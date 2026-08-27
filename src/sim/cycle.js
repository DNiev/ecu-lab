/**
 * The closed part of the engine cycle, solved on a crank-angle grid.
 *
 * The physics core. Indicated work, peak pressure, MBT and the knock limit are all read
 * off one integrated pressure trace, from intake valve close to exhaust valve open.
 *
 * WHY A TRACE. Torque used to be fuel energy times three efficiency scalars, with spark
 * entering through a parabola on a correlated MBT. That cannot express burn PHASING —
 * spark does not scale the work done, it moves WHEN the heat arrives relative to a piston
 * that is somewhere different at every crank angle. Too early and rising pressure fights
 * the piston still coming up; too late and the burn happens into a cylinder already
 * expanding. MBT is where those two losses balance, and it falls out of the integration
 * instead of being asserted.
 *
 * WHY A TRACE. Torque used to be fuel energy times three efficiency scalars, with spark
 * entering through a parabola on a correlated MBT. That cannot express burn PHASING —
 * spark does not scale the work done, it moves WHEN the heat arrives relative to a piston
 * that is somewhere different at every crank angle. Too early and rising pressure fights
 * the piston still coming up; too late and the burn happens into a cylinder already
 * expanding. MBT is where those two losses balance, and it falls out of the integration
 * instead of being asserted.
 *
 * THE MODEL. TWO ZONES sharing a pressure and carrying their own temperatures, which is
 * what lets it say anything honest about end-gas heating and exhaust temperature:
 *   - Slider-crank volume, so rod length and stroke matter.
 *   - Wiebe heat release after a flame-development delay.
 *   - Pressure from the first law over both zones: dp = (γ-1)/V · dQ − γ · p/V · dV.
 *   - Trapezoidal p dV, giving gross indicated MEP directly.
 *   - UNBURNED zone compressed isentropically by that pressure, less its wall loss.
 *   - BURNED zone from an open-system enthalpy balance: charge crosses the flame at the
 *     unburned temperature with its fuel energy, then does displacement work and loses
 *     heat to the wall.
 *   - Woschni wall heat transfer, against an area that grows as the piston uncovers the
 *     liner.
 *   - Crevice volume as real geometry, blowby as real lost mass.
 *
 * WHY ENGINE SPEED MATTERS TWICE. Knock is a pressure-AND-TIME problem: the Livengood-Wu
 * integral accumulates in MILLISECONDS, so a 1900 RPM cycle gives the end gas nearly
 * three times the dwell of a 5500 RPM one. It also gives it three times as long to shed
 * heat into a 450 K head. Model only the dwell side and the knock limit collapses at low
 * speed, exactly where a boosted engine makes its rated torque. Both halves are here.
 *
 * WHAT IT IS NOT. Not CFD. No flame-front geometry, so how much of the burned zone's heat
 * the end gas feels is one coefficient rather than a radiation view factor. Both zones are
 * well stirred — no boundary layer, no profile within either. Composition is frozen apart
 * from the two gammas, so dissociation is an effective gamma plus a ceiling rather than an
 * equilibrium solve. No cycle-to-cycle variation.
 */

import { COEFF } from './coefficients.js';
import { BARO_KPA, KPA_PER_BAR, R_AIR } from './constants.js';
import { clamp } from './math.js';
import { evaporativeCoolingK, residualFraction, trappedChargeK } from './thermo.js';

/**
 * Crank angle at which the exhaust valve opens, degrees after TDC firing.
 *
 * Exported because the acoustics model needs the same angle: the exhaust note is the
 * blowdown pulse that starts here, and two files holding their own idea of when the
 * valve cracks would drift apart silently.
 */
export const EVO_ATDC = 180 - 50;

/**
 * Cylinder volume at a crank angle, from the slider-crank geometry.
 *
 * Rod ratio matters and is not cosmetic: a short rod moves the piston away from TDC
 * faster just after the burn starts, which changes how much of the heat release lands
 * where it can do work.
 *
 * @param {number} thetaDeg crank angle, degrees after TDC firing (negative = before)
 * @param {number} clearanceM3 volume above the piston at TDC
 * @param {number} sweptM3 displacement of one cylinder
 * @param {number} rodRatio connecting rod length ÷ crank radius
 * @returns {number} cylinder volume, m³
 */
export function cylinderVolumeM3(thetaDeg, clearanceM3, sweptM3, rodRatio) {
  const th = (thetaDeg * Math.PI) / 180;
  const s = Math.sin(th);
  // Piston displacement from TDC, in crank radii.
  const x = rodRatio + 1 - Math.cos(th) - Math.sqrt(Math.max(0, rodRatio * rodRatio - s * s));
  return clearanceM3 + (sweptM3 / 2) * x;
}

/**
 * Crank angle at which the intake valve closes, degrees after BDC.
 *
 * A longer-duration camshaft holds the intake valve open later, which is why a big cam
 * loses low-RPM cylinder pressure: some of the charge is pushed back out before the
 * valve shuts. It is also why EFFECTIVE compression is always lower than the static
 * ratio stamped on the piston, and why a cammed engine tolerates more static
 * compression than its number suggests.
 *
 * @param {number} camDuration crank degrees
 * @returns {number} IVC, degrees after BDC
 */
export function ivcAfterBdcDeg(camDuration) {
  return COEFF.IVC_BASE_ABDC + (camDuration - COEFF.IVC_CAM_REF_DURATION) * COEFF.IVC_PER_CAM_DEG;
}

/**
 * Burn duration — the crank angle the Wiebe function spans, from the end of the flame
 * development delay to essentially complete combustion.
 *
 * This is the TOTAL duration, not the 10-90% figure usually quoted in the literature.
 * With `WIEBE_A = 5` and `WIEBE_M = 2` the 10-90% window is very close to half of it, so
 * a 42-degree total here is a ~21-degree 10-90%, which is where a production engine sits.
 *
 * Burn duration in CRANK degrees is roughly constant with engine speed, because
 * turbulence intensity scales with piston speed and the flame speeds up in proportion.
 * It is not exactly constant, and the residual dilution and mixture terms below are the
 * two things a tuner can actually move it with.
 *
 * @param {object} input
 * @param {number} input.rpm engine speed
 * @param {number} input.lambda delivered lambda
 * @param {number} input.residualFrac burned gas left over from the previous cycle, 0..1
 * @param {number} [input.boreFlameFactor] flame travel scaling from bore, 1 at reference
 * @returns {number} burn duration, crank degrees
 */
export function burnDurationDeg({ rpm, lambda, residualFrac, boreFlameFactor = 1 }) {
  // Mixture: fastest a little rich of stoichiometric, slower in both directions — but
  // NOT symmetrically. Laminar flame speed falls away far faster on the lean side, where
  // there is surplus air to heat and nothing extra burning to heat it, than on the rich
  // side, where the surplus fuel at least keeps the flame temperature up. Treating the
  // two the same made a lean charge burn almost as fast as a rich one, which is what let
  // the model conclude that lean-under-load was SAFER — the burn stayed short, so the end
  // gas had no more time to light itself. It is not safer, and the asymmetry is why.
  const lambdaOff = lambda - COEFF.BURN_FASTEST_LAMBDA;
  const penalty = lambdaOff > 0 ? COEFF.BURN_LAMBDA_PENALTY_LEAN : COEFF.BURN_LAMBDA_PENALTY_RICH;
  const mixtureFactor = 1 + lambdaOff * lambdaOff * penalty;
  // Dilution: residual burned gas has no oxygen and absorbs heat, so the flame crawls.
  const dilutionFactor = 1 + residualFrac * COEFF.BURN_RESIDUAL_PENALTY;
  const speedFactor = 1 + (rpm - COEFF.BURN_RPM_REF) * COEFF.BURN_PER_RPM;
  return COEFF.BURN_DURATION_BASE_DEG * boreFlameFactor
    * mixtureFactor * dilutionFactor * clamp(speedFactor, 0.7, 1.6);
}

/**
 * @typedef {object} CycleInput
 * @property {number} rpm engine speed
 * @property {number} sparkBtdc commanded spark advance, degrees before TDC
 * @property {number} trappedPa cylinder pressure at intake valve close
 * @property {number} trappedK charge temperature at intake valve close
 * @property {number} heatJ chemical energy released by the burn, joules
 * @property {number} clearanceM3 volume above the piston at TDC
 * @property {number} sweptM3 one cylinder's displacement
 * @property {number} rodRatio connecting rod length ÷ crank radius
 * @property {number} ivcAbdc intake valve close, degrees after BDC
 * @property {number} burnDeg burn duration, crank degrees
 * @property {number} boreM cylinder bore, metres — sets heat-transfer area
 * @property {number} strokeM stroke, metres — sets piston speed and liner area
 * @property {number} trappedMassKg total mass in the cylinder, for the gas-law temperature
 * @property {number} octaneNumber fuel antiknock index
 * @property {number} [lambda] delivered lambda; sets how hot the flame behind the
 *   front runs, which heats the end gas on top of compression
 */

/**
 * @typedef {object} CycleResult
 * @property {number} imepGrossPa gross indicated MEP over the closed period
 * @property {number} peakPressurePa highest cylinder pressure reached
 * @property {number} peakPressureDeg crank angle of that peak, degrees ATDC
 * @property {number} peakEndGasK hottest the unburned end gas got
 * @property {number} peakBurnedK hottest the burned zone got — the flame temperature
 * @property {number} exhaustK gas temperature at the port, after blowdown
 * @property {number} blowbyFrac charge lost past the rings over the closed period
 * @property {number} knockIntegral Livengood-Wu autoignition integral; ≥ 1 means knock
 * @property {number} mfb50Deg crank angle of 50% mass burned, degrees ATDC
 */

/**
 * Integrates one closed cycle and reports what the pressure trace says.
 *
 * @param {CycleInput} input
 * @returns {CycleResult}
 */
export function runCycle({
  rpm, sparkBtdc, trappedPa, trappedK, heatJ,
  clearanceM3, sweptM3, rodRatio, ivcAbdc, burnDeg, octaneNumber,
  boreM, strokeM, trappedMassKg,
}) {
  const step = COEFF.CYCLE_STEP_DEG;
  const thetaStart = -180 + ivcAbdc;
  const spark = -sparkBtdc;
  // Spark does not light the charge instantly: there is a delay while a kernel forms
  // and grows to a self-sustaining flame. Combustion is therefore phased from the end
  // of that delay, not from the spark event.
  const burnStart = spark + COEFF.FLAME_DEVELOPMENT_DEG;
  const burnEnd = burnStart + burnDeg;
  // Geometry the wall heat-transfer model needs. What reaches the piston is the heat
  // release minus whatever the walls take, and the wall term is computed per step below
  // rather than assumed as a fixed fraction of the fuel.
  const boreAreaM2 = (Math.PI / 4) * boreM * boreM;
  const meanPistonSpeed = 2 * strokeM * (rpm / 60);
  // Motored reference state for the Woschni combustion term: what the pressure would
  // have been at this crank angle with no combustion at all.
  const vIvcRef = cylinderVolumeM3(thetaStart, clearanceM3, sweptM3, rodRatio);
  // Time per crank degree, milliseconds — the clock the autoignition integral runs on.
  const msPerDeg = 1000 / (6 * Math.max(rpm, 1));

  // Constant for the whole cycle, so it is computed once rather than at every step:
  // the octane and scale part of the ignition-delay correlation.
  const tauFuelTerm = COEFF.KNOCK_TAU_SCALE * COEFF.KNOCK_DE_A
    * Math.pow(octaneNumber / 100, COEFF.KNOCK_DE_B);
  // Specific heats for the two zones, from their gammas.
  const cvU = R_AIR / (COEFF.GAMMA_UNBURNED - 1);
  const cpU = cvU + R_AIR;
  const cpB = R_AIR / (COEFF.GAMMA_BURNED - 1) + R_AIR;
  // Energy the fuel releases per kg of charge that burns.
  const qPerKg = trappedMassKg > 0 ? heatJ / trappedMassKg : 0;
  // Crevices: the piston top-land gap and the head gasket bore. Gas pushed in there sits
  // at wall temperature and takes no part in combustion, then comes back out on
  // expansion. This is where most unburnt hydrocarbon actually comes from.
  const creviceM3 = clearanceM3 * COEFF.CREVICE_VOLUME_FRAC;

  let p = trappedPa;
  let v = cylinderVolumeM3(thetaStart, clearanceM3, sweptM3, rodRatio);
  let work = 0;
  let peakPressurePa = p;
  let peakPressureDeg = thetaStart;
  let peakEndGasK = trappedK;
  let peakBurnedK = trappedK;
  let knockIntegral = 0;
  let mfb50Deg = burnStart + burnDeg / 2;
  let prevBurned = 0;
  let crossed50 = false;
  // The two zones. Unburned starts as the whole charge at the trapped state; burned
  // starts empty and is seeded at the first step that burns anything.
  let tU = trappedK;
  let tB = trappedK;
  // Charge blown past the rings, as a fraction of what was trapped. Real and permanent:
  // it never does work on the piston and never comes back.
  let blowbyFrac = 0;
  // Heat the unburned zone has given up to the wall so far, as degrees below adiabatic.
  let endGasCoolK = 0;

  /** Wiebe mass fraction burned at a crank angle. */
  const burnedFraction = (theta) => {
    if (theta <= burnStart) return 0;
    if (theta >= burnEnd) return 1;
    const x = (theta - burnStart) / burnDeg;
    return 1 - Math.exp(-COEFF.WIEBE_A * Math.pow(x, COEFF.WIEBE_M + 1));
  };

  for (let theta = thetaStart; theta < EVO_ATDC; theta += step) {
    const thetaNext = theta + step;
    const vNext = cylinderVolumeM3(thetaNext, clearanceM3, sweptM3, rodRatio);
    const burned = burnedFraction(thetaNext);
    const dQ = (burned - prevBurned) * heatJ;

    // Gamma falls as the charge burns: hot products are polyatomic and store energy in
    // vibration. Blending is the cheap stand-in for two zones, and it matters — holding
    // gamma unburned overstates peak pressure badly.
    const gamma = COEFF.GAMMA_UNBURNED
      + (COEFF.GAMMA_BURNED - COEFF.GAMMA_UNBURNED) * burned;

    // --- WALL HEAT TRANSFER, per step, from Woschni. Heat loss scales with surface
    // area, gas temperature and charge motion, NOT with fuel — so a small cylinder, a
    // slow-turning engine and a boosted one each lose proportionally more, none of which
    // a flat fraction of fuel energy could express.
    const chargeKg = trappedMassKg * (1 - blowbyFrac);
    const tGas = (p * v) / (chargeKg * R_AIR);
    // Exposed area: head, piston crown, and the liner the piston has uncovered.
    const strokeFrac = Math.max(0, (v - clearanceM3) / sweptM3);
    const areaM2 = 2 * boreAreaM2 + Math.PI * boreM * strokeM * strokeFrac;
    // Woschni's characteristic gas velocity. The second term is the extra motion
    // combustion itself creates, driven by how far pressure has risen above the motored
    // trace — so it only appears once something is burning.
    const pMotoredPa = trappedPa * Math.pow(vIvcRef / v, COEFF.GAMMA_UNBURNED);
    const wGas = COEFF.WOSCHNI_C1 * meanPistonSpeed
      + (burned > 0
        ? COEFF.WOSCHNI_C2 * (sweptM3 * trappedK / (trappedPa * vIvcRef))
          * Math.max(0, p - pMotoredPa)
        : 0);
    const hCoeff = COEFF.WOSCHNI_K * Math.pow(boreM, -0.2)
      * Math.pow(p / 1000, 0.8) * Math.pow(tGas, -0.55) * Math.pow(Math.max(wGas, 0.1), 0.8);
    // Seconds per integration step: a crank turns 6 x rpm degrees per second.
    const dtS = step / (6 * Math.max(rpm, 1));
    const dQwall = hCoeff * areaM2 * (tGas - COEFF.WALL_TEMP_K) * dtS;

    // First law over both zones together: pressure rises with heat added, falls as the
    // volume grows, and falls again with whatever the walls took. Gas hiding in the
    // crevices is at wall temperature and out of the working volume.
    const workingV = Math.max(v - creviceM3, clearanceM3 * 0.1);
    const dp = ((gamma - 1) / workingV) * (dQ - dQwall) - (gamma * p * (vNext - v)) / workingV;
    const pNext = Math.max(1, p + dp);

    // Work on the piston, trapezoidal.
    work += ((p + pNext) / 2) * (vNext - v);

    // --- BLOWBY. Flow past the rings scales with the pressure ratio across them, so it
    // is a peak-pressure phenomenon: negligible at cruise, real at 70 bar. The mass is
    // gone for good, which is why a tired ring pack costs power everywhere at once.
    blowbyFrac += COEFF.BLOWBY_PER_BAR_S * (pNext / (KPA_PER_BAR * 1000)) * dtS;

    // --- THE TWO ZONES.
    //
    // UNBURNED: compressed isentropically by whatever the burned gas is doing to the
    // pressure, less the heat it gives up to the wall. Its share of the wall area and of
    // the mass are both roughly (1 - burned), so those cancel and what is left is the
    // same Woschni coefficient against the unburned charge's own heat capacity.
    tU = trappedK * Math.pow(pNext / trappedPa, (COEFF.GAMMA_UNBURNED - 1) / COEFF.GAMMA_UNBURNED)
      - endGasCoolK;
    endGasCoolK += (hCoeff * areaM2 * Math.max(0, tU - COEFF.WALL_TEMP_K) * dtS)
      / Math.max(1e-9, chargeKg * cvU);
    tU = Math.max(COEFF.WALL_TEMP_K, tU);

    // BURNED: an energy balance on the burned mass. Charge crosses the flame at the
    // unburned temperature with its fuel energy, then does displacement work and loses
    // its share to the wall. Replaces the fitted Gaussian that used to assert where flame
    // temperature peaks; the balance now produces that on its own.
    if (burned > 0) {
      const dBurned = burned - prevBurned;
      // Seed the zone at the unburned temperature the instant it first has mass in it,
      // so the first step's balance is not dividing into an empty zone.
      if (prevBurned <= 0) tB = tU;
      // Open-system enthalpy balance, per kg of TOTAL charge:
      //   x·cp_b·dT_b = (x·R·T_b/p)·dp + dx·(h_in − h_b) + q_released − q_wall
      // Everything below is that, term by term.
      const flowWork = (burned * R_AIR * tB / Math.max(p, 1)) * (pNext - p);
      const enthalpyIn = dBurned * (cpU * tU - cpB * tB);
      const released = dBurned * qPerKg;
      const qWallB = (hCoeff * areaM2 * burned * Math.max(0, tB - COEFF.WALL_TEMP_K) * dtS)
        / Math.max(1e-9, chargeKg);
      // Heat capacity rises with temperature — vibrational modes and dissociation — which
      // is what keeps flame temperature from collapsing either side of stoichiometric.
      const cpBhot = cpB * (1 + COEFF.CP_BURNED_TEMP_RISE
        * Math.max(0, tB - COEFF.CP_BURNED_REF_K) / 1000);
      tB += (flowWork + enthalpyIn + released - qWallB) / (burned * cpBhot);
      tB = clamp(tB, tU, COEFF.BURNED_GAS_MAX_K);
      if (tB > peakBurnedK) peakBurnedK = tB;
    }

    // --- AUTOIGNITION of what is left unburned. The end gas is heated by compression AND
    // by the burned gas right behind the flame front, which the two-zone temperature now
    // gives directly rather than through a fitted multiplier.
    if (burned < COEFF.KNOCK_ENDGAS_BURN_LIMIT) {
      const endGasK = tU + (tB - tU) * burned * COEFF.ENDGAS_FLAME_COUPLING;
      if (endGasK > peakEndGasK) peakEndGasK = endGasK;
      // Douaud & Eyzat ignition delay: how long this mixture survives at this pressure
      // and temperature before lighting itself. Octane enters here as a fuel property.
      const tau = tauFuelTerm
        * Math.pow(pNext / COEFF.ATM_PA, -COEFF.KNOCK_DE_N)
        * Math.exp(COEFF.KNOCK_DE_E / endGasK);
      // Livengood-Wu: autoignition when the accumulated fraction of the delay reaches 1.
      knockIntegral += (step * msPerDeg) / tau;
    }

    if (pNext > peakPressurePa) { peakPressurePa = pNext; peakPressureDeg = thetaNext; }
    if (!crossed50 && burned >= 0.5) { mfb50Deg = thetaNext; crossed50 = true; }

    p = pNext;
    v = vNext;
    prevBurned = burned;
  }

  // Exhaust temperature, from the cycle's own state at exhaust valve open rather than
  // from a correlation. What leaves the port is the burned zone after blowdown to the
  // manifold: an irreversible expansion from cylinder pressure, which cools it.
  //
  // This is what the DATALOG reports as EGT. It is not what the turbine balance uses —
  // that needs an answer before the cycle can run, so it has `exhaustTempK` in thermo.js
  // instead. An earlier comment here claimed this was "the number the turbine should
  // see", which is a statement about what ought to be true rather than what is, and it
  // cost time when issue #47 was being tracked down.
  // The ratio is capped at 1 because blowdown is an EXPANSION — it can only cool. Below
  // roughly half throttle the cylinder is still under manifold pressure when the valve
  // opens, and the uncapped ratio inverted into an isentropic COMPRESSION that heated
  // the exhaust: a 20 kPa cruise point came out at 2.25x and left the port ~250 K hotter
  // than the burned gas that fed it, so the datalog read EGT climbing as the driver
  // lifted. There is no expansion to have in that case; the charge is simply pushed out.
  const blowdownRatio = Math.min(1, BARO_KPA * 1000 / Math.max(p, 1));
  const blowdownK = tB * Math.pow(
    Math.max(0.05, blowdownRatio),
    (COEFF.GAMMA_BURNED - 1) / COEFF.GAMMA_BURNED,
  );

  // THE CHARGE DOES NOT ALL LEAVE THE SAME WAY, AND THAT IS WHAT SETS EGT WITH LOAD.
  //
  // Blowdown only accounts for the mass that escapes on its own pressure while the
  // cylinder is still above the manifold. The REST is pushed out by the piston over the
  // whole exhaust stroke, at manifold pressure, in contact with a port and chamber
  // hundreds of kelvin cooler than it is — so it arrives at the probe much cooler than
  // the blowdown pulse did.
  //
  // The split is what makes this strongly load-dependent, and it is why modelling port
  // heat loss alone cannot fix issue #47. At wide-open throttle the cylinder is far
  // above the manifold at valve opening, so about 70% of the charge leaves as a hot
  // blowdown pulse. At 40 kPa it is barely above the manifold at all, so only about 18%
  // does and the other 82% is pushed out slowly against the walls. Same fuel-air ratio,
  // same burned-gas temperature, very different exhaust temperature — which is exactly
  // what a real engine does, and the opposite of what this model used to report.
  //
  //     f_blowdown = 1 - (p_man / p_evo)^(1/gamma)
  //
  // The displaced remainder approaches wall temperature over its residence time. NTU
  // carries the weak flow dependence of turbulent convection: h scales about as
  // mdot^0.8, so NTU = hA/(mdot*cp) scales as mdot^-0.2. That term is deliberately weak,
  // because it IS weak — a 3.5x change in flow moves it by 28%. The load dependence
  // above is doing the work, as it should.
  const blowdownMassFrac = 1 - Math.pow(
    Math.max(0.05, blowdownRatio), 1 / COEFF.GAMMA_BURNED,
  );
  const flowRef = Math.max(1e-9, trappedMassKg * rpm);
  const ntu = COEFF.EXHAUST_PORT_NTU
    * Math.pow(COEFF.EXHAUST_PORT_FLOW_REF / flowRef, COEFF.EXHAUST_PORT_FLOW_EXP);
  const displacedK = COEFF.WALL_TEMP_K
    + (blowdownK - COEFF.WALL_TEMP_K) * Math.exp(-ntu);
  const portK = blowdownMassFrac * blowdownK + (1 - blowdownMassFrac) * displacedK;

  return {
    imepGrossPa: work / sweptM3,
    peakPressurePa,
    peakPressureDeg,
    peakEndGasK,
    peakBurnedK,
    exhaustK: Math.max(COEFF.WALL_TEMP_K, portK),
    blowbyFrac,
    knockIntegral,
    mfb50Deg,
  };
}

/**
 * The most spark advance this cycle tolerates before the end gas lights itself.
 *
 * Solved from `runCycle` rather than looked up, so every input that changes the pressure
 * history — compression, boost, charge temperature, mixture, engine speed, cam timing,
 * octane — moves the limit automatically, with no separate term for each.
 *
 * A mixture that cannot knock anywhere in range reports KNOCK_UNBOUNDED_BTDC, not the
 * ceiling: the ceiling is an artefact of the search, not a property of the engine.
 *
 * @param {CycleInput} base cycle inputs; `sparkBtdc` is ignored
 * @returns {number} knock-limited spark advance, degrees BTDC
 */
export function knockLimitedSpark(base) {
  const integralAt = (sparkBtdc) => runCycle({ ...base, sparkBtdc }).knockIntegral;
  const lo = COEFF.KNOCK_SEARCH_MIN_BTDC;
  const hi = COEFF.KNOCK_SEARCH_MAX_BTDC;

  // Most logged points cannot be made to knock at all — anything at cruise, and any
  // low-compression engine off boost. Testing the advanced end first answers those in
  // one cycle evaluation instead of a full search, which matters because this runs for
  // every point of every pull.
  if (integralAt(hi) < 1) return COEFF.KNOCK_UNBOUNDED_BTDC;
  if (integralAt(lo) >= 1) return lo;

  // Bisection. The search ceiling is deliberately below the advance at which the
  // autoignition integral stops being monotonic: advance far enough and the charge is
  // almost entirely burned before TDC, so there is little end gas left to accumulate
  // delay and the integral turns back DOWN. Bisecting across that hump would report a
  // "knock limit" well past where the engine actually started detonating. Keeping the
  // ceiling below it means the function is monotonic everywhere it is searched.
  let a = lo;
  let b = hi;
  while (b - a > COEFF.KNOCK_SEARCH_TOL_DEG) {
    const mid = (a + b) / 2;
    if (integralAt(mid) >= 1) b = mid; else a = mid;
  }
  return a;
}

/**
 * Peak cylinder pressure in bar, for display and for the wear model.
 *
 * @param {number} peakPressurePa
 * @returns {number} bar
 */
export const paToBar = (peakPressurePa) => peakPressurePa / (KPA_PER_BAR * 1000);

/**
 * Air actually trapped in one cylinder for one cycle, grams — the ideal gas law against
 * swept volume, scaled by VE. Exported so the per-point solve and the calibration
 * generator cannot end up with two ideas of how much air is in the cylinder.
 *
 * @param {object} input
 * @param {number} input.veActual true cylinder filling, percent
 * @param {number} input.mapKpa manifold absolute pressure, kPa
 * @param {number} input.chargeK incoming charge temperature, K
 * @param {number} input.sweptM3 one cylinder's displacement
 * @returns {number} grams of air
 */
export function trappedAirGrams({ veActual, mapKpa, chargeK, sweptM3 }) {
  const densityKgM3 = (mapKpa * 1000) / (R_AIR * chargeK);
  return (veActual / 100) * sweptM3 * densityKgM3 * 1000;
}

/**
 * Builds the cycle inputs for one operating point. Shared by the per-point solve and the
 * factory calibration generator: two copies would drift, and the generated calibration
 * would then be knock-limited against a different engine than the player drives.
 *
 * @param {object} input
 * @param {number} input.rpm engine speed
 * @param {number} input.mapKpa manifold absolute pressure, kPa
 * @param {number} input.empKpa exhaust manifold pressure, kPa
 * @param {number} input.intakeK incoming charge temperature, K
 * @param {number} input.airChargeG air actually trapped per cylinder per cycle, grams
 * @param {number} input.burnedFuelG fuel that finds oxygen to burn, grams
 * @param {number} [input.fuelMassG] fuel delivered, grams — all of it evaporates and
 *   cools the charge, including the part too rich to find oxygen. Defaults to the
 *   burned mass when a caller has no separate figure
 * @param {number} input.lambda delivered lambda
 * @param {{lhv: number, octane: number, stoich: number}} input.fuel
 * @param {import('./engine.js').DerivedEngine} input.derived
 * @returns {CycleInput & {residualFrac: number, trappedK: number, effectiveCr: number}}
 */
export function cycleInputsFor({
  rpm, mapKpa, empKpa, intakeK, airChargeG, burnedFuelG, fuelMassG, lambda, fuel, derived,
}) {
  const fuelIn = fuelMassG ?? burnedFuelG;
  const sweptM3 = (derived.displacementL / derived.cyl) / 1000;
  const clearanceM3 = sweptM3 / (derived.compression - 1);
  const ivcAbdc = ivcAfterBdcDeg(derived.camDuration);
  const vIvc = cylinderVolumeM3(-180 + ivcAbdc, clearanceM3, sweptM3, COEFF.ROD_RATIO);

  const residualFrac = residualFraction({
    mapKpa, empKpa, overlapDeg: derived.overlapDeg || 0, compression: derived.compression,
  });
  // Fuel evaporating into the charge cools it before anything else happens to it, so a
  // richer mixture starts compression colder and a leaner one starts hotter.
  const cooledK = intakeK - evaporativeCoolingK(fuelIn, airChargeG, fuel);
  const trappedK = trappedChargeK(cooledK, residualFrac) + (derived.chamberOffsetK || 0);

  // Pressure at intake valve close, from the ideal gas law on the fresh charge at the
  // temperature it arrived at. Deriving it rather than assuming it equals manifold
  // pressure is what lets volumetric efficiency above 100% — ram and scavenging — show
  // up as genuinely higher cylinder pressure.
  //
  // Deliberately NOT re-derived at the residual-mixed temperature. The manifold sets the
  // pressure at IVC; hot residual raises the charge TEMPERATURE at that pressure, it
  // does not pressurise the cylinder further. Computing p from the mixed temperature at
  // fixed mass inflated trapped pressure by about a tenth under boost, and since
  // ignition delay goes as pressure to the -1.7 power, that alone made boosted engines
  // far more knock-prone than they are. Pressure comes from the fresh charge; the mixed
  // temperature below is what the thermal history and the end gas run on.
  const trappedPa = ((airChargeG / 1000) * R_AIR * cooledK) / vIvc;

  // Everything in the cylinder that has heat capacity: fresh air, the residual it mixed
  // with, AND the fuel vapour. Counting the fuel matters — it is why a rich mixture burns
  // cooler even though it releases the same heat. Past stoichiometric the extra fuel
  // finds no oxygen, so it adds mass to warm without adding energy, and flame temperature
  // falls. Leave it out and over-fuelling looks thermally free.
  const totalMassKg = ((airChargeG + fuelIn) / 1000) / Math.max(0.05, 1 - residualFrac);

  return {
    rpm,
    sparkBtdc: 0,
    trappedPa,
    boreM: derived.bore / 1000,
    strokeM: derived.stroke / 1000,
    trappedMassKg: totalMassKg,
    trappedK,
    heatJ: (burnedFuelG / 1000) * fuel.lhv * COEFF.COMBUSTION_COMPLETENESS,
    clearanceM3,
    sweptM3,
    rodRatio: COEFF.ROD_RATIO,
    ivcAbdc,
    burnDeg: burnDurationDeg({
      rpm, lambda, residualFrac, boreFlameFactor: derived.boreFlameFactor,
    }),
    octaneNumber: fuel.octane,
    lambda,
    residualFrac,
    effectiveCr: vIvc / clearanceM3,
  };
}

/**
 * MBT for one table cell, from the cycle the rest of the model runs. The advisor and the
 * calibration generator both come through here so they cannot disagree about what good
 * timing looks like.
 *
 * @param {Parameters<typeof cycleInputsFor>[0]} input
 * @returns {number} MBT spark advance, degrees BTDC
 */
export function mbtForCell(input) {
  return mbtFromBurn(cycleInputsFor(input).burnDeg);
}

/**
 * Minimum spark for best torque, derived rather than correlated.
 *
 * Best torque lands with 50% of the mass burned 8-10 degrees after TDC across engine
 * types. Given the Wiebe shape, 50% burn is a fixed fraction of the duration after
 * ignition, so the timing that puts it there is written down rather than fitted — which
 * makes MBT respond to mixture, dilution and speed, as the old correlation could not.
 *
 * @param {number} burnDeg burn duration, crank degrees
 * @returns {number} MBT spark advance, degrees BTDC
 */
export function mbtFromBurn(burnDeg) {
  // Crank angle of 50% burn, as a fraction of the burn duration: solve the Wiebe
  // function for x where the burned fraction is one half.
  const half = Math.pow(Math.log(2) / COEFF.WIEBE_A, 1 / (COEFF.WIEBE_M + 1));
  // Clamped to the band a spark table can actually hold, which is the guard the
  // light-load MBT work added: a very slow, heavily diluted burn would otherwise ask
  // for advance no calibration would ever write.
  return clamp(
    COEFF.FLAME_DEVELOPMENT_DEG + half * burnDeg - COEFF.MFB50_ATDC_DEG,
    COEFF.MBT_MIN_DEG, COEFF.MBT_MAX_DEG,
  );
}

/**
 * Calibration coefficients.
 *
 * Every empirically-tuned number in the simulation lives here, in one place, so a
 * contributor can find and adjust the model without hunting through formulas.
 * Each is annotated with what it represents and roughly why it has the value it has.
 *
 * No other file in `src/sim/` should contain a bare magic number. If you are adding
 * physics and need a fudge factor, put it here with a comment explaining it — that
 * rule is what keeps the model auditable.
 *
 * KEY ORDER IS PART OF THE FINGERPRINT. `tests/fingerprint.js` hashes this object as
 * declared, so MOVING a coefficient fails the fingerprint exactly as if you had changed
 * its value. Add new keys at the end of their section; do not reshuffle.
 *
 * Changing anything here will move the dyno numbers, which means the behavioural
 * fingerprint tests in `tests/` will fail. That is intentional: review the diff,
 * confirm the new numbers are what you meant, then refresh the fixture with
 * `npm run test:fingerprint:update`.
 */
export const COEFF = {
  // --- Friction & pumping (mean effective pressures, Pa) ---
  RUBBING_BASE_PA: 45000,      // rubbing FMEP at zero RPM
  RUBBING_PER_RPM: 6.5,        // rubbing FMEP rise per RPM
  SPRING_FMEP_PER_RATE: 190,   // extra FMEP per point of valve spring rate above stock
  SPRING_RPM_BIAS: 0.6,        // how much of spring drag scales with RPM (rest is constant)
  // Extra rubbing FMEP per main bearing beyond the V6 baseline of four.
  // Anchored arithmetically rather than guessed: total rubbing FMEP at 6000 RPM is
  // about 84 kPa, published breakdowns put the crankshaft group near 15% of friction
  // (~12.6 kPa), and the baseline carries four mains — so roughly 3 kPa each.
  FMEP_PER_MAIN_BEARING_PA: 3000,
  // Fraction of rubbing friction a balance shaft pair adds. Source: National Academies
  // fuel-economy report, 6% measured on Ford's 1.0 L I3 — but that is a SINGLE shaft on
  // a triple, applied here to twin-shaft 1.8 L+ I4s. An extrapolation, not a match.
  FMEP_BALANCE_SHAFT_FRAC: 0.06,

  // --- Engine cycle: geometry and integration (see cycle.js) ---
  // Integration step, crank degrees. 133 steps over the closed period. Halving it moves
  // indicated work under 0.2% and doubles the cost of every knock search — not worth it.
  CYCLE_STEP_DEG: 2,
  // Rod length / crank radius. Production petrol runs 1.5-1.9. Not player-editable, but
  // read from here rather than assumed infinite, which would misplace the piston at TDC.
  ROD_RATIO: 1.75,
  // Intake valve close, degrees after BDC, and how it tracks cam duration. IVC sets
  // EFFECTIVE compression — the piston does not compress until the valve shuts — which is
  // why a big cam tolerates more static compression and gives away low-RPM pressure.
  IVC_BASE_ABDC: 45,
  IVC_CAM_REF_DURATION: 210,
  IVC_PER_CAM_DEG: 0.5,
  // Ratio of specific heats, blended by mass fraction burned. Unburned air at chamber
  // temperature is ~1.35. Burned products dissociate, dropping the effective value into
  // the published 1.20-1.27 band; this sits at the dissociated end, without which the
  // cycle reads ~8% high. Holding gamma unburned throughout overstates peak pressure ~15%.
  GAMMA_UNBURNED: 1.35,
  GAMMA_BURNED: 1.235,
  // --- Wall heat transfer (Woschni) ---
  // h = K · B^-0.2 · p^0.8 · T^-0.55 · w^0.8, W/(m^2·K), pressure in kPa. PUBLISHED
  // coefficients, not fitted. C1 is the piston-speed term, C2 the combustion term driven
  // by pressure rise above the motored trace.
  WOSCHNI_K: 3.26,
  WOSCHNI_C1: 2.28,
  WOSCHNI_C2: 3.24e-3,
  // Mean chamber wall temperature, K. Coolant ~370 K, metal surfaces above it.
  WALL_TEMP_K: 450,
  // Standard atmosphere, Pa — the unit Douaud-Eyzat is written in.
  ATM_PA: 101325,

  // --- Engine cycle: combustion (Wiebe) ---
  // Wiebe efficiency and form factors. a = 5 burns 99.3% by the end of the nominal
  // duration; m = 2 gives the S-curve measured traces follow.
  WIEBE_A: 5,
  WIEBE_M: 2,
  // Spark to appreciable heat release, crank degrees, while the kernel forms. Real
  // engines show 5-15 depending on charge motion.
  FLAME_DEVELOPMENT_DEG: 8,
  // Burn duration at the reference condition. NOTE this is the TOTAL Wiebe span, not the
  // 10-90% figure the literature quotes — at a=5, m=2 the 10-90% window is almost exactly
  // half, so 42 here is a ~21 degree 10-90%, which is where a production engine sits.
  // Duration in CRANK degrees is near speed-independent (turbulence scales with piston
  // speed), which is why BURN_PER_RPM is small rather than proportional.
  BURN_DURATION_BASE_DEG: 42,
  BURN_RPM_REF: 4000,
  BURN_PER_RPM: 0.00004,
  // Lambda that burns fastest — slightly rich, which is part of why best torque is rich.
  BURN_FASTEST_LAMBDA: 0.9,
  // How sharply the burn slows either side of that — NOT symmetric. Published laminar
  // flame speeds fall roughly twice as fast per unit of lambda on the lean side: surplus
  // air is inert mass to heat, where surplus fuel keeps flame temperature up. A symmetric
  // penalty let a lean charge burn nearly as fast as a rich one, so the end gas never got
  // the extra dwell that actually kills pistons.
  BURN_LAMBDA_PENALTY_RICH: 1.4,
  BURN_LAMBDA_PENALTY_LEAN: 4.2,
  // Dilution slows the flame: residual gas carries no oxygen and soaks up heat. This is
  // a big cam's lumpy idle. ANCHOR: 20 kPa cruise lands ~26% residual, an 82 degree burn
  // and 42 degrees of MBT, which is the 40-50 band real factory cruise maps carry (#34).
  BURN_RESIDUAL_PENALTY: 3.8,
  // Fuel that finds oxygen and burns to completion. Real homogeneous SI combustion leaves
  // 1-3% in crevices and quench layers — this is why an engine has HC emissions.
  COMBUSTION_COMPLETENESS: 0.97,
  // --- Crevice volume and blowby ---
  // The piston top-land gap, the ring-groove clearance and the head gasket bore, as a
  // fraction of the clearance volume. Published figures for production engines run
  // 1.5-3% of clearance. Gas driven in there sits at wall temperature, takes no part in
  // combustion, and comes back out during expansion too late and too cold to burn — it
  // is where most unburnt hydrocarbon actually comes from, and it is why
  // COMBUSTION_COMPLETENESS above is not 1.
  CREVICE_VOLUME_FRAC: 0.022,
  // Charge lost past the rings per second, per bar of cylinder pressure. Production
  // engines lose roughly half a percent to one percent of trapped mass per cycle at full
  // load; this reproduces that and, unlike a flat fraction, scales with pressure — so
  // blowby is negligible at cruise and real at 70 bar, which is why a tired ring pack
  // shows up under boost first.
  BLOWBY_PER_BAR_S: 0.00025,

  // --- Engine cycle: autoignition (Douaud & Eyzat) ---
  // tau[ms] = SCALE · A · (ON/100)^B · p[atm]^-N · exp(E/T[K]), integrated per
  // Livengood-Wu until the accumulated fraction reaches 1. A, B, N and E are the
  // PUBLISHED coefficients. SCALE is the one fitted number in the knock model: published
  // Douaud-Eyzat was derived on one specific chamber, and every implementation carries a
  // scale factor for the engine it is applied to. It also absorbs, in one place, what the
  // cycle does not model — chamber shape, turbulence, port vs direct injection.
  //
  // THREE ANCHORS, and changing SCALE must keep all three:
  //   1. Every preset reaches published output with its factory calibration knock-free.
  //   2. A stock 10.3:1 on 91 octane runs out of margin at 36.0 deg at 5500 RPM, falling
  //      to 23.5 at 3000 — a real one does. (Emergent: low speed means more milliseconds
  //      of dwell for the end gas. The old additive envelope needed a term for it.)
  //   3. The shipped stock calibration runs knock-free — what a new player meets first.
  // Higher values pass the presets more easily but push the NA limit past anything the
  // app can command, deleting the tutorial's most basic lesson.
  // `tests/presets.test.js` fails if 1 or 3 break.
  KNOCK_TAU_SCALE: 2.0,
  KNOCK_DE_A: 17.68,
  KNOCK_DE_B: 3.402,
  KNOCK_DE_N: 1.7,
  KNOCK_DE_E: 3800,
  // How much of the burned zone's temperature the end gas feels, per unit of mass already
  // burned. The zones share a pressure but not a boundary layer: the unburned charge is
  // heated by radiation and conduction from the flame front, not by mixing with it.
  // Replaces a three-coefficient Gaussian in lambda — the energy balance now produces the
  // peak on its own rather than being told where it is.
  ENDGAS_FLAME_COUPLING: 0.035,
  // Ceiling on burned-gas temperature, K. Above this, dissociation absorbs essentially
  // all further heat release, which a fixed-gamma zone cannot represent.
  BURNED_GAS_MAX_K: 2900,
  // Burned-gas heat capacity rise per 1000 K above the reference. Vibrational modes and
  // dissociation both soak up heat that would otherwise show as temperature; frozen
  // composition cannot express that, so flame temperature fell off far too steeply either
  // side of stoichiometric — a 5% lean mixture lost over 100 K where a real one loses ~40.
  CP_BURNED_TEMP_RISE: 0.30,
  CP_BURNED_REF_K: 1800,
  // Stop accumulating once this much of the charge has burned: past it there is
  // essentially no unburned end gas left to autoignite.
  KNOCK_ENDGAS_BURN_LIMIT: 0.95,
  // Bracket and tolerance for the knock-limit search. MAX must stay BELOW the advance at
  // which the autoignition integral stops being monotonic (see knockLimitedSpark), or
  // bisection reports a limit past where the engine actually detonated.
  KNOCK_SEARCH_MIN_BTDC: -10,
  KNOCK_SEARCH_MAX_BTDC: 45,
  // Reported when nothing in range can be made to knock — a cylinder in deep vacuum.
  // Must NOT be the search ceiling: the advisor reads that as a hard limit and calls
  // stock cruise cells carrying 47 degrees dangerous. Far above any spark table, so
  // whatever else binds (MBT, at light load) is correctly the lower ceiling.
  KNOCK_UNBOUNDED_BTDC: 90,
  KNOCK_SEARCH_TOL_DEG: 0.25,

  // --- Charge cooling from fuel evaporation ---
  // Latent heat of vaporisation, J/kg. A richer charge arrives colder, which is most of
  // why E85 resists knock: double the latent heat AND ~1.4x the mass for the same lambda,
  // so it drops charge temperature 80-90 K where pump gasoline manages 25-30.
  FUEL_LATENT_HEAT_GASOLINE: 350000,
  FUEL_LATENT_HEAT_ETHANOL: 760000,
  // Stoichiometric ratio below which a fuel counts as an ethanol blend.
  FUEL_ETHANOL_STOICH_MAX: 12,
  // Charge specific heat at constant pressure, J/(kg·K).
  CHARGE_CP: 1005,
  // Share evaporating in the cylinder rather than the port. Direct injection puts nearly
  // all of it in the trapped charge; port injection loses much to the runner walls. No
  // injection-type input yet (issue #24), so this is the blended middle.
  FUEL_EVAP_IN_CYLINDER: 0.6,

  // --- Residual gas (internal EGR) ---
  // Exhaust left from the previous cycle. Dilutes the charge, slows the burn, and arrives
  // at exhaust temperature so it raises where compression starts. Overlap and low load
  // raise it; boost lowers it as the fresh charge scavenges the chamber.
  //
  // RESIDUAL_BASE is quoted at RESIDUAL_CR_REF and scaled by clearance volume, Vd/(CR-1).
  // Sanity check on 0.04: at 10.5:1 the clearance volume is a tenth of the total, and
  // exhaust in it at 1050 K is about a third the density of fresh charge.
  RESIDUAL_BASE: 0.04,
  RESIDUAL_CR_REF: 10.5,
  RESIDUAL_PER_OVERLAP_DEG: 0.004,
  RESIDUAL_LOAD_EXP: 1.15,
  RESIDUAL_MAX: 0.35,
  // Temperature the residual fraction is mixed in at, K. Exhaust gas in the chamber at
  // the end of blowdown, not peak in-cylinder temperature.
  RESIDUAL_TEMP_K: 1050,

  // --- Turbocharger (see turbo.js) ---
  // Specific heats at constant pressure, J/(kg·K). Exhaust is hot and partly triatomic,
  // so it carries more energy per degree — which is why a turbine can drive a compressor
  // moving the same mass.
  CP_AIR: 1005,
  CP_EXHAUST: 1150,
  // Bearing and windage losses across the shaft.
  TURBO_MECH_EFF: 0.95,
  // Turbine flow parameter (mass flow · sqrt(inlet T) / effective area) to the pressure
  // needed upstream — the nozzle relation collapsed to one constant. This is what makes
  // backpressure scale with FLOW rather than boost.
  //
  // ANCHOR: the medium housing at 0.16 kg/s (a 2.0 L four at 16 psi, 3500 RPM) lands EMP
  // near 1.4x boost, mid-band for a matched turbo. Small then exceeds 2x at that flow and
  // large sits just under 1x — the sizing trade, emergent rather than a multiplier.
  TURBINE_FLOW_TO_KPA: 0.04,
  // AFR the exhaust-mass estimate assumes. Only total mass matters, so gasoline is close
  // enough for every fuel.
  EXHAUST_STOICH_REF: 14.7,
  // NA exhaust system backpressure per kg/s, kPa. A turbine dwarfs this; without one it
  // is the whole restriction.
  EXHAUST_SYSTEM_KPA_PER_KGS: 90,
  // The induction solve is a fixed point (boost -> airflow -> exhaust energy -> boost).
  // Three damped passes converge inside a tenth of a psi everywhere the app can reach.
  INDUCTION_SOLVE_PASSES: 3,
  INDUCTION_RELAX: 0.7,
  // Backpressure a wastegate relieves while bleeding exhaust around the turbine. This is
  // why a larger turbine is worth power at the same boost: it spends more life gated.
  WASTEGATE_RELIEF: 0.55,
  // --- Compressor map (see compressorMap in turbo.js) ---
  // How sharply efficiency falls away from the island centre, and how much a unit of
  // normalised pressure-ratio error costs relative to a unit of flow error. Real islands
  // are taller than they are wide — a compressor tolerates being off-flow better than it
  // tolerates being asked for a pressure ratio it was not designed for.
  MAP_EFF_FALLOFF: 0.28,
  MAP_PR_WEIGHT: 1.9,
  // Efficiency floor. Even a badly mismatched compressor moves some air; this stops the
  // power balance dividing by nothing at the extremes.
  MAP_EFF_FLOOR: 0.30,
  // What crossing a limit line costs. Neither is a gentle roll-off: a surging compressor
  // has detached, reversing flow and is not pumping, and a choked one is putting its
  // shaft work into heating the air rather than compressing it.
  SURGE_EFF_PENALTY: 0.55,
  CHOKE_EFF_PENALTY: 0.70,
  // Pressure ratio below which surge is not a meaningful condition — near atmospheric
  // there is no pressure for the flow to reverse against.
  SURGE_MIN_PR: 1.15,
  // --- Turbo shaft inertia (live engine only) ---
  // Time constant for boost to reach the steady-state balance, seconds, at FULL exhaust
  // flow. Divided by how much flow there actually is, so spool-up is slow off idle and
  // quick at high load — which is the real mechanism: the shaft accelerates on surplus
  // turbine power, and there is very little of that at low flow. Scaled per housing by
  // TURBINE_OPTS.inertiaScale, because a big wheel has more rotating mass to move.
  //
  // A dyno sweep does NOT see this. Each point of a steady-state pull is held until it
  // settles, which is what makes it a steady-state measurement; only the live engine has
  // a transient to lag through.
  TURBO_SPOOL_TAU_S: 0.16,
  // Coming down is faster than going up: close the throttle and the compressor is pumping
  // against a shut plate with nothing driving it. The asymmetry is why the second of two
  // closely spaced shifts feels stronger than the first.
  TURBO_DECAY_TAU_S: 0.22,

  // --- Exhaust gas temperature ---
  // One correlation, two consumers: the turbine balance (which needs a temperature before
  // the cycle can run) and the datalog's EGT gauge. They must not diverge again.
  //
  // The load term SATURATES rather than rising linearly — past a full charge, more air
  // brings more expansion work and a richer mixture too, so EGT gains tens of degrees,
  // not hundreds. ANCHORS: ~600 °C light-load cruise, 860 °C WOT naturally aspirated,
  // 930 °C boosted at best power. A linear term fits none of them and puts a stock Golf R
  // at 1030 °C, which no production turbine survives.
  EXHAUST_BASE_K: 590,
  EXHAUST_LOAD_SPAN_K: 714,
  EXHAUST_LOAD_SCALE: 0.48,
  EXHAUST_PER_RETARD_K: 14,
  EXHAUST_RICH_COOLING_K: 420,
  // Where the datalog calls the pull hot, °C. Production turbine wheels and exhaust
  // valves are rated 950-1000 sustained. The seven presets peak 881-951 on their factory
  // calibrations, so ~30 °C of margin above the hottest (the Golf R) — RE-CHECK this if a
  // hotter preset is added. Drives the `egtRisk` flag only; heat damage is not separately
  // priced, since lean-under-boost already pays through WEAR_VALVE_LEAN_BOOST.
  EGT_LIMIT_C: 980,

  // --- MBT phasing and knock control ---
  // MBT is where 50% mass burned lands just after TDC, derived from the modelled burn
  // rather than fitted. Textbook optimum is 8-10 degrees ATDC across many engines.
  MFB50_ATDC_DEG: 8.5,
  // Range MBT itself may occupy — the burn model is an extrapolation at its extremes.
  // NOT the spark TABLE's range: that is SPARK_MIN_DEG / SPARK_MAX_DEG in tables.js and
  // goes negative, because a table can hold retard MBT would never ask for.
  MBT_MIN_DEG: 10,
  MBT_MAX_DEG: 50,
  // Most retard an ECU accumulates from its knock sensors before simply running there.
  MAX_KNOCK_RETARD: 18,

  // --- Combustion chamber as a physical object ---
  // All that survives of the old additive knock envelope (see the note at the foot of
  // this file). Never corrections in degrees: chamber properties, which reach knock by
  // moving burn duration and charge temperature for the cycle to integrate.
  //
  // Reference bore for the burn model, mm. Flame travel scales with bore, which is why a
  // large-bore V8 is more knock-prone than a small four at the same compression.
  BORE_FLAME_REF_MM: 92,
  // Chamber heat a cast iron head adds, K. Iron conducts about a third of aluminium.
  IRON_HEAD_CHAMBER_K: 22,

  // Peak cylinder pressure a stock bottom end — cast pistons, powdered-metal rods,
  // production rod bolts — survives indefinitely. Above it, damage accumulates whether or
  // not the mixture ever detonates.
  //
  // Anchored on THIS MODEL's pressure scale, measured across a build ladder on E85 so
  // knock does not confound it:
  //     seven factory presets   63-75 bar   clear by ~30
  //     stock CR, 8 psi         99 bar      clear by 6      (a mild, sane build)
  //     stock CR, 14 psi       108 bar      trips           (stock rods, serious boost)
  //     12.5:1, 18 psi         118 bar      trips
  //     13.5:1, 24 psi         122 bar      trips
  //
  // Published failure thresholds for production internals are 110-130 bar. The two-zone
  // cycle reads close enough to that band for this to sit just under it, where the old
  // single-zone estimate read low enough that borrowing the literature figure would have
  // made the overload unreachable. `tests/presets.test.js` asserts every preset clears.
  PEAK_PRESSURE_LIMIT_BAR: 105,

  // --- Wear rates (percent of component life per pull) ---
  WEAR_KNOCK: 0.06,            // per degree of retard, per logged point
  WEAR_LEAN: 0.15,
  WEAR_VALVE_LEAN_BOOST: 0.4,
  WEAR_RICH_BORE_WASH: 0.9,    // per unit of lambda below the rich threshold
  // Piston, rod and rod-bolt damage per bar of peak pressure past
  // PEAK_PRESSURE_LIMIT_BAR, per logged point. A build sitting 20 bar over the limit
  // across a whole sweep spends about 5% of piston life per pull — serious, but slower
  // than sustained detonation, which is the right ordering: overload cracks a ring land
  // over a season of pulls, knock does it in an afternoon.
  WEAR_PISTON_PER_BAR: 0.004,
  // Bearings are loaded by peak cylinder pressure every firing stroke, so their wear
  // tracks a pull's AVERAGE peak pressure, not boost. Boost was the old proxy and a bad
  // one: it charged a 9.5:1 and a 12.5:1 engine alike for the same manifold pressure.
  //
  // These are ORDERING numbers, calibrated so a stock NA pull stays near 0.15 and the
  // N54 near 0.6: NA nearly free, factory turbo a few tenths, compression-on-boost whole
  // points per pull. Below the free threshold the oil film carries the load indefinitely,
  // so a part-throttle pull costs nothing — deliberate, where the old expression charged
  // a flat 0.05. Refitted when the cycle replaced the empirical pressure estimate.
  BEARING_PRESSURE_FREE_BAR: 55,
  WEAR_BEARING_PER_BAR: 0.075,
  // Average peak pressure that raises the bottom-end advisory. Above a healthy NA pull
  // (~65 bar averaged), so it means "boosted-engine loading", not "you drove it".
  BEARING_EVENT_BAR: 60,

  // --- Camshaft & valvetrain ---
  CAM_PEAK_SHIFT_PER_DEG: 32,  // RPM the VE peak moves per degree of extra duration
  CAM_OVERLAP_PER_DEG: 0.55,   // overlap degrees gained per degree of duration
  CAM_FLOW_GAIN_PER_DEG: 0.0015,
  FLOAT_BASE_RPM: 7950,        // float speed at stock cam and stock springs
  FLOAT_PER_SPRING_RATE: 58,
  FLOAT_PER_CAM_DEG: 14,
  FLOAT_COLLAPSE_RPM: 1100,    // RPM band over which filling collapses past float
  FLOAT_COLLAPSE_FLOOR: 0.30,

  // --- Mixture targets ---
  BEST_AFR_NA: 12.85,          // lambda ~0.87, mid of the published best-torque band
  BEST_AFR_BOOST_SHIFT: 0.08,  // AFR richer per psi of boost
  BEST_AFR_BOOST_CAP: 0.65,    // richest the target is allowed to shift (lambda ~0.83)
  RICH_DAMAGE_LAMBDA: 0.75,    // below this under load, unburnt fuel starts causing harm
  LEAN_DAMAGE_AFR: 15.2,

  // --- Idle control (live engine) ---
  IDLE_AIR_GAIN_UP: 0.012,     // air is added far faster than removed (dashpot)
  IDLE_AIR_GAIN_DOWN: 0.0008,
  IDLE_AIR_DAMP: 0.004,
  IDLE_SPARK_GAIN: 0.022,      // spark gives instant torque authority; air is slow
  IDLE_SPARK_LIMIT: 14,
  IDLE_BLEED_RATE: 0.06,       // how fast the idle valve returns to base off-idle

  // --- Volumetric efficiency modifiers ---
  VE_PER_COMPRESSION_POINT: 0.005, // less clearance volume = less residual dilution
  VE_ALUMINIUM_HEAD_GAIN: 1.015,   // cooler chamber = denser incoming charge
  VE_E85_CHARGE_COOLING: 1.03,     // high latent heat of vaporisation densifies charge
  VE_EXHAUST_UNDERSIZE: 0.08,      // top-end VE lost per inch undersized
  VE_EXHAUST_OVERSIZE: 0.05,       // low-end VE lost per inch oversized (scavenging)
  VE_TURBINE_BACKPRESSURE: 0.97,   // baseline cost of having a turbine in the stream

  // --- Fuel trims ---
  STFT_GAIN: 42,
  LTFT_LEARN_RATE: 0.004,
  TRIM_LIMIT: 25,

  // --- MAF measurement error ---
  // A bigger intake or turbo plumbing changes the flow profile across the sensor, so a
  // MAF calibrated for stock hardware under-reads. Illustrative of the magnitude tuners
  // correct for with a scalar, not measurements of a specific part.
  MAF_ERROR_INTAKE: 0.90,
  MAF_ERROR_TURBO: 0.92,

  // --- Manifold vacuum model ---
  // RPM normalisation datum for the engine-speed term in the manifold vacuum model
  // (`live.js`'s `nFrac`, how hard the engine pulls vacuum through a given throttle
  // opening). This is DELIBERATELY a fixed absolute RPM, not the per-engine redline:
  // it calibrates how fast a generic engine pumps air, which does not change just
  // because a build has a taller or shorter rev limit. Do not wire this to
  // `derived.redline`.
  //
  // Today's max shippable redline (7500, see `DEFAULT_REDLINE_RPM` in `engine.js` and
  // the RPM axis in `tables.js`) equals this datum, so the resulting `nFrac` never
  // exceeds 1.0 in practice — the 1.2 clamp ceiling around it in `live.js` is
  // currently unreachable headroom, not a live limit.
  MANIFOLD_VACUUM_RPM_NORM: 7500,

  // --- Engineer Score: static compression under boost ---
  // Static compression a boosted build may carry on 91 octane with no charge cooling
  // before the score calls the combination incoherent. Factory DI turbo engines ship
  // across 10.2-11.0 (N54 10.2, B58 11.0, Toyota/BMW 2.0 T 11.0); this base clears the
  // BOTTOM of that band alone, and the credits below clear the top. 10.8 + 0.3 (93
  // octane) + 0.4 (intercooler) = 11.5 is how a B58 as sold comes out unpenalised.
  //
  // TWO KNOWN SIMPLIFICATIONS, both deferred rather than hidden:
  //   - A port-injected engine gets the same allowance as a DI one, which it has not
  //     earned — DI evaporates fuel inside the cylinder and buys real knock margin from
  //     it. Issue #24 tracks modelling injection type.
  //   - The headroom does not scale with boost LEVEL; 3 psi and 24 psi are judged alike.
  COMPRESSION_BOOST_BASE: 10.8,
  // Compression credit per degree of octane bonus, and per intercooler.
  //
  // Both are steep discounts, on purpose: the physics ALREADY charges for octane and
  // charge cooling once, so paying full price here bills the decision twice. Their
  // provenance is the retired flat rate of 2 degrees of knock margin per compression
  // point — E85's +14 was worth 7 points in that currency, an intercooler's 69 °C was
  // worth 2.78 — and they pay out roughly a fifth and a seventh of that.
  //
  // THAT EXCHANGE RATE NO LONGER EXISTS: the cycle produces compression's knock cost
  // emergently and it is not a fixed rate. These two are inherited and DUE A
  // REVALIDATION, left alone here because retuning them is a scoring decision that
  // belongs in its own change.
  COMPRESSION_PER_OCTANE_DEG: 0.1,
  COMPRESSION_INTERCOOLER_GAIN: 0.4,
  // Points charged per compression point past the headroom, and the cap. The cap equals
  // the flat penalty this rule replaced, so it is never harsher than its predecessor.
  // How much static compression one psi of boost takes off the headroom, and the boost
  // level the base above is implicitly calibrated at.
  //
  // Boost level is the single largest determinant of whether high static compression
  // survives, and until now the rule ignored it entirely: it gated on `peakBoostPsi > 0`
  // and then responded only to octane and charge cooling — the second and third most
  // important variables. A 5 psi build and a 25 psi build at 13.0:1 on E85 scored
  // identically (issue #25).
  //
  // 0.1 points per psi is the long-standing shop rule stated as a rate: drop about one
  // point of static compression per ten psi of intended boost. Expressed in the model's
  // own currency it is mild — engine.js prices a compression point at 2 degrees of knock
  // margin, so this is 0.2 degrees per psi — which is deliberate, for the same reason
  // the octane and intercooler credits are discounted: the physics already charges for
  // boost against compression through peak pressure and ignition delay, and the Tuning
  // Score already deducts for the knock events that follow. This must not bill it twice.
  //
  // It does not double-count KNOCK_OVERBOOST_PENALTY either. That prices running a
  // COMPRESSOR outside its efficient map, which is a property of the turbo match and
  // fires whatever the compression ratio is. This prices boost against the SHORT BLOCK.
  //
  // The term is ONE-SIDED: it only ever takes headroom away, above the reference, and
  // never hands any back below it. A two-sided swing was tried first and rejected — it
  // made a 10 psi build MORE permissive than today (11.3:1 on 93 octane with no
  // intercooler stopped being flagged), and this rule has no evidence for loosening
  // anything. Widening what counts as sound engineering is not what the issue asked for.
  //
  // 14 psi is the median peak boost across the shipped factory engines (8.5, 13, 14, 17,
  // 17), which is the band COMPRESSION_BOOST_BASE was fitted against — so below it a
  // factory-normal build is judged exactly as it was before, and every shipped engine
  // stays unpenalised: the tightest, the B58 at 11.0:1 and 17 psi, keeps 0.20 points of
  // margin after paying 0.30 for the 3 psi it runs past the reference.
  COMPRESSION_PER_BOOST_PSI: 0.1,
  COMPRESSION_BOOST_REF_PSI: 14,
  COMPRESSION_PENALTY_PER_POINT: 10,
  COMPRESSION_PENALTY_CAP: 15,

  // --- Retired, kept here so "didn't this used to have a term for X?" has one answer ---
  //
  // ADDITIVE KNOCK ENVELOPE (21 coefficients) — a base timing table plus hand-fitted
  //   corrections in degrees for charge index, mixture, charge temperature, overboost,
  //   exhaust work, cylinder size, head material and compression, two pressure clamps and
  //   a five-term MBT plane. All arrive through the cycle's Livengood-Wu integral now.
  //   Twenty-one fitted numbers became one: KNOCK_TAU_SCALE. Two were never corrections
  //   and survive above as chamber properties: BORE_FLAME_REF_MM, IRON_HEAD_CHAMBER_K.
  // BURN-DURATION CORRELATION — spark-to-50%-burn in RPM and pressure ratio. Conclusion
  //   kept in full; the integrated burn replaced the formula.
  // EMPIRICAL PEAK-PRESSURE BLOCK — estimated from boost and compression. Measured off
  //   the trace now, which is why PEAK_PRESSURE_LIMIT_BAR is on a different scale.
  // FLAT HEAT-LOSS FRACTION — replaced by Woschni.
  // SPOOL RAMP — boost as target x spool(RPM) x throttle^2. Replaced by the power balance.
};

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
 * ONE DELIBERATE EXCEPTION. The sound model's calibration lives in `ACOUSTIC`, in
 * `acoustics.js`, not here. Its numbers cannot move a single dyno figure, but this object
 * is hashed WHOLE by the fingerprint — so putting them here would demand a fixture update
 * on a change that altered nothing measurable, and that is how a regression gate gets
 * updated without being read. The rule those numbers still follow is this file's real
 * one: named, explained, and never bare in a formula.
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
  // the published 1.20-1.27 band; this sits at the dissociated end. Holding gamma at the
  // unburned value throughout overstates the cycle — measured on the stock V6 at 4500 RPM
  // wide open, peak pressure by about 7% and IMEP by about 5%.
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
  // --- Exhaust port: what the EGT probe sees (see the two-stream note in cycle.js) ---
  // How completely the piston-displaced part of the charge cools toward the port wall on
  // its way out, as a number of transfer units at the reference flow. Fitted to the
  // published EGT band for a naturally aspirated gasoline engine — roughly 850 C at wide
  // open throttle, falling through about 700 at part throttle to 400-500 at light cruise
  // — because those are the numbers a tuner reads off a gauge and the only ones worth
  // matching. See EXHAUST_PORT_FLOW_REF for what the reference flow is.
  //
  // WHERE IT LANDS NOW (tests/benchmark.test.js measures it): cruise and part throttle
  // sit in their bands, but wide open throttle reads low — about 780 C on the stock V6 at
  // 6500 RPM, and 795-830 C on the boosted presets against the 880-950 C a production
  // turbine inlet runs at. Lowering this to lift WOT would put a 30 kPa cruise at ~670 C,
  // so one number cannot fix both; docs/accuracy.md carries it as a known approximation.
  EXHAUST_PORT_NTU: 1.0,
  // Reference value of trappedMass x rpm, in the units the cycle carries them (kg and
  // rev/min), measured at the stock V6 at wide-open throttle and 6500 RPM: 6.18e-4 kg of
  // charge times 6500 is about 4.0. Only the RATIO to this matters, so it is a
  // normaliser rather than a physical quantity — but it has to be the right order of
  // magnitude or the NTU above stops meaning "at the reference flow".
  EXHAUST_PORT_FLOW_REF: 4.0,
  // Turbulent convection puts h at about mdot^0.8, so NTU = hA/(mdot*cp) goes as
  // mdot^-0.2. Deliberately weak: it is weak in reality, and the blowdown mass fraction
  // is what carries the load dependence.
  EXHAUST_PORT_FLOW_EXP: 0.2,
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
  // a big cam's lumpy idle. ANCHOR: 20 kPa cruise lands ~26% residual, a burn of about
  // 85 degrees and 43 degrees of MBT (stock V6, 2000-2500 RPM), which is the 40-50 band
  // real factory cruise maps carry (#34).
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
  //   2. A stock 10.3:1 on 91 octane runs out of margin lower at low speed than high —
  //      measured now at about 37 deg at 5500 RPM, 31 at 4000, 29.5 at 3000 and 28.5 at
  //      2500 — as a real one does. (Emergent: low speed means more milliseconds of
  //      dwell for the end gas. The old additive envelope needed a term for it. The
  //      figures this comment once quoted, 36.0 and 23.5, predate later model changes.)
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
  // How much fuel the charge can hold as vapour. Past its dew point the rest stays liquid
  // on the port, walls and plugs — a flooded engine, and the reason a cold one needs so
  // much enrichment. Saturation pressure by Clausius-Clapeyron through the Reid vapour
  // pressure (37.8 °C): p = RVP · exp(-B · (1/T - 1/311)). Blends are placed by ethanol
  // mass fraction between three anchors, because gasoline-ethanol blends are far from
  // ideal (E85 sits near 45 kPa, nowhere near the ~20 a straight mix of the two predicts).
  //   gasoline  RVP ~60 kPa (summer grade), vapour ~65 g/mol (API, its light ends), and an
  //             effective B that gives the ~15-20 kPa true vapour pressure API charts
  //             show at 0 °C;
  //   E85       ~45 kPa, mid ASTM D5798;
  //   ethanol   15.9 kPa, 46.07 g/mol, B = 42.3 kJ/mol ÷ R.
  FUEL_VAPOUR_ANCHORS: [
    { ethanol: 0, rvpKpa: 60, b: 3000, molarG: 65 },
    { ethanol: 0.86, rvpKpa: 45, b: 4800, molarG: 48 },
    { ethanol: 1, rvpKpa: 15.9, b: 5090, molarG: 46.07 },
  ],
  FUEL_RVP_REF_K: 310.93,
  AIR_MOLAR_G: 28.97,
  // Ethanol mass fraction from stoichiometric ratio, for pump fuels that carry no blend
  // figure: gasoline 14.7, ethanol 9.0.
  STOICH_GASOLINE: 14.7,
  STOICH_ETHANOL: 9.0,

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
  // At 0.16 kg/s (a 2.0 L four at 16 psi, 3500 RPM) and the reference exhaust
  // temperature, measured: the small housing holds the exhaust manifold at about 1.2x
  // the intake manifold's absolute pressure, the medium at about 0.9x and the large at
  // about 0.8x — the sizing trade, emergent rather than a multiplier. (This comment once
  // quoted 1.4x / over 2x / under 1x; those figures predate later changes.)
  TURBINE_FLOW_TO_KPA: 0.04,
  // AFR the exhaust-mass estimate assumes. Only total mass matters, so gasoline is close
  // enough for every fuel.
  EXHAUST_STOICH_REF: 14.7,
  // NA exhaust system backpressure per kg/s, kPa. A turbine dwarfs this; without one it
  // is the whole restriction.
  EXHAUST_SYSTEM_KPA_PER_KGS: 90,
  // The induction solve spools the turbo up from zero (see solveInduction): it climbs in
  // steps of at least this many psi, and at most this many steps to the target, then
  // bisects the last step this many times — 12 halvings of a quarter psi is 0.0001 psi,
  // far inside anything the app displays.
  INDUCTION_SPOOL_STEP_PSI: 0.25,
  INDUCTION_SPOOL_MAX_STEPS: 48,
  INDUCTION_EDGE_PASSES: 12,

  // --- Superchargers (src/sim/blower.js) ---
  // The bypass valve is held open by manifold vacuum and shuts as the throttle nears wide
  // open: fully bypassed below 85% throttle, fully shut from 97%.
  BLOWER_BYPASS_OPEN_FRAC: 0.85,
  BLOWER_BYPASS_SHUT_FRAC: 0.97,
  // Positive-displacement efficiency map (modelling choice, shaped to the published
  // figures on each BLOWER_OPTS entry): best at 70% of rated speed and at the unit's
  // design pressure ratio, falling away quadratically either side, never below 30%.
  BLOWER_BEST_SPEED_FRAC: 0.7,
  BLOWER_EFF_PR_FALLOFF: 0.9,
  BLOWER_EFF_SPEED_FALLOFF: 0.6,
  BLOWER_EFF_FLOOR: 0.3,
  // Volumetric efficiency never falls below this however hard a slow rotor is pushed.
  BLOWER_MIN_VOL_EFF: 0.3,
  // Centrifugal work input factor (slip × power input), 0.85-0.9 for backswept impellers.
  BLOWER_WORK_FACTOR: 0.88,
  // Drive losses: a ribbed belt ~95%; belt plus a centrifugal's internal step-up gears ~92%.
  BLOWER_BELT_DRIVE_EFF: 0.95,
  BLOWER_GEAR_DRIVE_EFF: 0.92,
  // Solver bounds.
  BLOWER_SEARCH_MAX_PSI: 40,
  BLOWER_SOLVE_PASSES: 30,

  // --- Nitrous oxide (src/sim/nitrous.js) ---
  // Bottle vapour pressure, psi gauge, through the racing charts' 762 psi at 70 °F; the
  // Clausius-Clapeyron slope B (K) is fitted to their 921 psi at 85 °F.
  N2O_REF_PSI: 762,
  N2O_REF_K: 294.26,
  N2O_VAPOUR_B: 2026,
  // Jet ratings are for about 950 psi at 85 °F. A 100 shot flows 5-6 lb/min (4.8-6 quoted).
  N2O_REF_BOTTLE_PSI: 950,
  N2O_REF_BOTTLE_K: 302.59,
  N2O_LB_MIN_PER_HP: 0.054,
  // A wet kit's fuel jet is sized rich of stoichiometric on the nitrous it pairs with:
  // λ 0.80 at rated bottle pressure, inside the 11.5-12:1 on gasoline (λ 0.78-0.82) nitrous
  // tuners run while spraying (modelling choice). A dry kit's 100% is the same fuel.
  N2O_WET_LAMBDA: 0.8,
  // What nitrous tuners aim the whole mixture at while spraying on pump gas, 11.5-12:1;
  // the pull log prices its fuel advice against the middle of that.
  N2O_TARGET_LAMBDA: 0.8,
  // Share of the nitrous's latent heat drawn from the charge rather than the lines, nozzle
  // and plate — which frost over on a real car because they give up the rest. The same
  // idea as FUEL_EVAP_IN_CYLINDER for fuel (modelling choice).
  N2O_CHARGE_COOLING_SHARE: 0.5,
  // The bottle wall: a 10 lb aluminium bottle, ~7 kg × 0.9 kJ/kg·K. The liquid's own heat
  // capacity comes from its saturation curve (src/sim/nitrous.js).
  N2O_BOTTLE_WALL_J_PER_K: 6300,
  // Heat the wall passes to the liquid inside, W/K: ~0.25 m² wetted at a few hundred
  // W/m²·K of natural convection. Slow against a pass of a few seconds, so the liquid pays
  // for its own boiling and the pressure sags; fast against the minutes between passes.
  N2O_WALL_LIQUID_UA: 100,
  // Heat the wall trades with the air around it, W/K: ~0.35 m² at ~8 W/m²·K, still air.
  // A bottle left alone follows the weather over a couple of hours.
  N2O_BOTTLE_AMBIENT_UA: 3,
  // A blanket-style bottle heater on the wall, ~250 W, switched by a skin thermostat.
  N2O_HEATER_W: 250,
  // Backpressure a wastegate relieves while bleeding exhaust around the turbine. This is
  // why a larger turbine is worth power at the same boost: it spends more life gated.
  // Scales the share of turbine capability above the target (see solveInduction). Fitted
  // to the turbo presets' published ratings after the gate was corrected to open on
  // SURPLUS rather than shortfall; at 0.2 every one lands within 5% of its rated power,
  // with exhaust backpressure at rated power 1.0-1.4x the boost pressure, which is where
  // small OEM turbos run. It was 0.55 when it acted in the wrong direction.
  WASTEGATE_RELIEF: 0.2,
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
  // valves are rated 950-1000 sustained. On the datalog's EGT (the cycle's port
  // temperature, not the correlation above) the seven presets peak 785-825 °C on their
  // factory calibrations, so this is reached only by a build running far hotter than any
  // factory one — RE-CHECK this if a hotter preset is added. Drives the `egtRisk` flag only; heat damage is not separately
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
  // knock does not confound it (stock V6, intercooled, large compressor, 850 cc
  // injectors; re-measured after the turbo solve and exhaust fixes):
  //     seven factory presets   65-89 bar   clear by 16 or more
  //     stock CR, 8 psi        104 bar      clear by 1      (a mild, sane build)
  //     stock CR, 14 psi       112 bar      trips           (stock rods, serious boost)
  //     12.5:1, 18 psi         122 bar      trips
  //     13.5:1, 24 psi         125 bar      trips
  //
  // Failure thresholds quoted for production internals are about 110-130 bar (a
  // practitioners' figure; no primary source is cited here). The two-zone
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
  // These are ORDERING numbers: NA cheap, factory turbo about a point, compression-on-
  // boost whole points per pull. Measured now: a stock NA pull costs about 0.3 and the
  // N54 about 1.2. They were calibrated at 0.15 and 0.6 under an earlier model; the
  // ordering holds, the absolute figures have doubled, and nothing downstream relies on
  // the absolute value beyond the health bar. Below the free threshold the oil film carries the load indefinitely,
  // so a part-throttle pull costs nothing — deliberate, where the old expression charged
  // a flat 0.05. Refitted when the cycle replaced the empirical pressure estimate.
  BEARING_PRESSURE_FREE_BAR: 55,
  WEAR_BEARING_PER_BAR: 0.075,
  // Average peak pressure that raises the bottom-end advisory. Just above a healthy NA
  // pull (the stock V6 averages about 59 bar), so it means "boosted-engine loading", not
  // "you drove it".
  BEARING_EVENT_BAR: 60,

  // --- Inlet Mach index: the high-speed breathing limit (see engine.js) ---
  // Lumped (bore / inlet valve diameter)^2 from Taylor's index. DERIVED, not fitted: a
  // modern four-valve head runs two intake valves at roughly 0.36 of the bore each, so
  // the equivalent single valve is 0.36 * sqrt(2) = 0.509 of the bore, and the factor is
  // 1 / 0.509^2 = 3.86.
  MACH_BORE_VALVE_FACTOR: 3.86,
  // Where choking starts to cost volumetric efficiency, and how fast it costs it.
  //
  // THESE TWO ARE FITTED, and it is worth being straight about to what. Taylor's own
  // 2-valve data puts the knee near Z = 0.5-0.6; a modern 4-valve head with the geometry
  // above never gets near that, which is precisely WHY these engines rev as far as they
  // do. So the absolute threshold here is not Taylor's — it stands in for everything
  // else that stops a real engine breathing at speed and that this model has no term
  // for: cam profile running out of area, intake runner tuning falling off its resonant
  // peak, and port velocity. Those are what actually roll a VQ35HR over at 6800.
  //
  // What IS carried over from the physics, and what makes this worth doing as a Mach
  // index rather than as a curve fit against RPM, is the DEPENDENCE: rolloff scales with
  // mean piston speed against the speed of sound, so a long-stroke engine chokes at
  // fewer revolutions than a short-stroke one of the same displacement, and a hotter
  // charge chokes later. Both are real, both fall out for free, and neither was in the
  // model before.
  //
  // Fitted against the published peak-power RPM of the shipped naturally aspirated
  // engines, which are the only engines here whose peak the boost curve does not already
  // place. See the note in presets.js on what moved as a result.
  MACH_Z_CRIT: 0.155,
  MACH_VE_LOSS: 10,
  // A choked engine still breathes something at the limiter.
  MACH_VE_FLOOR: 0.55,

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
  // A rev limiter is a hysteresis loop, not a ceiling: fuel is cut at the limit, revs
  // fall, and fuel is restored this far below it. That cut-restore cycle IS the bounce
  // you hear off a limiter, and the band is what sets how fast it stutters.
  LIMITER_RESTORE_BAND_RPM: 320,

  // --- Volumetric efficiency modifiers ---
  VE_PER_COMPRESSION_POINT: 0.005, // less clearance volume = less residual dilution
  VE_ALUMINIUM_HEAD_GAIN: 1.015,   // cooler chamber = denser incoming charge
  VE_E85_CHARGE_COOLING: 1.03,     // high latent heat of vaporisation densifies charge
  VE_EXHAUST_UNDERSIZE: 0.08,      // top-end VE lost per inch undersized
  VE_EXHAUST_OVERSIZE: 0.05,       // low-end VE lost per inch oversized (scavenging)
  // Baseline cost of the induction system a turbo engine carries and an NA one does
  // not: the intercooler core and the charge piping between compressor and throttle,
  // both of which drop pressure whether or not the turbine is restricting anything.
  // This is the INTAKE side. It is flat because that plumbing is fixed hardware.
  VE_TURBINE_BACKPRESSURE: 0.97,

  // --- Exhaust backpressure against cylinder filling ---
  // The EXHAUST side, which the flat number above used to stand in for as well — and
  // could not, because it charged a small turbine at 6500 RPM exactly what it charged
  // the same turbine at idle. The turbine is a flow restriction, so what it costs the
  // engine is set by the pressure it holds upstream, which climbs with flow.
  //
  // Overlap this is fitted at, crank degrees — the stock V6's.
  VE_BACKPRESSURE_OVERLAP_REF: 24,
  // VE lost per unit of (exhaust manifold / intake manifold) pressure above 1, at the
  // reference overlap. Fitted against the five boosted presets' published figures.
  VE_BACKPRESSURE_PER_PR: 0.50,
  // Best-power lambda the exhaust flow and temperature estimate assume. The VE table is
  // hardware, not a tune, so it is built at the mixture the engine is meant to run.
  VE_BACKPRESSURE_LAMBDA_REF: 0.88,
  // However choked the turbine, the engine still breathes something.
  VE_BACKPRESSURE_FLOOR: 0.70,

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
  // ONE KNOWN SIMPLIFICATION, deferred rather than hidden: a port-injected engine gets
  // the same allowance as a DI one, which it has not earned — DI evaporates fuel inside
  // the cylinder and buys real knock margin from it. Issue #24 tracks modelling
  // injection type.
  //
  // The other simplification that stood here — the headroom not scaling with boost
  // LEVEL, so that 3 psi and 24 psi were judged alike — is fixed, by
  // COMPRESSION_PER_BOOST_PSI below.
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
  // The same headroom, without boost stacked on top (issue #27). An NA engine pays no
  // boost term and has no intercooler to credit, so octane is the only lever, and the
  // ceiling sits higher than the boosted base.
  //
  // Fitted against the cycle when it was written: on the stock V6 at wide-open throttle
  // on 91 octane the knock integral then started costing a degree at 9.55:1 at 2500 RPM,
  // 10.50 at 3000 and 11.40 at 3500, and 11.5 sat just above the 3000 RPM figure —
  // gentler than the physics, so a build was not billed twice for one decision.
  //
  // RE-MEASURED (accuracy audit): the knock limit at low speed has since become more
  // lenient, and the same engine now loses a degree only at about 12.7:1 at 2500, 3000
  // and 3500 RPM alike. So 11.5 is now STRICTER than the physics by about 1.2 points of
  // compression, the opposite of the intent above. Whether to move this to ~12.7 (a
  // scoring change) or to revisit the low-speed knock limit is a decision for the
  // maintainers; docs/accuracy.md records it. It still warns about the 13.0:1 pump-gas
  // NA engine the slider will happily build.
  COMPRESSION_NA_BASE: 11.5,
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
  // Points charged per compression point past the headroom, and the cap. The cap equals
  // the flat penalty this rule replaced, so it is never harsher than its predecessor.
  COMPRESSION_PENALTY_PER_POINT: 10,
  COMPRESSION_PENALTY_CAP: 15,

  // --- Drivetrain & drag strip (see drivetrain.js) ---
  // Fraction of peak grip a tyre still transmits once it has broken loose. Sliding
  // friction is always below static, which is exactly why a spinning tyre is slower
  // than one held at the limit — and why the driver model below lifts rather than
  // staying flat.
  TIRE_SLIDING_FRACTION: 0.92,
  // Mass of one wheel and tyre assembly, kg, and the fraction of `m·r²` its rotational
  // inertia actually comes to. A wheel is not a thin ring — the rim's mass sits well
  // inboard of the tread — so a radius of gyration around 0.74·r is representative,
  // giving I ≈ 0.55·m·r². Because I/r² is then just a mass, the wheels contribute a
  // fixed effective mass regardless of tyre size, which is the correct behaviour: a
  // taller tyre is harder to spin up but also gears the car taller by the same factor.
  WHEEL_ASSEMBLY_MASS_KG: 22,
  WHEEL_RING_FRACTION: 0.55,
  // Manifold pressure assumed while the throttle is shut mid-shift, kPa. Feeds the
  // existing pumping-loss model so revs fall against real engine braking rather than
  // at an invented rate.
  SHIFT_MANIFOLD_KPA: 30,
  // How far below the limiter's cut speed the driver takes the next gear. Shifting
  // exactly at the cut wastes the last few hundred RPM bouncing off it.
  UPSHIFT_MARGIN_RPM: 60,

  // --- Driver model ---
  // A real driver does not hold the throttle flat while the tyre is spinning: first
  // gear runs past 40 mph, so that would be a burnout halfway down the strip. After a
  // reaction delay they feather it to keep the tyre just at the limit, which is both
  // what happens and what is fastest. Backing off is quick and getting back in is
  // deliberate, so the loop settles instead of oscillating.
  DRIVER_REACTION_S: 0.45,
  DRIVER_LIFT_RATE: 3.2,        // throttle fraction shed per second while spinning
  DRIVER_REAPPLY_RATE: 1.1,     // throttle fraction restored per second once hooked
  DRIVER_MIN_THROTTLE: 0.30,    // how far the driver will lift before riding it out
  DRIVER_REAPPLY_MARGIN: 0.94,  // fraction of the grip limit they wait to fall under

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

/**
 * Empirical numbers the engine management layer runs on — the ECU's counterpart to
 * `COEFF` in src/sim/coefficients.js, kept to the same rule: every number that is a
 * judgement rather than a definition lives here, with what it represents.
 *
 * A separate object rather than more `COEFF` keys because the two are verified
 * differently. `COEFF` drives every result the app has always produced and the
 * behavioural fingerprint pins it, key for key. Nothing here can reach a result unless
 * an ECU context is in play, and the ECU layer is proved instead by its own tests: the
 * default calibration reproduces the original model exactly, and each of these numbers
 * has a physical consequence a test checks (tests/ecu.test.js).
 *
 * Unit conversions, published formulas (the standard atmosphere, Paschen-style
 * breakdown, the thermistor beta model) and parts catalogues are not here: those are
 * definitions or data, and they sit, documented, beside the code that uses them.
 */

export const ECU_COEFF = Object.freeze({
  // ---- Port wall film (X-τ, Aquino SAE 810494). Fraction of each injection that lands
  // on the wall, and how long the film takes to evaporate back, fully warm; both grow
  // as the port cools, over the span below the warm reference.
  FILM_X_WARM: 0.12,
  FILM_X_COLD_ADD: 0.4,
  FILM_TAU_WARM_S: 0.12,
  FILM_TAU_COLD_ADD_S: 0.7,
  FILM_WARM_C: 80,
  FILM_COLD_SPAN_C: 100,

  // ---- Charging system. A 120 A alternator at about 2.8× crank speed: nothing below
  // its cut-in, rising exponentially to its rating (about half at a hot idle).
  ALT_RATED_A: 120,
  ALT_CUT_IN_RPM: 350,
  ALT_RISE_RPM: 650,
  /** Mechanical-to-electrical efficiency of the alternator. */
  ALT_EFFICIENCY: 0.55,
  /** Regulated voltage with no load, and how far it droops per amp drawn. */
  ALT_REGULATED_V: 14.2,
  ALT_DROOP_V_PER_A: 0.004,
  /** Battery voltage once the alternator cannot keep up, and its fall per amp of deficit. */
  BATTERY_DEFICIT_V: 12.5,
  BATTERY_SAG_V_PER_A: 0.015,
  BATTERY_REST_V: 12.6,
  BATTERY_CRANKING_V: 10.2,
  /** Electrical loads, amps: the car itself, headlights and blower, the A/C clutch and fan. */
  LOAD_BASE_A: 22,
  LOAD_LIGHTS_A: 45,
  LOAD_AC_A: 16,

  // ---- Cranking.
  /** Friction mean effective pressure at cranking speed, Pa — cold rings and bearings. */
  CRANKING_FMEP_PA: 1.3e5,
  /** Manifold pressure while cranking, as a fraction of atmospheric: barely pumping. */
  CRANKING_MAP_FRAC: 0.92,
  CRANKING_MAP_FALL_PER_KRPM: 0.3,
  CRANKING_MAP_MIN_FRAC: 0.6,
  CRANKING_MAP_MAX_FRAC: 0.95,

  // ---- Cam phasers.
  /** Oil pressure at which a phaser has its full rate, kPa. */
  PHASER_FULL_OIL_KPA: 180,
  /** How fast a locked phaser returns to its pin, per second of the gap. */
  PHASER_LOCK_RETURN_PER_S: 8,
  /** How far past its end stops a phaser can overshoot, degrees. */
  PHASER_OVERTRAVEL_DEG: 5,

  // ---- Idle and overrun.
  /** Idle-valve travel the controller may use, percent. */
  IDLE_AIR_MIN_PCT: 1,
  IDLE_AIR_MAX_PCT: 34,
  /** Where the idle valve bleeds back to while coasting down, percent. */
  IDLE_COAST_AIR_PCT: 3,
  /** Above this the ECU is coasting, not idling. */
  IDLE_CAPTURE_RPM: 2000,
  /** Below this idle spark control acts; above it (throttle shut) overrun retard does. */
  IDLE_SPARK_MAX_RPM: 1600,
  /** Share of the anti-stall kick applied per 50 ms step. */
  ANTISTALL_STEP_SHARE: 0.25,

  // ---- Limiters and protections.
  /** Spark retard at the top of a retard-style soft limiter window, degrees. */
  LIMITER_RETARD_DEG: 15,
  /** A boost cut this large means "no boost at all". */
  BOOST_CUT_ALL_PSI: 99,
  /** The most boost the stacked protections may take out before cutting it all. */
  BOOST_CUT_STACK_MAX_PSI: 30,
  /** Each torque-limiting protection step closes the throttle to this share of before... */
  PROTECT_THROTTLE_STEP: 0.85,
  /** ...and never below this share of the driver's request. */
  PROTECT_THROTTLE_MIN: 0.5,
  /** The throttle-cut limiter never closes the blade further than this share. */
  THROTTLE_CUT_MIN: 0.15,
  /** Component protection only counts as acting past this much enrichment, percent. */
  EGT_ENRICH_DEADBAND_PCT: 0.25,
  /** How long a lean reading must last before lean protection acts, s. */
  LEAN_CONFIRM_S: 0.3,
  /** How long after any fuel cut before the wideband is trusted again, s. */
  CUT_SETTLE_S: 0.4,
  /** How long low oil pressure must last before the fuel is cut, s. */
  OIL_CONFIRM_S: 0.5,
  /** How long knock must stay away before the high-det map is dropped, s. */
  HIGH_DET_QUIET_S: 10,
  /** Protective retard rates, degrees per second, and the ceiling. */
  LEAN_RETARD_RATE_DEG_S: 20,
  LEAN_RETARD_MAX_DEG: 20,
  TORQUE_RETARD_RATE_DEG_S: 30,
  TORQUE_RETARD_MAX_DEG: 30,
  TORQUE_RETARD_RECOVER_DEG_S: 15,
  /** Component-protection enrichment added and removed, percent per second. */
  EGT_ENRICH_RATE_PCT_S: 10,
  EGT_ENRICH_DECAY_PCT_S: 5,
  /** Exhaust temperature as the ECU's model follows it, s. */
  EGT_FILTER_S: 0.3,
  /** Temperature of the air a fuel-cut event pumps through, above charge temperature, °C. */
  CUT_AIR_RISE_C: 150,
  /**
   * Manifold temperature rise when a full charge of unburned mixture lights in the
   * exhaust manifold, °C averaged over the events that did it. The reason a spark-cut
   * limiter pops and bangs and a fuel-cut one goes quiet.
   */
  AFTERBURN_RISE_C: 260,

  // ---- Live engine hardware.
  /** Starter stall torque at the crank, Nm, and the crank speed it can no longer push past. */
  STARTER_STALL_NM: 180,
  STARTER_FREE_RPM: 330,
  /** Engine speed at which the ECU counts the engine as running. */
  RUNNING_RPM: 450,
  /** Intake plenum and runner volume as a multiple of displacement — a typical production
   * manifold. Sets how fast manifold pressure follows the throttle. */
  PLENUM_TO_DISPLACEMENT: 1.4,
  /** A/C compressor torque at the crank when the clutch is engaged, Nm. */
  AC_NM: 11,
  /** Oil pump: kPa per 1000 RPM hot, and relief pressure. */
  OIL_KPA_PER_KRPM: 95,
  OIL_RELIEF_KPA: 520,

  // ---- Boost control.
  /** Integrator clamp, duty percent. */
  BOOST_INTEGRAL_LIMIT_PCT: 60,
  /** The boost target the ECU guesses its IAT from, as a share of the curve's peak. */
  IAT_GUESS_BOOST_SHARE: 0.8,

  // ---- Knock sensing. Valvetrain noise at the sensor, volts: a floor plus a term in
  // RPM² (valve closing velocity), scaled by spring stiffness and cam duration.
  KNOCK_NOISE_FLOOR_V: 0.05,
  KNOCK_NOISE_V: 0.25,
  KNOCK_NOISE_REF_RPM: 6000,
  KNOCK_NOISE_REF_SPRING: 50,
  KNOCK_NOISE_REF_CAM_DEG: 210,
  KNOCK_NOISE_CAM_SPAN_DEG: 150,
  /** Knock signal per degree past the limit, volts per bar of peak pressure. */
  KNOCK_SIGNAL_V_PER_BAR: 0.012,
  KNOCK_SIGNAL_MIN_BAR: 15,
  /** Noise peaks against its mean, and the spread over which they cross a threshold. */
  KNOCK_NOISE_PEAK: 1.3,
  KNOCK_NOISE_SPREAD: 0.3,
  /** A factory threshold: this much above the engine's own noise, plus an offset. */
  KNOCK_FACTORY_MARGIN: 1.35,
  KNOCK_FACTORY_OFFSET_V: 0.04,
  /** Peak cylinder pressure the ECU's knock window assumes, bar per kPa of MAP. */
  PEAK_BAR_PER_KPA: 0.62,
  /** How much a logged knock event adds to the running knock count, per degree-second. */
  KNOCK_COUNT_PER_DEG_S: 8,

  // ---- Cylinder-to-cylinder spread (runner flow and neighbour heat).
  CYL_AIR_END_GAIN: 0.035,
  CYL_AIR_SKEW: 0.012,
  CYL_CHAMBER_MID_K: 7,

  // ---- Injectors and fuel supply.
  /** Dead-time growth as voltage falls: (13.5 / V) to this power. */
  DEADTIME_VOLT_EXP: 1.6,
  /** Dead-time growth per kPa across the injector above its rating. */
  DEADTIME_PER_KPA: 0.0005,
  /** Below this battery voltage the injector driver no longer switches. */
  INJECTOR_MIN_V: 6,
  /** Open time below which the pintle never reaches full lift, ms. */
  BALLISTIC_OPEN_MS: 0.35,
  /** Rail pressure above rating at which a pump's flow would reach zero, kPa. */
  PUMP_PRESSURE_SPAN_KPA: 900,
  PUMP_FLOW_MIN: 0.15,
  PUMP_FLOW_MAX: 1.3,
  PUMP_VOLT_MIN: 0.3,
  PUMP_VOLT_MAX: 1.15,

  // ---- Ignition.
  /** Driver and harness resistance in series with the coil primary, ohms. */
  COIL_HARNESS_OHM: 0.9,
  /** The most a coil can be over-charged past its rated energy. */
  COIL_OVERCHARGE_MAX: 1.2,
  /** Spark breakdown, kV: a base plus a term in gap × pressure^n (Paschen-like). */
  SPARK_BASE_KV: 1.5,
  SPARK_KV_PER_MM: 1.5,
  SPARK_PRESSURE_EXP: 0.85,
  SPARK_MIN_BAR: 0.5,
  /** Breakdown is statistical over about this many kV either side of the ceiling. */
  SPARK_SPREAD_KV: 4,
  /** Compression exponent from intake close to the spark. */
  SPARK_POLYTROPIC_N: 1.3,
  /** Secondary voltage assumed when no coil is described, kV. */
  SPARK_DEFAULT_KV: 45,
  /** Flammability limits, lambda, and how residual gas narrows them. */
  FLAME_LEAN_LIMIT: 1.6,
  FLAME_LEAN_PER_RESIDUAL: 1.2,
  FLAME_RICH_LIMIT: 0.45,
  FLAME_RICH_PER_RESIDUAL: 0.25,
  FLAME_LEAN_SPREAD: 0.25,
  FLAME_RICH_SPREAD: 0.15,

  // ---- Oil pump.
  OIL_VISCOSITY_REF_C: 90,
  OIL_VISCOSITY_SPAN_C: 38,
  OIL_VISCOSITY_MIN: 0.7,
  OIL_VISCOSITY_MAX: 6,
  OIL_VISCOSITY_EXP: 0.55,
  /** Pressure the pump makes above zero flow — the relief spring's preload, kPa. */
  OIL_BASE_KPA: 15,
  /** Hottest the oil runs with a working cooling system, °C. */
  OIL_MAX_C: 115,
  /** Where coolant settles with the radiator fan failed, °C. */
  COOLANT_FAN_FAILED_C: 135,

  // ---- Dyno fault severities.
  /** Flow left in a weak fuel pump, and oil pressure left with the level low. */
  WEAK_PUMP_HEALTH: 0.55,
  LOW_OIL_HEALTH: 0.25,

  // ---- Drag strip.
  /** How fast each traction-control actuator delivers its cut, s. */
  TC_TAU_SPARK_S: 0.02,
  TC_TAU_FUEL_S: 0.01,
  TC_TAU_THROTTLE_S: 0.12,
  TC_TAU_BOOST_S: 0.5,
  /** Most torque traction control may take away. */
  TC_MAX_CUT: 0.95,
  /** How fast the cut is released once the tyre hooks up, per 100 ms. */
  TC_RELEASE_RATE: 0.6,
  /** Share of a manual shift a flat-foot shift still takes. */
  FFS_SHIFT_SHARE: 0.55,

  // ---- Ethanol.
  /** Octane gained from E85 to pure ethanol. */
  ETHANOL_OCTANE_PAST_E85: 2,
});

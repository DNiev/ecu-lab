/**
 * Physical constants — real measured values, not tuning knobs.
 *
 * Nothing in this file is an adjustable parameter. If you find yourself wanting to
 * change a number here to make the engine behave differently, the value you actually
 * want is in `coefficients.js` instead.
 *
 * The simulation works in real engineering units throughout:
 *   pressure kPa · temperature K · air & fuel mass grams · time ms
 *   energy J · torque Nm internally (converted to lb-ft only for display)
 *   MEP values Pa · airflow g/s · power W (converted to hp for display)
 */

/** Specific gas constant for air, J/(kg·K). */
export const R_AIR = 287;

/** Sea-level ambient pressure, kPa. */
export const BARO_KPA = 101.325;

/** Kelvin to Celsius offset. */
export const KELVIN_OFFSET = 273.15;

/** Ambient air temperature, K. */
export const AMBIENT_K = 298;

/**
 * The same ambient temperature in Celsius, 24.85 °C.
 *
 * Derived rather than written out, because two places used to state ambient
 * independently — `AMBIENT_K` here and a bare `25` in the knock model's IAT penalty —
 * and they did not agree. Everything that needs ambient in Celsius must come through
 * this, so the model cannot hold two ambients at once.
 */
export const AMBIENT_C = AMBIENT_K - KELVIN_OFFSET;

/** Pounds per square inch to kilopascals. */
export const PSI_TO_KPA = 6.895;

/** Kilopascals per bar — cylinder pressures are conventionally quoted in bar. */
export const KPA_PER_BAR = 100;

/** (γ−1)/γ for air — the isentropic compression exponent. */
export const GAMMA_EXP = 0.286;

/** Typical turbocharger compressor isentropic efficiency. */
export const COMP_ISEN_EFF = 0.70;

/** Fraction of the compression temperature rise an intercooler removes. */
export const IC_EFFECTIVENESS = 0.70;


/** Crank → wheel transmission efficiency. */
export const DRIVETRAIN_EFF = 0.85;

/** Injector opening latency at ~13.5 V, ms. */
export const INJ_DEADTIME_MS = 1.0;

/** How strongly bore:stroke ratio biases the powerband. */
export const CHAR_SCALE = 0.3;

// --- Vehicle dynamics ---
// The drag strip works in SI throughout: metres, seconds, kilograms, newtons.
// Everything below is either a defined unit conversion or a measured physical
// constant, so none of it is adjustable. The knobs live in `coefficients.js`.

/** Standard gravitational acceleration, m/s². */
export const G = 9.80665;

/** Metres per international inch, exactly. */
export const M_PER_INCH = 0.0254;

/** Metres per international mile, exactly. */
export const MILE_M = 1609.344;

/** A quarter mile, metres — the distance the strip measures. */
export const QUARTER_MILE_M = MILE_M / 4;

/** An eighth mile, metres — the interval most strips also time. */
export const EIGHTH_MILE_M = MILE_M / 8;

/** Sixty feet, metres — the launch metric drag racers actually judge a run by. */
export const SIXTY_FEET_M = 60 * 12 * M_PER_INCH;

/** Miles per hour per metre per second. */
export const MPH_PER_MS = 3600 / MILE_M;

/** 60 mph in m/s, the 0-60 trigger. */
export const SIXTY_MPH_MS = 60 / MPH_PER_MS;

/**
 * Ambient air density, kg/m³.
 *
 * Not a separate measured figure: it is the ideal gas law the engine model already
 * uses, evaluated at the same sea-level pressure and 25 °C ambient. That resolves to
 * 1.185 kg/m³ against a published 1.184, and it means the air the car pushes through
 * is the same air the engine breathes — change the ambient conditions once and both
 * move together.
 */
export const RHO_AIR = (BARO_KPA * 1000) / (R_AIR * AMBIENT_K);

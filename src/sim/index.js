/**
 * Public API of the simulation layer.
 *
 * Everything below is a pure function or a plain data table — there is no React
 * dependency anywhere in `src/sim/`, which is what makes the physics testable in
 * plain Node and reusable outside this UI.
 *
 * If you are new to the codebase, start at `evaluatePoint` in `point.js`. Everything
 * else either feeds it or displays its output.
 */

export * from './constants.js';
export * from './coefficients.js';
export * from './tables.js';
export * from './hardware.js';
export * from './math.js';
export * from './thermo.js';
export * from './friction.js';
export * from './engine.js';
export * from './knock.js';
export * from './manifold.js';
export * from './turbo.js';
export * from './cycle.js';
export * from './airflow.js';
export * from './point.js';
export * from './sweep.js';
export * from './presets.js';
export * from './live.js';
export * from './drivetrain.js';
export * from './advisors.js';
export * from './scoring.js';

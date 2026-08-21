/**
 * @ql/sim -- the Quidditch Legends match engine.
 *
 * Pure and dependency-free by design: no database, no clock, no network. A match
 * is a function of (squads, tactics, seed, rules), which is what lets the same
 * code run in a matchday worker, in a browser preview, and in the balance
 * harness -- and lets any published match be replayed exactly, forever.
 */

export * from './types.js';
export * from './rules.js';
export * from './rng.js';
export * from './ratings.js';
export * from './expectations.js';
export * from './lineup.js';
export * from './generate.js';
export * from './report.js';
export { simulate, type SimulateOptions } from './simulate.js';
export { seekerLambda, snitchRamp } from './snitch.js';
export { beaterUnit, seekerSuppression } from './bludgers.js';

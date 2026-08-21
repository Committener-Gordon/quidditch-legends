/**
 * @ql/economy -- what a Galleon buys, and what it costs to keep a club.
 *
 * Pure, like the match engine, and for the same reasons: it can be unit-tested,
 * it can be run over a hundred simulated seasons to see whether anyone goes
 * bankrupt or hoards, and the web app can price a facility upgrade without asking
 * the worker.
 *
 * Nothing here is for sale for real money. One currency, earned only, so the
 * economy's whole job is to force choices -- every week a manager should be short
 * of Galleons for something they want.
 *
 * The scale is anchored on one benchmark, taken from real football: a healthy club
 * spends 55-65% of its income on wages. Everything below is derived from that.
 */

export * from './wages.js';
export * from './income.js';
export * from './facilities.js';
export * from './training.js';

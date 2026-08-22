/**
 * @ql/domain -- the rules that span money and squad membership.
 *
 * Pure and dependency-free, like `@ql/sim` and `@ql/economy`. If a rule about a
 * club needs a database to test, it is in the wrong place.
 */

export * from './types.js';
export * from './club.js';
export * from './transfer.js';

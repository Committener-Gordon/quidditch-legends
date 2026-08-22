/**
 * The jobs, as a library.
 *
 * The CLI and the scheduler both call these, and so does the web app when a single
 * player presses play. Keeping them importable rather than locked inside a binary
 * is what lets "the player owns the clock" and "a scheduler owns the clock" be the
 * same code with a different trigger.
 */

export { runMatchday, runSeason, settleWorld, type MatchdayResult, type MatchdayLine } from './matchday.js';
export { newSeason, reschedule, topDivision, type NewSeasonResult } from './newSeason.js';
export { runOffseason, type OffseasonResult } from './offseason.js';
export { recomputeStandings, computeTable, type TableRow } from './standings.js';
export { createWorld, SEED_CAPITAL } from './createWorld.js';
export { isPayday, weekOf, runPayday, aiSpend, payPrizeMoney, repriceSquads } from './finance.js';

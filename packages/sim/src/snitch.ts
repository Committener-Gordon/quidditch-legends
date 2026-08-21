/**
 * The snitch: a 30-point prize that comes straight back out after every catch.
 *
 * Each snitch is a hazard rate that ramps from the moment it is released, so it
 * is elusive at first and increasingly likely to be taken. Because catches
 * repeat, seeker quality compounds over a match instead of resolving in one coin
 * flip -- which is the whole reason this ruleset works where canon does not.
 */

import { liveRating } from './ratings.js';
import { seekerSuppression } from './bludgers.js';
import { emit, scoreOf, sideBonus, type MatchContext, type TeamState } from './state.js';

/** Visibility ramp since the current snitch was released. */
export function snitchRamp(ctx: MatchContext): number {
  return 1 - Math.exp(-ctx.snitchAge / ctx.rules.snitchRampMinutes);
}

/** Hazard rate for one seeker this minute: the chance they take the snitch now. */
export function seekerLambda(ctx: MatchContext, team: TeamState): number {
  const { rules } = ctx;
  const rating = liveRating(team.seeker, rules) + sideBonus(ctx, team.side);
  const ratio = Math.max(0.2, rating / rules.seekerPoolAverage);
  const commitment = rules.seekerCommitment[team.tactics.seekerCommitment].lambda;
  const pressure = 1 - seekerSuppression(ctx, team.side);

  return (
    rules.snitchLambda0 *
    snitchRamp(ctx) *
    ratio ** rules.seekerExponent *
    commitment *
    pressure
  );
}

export function resolveSnitch(ctx: MatchContext): void {
  const lambdaHome = seekerLambda(ctx, ctx.home);
  const lambdaAway = seekerLambda(ctx, ctx.away);
  const total = lambdaHome + lambdaAway;

  if (total <= 0 || !ctx.rng.chance(1 - Math.exp(-total))) {
    ctx.snitchAge += 1;
    return;
  }

  const winner = ctx.rng.next() < lambdaHome / total ? ctx.home : ctx.away;
  winner.points += ctx.rules.snitchPoints;
  winner.catches += 1;
  winner.seeker.stats.snitchCatches += 1;

  emit(ctx, {
    minute: ctx.minute,
    type: 'SNITCH_CAUGHT',
    side: winner.side,
    seekerId: winner.seeker.player.id,
    index: ctx.snitchIndex,
    score: scoreOf(ctx),
  });

  // Straight back out: a new snitch, a fresh ramp, and the hunt starts again.
  ctx.snitchIndex += 1;
  ctx.snitchAge = 0;
  emit(ctx, { minute: ctx.minute, type: 'SNITCH_RELEASED', index: ctx.snitchIndex });
}

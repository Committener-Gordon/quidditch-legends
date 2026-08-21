/**
 * The quaffle game: possession, advance, shot, save.
 *
 * At the default dials this fires 1.5 times a minute, so 120 possessions a match
 * shared between the sides -- about 60 each, of which 55% reach a shot and 45%
 * of those beat the keeper. That is the ~15 goals, ~150 points half of a team's
 * scoring budget.
 */

import {
  DEFENCE_WEIGHTS,
  POSITION_WEIGHTS,
  SHOOTING_WEIGHTS,
  clamp,
  liveRating,
  liveSkill,
} from './ratings.js';
import { emit, opponentOf, scoreOf, sideBonus, type MatchContext, type TeamState } from './state.js';
import type { Side } from './types.js';

/** What the seeker lends to open play when told to drop back. */
function seekerContribution(ctx: MatchContext, team: TeamState, attacking: boolean): number {
  const profile = ctx.rules.seekerCommitment[team.tactics.seekerCommitment];
  if (profile.quaffleSupport <= 0) return 0;
  const weights = attacking ? POSITION_WEIGHTS.chaser : DEFENCE_WEIGHTS;
  // Explicitly out of position: a seeker playing chaser is doing someone else's job.
  return profile.quaffleSupport * liveSkill(team.seeker, weights, ctx.rules, false);
}

function chaserUnit(ctx: MatchContext, team: TeamState): number {
  let total = 0;
  for (const chaser of team.chasers) total += liveRating(chaser, ctx.rules);
  return total / Math.max(1, team.chasers.length);
}

function defensiveUnit(ctx: MatchContext, team: TeamState): number {
  let total = 0;
  for (const chaser of team.chasers) total += liveSkill(chaser, DEFENCE_WEIGHTS, ctx.rules);
  return total / Math.max(1, team.chasers.length);
}

/**
 * Which side wins the quaffle. An explicit slope from 50/50, rather than a ratio
 * of unit ratings -- the ratio form compounds with the shot and goal contests and
 * turns a good side into an unbeatable one.
 */
function contestPossession(ctx: MatchContext): Side {
  const homeUnit =
    chaserUnit(ctx, ctx.home) + seekerContribution(ctx, ctx.home, true) + sideBonus(ctx, 'home');
  const awayUnit =
    chaserUnit(ctx, ctx.away) + seekerContribution(ctx, ctx.away, true) + sideBonus(ctx, 'away');

  const { rules } = ctx;
  // Committing forward costs you the quaffle more often.
  const homeCommit = rules.aggression[ctx.home.aggression].possession;
  const awayCommit = rules.aggression[ctx.away.aggression].possession;

  const pHome = clamp(
    0.5 +
      (rules.possessionSlope * (homeUnit - awayUnit)) / 100 +
      (homeCommit - awayCommit) / 2,
    rules.possessionClamp[0],
    rules.possessionClamp[1],
  );

  return ctx.rng.chance(pHome) ? 'home' : 'away';
}

export function resolvePossession(ctx: MatchContext): void {
  const { rules, rng } = ctx;
  const attackingSide = contestPossession(ctx);
  const attack = attackingSide === 'home' ? ctx.home : ctx.away;
  const defence = opponentOf(ctx, attackingSide);

  const attackRating =
    chaserUnit(ctx, attack) + seekerContribution(ctx, attack, true) + sideBonus(ctx, attack.side);
  const defenceRating =
    (defensiveUnit(ctx, defence) + seekerContribution(ctx, defence, false)) * rules.defenceWeight +
    sideBonus(ctx, defence.side);

  const pShot = clamp(
    rules.shotBase +
      (rules.shotSlope * (attackRating - defenceRating)) / 100 +
      rules.aggression[attack.aggression].shot,
    rules.shotClamp[0],
    rules.shotClamp[1],
  );

  if (!rng.chance(pShot)) {
    // Turnover. Credit a defender, but only log the ones worth commentary.
    const defenders = defence.chasers;
    if (defenders.length > 0) {
      const winner = rng.weightedPick(
        defenders,
        defenders.map((d) => Math.max(1, liveSkill(d, DEFENCE_WEIGHTS, ctx.rules) ** 2)),
      );
      winner.stats.interceptions += 1;
      if (rng.chance(rules.interceptionLogRate)) {
        emit(ctx, {
          minute: ctx.minute,
          type: 'INTERCEPTION',
          side: defence.side,
          playerId: winner.player.id,
        });
      }
    }
    return;
  }

  if (attack.chasers.length === 0) return;

  // A shot. Better shooters take more of them.
  const shooter = rng.weightedPick(
    attack.chasers,
    attack.chasers.map((c) => Math.max(1, liveSkill(c, SHOOTING_WEIGHTS, ctx.rules) ** 2)),
  );
  attack.shots += 1;
  shooter.stats.shots += 1;

  const quality = liveSkill(shooter, SHOOTING_WEIGHTS, ctx.rules) + sideBonus(ctx, attack.side);
  const keeperRating = liveRating(defence.keeper, ctx.rules) + sideBonus(ctx, defence.side);
  defence.keeper.stats.shotsFaced += 1;

  const pGoal = clamp(
    rules.goalBase + (rules.goalSlope * (quality - keeperRating)) / 100,
    rules.goalClamp[0],
    rules.goalClamp[1],
  );

  if (!rng.chance(pGoal)) {
    defence.keeper.stats.saves += 1;
    emit(ctx, {
      minute: ctx.minute,
      type: 'SAVE',
      side: defence.side,
      keeperId: defence.keeper.player.id,
      shooterId: shooter.player.id,
    });
    return;
  }

  attack.points += rules.goalPoints;
  attack.goals += 1;
  shooter.stats.goals += 1;

  const providers = attack.chasers.filter((c) => c !== shooter);
  let assistId: string | null = null;
  if (providers.length > 0 && rng.chance(rules.assistChance)) {
    const provider = rng.weightedPick(
      providers,
      providers.map((p) =>
        Math.max(1, liveSkill(p, { vision: 0.5, handling: 0.5 }, ctx.rules) ** 2),
      ),
    );
    provider.stats.assists += 1;
    assistId = provider.player.id;
  }

  emit(ctx, {
    minute: ctx.minute,
    type: 'GOAL',
    side: attack.side,
    playerId: shooter.player.id,
    assistId,
    score: scoreOf(ctx),
  });
}

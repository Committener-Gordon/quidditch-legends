/**
 * Bludgers: the only thing beaters do, and the reason their ratings are not noise.
 *
 * A hit costs the target stamina and puts a short rating penalty on them, which
 * feeds back into the quaffle game. Sustained beater dominance also suppresses
 * the opposing seeker's hazard rate -- under a respawning snitch that is a
 * reliable four-times-a-match payoff rather than a lottery ticket.
 */

import { BLUDGER_WEIGHTS, EVASION_WEIGHTS, SHOOTING_WEIGHTS, clamp, liveSkill } from './ratings.js';
import {
  emit,
  onPitch,
  opponentOf,
  sideBonus,
  type MatchContext,
  type PlayerState,
  type TeamState,
} from './state.js';
import type { Side } from './types.js';

export function beaterUnit(ctx: MatchContext, team: TeamState): number {
  if (team.beaters.length === 0) return 0;
  let total = 0;
  for (const beater of team.beaters) total += liveSkill(beater, BLUDGER_WEIGHTS, ctx.rules);
  return total / team.beaters.length + sideBonus(ctx, team.side);
}

/**
 * How far the opposing beaters are holding this side's seeker off the snitch,
 * as a fraction of the hazard rate. Capped by rules.maxBeaterSuppression.
 */
export function seekerSuppression(ctx: MatchContext, side: Side): number {
  const own = side === 'home' ? ctx.home : ctx.away;
  const opponent = opponentOf(ctx, side);

  const advantage = (beaterUnit(ctx, opponent) - beaterUnit(ctx, own)) / 100;
  const focus = ctx.rules.beaterFocusPressure[opponent.tactics.beaterFocus];
  // Symmetric around the 0.5 baseline, so evenly matched beaters cancel out and
  // only the gap between them moves the hunt.
  let suppression =
    ctx.rules.maxBeaterSuppression *
    focus *
    (0.5 + ctx.rules.beaterSuppressionResponse * advantage);

  // Beaters told to protect their own spend the effort shielding, not hunting.
  if (own.tactics.beaterFocus === 'protect') suppression *= ctx.rules.protectSuppressionRelief;

  return clamp(suppression, 0, ctx.rules.maxBeaterSuppression);
}

function anyOutfielder(ctx: MatchContext, victimTeam: TeamState): PlayerState {
  const outfield = onPitch(victimTeam).filter((player) => player.position !== 'keeper');
  return ctx.rng.pick(outfield.length > 0 ? outfield : onPitch(victimTeam));
}

function pickTarget(ctx: MatchContext, striking: TeamState, victimTeam: TeamState): PlayerState {
  // A focus is an instruction, not a guarantee -- some bludgers find whoever is
  // in the way.
  if (!ctx.rng.chance(ctx.rules.focusTargetShare)) return anyOutfielder(ctx, victimTeam);

  switch (striking.tactics.beaterFocus) {
    case 'seeker':
      return victimTeam.seeker;
    case 'chasers': {
      const chasers = victimTeam.chasers;
      if (chasers.length === 0) return victimTeam.seeker;
      // Go after whoever is hurting you most.
      return ctx.rng.weightedPick(
        chasers,
        chasers.map((c) => Math.max(1, liveSkill(c, SHOOTING_WEIGHTS, ctx.rules) ** 2)),
      );
    }
    case 'protect':
    default:
      return anyOutfielder(ctx, victimTeam);
  }
}

export function resolveBludger(ctx: MatchContext): void {
  const { rules, rng } = ctx;

  const weights = [ctx.home, ctx.away].map((team) => {
    const offence = rules.beaterFocusOffence[team.tactics.beaterFocus];
    return Math.max(1, (beaterUnit(ctx, team) * offence) ** 2);
  });
  const striking = rng.weightedIndex(weights) === 0 ? ctx.home : ctx.away;
  const victimTeam = opponentOf(ctx, striking.side);

  if (striking.beaters.length === 0) return;

  const beater = rng.weightedPick(
    striking.beaters,
    striking.beaters.map((b) => Math.max(1, liveSkill(b, BLUDGER_WEIGHTS, ctx.rules) ** 2)),
  );
  const target = pickTarget(ctx, striking, victimTeam);

  const power = liveSkill(beater, BLUDGER_WEIGHTS, ctx.rules) + sideBonus(ctx, striking.side);
  const evasion = liveSkill(target, EVASION_WEIGHTS, ctx.rules) + sideBonus(ctx, victimTeam.side);

  // Beaters told to protect their own make their side harder to hit.
  const shielded = victimTeam.tactics.beaterFocus === 'protect' ? 1 - rules.protectHitReduction : 1;
  const pHit = clamp(
    (rules.bludgerHitBase + (rules.bludgerHitSlope * (power - evasion)) / 100) * shielded,
    rules.bludgerHitClamp[0],
    rules.bludgerHitClamp[1],
  );
  if (!rng.chance(pHit)) return;

  beater.stats.bludgerHits += 1;
  target.stats.hitsTaken += 1;
  target.stamina = Math.max(0, target.stamina - rules.bludgerStaminaCost);
  target.debuff = rules.bludgerDebuff;
  target.debuffUntil = ctx.minute + rules.bludgerDebuffMinutes;

  emit(ctx, {
    minute: ctx.minute,
    type: 'BLUDGER_HIT',
    side: striking.side,
    beaterId: beater.player.id,
    targetId: target.player.id,
    targetPosition: target.position,
  });

  // Nerve is what keeps a hit from becoming a spell in the medical wing.
  const injuryChance = rules.injuryChanceOnHit * (1 - target.player.attributes.nerve / 250);
  if (rng.chance(injuryChance)) {
    const days = Math.round(rng.range(rules.injuryDays[0], rules.injuryDays[1]));
    target.injury = { days };
    emit(ctx, {
      minute: ctx.minute,
      type: 'INJURY',
      side: target.side,
      playerId: target.player.id,
      days,
    });
  }
}

/**
 * Between-tick housekeeping: stamina, expiring bludger damage, substitutions and
 * the one situational call the engine makes on the manager's behalf.
 */

import { baseRating } from './ratings.js';
import {
  emit,
  onPitch,
  type MatchContext,
  type PlayerState,
  type TeamState,
} from './state.js';
import type { Position } from './types.js';

/** A player carrying an injury with nobody to replace them keeps flying, badly. */
const PLAYING_HURT_PENALTY = 0.25;

export function expireDebuffs(ctx: MatchContext): void {
  for (const team of [ctx.home, ctx.away]) {
    for (const player of onPitch(team)) {
      if (player.debuff > 0 && ctx.minute > player.debuffUntil) player.debuff = 0;
    }
  }
}

export function drainStamina(ctx: MatchContext): void {
  const { rules } = ctx;
  for (const team of [ctx.home, ctx.away]) {
    const effort =
      team.aggression === 'attacking' ? 1.06 : team.aggression === 'defensive' ? 0.96 : 1;
    for (const player of onPitch(team)) {
      let drain = rules.staminaDrainPerMinute[player.position];
      if (player.position === 'seeker') {
        drain *= rules.seekerCommitment[team.tactics.seekerCommitment].drain;
      } else if (player.position !== 'keeper') {
        drain *= effort;
      }
      player.stamina = Math.max(0, player.stamina - drain);
    }
  }
}

function slotFor(team: TeamState, player: PlayerState): Position | null {
  if (team.chasers.includes(player)) return 'chaser';
  if (team.beaters.includes(player)) return 'beater';
  if (team.keeper === player) return 'keeper';
  if (team.seeker === player) return 'seeker';
  return null;
}

function replaceInSlot(team: TeamState, out: PlayerState, incoming: PlayerState, slot: Position): void {
  if (slot === 'chaser') {
    team.chasers[team.chasers.indexOf(out)] = incoming;
  } else if (slot === 'beater') {
    team.beaters[team.beaters.indexOf(out)] = incoming;
  } else if (slot === 'keeper') {
    team.keeper = incoming;
  } else {
    team.seeker = incoming;
  }
  incoming.position = slot;
  incoming.stats.position = slot;
  incoming.onPitch = true;
  out.onPitch = false;
  team.bench.splice(team.bench.indexOf(incoming), 1);
  team.subsUsed += 1;
}

/** Best available replacement: a specialist first, anyone at all if it is forced. */
function findReplacement(
  ctx: MatchContext,
  team: TeamState,
  slot: Position,
  forced: boolean,
): PlayerState | null {
  const available = team.bench.filter((p) => !p.injury);
  if (available.length === 0) return null;

  const specialists = available.filter((p) => p.player.position === slot);
  const pool = specialists.length > 0 ? specialists : forced ? available : [];
  if (pool.length === 0) return null;

  let best = pool[0]!;
  let bestRating = baseRating(best.player, slot, ctx.rules) * (best.stamina / 100);
  for (const candidate of pool.slice(1)) {
    const rating = baseRating(candidate.player, slot, ctx.rules) * (candidate.stamina / 100);
    if (rating > bestRating) {
      best = candidate;
      bestRating = rating;
    }
  }
  return best;
}

export function runSubstitutions(ctx: MatchContext): void {
  for (const team of [ctx.home, ctx.away]) {
    // Injuries first: they are why you keep a substitution in your pocket.
    for (const player of onPitch(team)) {
      if (!player.injury || player.debuff >= PLAYING_HURT_PENALTY) continue;
      const slot = slotFor(team, player);
      if (!slot) continue;

      const replacement =
        team.subsUsed < ctx.rules.substitutionsAllowed
          ? findReplacement(ctx, team, slot, true)
          : null;

      if (!replacement) {
        // Nobody to bring on. Carry the knock to full time.
        player.debuff = PLAYING_HURT_PENALTY;
        player.debuffUntil = Number.POSITIVE_INFINITY;
        continue;
      }
      replaceInSlot(team, player, replacement, slot);
      emit(ctx, {
        minute: ctx.minute,
        type: 'SUBSTITUTION',
        side: team.side,
        offId: player.player.id,
        onId: replacement.player.id,
        reason: 'injury',
      });
    }

    // Then tired legs, but never at the cost of fielding someone worse.
    if (team.subsUsed >= ctx.rules.substitutionsAllowed) continue;
    for (const player of onPitch(team)) {
      if (team.subsUsed >= ctx.rules.substitutionsAllowed) break;
      if (player.stamina > ctx.rules.subStaminaThreshold) continue;

      const slot = slotFor(team, player);
      if (!slot) continue;
      const replacement = findReplacement(ctx, team, slot, false);
      if (!replacement || replacement.stamina < player.stamina + 20) continue;

      const current = baseRating(player.player, slot, ctx.rules) * (player.stamina / 100);
      const fresh = baseRating(replacement.player, slot, ctx.rules) * (replacement.stamina / 100);
      if (fresh <= current) continue;

      replaceInSlot(team, player, replacement, slot);
      emit(ctx, {
        minute: ctx.minute,
        type: 'SUBSTITUTION',
        side: team.side,
        offId: player.player.id,
        onId: replacement.player.id,
        reason: 'stamina',
      });
    }
  }
}

/** Trailing late, with chaseTheGame on: throw another chaser at it. */
export function applyEndgame(ctx: MatchContext): void {
  if (ctx.minute < ctx.rules.chaseTheGameFromMinute) return;

  for (const team of [ctx.home, ctx.away]) {
    if (!team.tactics.chaseTheGame) continue;
    if (team.aggression === 'attacking') continue;

    const opponent = team.side === 'home' ? ctx.away : ctx.home;
    if (opponent.points - team.points < ctx.rules.chaseTheGameDeficit) continue;

    team.aggression = 'attacking';
    emit(ctx, { minute: ctx.minute, type: 'TACTIC_SHIFT', side: team.side, to: 'attacking' });
  }
}

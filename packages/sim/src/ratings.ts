/**
 * Attributes in, role ratings out.
 *
 * Two rules keep this honest: every attribute must carry weight in at least one
 * position (an attribute nothing reads is just a number to admire), and the
 * weights for a position must sum to 1 so a rating is directly comparable to the
 * 1-99 attribute scale a manager sees.
 */

import type { Attributes, Attribute, Player, Position } from './types.js';
import type { RuleSet } from './rules.js';

export type Weights = Partial<Record<Attribute, number>>;

export const POSITION_WEIGHTS: Record<Position, Weights> = {
  chaser: { handling: 0.3, aim: 0.2, flying: 0.2, vision: 0.2, nerve: 0.1 },
  beater: { strength: 0.35, aim: 0.35, flying: 0.2, vision: 0.1 },
  keeper: { reflexes: 0.4, vision: 0.25, flying: 0.2, nerve: 0.15 },
  seeker: { flying: 0.35, vision: 0.3, handling: 0.2, nerve: 0.15 },
};

/** Taking the shot: placement and composure, less about carrying the quaffle. */
export const SHOOTING_WEIGHTS: Weights = { aim: 0.45, handling: 0.2, nerve: 0.2, flying: 0.15 };
/** Winning the quaffle back rather than moving it forward. */
export const DEFENCE_WEIGHTS: Weights = { vision: 0.4, flying: 0.3, handling: 0.2, strength: 0.1 };
/** Getting out of a bludger's way. */
export const EVASION_WEIGHTS: Weights = { reflexes: 0.45, flying: 0.4, nerve: 0.15 };
/** Putting a bludger where it hurts. */
export const BLUDGER_WEIGHTS: Weights = { aim: 0.4, strength: 0.4, flying: 0.2 };

export function weighted(attributes: Attributes, weights: Weights): number {
  let total = 0;
  for (const key in weights) {
    const attribute = key as Attribute;
    total += attributes[attribute] * (weights[attribute] ?? 0);
  }
  return total;
}

/** Rating in a position, ignoring condition, form and in-match damage. */
export function baseRating(player: Player, position: Position, rules: RuleSet): number {
  const raw = weighted(player.attributes, POSITION_WEIGHTS[position]);
  return position === player.position ? raw : raw * rules.outOfPositionPenalty;
}

/** Rating in the player's natural position. Used for valuations and squad strength. */
export function overall(player: Player, rules: RuleSet): number {
  return baseRating(player, player.position, rules);
}

/** A drained player keeps 70% of their rating; a fresh one keeps all of it. */
export function conditionFactor(stamina: number): number {
  return 0.7 + 0.3 * (clamp(stamina, 0, 100) / 100);
}

/** Form 50 is neutral; the extremes are worth +/-6%. */
export function formFactor(form: number): number {
  return 0.94 + 0.0012 * clamp(form, 0, 100);
}

/** Anything the tick loop needs to rate a player mid-match. */
export interface RatedPlayer {
  player: Player;
  /** Position actually being played. */
  position: Position;
  stamina: number;
  /** Current rating penalty from a recent bludger hit, 0-1. */
  debuff: number;
}

function live(rated: RatedPlayer, raw: number, rules: RuleSet, natural: boolean): number {
  const positional = natural ? 1 : rules.outOfPositionPenalty;
  return (
    raw *
    positional *
    conditionFactor(rated.stamina) *
    formFactor(rated.player.form) *
    (1 - rated.debuff)
  );
}

/** Rating in the position being played, after condition, form and damage. */
export function liveRating(rated: RatedPlayer, rules: RuleSet): number {
  const raw = weighted(rated.player.attributes, POSITION_WEIGHTS[rated.position]);
  return live(rated, raw, rules, rated.position === rated.player.position);
}

/**
 * Live rating against an arbitrary weight map, for the specialised contests.
 *
 * `natural` defaults to whether the player is in their own position. Pass it
 * explicitly when a player is doing a job that is not their position at all --
 * a seeker dropping back as a fourth chaser takes the out-of-position penalty
 * even though they are still, nominally, the seeker.
 */
export function liveSkill(
  rated: RatedPlayer,
  weights: Weights,
  rules: RuleSet,
  natural: boolean = rated.position === rated.player.position,
): number {
  const raw = weighted(rated.player.attributes, weights);
  return live(rated, raw, rules, natural);
}

export function meanRating(players: RatedPlayer[], rules: RuleSet): number {
  if (players.length === 0) return 0;
  let total = 0;
  for (const p of players) total += liveRating(p, rules);
  return total / players.length;
}

export function meanSkill(players: RatedPlayer[], weights: Weights, rules: RuleSet): number {
  if (players.length === 0) return 0;
  let total = 0;
  for (const p of players) total += liveSkill(p, weights, rules);
  return total / players.length;
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Strength of a whole squad, for seeding fixtures and picking a favourite. */
export function squadStrength(
  starters: { player: Player; position: Position }[],
  rules: RuleSet,
): number {
  if (starters.length === 0) return 0;
  let total = 0;
  for (const s of starters) total += baseRating(s.player, s.position, rules);
  return total / starters.length;
}

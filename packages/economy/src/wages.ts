/**
 * What a player costs to keep.
 *
 * Exponential in rating, so the last few points of quality are what actually
 * hurt: a 70 costs about twice a 60, and a 90 costs four times a 70. That curve
 * is what stops a manager simply buying the best available at every position, and
 * it is why selling a star is a real decision rather than a loss.
 */

import { overall, type Player, type RuleSet } from '@ql/sim';

export interface WageRules {
  /** Weekly wage at the reference rating. */
  base: number;
  referenceRating: number;
  /** Multiplier per rating point above the reference. */
  perPoint: number;
  /** Young players on their first deal cost less; veterans hold their price. */
  ageDiscount: { under: number; multiplier: number };
  /** Potential a manager cannot see still shows up in the wage demand. */
  potentialWeight: number;
}

export const WAGE_RULES: WageRules = {
  base: 290,
  referenceRating: 45,
  perPoint: 1.075,
  ageDiscount: { under: 21, multiplier: 0.6 },
  potentialWeight: 0.35,
};

/** Weekly wage in Galleons for a player at a given rating. */
export function wageForRating(rating: number, options: { age?: number; potential?: number } = {}): number {
  const rules = WAGE_RULES;
  let wage = rules.base * rules.perPoint ** (rating - rules.referenceRating);

  // A prospect's ceiling is priced in even though the manager cannot see it --
  // which is exactly why an unscouted signing can be an expensive mistake.
  if (options.potential !== undefined && options.potential > rating) {
    const headroom = options.potential - rating;
    wage *= 1 + (rules.potentialWeight * Math.min(headroom, 25)) / 100;
  }

  if (options.age !== undefined && options.age < rules.ageDiscount.under) {
    wage *= rules.ageDiscount.multiplier;
  }

  return Math.max(40, Math.round(wage));
}

export function wageForPlayer(player: Player, rules: RuleSet): number {
  const options: { age: number; potential?: number } = { age: player.age };
  if (player.potential !== undefined) options.potential = player.potential;
  return wageForRating(overall(player, rules), options);
}

/**
 * Transfer value, for phase four. Roughly a season and a half of wages, steepened
 * by youth: a 19-year-old with room to grow is worth more than his wage suggests,
 * a 33-year-old considerably less.
 */
export function marketValue(rating: number, age: number, potential: number): number {
  const wage = wageForRating(rating, { age, potential });
  const ageCurve =
    age <= 20 ? 2.2 : age <= 24 ? 1.8 : age <= 28 ? 1.4 : age <= 31 ? 0.9 : age <= 34 ? 0.45 : 0.2;
  const upside = 1 + Math.max(0, potential - rating) / 60;
  return Math.round(((wage * 52) / 12) * ageCurve * upside * 3);
}

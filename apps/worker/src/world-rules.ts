/**
 * World rules, as distinct from match rules.
 *
 * `RuleSet` in @ql/sim governs what happens inside eighty minutes. These govern
 * what happens between matches -- recovery, ageing, retirement, intake. They are
 * kept apart because a match rule change has to be versioned and pinned to
 * historical results, and these do not: they only ever affect the future.
 */

export interface WorldRules {
  /**
   * Stamina recovered per day between fixtures.
   *
   * A chaser burns about 40 stamina in a full match and the average gap between
   * matchdays is 2.33 days, so 17/day is break-even for someone who never comes
   * off. Sixteen puts an ever-present starter at a slight deficit, which is what
   * makes a bench worth having.
   */
  staminaRecoveryPerDay: number;
  /** Form drifts back toward the middle in the off-season. */
  offseasonFormPull: number;
  /** Retirement becomes possible here and certain at `retirementCertainAge`. */
  retirementFromAge: number;
  retirementCertainAge: number;
  /** Squad size each club is refilled to during the off-season. */
  rosterTarget: number;
  /** XP a full season of every minute is worth, used to scale development. */
  seasonXpReference: number;
  /** Rating points a 17-year-old prospect starts below their club's average. */
  intakeRatingGap: number;
  morale: { win: number; draw: number; loss: number };
}

export const DEFAULT_WORLD: WorldRules = {
  staminaRecoveryPerDay: 16,
  offseasonFormPull: 0.5,
  retirementFromAge: 33,
  retirementCertainAge: 38,
  rosterTarget: 14,
  seasonXpReference: 2300,
  intakeRatingGap: 12,
  morale: { win: 2, draw: 0, loss: -2 },
};

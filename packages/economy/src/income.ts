/**
 * Where the money comes from.
 *
 * Two recurring faucets and two occasional ones. The recurring pair is deliberately
 * the larger: a club should be able to plan, and a club that plans badly should
 * feel it every single week rather than once a season.
 */

export interface IncomeRules {
  /** Galleons per ticket sold. */
  ticketPrice: number;
  /** Share of the stadium that turns up for a mid-table side in average form. */
  baseFill: number;
  /** How much league position and form move attendance. */
  positionSwing: number;
  formSwing: number;
  fillClamp: [number, number];
  /** Weekly sponsor money by division tier. */
  sponsorByTier: Record<number, number>;
  /**
   * Prize money for finishing Nth in a twelve-club division.
   *
   * Deliberately flat -- about 3.5:1 top to bottom. A steeper curve was measured
   * over four simulated seasons and it was the main engine of the snowball: at
   * 12:1 the champion banked more than a whole season's operating surplus in prize
   * money alone, and by season four the top clubs had twelve facility levels to
   * the bottom clubs' five.
   */
  prizeByPosition: number[];
  /** Appearance fee, home or away, so an away trip is not a dead week. */
  appearanceFee: number;
}

export const INCOME_RULES: IncomeRules = {
  ticketPrice: 1,
  baseFill: 0.72,
  positionSwing: 0.22,
  formSwing: 0.12,
  fillClamp: [0.35, 1],
  sponsorByTier: { 1: 6000, 2: 3200, 3: 1800 },
  prizeByPosition: [
    70_000, 56_000, 47_000, 41_000, 37_000, 34_000, 31_000, 28_000, 26_000, 24_000, 22_000, 20_000,
  ],
  appearanceFee: 1500,
};

/**
 * How full the ground gets.
 *
 * `positionShare` is 1 at the top of the table and 0 at the bottom; `formShare`
 * is the club's recent results on the same scale. Winning fills a stadium, which
 * is the feedback loop that makes a promotion push pay for itself.
 */
export function attendanceFill(positionShare: number, formShare: number): number {
  const rules = INCOME_RULES;
  const fill =
    rules.baseFill +
    rules.positionSwing * (positionShare - 0.5) * 2 +
    rules.formSwing * (formShare - 0.5) * 2;
  return Math.min(rules.fillClamp[1], Math.max(rules.fillClamp[0], fill));
}

export function gateReceipts(capacity: number, fill: number): number {
  return Math.round(capacity * fill * INCOME_RULES.ticketPrice);
}

export function sponsorPerWeek(tier: number): number {
  return INCOME_RULES.sponsorByTier[tier] ?? INCOME_RULES.sponsorByTier[3] ?? 1800;
}

export function prizeMoney(position: number): number {
  const table = INCOME_RULES.prizeByPosition;
  return table[position - 1] ?? table[table.length - 1] ?? 0;
}

/**
 * The facility tree: the sink that makes saving worth it.
 *
 * Two rules do the work. Cost rises geometrically, so each level hurts more than
 * the last. And upkeep is charged on the capital invested, so a club that maxes
 * everything carries a fixed weekly cost it has to keep winning to afford -- which
 * is what stops the season-one champion simply buying everything and never being
 * caught.
 */

export type FacilityKind =
  | 'trainingGround'
  | 'medicalWing'
  | 'scoutingNetwork'
  | 'academy'
  | 'stadium'
  | 'broomStore';

export interface FacilitySpec {
  kind: FacilityKind;
  name: string;
  /** What buying a level actually does, in the manager's words. */
  effect: string;
  maxLevel: number;
  /** Cost of the first level. */
  baseCost: number;
  /** Multiplier per level. */
  growth: number;
}

export const FACILITIES: FacilitySpec[] = [
  {
    kind: 'trainingGround',
    name: 'Training ground',
    effect: 'Multiplies what a week of training is worth, 1.0 up to 1.8',
    maxLevel: 5,
    baseCost: 40_000,
    growth: 1.8,
  },
  {
    kind: 'medicalWing',
    name: 'Medical wing',
    effect: 'Cuts injury length and softens the risk of a bludger',
    maxLevel: 5,
    baseCost: 32_000,
    growth: 1.8,
  },
  {
    kind: 'scoutingNetwork',
    name: 'Scouting network',
    effect: 'Narrows the potential range a scout reports on a player',
    maxLevel: 5,
    baseCost: 28_000,
    growth: 1.75,
  },
  {
    kind: 'academy',
    name: 'Academy',
    effect: 'Better and more numerous youth players each off-season',
    maxLevel: 5,
    baseCost: 36_000,
    growth: 1.8,
  },
  {
    kind: 'stadium',
    name: 'Stadium',
    effect: 'Two thousand more seats, and the gate receipts that come with them',
    maxLevel: 6,
    baseCost: 60_000,
    growth: 1.7,
  },
  {
    kind: 'broomStore',
    name: 'Broom store',
    effect: 'A point of Flying across the whole squad; cheap early, poor value late',
    maxLevel: 3,
    baseCost: 18_000,
    growth: 2.1,
  },
];

export const FACILITY_BY_KIND: Record<FacilityKind, FacilitySpec> = Object.fromEntries(
  FACILITIES.map((facility) => [facility.kind, facility]),
) as Record<FacilityKind, FacilitySpec>;

/** Weekly upkeep as a share of the capital a club has sunk into its facilities. */
export const UPKEEP_RATE = 0.012;

/** Cost of moving from `level` to `level + 1`. Zero means it is already maxed. */
export function upgradeCost(kind: FacilityKind, level: number): number {
  const spec = FACILITY_BY_KIND[kind];
  if (level >= spec.maxLevel) return 0;
  return Math.round(spec.baseCost * spec.growth ** level);
}

/** Everything spent to reach a level, which is what upkeep is charged on. */
export function investedAt(kind: FacilityKind, level: number): number {
  let total = 0;
  for (let step = 0; step < level; step++) total += upgradeCost(kind, step);
  return total;
}

export function weeklyUpkeep(levels: Partial<Record<FacilityKind, number>>): number {
  let capital = 0;
  for (const facility of FACILITIES) {
    capital += investedAt(facility.kind, levels[facility.kind] ?? 0);
  }
  return Math.round(capital * UPKEEP_RATE);
}

// --- what the levels actually do -------------------------------------------

/** Training ground: 1.0 at level 0 up to 1.8 at level 5. */
export function trainingMultiplier(level: number): number {
  return 1 + 0.16 * Math.min(level, 5);
}

/** Medical wing: injuries heal faster and land less often. */
export function injuryRecoveryMultiplier(level: number): number {
  return 1 - 0.09 * Math.min(level, 5);
}
export function injuryRiskMultiplier(level: number): number {
  return 1 - 0.06 * Math.min(level, 5);
}

/** Scouting network: the reported potential range, in rating points either way. */
export function scoutRange(level: number): number {
  return Math.max(2, 16 - 2.8 * Math.min(level, 5));
}

/** Academy: how many prospects come through, and how good they are. */
export function academyIntakeBonus(level: number): { extra: number; ratingBonus: number } {
  return { extra: Math.floor(Math.min(level, 5) / 2), ratingBonus: 1.4 * Math.min(level, 5) };
}

/** Stadium: seats added per level. */
export function stadiumCapacity(baseCapacity: number, level: number): number {
  return baseCapacity + 2000 * Math.min(level, 6);
}

/** Broom store: a flat Flying bonus across the squad. */
export function broomFlyingBonus(level: number): number {
  return Math.min(level, 3);
}

export const DEFAULT_LEVELS: Record<FacilityKind, number> = {
  trainingGround: 0,
  medicalWing: 0,
  scoutingNetwork: 0,
  academy: 0,
  stadium: 0,
  broomStore: 0,
};

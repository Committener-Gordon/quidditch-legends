/**
 * Training: the only way to spend money on a player who is already yours.
 *
 * An order lasts a season and costs every week it runs, which makes it a
 * commitment rather than a toggle. Intensity trades development against injury
 * risk and fatigue, so pushing a squad hard is a real gamble and not free value.
 */

import type { Attribute } from '@ql/sim';

export type TrainingIntensity = 'light' | 'normal' | 'hard';

export interface IntensityProfile {
  /** Multiplies the XP a week of training is worth. */
  gain: number;
  /** Multiplies injury risk in training and in matches. */
  risk: number;
  /** Weekly cost per player. */
  costPerPlayer: number;
  /** Extra stamina drain per matchday. */
  fatigue: number;
}

export const INTENSITY: Record<TrainingIntensity, IntensityProfile> = {
  light: { gain: 0.7, risk: 0.85, costPerPlayer: 30, fatigue: -2 },
  normal: { gain: 1, risk: 1, costPerPlayer: 70, fatigue: 0 },
  hard: { gain: 1.35, risk: 1.3, costPerPlayer: 130, fatigue: 3 },
};

export interface TrainingOrder {
  /** The attribute the squad works on. Null means general fitness. */
  focus: Attribute | null;
  intensity: TrainingIntensity;
}

export function weeklyTrainingCost(order: TrainingOrder, squadSize: number): number {
  return Math.round(INTENSITY[order.intensity].costPerPlayer * squadSize);
}

/**
 * How much a season of this order is worth to development.
 *
 * A focused order concentrates its effect on one attribute, which is worth more
 * than spreading it -- but only for players whose position actually reads that
 * attribute. Training Strength into a Keeper buys nothing.
 */
export function developmentBonus(
  order: TrainingOrder,
  facilityMultiplier: number,
  weightOfFocus: number,
): number {
  const focused = order.focus === null ? 1 : 1 + 1.6 * weightOfFocus;
  return INTENSITY[order.intensity].gain * facilityMultiplier * focused;
}

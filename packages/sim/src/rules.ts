/**
 * Every balance dial in the sport, in one versioned object.
 *
 * A match row in the database stores its `version` alongside its seed. Retuning
 * the sport therefore means publishing a NEW version and leaving old matches
 * pinned to the rules they were played under -- never re-simulating them.
 *
 * The default numbers below are derived from one scoring budget, per team, over
 * an 80 minute match:
 *
 *   60 possessions x 0.55 reach a shot x 0.45 beat the keeper  =  ~15 goals
 *   15 goals x 10 points                                       =  150 points
 *   ~4 snitch cycles per match, ~2 caught by each seeker
 *   2 catches x 30 points                                      =   60 points
 *                                                              ------------
 *   total ~210 points, of which the snitch is ~29%
 */

import type { Aggression, BeaterFocus, Position, SeekerCommitment } from './types.js';

export interface AggressionProfile {
  /** Added to the chance a possession reaches a shot. */
  shot: number;
  /** Multiplies the side's weight when contesting possession. */
  possession: number;
}

export interface CommitmentProfile {
  /** Multiplies the seeker's snitch hazard rate. */
  lambda: number;
  /** Fraction of the seeker's rating lent to the chaser unit in open play. */
  quaffleSupport: number;
  /** Multiplies the seeker's stamina drain. */
  drain: number;
}

export interface RuleSet {
  version: string;

  // --- the match ------------------------------------------------------------
  matchMinutes: number;
  goalPoints: number;
  snitchPoints: number;
  /** Rating points added to the home side's units. */
  homeAdvantage: number;

  // --- quaffle --------------------------------------------------------------
  /** Total possessions per minute, shared between the sides. */
  possessionsPerMinute: number;
  /** How far a 100-point unit gap moves the share of possession from 50/50. */
  possessionSlope: number;
  possessionClamp: [number, number];
  /** Chance a possession reaches a shot when the units are evenly matched. */
  shotBase: number;
  /** How much a 100-point rating gap moves that chance. */
  shotSlope: number;
  shotClamp: [number, number];
  /** Chance a shot beats the keeper when shooter and keeper are evenly matched. */
  goalBase: number;
  goalSlope: number;
  goalClamp: [number, number];
  /** Chance a goal has an assist credited. */
  assistChance: number;
  /** Fraction of turnovers loud enough to log as an interception. */
  interceptionLogRate: number;
  /** Weight of the defending unit's rating relative to the attacking unit's. */
  defenceWeight: number;

  // --- bludgers -------------------------------------------------------------
  bludgerEventsPerMinute: number;
  bludgerHitBase: number;
  bludgerHitSlope: number;
  bludgerHitClamp: [number, number];
  /** Stamina removed from the player struck. */
  bludgerStaminaCost: number;
  /**
   * Chance a beater focus actually finds its nominated target rather than
   * whoever is nearest. Without this, `beaterFocus: 'seeker'` funnels every
   * bludger in the match into one player and the seeker is a spent force by the
   * hour mark, every match, on both sides.
   */
  focusTargetShare: number;
  /** Rating penalty while shaken off, and how long that lasts. */
  bludgerDebuff: number;
  bludgerDebuffMinutes: number;
  /** Chance a hit injures, before the target's nerve is applied. */
  injuryChanceOnHit: number;
  injuryDays: [number, number];

  // --- snitch ---------------------------------------------------------------
  /** Base hazard per seeker per minute at pool-average rating. */
  snitchLambda0: number;
  /** Time constant of the visibility ramp after each release, in minutes. */
  snitchRampMinutes: number;
  /** Exponent on (seekerRating / poolAverage). The main dial for what a star seeker is worth. */
  seekerExponent: number;
  /**
   * The reference the seeker ratio is measured against. This is a LIVE rating,
   * not a nominal one: a 65-rated seeker spends the match somewhere near 60 once
   * condition and form are applied, and gives up another slice to beater
   * pressure. Setting the reference at that level is what makes the predicted
   * catch count in expectations.ts match what the harness actually observes.
   */
  seekerPoolAverage: number;
  /** Ceiling on how far beaters can suppress the opposing seeker. */
  maxBeaterSuppression: number;
  /**
   * How sharply suppression responds to the beater rating gap. This is the dial
   * that decides whether beaters are worth buying: raising it makes beater
   * QUALITY matter more without raising average suppression, so the total number
   * of catches in a match is left alone.
   */
  beaterSuppressionResponse: number;

  // --- stamina and substitutions -------------------------------------------
  staminaDrainPerMinute: Record<Position, number>;
  substitutionsAllowed: number;
  /** Auto-sub an outfielder below this, if the bench holds someone fresher. */
  subStaminaThreshold: number;
  /** Rating multiplier for playing out of natural position. */
  outOfPositionPenalty: number;

  // --- tactics --------------------------------------------------------------
  aggression: Record<Aggression, AggressionProfile>;
  seekerCommitment: Record<SeekerCommitment, CommitmentProfile>;
  /** How hard each focus presses the opposing seeker. */
  beaterFocusPressure: Record<BeaterFocus, number>;
  /** Multiplies a side's offensive bludger weight under each focus. */
  beaterFocusOffence: Record<BeaterFocus, number>;
  /**
   * How much harder a side on `protect` is to hit. Without this, protecting was
   * all cost: fewer bludgers landed, and the only benefit was a smaller slice off
   * your own seeker's hunt.
   */
  protectHitReduction: number;
  /** What a side on `protect` cuts the suppression of its own seeker to. */
  protectSuppressionRelief: number;
  chaseTheGameFromMinute: number;
  chaseTheGameDeficit: number;
}

export const RULES_V2: RuleSet = {
  version: 'v2',

  matchMinutes: 80,
  goalPoints: 10,
  snitchPoints: 30,
  homeAdvantage: 2.5,

  possessionsPerMinute: 1.5,
  possessionSlope: 0.22,
  possessionClamp: [0.3, 0.7],
  shotBase: 0.55,
  shotSlope: 0.25,
  shotClamp: [0.15, 0.9],
  goalBase: 0.45,
  goalSlope: 0.22,
  goalClamp: [0.1, 0.85],
  assistChance: 0.6,
  interceptionLogRate: 0.3,
  defenceWeight: 0.95,

  bludgerEventsPerMinute: 0.5,
  bludgerHitBase: 0.5,
  bludgerHitSlope: 0.8,
  bludgerHitClamp: [0.15, 0.9],
  bludgerStaminaCost: 1.5,
  focusTargetShare: 0.7,
  bludgerDebuff: 0.2,
  bludgerDebuffMinutes: 4,
  injuryChanceOnHit: 0.035,
  injuryDays: [3, 24],

  snitchLambda0: 0.036,
  snitchRampMinutes: 6,
  seekerExponent: 1.2,
  seekerPoolAverage: 49,
  maxBeaterSuppression: 0.34,
  beaterSuppressionResponse: 4.2,

  staminaDrainPerMinute: { chaser: 0.5, beater: 0.42, keeper: 0.22, seeker: 0.42 },
  substitutionsAllowed: 3,
  subStaminaThreshold: 38,
  outOfPositionPenalty: 0.85,

  aggression: {
    defensive: { shot: -0.05, possession: 1.04 },
    balanced: { shot: 0, possession: 1 },
    attacking: { shot: 0.06, possession: 0.94 },
  },
  // A seeker dropping back lends their rating to open play, and that bonus
  // compounds through possession, shot and save the same way a rating gap does --
  // which made `support` the strictly correct call at quaffleSupport 0.30.
  seekerCommitment: {
    hunt: { lambda: 1.2, quaffleSupport: 0, drain: 1.12 },
    balanced: { lambda: 1, quaffleSupport: 0.06, drain: 1 },
    support: { lambda: 0.82, quaffleSupport: 0.15, drain: 0.95 },
  },
  beaterFocusPressure: { seeker: 0.62, chasers: 0.45, protect: 0.55 },
  beaterFocusOffence: { seeker: 1, chasers: 1, protect: 0.85 },
  protectHitReduction: 0.22,
  protectSuppressionRelief: 0.45,
  chaseTheGameFromMinute: 62,
  chaseTheGameDeficit: 20,
};

/**
 * The rule set the league launched on, kept exactly as it was.
 *
 * v2 retuned the tactical layer after a full simulated season showed that
 * `beaterFocus: 'seeker'` and `seekerCommitment: 'support'` were not decisions but
 * answers. v1 stays here unchanged so that any match played under it still
 * replays to the same result -- which is the entire point of pinning a version to
 * a match row.
 */
export const RULES_V1: RuleSet = {
  ...RULES_V2,
  version: 'v1',
  bludgerDebuff: 0.14,
  protectHitReduction: 0,
  protectSuppressionRelief: 0.6,
  seekerCommitment: {
    hunt: { lambda: 1.15, quaffleSupport: 0, drain: 1.15 },
    balanced: { lambda: 1, quaffleSupport: 0.1, drain: 1 },
    support: { lambda: 0.78, quaffleSupport: 0.3, drain: 0.95 },
  },
  beaterFocusPressure: { seeker: 1, chasers: 0.25, protect: 0.5 },
  beaterFocusOffence: { seeker: 1, chasers: 1, protect: 0.6 },
};

export const DEFAULT_RULES = RULES_V2;

/** Named rule sets, so a season can be pinned to one by string. */
export const RULE_SETS: Record<string, RuleSet> = { v1: RULES_V1, v2: RULES_V2 };

export function rulesByVersion(version: string): RuleSet {
  const rules = RULE_SETS[version];
  if (!rules) throw new Error(`Unknown rules version: ${version}`);
  return rules;
}

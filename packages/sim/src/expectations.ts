/**
 * What the dials predict, before a single match is played.
 *
 * These are the arithmetic the rule set was built from. The harness compares them
 * against simulated reality, and the post-match ratings use them as the baseline
 * a performance is judged against -- so retuning a dial moves both, together.
 */

import type { RuleSet } from './rules.js';

export interface Expectations {
  possessionsPerTeam: number;
  shotsPerTeam: number;
  goalsPerTeam: number;
  savesPerKeeper: number;
  quafflePointsPerTeam: number;
  /** Mean minutes a snitch survives, including the visibility ramp. */
  snitchCycleMinutes: number;
  catchesPerMatch: number;
  catchesPerTeam: number;
  snitchPointsPerTeam: number;
  pointsPerTeam: number;
  /** Share of a team's points that comes from the snitch. */
  snitchShare: number;
  bludgerHitsPerTeam: number;
}

export function expectations(rules: RuleSet): Expectations {
  const possessionsPerTeam = (rules.matchMinutes * rules.possessionsPerMinute) / 2;
  const shotsPerTeam = possessionsPerTeam * rules.shotBase;
  const goalsPerTeam = shotsPerTeam * rules.goalBase;
  const quafflePointsPerTeam = goalsPerTeam * rules.goalPoints;

  // Two seekers hunting at pool-average rating, plus the ramp each release.
  const snitchCycleMinutes = 1 / (2 * rules.snitchLambda0) + rules.snitchRampMinutes;
  const catchesPerMatch = rules.matchMinutes / snitchCycleMinutes;
  const catchesPerTeam = catchesPerMatch / 2;
  const snitchPointsPerTeam = catchesPerTeam * rules.snitchPoints;

  const pointsPerTeam = quafflePointsPerTeam + snitchPointsPerTeam;

  return {
    possessionsPerTeam,
    shotsPerTeam,
    goalsPerTeam,
    savesPerKeeper: shotsPerTeam - goalsPerTeam,
    quafflePointsPerTeam,
    snitchCycleMinutes,
    catchesPerMatch,
    catchesPerTeam,
    snitchPointsPerTeam,
    pointsPerTeam,
    snitchShare: snitchPointsPerTeam / pointsPerTeam,
    bludgerHitsPerTeam:
      ((rules.matchMinutes * rules.bludgerEventsPerMinute) / 2) * rules.bludgerHitBase,
  };
}

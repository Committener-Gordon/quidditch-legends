/**
 * Fixture generation by the circle method.
 *
 * Twelve clubs, eleven rounds in the first half, mirrored with home and away
 * reversed for the second: twenty-two matchdays where every club plays every
 * other twice, once at home. The club order is shuffled from the season salt, so
 * two seasons of the same league are not the same fixture list -- and the same
 * salt always rebuilds the same one.
 */

import type { Rng } from '@ql/sim';

export interface ScheduledPair {
  matchday: number;
  homeClubId: string;
  awayClubId: string;
}

export function doubleRoundRobin(clubIds: string[], rng: Rng): ScheduledPair[] {
  if (clubIds.length < 2) throw new Error('a division needs at least two clubs');
  if (clubIds.length % 2 !== 0) {
    throw new Error(`a division needs an even number of clubs, got ${clubIds.length}`);
  }

  // Shuffle so the fixture list is season-specific but reproducible.
  const teams = [...clubIds];
  for (let index = teams.length - 1; index > 0; index--) {
    const swap = rng.int(index + 1);
    const held = teams[index]!;
    teams[index] = teams[swap]!;
    teams[swap] = held;
  }

  const size = teams.length;
  const roundsPerHalf = size - 1;
  const fixtures: ScheduledPair[] = [];

  for (let round = 0; round < roundsPerHalf; round++) {
    for (let slot = 0; slot < size / 2; slot++) {
      const a = teams[slot]!;
      const b = teams[size - 1 - slot]!;
      // Alternating who is at home keeps each club's home games spread out
      // instead of clustered at one end of the season.
      const aAtHome = (round + slot) % 2 === 0;

      fixtures.push({
        matchday: round + 1,
        homeClubId: aAtHome ? a : b,
        awayClubId: aAtHome ? b : a,
      });
      fixtures.push({
        matchday: round + 1 + roundsPerHalf,
        homeClubId: aAtHome ? b : a,
        awayClubId: aAtHome ? a : b,
      });
    }

    // Rotate everything but the first team.
    teams.splice(1, 0, teams.pop()!);
  }

  return fixtures.sort((left, right) => left.matchday - right.matchday);
}

export function matchdayCount(clubCount: number): number {
  return (clubCount - 1) * 2;
}

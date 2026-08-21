/**
 * Picking a side.
 *
 * The engine needs this for two reasons: the harness has to field generated
 * rosters, and on matchday the worker has to auto-pick for every manager who did
 * not set a lineup before the deadline.
 */

import { baseRating } from './ratings.js';
import type { RuleSet } from './rules.js';
import type { Lineup, Player, Position, Squad, Tactics } from './types.js';

const SLOTS: { position: Position; count: number }[] = [
  { position: 'keeper', count: 1 },
  { position: 'seeker', count: 1 },
  { position: 'beater', count: 2 },
  { position: 'chaser', count: 3 },
];

/** Rating discounted by condition: a 90-rated player at 40% fitness is not a pick. */
function pickValue(player: Player, position: Position, rules: RuleSet): number {
  return baseRating(player, position, rules) * (0.6 + 0.4 * (player.stamina / 100));
}

/**
 * Best available side from a roster. Scarce positions are filled first, so a
 * squad with one keeper does not end up playing a chaser in goal.
 */
export function autoLineup(
  roster: Player[],
  rules: RuleSet,
): { lineup: Lineup; bench: Player[] } {
  const available = [...roster];
  const chosen: Record<Position, Player[]> = { chaser: [], beater: [], keeper: [], seeker: [] };

  for (const slot of SLOTS) {
    for (let i = 0; i < slot.count; i++) {
      if (available.length === 0) break;
      let bestIndex = 0;
      let bestValue = -Infinity;
      for (let index = 0; index < available.length; index++) {
        const value = pickValue(available[index]!, slot.position, rules);
        if (value > bestValue) {
          bestValue = value;
          bestIndex = index;
        }
      }
      chosen[slot.position].push(available.splice(bestIndex, 1)[0]!);
    }
  }

  const keeper = chosen.keeper[0];
  const seeker = chosen.seeker[0];
  // Only reachable with a roster of fewer than seven players.
  if (!keeper || !seeker || chosen.beater.length < 2 || chosen.chaser.length < 3) {
    throw new Error('autoLineup needs at least 7 players to field a side');
  }

  return {
    lineup: { chasers: chosen.chaser, beaters: chosen.beater, keeper, seeker },
    // Freshest first: that is the order the auto-subs will reach for.
    bench: available.sort((a, b) => b.stamina - a.stamina),
  };
}

export function buildSquad(
  club: { clubId: string; name: string; short: string },
  roster: Player[],
  tactics: Tactics,
  rules: RuleSet,
): Squad {
  const { lineup, bench } = autoLineup(roster, rules);
  return { ...club, lineup, bench, tactics };
}

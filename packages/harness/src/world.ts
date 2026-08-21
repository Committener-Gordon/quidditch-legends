/**
 * Throwaway leagues for the harness.
 *
 * These clubs never touch a database. They exist so 100,000 matches can be run
 * against a plausible spread of squad quality before a single table is created.
 */

import {
  DEFAULT_RULES,
  DEFAULT_TACTICS,
  createRng,
  generateClub,
  squadStrength,
  type Archetype,
  type RuleSet,
  type Squad,
  type Tactics,
} from '@ql/sim';

const CLUB_NAMES: [string, string][] = [
  ['Pyrewood Pirates', 'PYR'],
  ['Ashdown Arrows', 'ASH'],
  ['Kirkwall Kestrels', 'KIR'],
  ['Thistlewood Thorns', 'THI'],
  ['Blackwood Basilisks', 'BLK'],
  ['Stillwater Sentinels', 'STL'],
  ['Marchbanks Magpies', 'MAR'],
  ['Hollowell Harriers', 'HOL'],
  ['Frostbourne Falcons', 'FRO'],
  ['Nettlefold Nomads', 'NET'],
  ['Crowhurst Chargers', 'CRO'],
  ['Lamplight Lions', 'LAM'],
];

export function clubIdentity(index: number): { name: string; short: string } {
  const entry = CLUB_NAMES[index % CLUB_NAMES.length]!;
  const cycle = Math.floor(index / CLUB_NAMES.length);
  return {
    name: cycle === 0 ? entry[0] : `${entry[0]} ${cycle + 1}`,
    short: entry[1],
  };
}

export interface ClubSpec {
  seed: string;
  index: number;
  rating: number;
  archetype?: Archetype;
  tactics?: Partial<Tactics>;
  rules?: RuleSet;
}

export function makeClub(spec: ClubSpec): Squad {
  const identity = clubIdentity(spec.index);
  return generateClub(createRng(spec.seed), {
    clubId: `c${spec.index}`,
    name: identity.name,
    short: identity.short,
    rating: spec.rating,
    archetype: spec.archetype ?? 'balanced',
    tactics: { ...DEFAULT_TACTICS, ...spec.tactics },
    rules: spec.rules ?? DEFAULT_RULES,
  });
}

/** Mean rating of the starting seven -- what "the favourite" means here. */
export function strengthOf(squad: Squad, rules: RuleSet = DEFAULT_RULES): number {
  return squadStrength(
    [
      ...squad.lineup.chasers.map((player) => ({ player, position: 'chaser' as const })),
      ...squad.lineup.beaters.map((player) => ({ player, position: 'beater' as const })),
      { player: squad.lineup.keeper, position: 'keeper' as const },
      { player: squad.lineup.seeker, position: 'seeker' as const },
    ],
    rules,
  );
}

/** A league-like spread of squad quality: most clubs mid-table, a few outliers. */
export function ratingForClub(rng: { normal(mean: number, sd: number): number }): number {
  const rating = rng.normal(65, 6.5);
  return Math.max(45, Math.min(85, rating));
}

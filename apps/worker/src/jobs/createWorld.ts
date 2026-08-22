/**
 * Building a league out of nothing but a seed.
 *
 * Twelve clubs, every one of them AI-managed, each with a fourteen-player roster
 * and its own tactical habits. Phase three turns one of these into a human's club
 * by setting `managerUserId` -- nothing else about the world has to change.
 */

import { createRng, generateRoster, rulesByVersion, type Tactics } from '@ql/sim';
import { wageForPlayer } from '@ql/economy';
import { clubs, ensureFacilities, fromSimPlayer, players, postEntry, type Database } from '@ql/db';

interface ClubBlueprint {
  name: string;
  short: string;
  /** Mean rating of the starting seven, which is the league's pecking order. */
  rating: number;
  capacity: number;
  tactics: Tactics;
}

/**
 * The division's hierarchy is set here rather than randomly, so a fresh world has
 * a title favourite, a mid-table and a couple of clubs in trouble -- the shape a
 * league needs to be worth reading.
 */
const DIVISION: ClubBlueprint[] = [
  { name: 'Pyrewood Pirates', short: 'PYR', rating: 72, capacity: 24000, tactics: t('balanced', 'balanced', 'seeker') },
  { name: 'Kirkwall Kestrels', short: 'KIR', rating: 70, capacity: 21000, tactics: t('attacking', 'hunt', 'seeker') },
  { name: 'Blackwood Basilisks', short: 'BLK', rating: 69, capacity: 19500, tactics: t('defensive', 'balanced', 'protect') },
  { name: 'Marchbanks Magpies', short: 'MAR', rating: 68, capacity: 18000, tactics: t('balanced', 'hunt', 'chasers') },
  { name: 'Frostbourne Falcons', short: 'FRO', rating: 67, capacity: 16500, tactics: t('attacking', 'balanced', 'chasers') },
  { name: 'Stillwater Sentinels', short: 'STL', rating: 66, capacity: 15000, tactics: t('defensive', 'support', 'protect') },
  { name: 'Thistlewood Thorns', short: 'THI', rating: 65, capacity: 14000, tactics: t('balanced', 'balanced', 'seeker') },
  { name: 'Hollowell Harriers', short: 'HOL', rating: 64, capacity: 12500, tactics: t('attacking', 'hunt', 'seeker') },
  { name: 'Crowhurst Chargers', short: 'CRO', rating: 63, capacity: 11000, tactics: t('balanced', 'support', 'chasers') },
  { name: 'Nettlefold Nomads', short: 'NET', rating: 62, capacity: 9500, tactics: t('defensive', 'balanced', 'protect') },
  { name: 'Lamplight Lions', short: 'LAM', rating: 60, capacity: 8000, tactics: t('balanced', 'hunt', 'seeker') },
  { name: 'Ashdown Arrows', short: 'ASH', rating: 58, capacity: 7000, tactics: t('attacking', 'support', 'chasers') },
];

function t(
  aggression: Tactics['aggression'],
  seekerCommitment: Tactics['seekerCommitment'],
  beaterFocus: Tactics['beaterFocus'],
): Tactics {
  return { aggression, seekerCommitment, beaterFocus, chaseTheGame: true };
}

export interface CreateWorldResult {
  clubs: number;
  players: number;
  seedCapital: number;
}

/**
 * What every club starts with.
 *
 * Enough for one meaningful facility upgrade plus a few weeks of buffer, so the
 * first real decision a manager makes is which upgrade -- not whether they can
 * afford to exist.
 */
export const SEED_CAPITAL = 80_000;

export async function createWorld(
  db: Database,
  options: { seed: string; season: number; rulesVersion?: string },
): Promise<CreateWorldResult> {
  const rules = rulesByVersion(options.rulesVersion ?? 'v2');
  const existing = await db.select({ id: clubs.id }).from(clubs).limit(1);
  if (existing.length > 0) {
    throw new Error('a world already exists -- run `world:reset` first if you meant to rebuild it');
  }

  let playerCount = 0;

  for (const blueprint of DIVISION) {
    const [club] = await db
      .insert(clubs)
      .values({
        name: blueprint.name,
        short: blueprint.short,
        stadiumCapacity: blueprint.capacity,
        tactics: blueprint.tactics,
        foundedSeason: options.season,
      })
      .returning({ id: clubs.id });
    if (!club) throw new Error(`failed to create ${blueprint.name}`);

    const roster = generateRoster(createRng(`${options.seed}::${blueprint.short}`), {
      clubId: club.id,
      name: blueprint.name,
      short: blueprint.short,
      rating: blueprint.rating,
    });

    await db.insert(players).values(
      roster.map((player) => ({
        ...fromSimPlayer(player, { clubId: club.id, joinedSeason: options.season }),
        wage: wageForPlayer(player, rules),
      })),
    );
    playerCount += roster.length;

    await ensureFacilities(db, club.id);
    await postEntry(db, {
      clubId: club.id,
      kind: 'adjustment',
      amount: SEED_CAPITAL,
      reason: 'founding capital',
      reference: `founding-s${options.season}`,
    });
  }

  // Staggered contracts, so a squad does not all run out in the same off-season.
  const { seedContracts } = await import('./market.js');
  await seedContracts(db, options.season);

  return { clubs: DIVISION.length, players: playerCount, seedCapital: SEED_CAPITAL };
}

export const DIVISION_SIZE = DIVISION.length;

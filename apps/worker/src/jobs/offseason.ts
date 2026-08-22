/**
 * The off-season.
 *
 * Four things happen between seasons, and together they are what makes a league
 * worth following for more than one year: players develop toward their hidden
 * ceiling, veterans decline and retire, and each club's academy refills the gaps.
 *
 * Development is deliberately gated on minutes played. A prospect who sat on the
 * bench all season barely improves, which is what gives a manager a reason to
 * risk playing one.
 */

import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  POSITION_WEIGHTS,
  createRng,
  generatePlayer,
  overall,
  rulesByVersion,
  type Attribute,
  type Position,
  type RuleSet,
  type Rng,
} from '@ql/sim';
import {
  academyIntakeBonus,
  developmentBonus,
  trainingMultiplier,
  wageForPlayer,
  type TrainingIntensity,
} from '@ql/economy';
import {
  clubs,
  facilityLevelsByClub,
  fromSimPlayer,
  players,
  seasons,
  toSimPlayer,
  trainingOrderFor,
  type Database,
  type PlayerRow,
} from '@ql/db';
import { DEFAULT_WORLD, type WorldRules } from '../world-rules.js';

/** Squad shape each club is refilled toward. */
const ROSTER_SHAPE: Record<Position, number> = { chaser: 6, beater: 4, keeper: 2, seeker: 2 };

const ATTRIBUTES: Attribute[] = [
  'flying',
  'handling',
  'aim',
  'strength',
  'vision',
  'reflexes',
  'nerve',
];

export interface OffseasonResult {
  season: number;
  developed: number;
  improved: number;
  declined: number;
  retired: { name: string; age: number; club: string | null }[];
  /** Players whose contracts ran out and who are now free agents. */
  walkedAway: { name: string; from: string | null }[];
  intake: number;
  biggestRisers: { name: string; age: number; from: number; to: number }[];
}

/**
 * How much rating a player gains, or loses, over one off-season.
 *
 * `boost` is what the club bought: its training ground level and the order it set,
 * multiplied together. Note that it scales the gain and cannot create one -- a
 * 33-year-old with no headroom left develops nothing however hard he trains.
 */
export function developmentDelta(
  row: PlayerRow,
  rules: RuleSet,
  world: WorldRules,
  boost = 1,
): number {
  const rating = overall(toSimPlayer(row), rules);
  const gap = Math.max(0, row.potential - rating);

  const ageFactor =
    row.age <= 21 ? 1 : row.age <= 25 ? 0.65 : row.age <= 29 ? 0.3 : row.age <= 32 ? 0.08 : 0;
  // Minutes are the input. A season of every minute is the reference.
  const xpFactor = Math.min(1.25, Math.max(0.15, row.xp / world.seasonXpReference));
  const headroom = Math.min(1, gap / 12);

  let delta = 4.5 * ageFactor * xpFactor * headroom * boost;
  if (row.age >= 31) delta -= (row.age - 30) * 0.55;

  // Never past the ceiling.
  return Math.min(delta, gap);
}

/**
 * Move a player's rating by `delta`.
 *
 * Position weights sum to 1, so adding delta to each weighted attribute moves the
 * position rating by exactly delta -- and leaves the attributes the position does
 * not use alone, which is why a chaser never gets stronger by playing chaser.
 */
function applyDelta(row: PlayerRow, delta: number): Partial<Record<Attribute, number>> {
  const weights = POSITION_WEIGHTS[row.position as Position];
  const changes: Partial<Record<Attribute, number>> = {};
  for (const attribute of ATTRIBUTES) {
    if ((weights[attribute] ?? 0) > 0) {
      changes[attribute] = Math.max(15, Math.min(99, Math.round(row[attribute] + delta)));
    }
  }
  return changes;
}

function retires(row: PlayerRow, world: WorldRules, rng: Rng): boolean {
  if (row.age >= world.retirementCertainAge) return true;
  if (row.age < world.retirementFromAge) return false;
  // Rises steeply: a third at 33, near-certain by 37.
  const chance = 0.3 + (row.age - world.retirementFromAge) * 0.18;
  return rng.chance(chance);
}

export async function runOffseason(
  db: Database,
  options: { seasonNumber: number; world?: WorldRules },
): Promise<OffseasonResult> {
  const world = options.world ?? DEFAULT_WORLD;
  const [season] = await db.select().from(seasons).where(eq(seasons.number, options.seasonNumber));
  if (!season) throw new Error(`no season ${options.seasonNumber}`);
  if (season.state !== 'complete') {
    throw new Error(
      `season ${season.number} is still ${season.state} -- every fixture has to be published first`,
    );
  }

  const rules = rulesByVersion(season.rulesVersion);
  const rng = createRng(`${season.salt}::offseason`);

  const roster = await db.select().from(players).where(isNull(players.retiredInSeason));
  const facilityLevels = await facilityLevelsByClub(db);

  // One training order per club per season, so look them up once.
  const orders = new Map<string, { focus: string | null; intensity: TrainingIntensity }>();
  for (const clubId of new Set(roster.map((row) => row.clubId).filter((id): id is string => !!id))) {
    const order = await trainingOrderFor(db, clubId, season.id);
    if (order) orders.set(clubId, { focus: order.focus, intensity: order.intensity });
  }

  const clubNames = new Map(
    (await db.select({ id: clubs.id, short: clubs.short }).from(clubs)).map((club) => [
      club.id,
      club.short,
    ]),
  );

  const result: OffseasonResult = {
    season: season.number,
    developed: 0,
    improved: 0,
    declined: 0,
    retired: [],
    walkedAway: [],
    intake: 0,
    biggestRisers: [],
  };
  const risers: OffseasonResult['biggestRisers'] = [];

  for (const row of roster) {
    const before = overall(toSimPlayer(row), rules);

    // What the club bought: its training ground, and the order it set. A focused
    // order is worth more, but only to players whose position reads that
    // attribute -- training Strength into a keeper buys nothing.
    const levels = row.clubId ? facilityLevels.get(row.clubId) : undefined;
    const order = row.clubId ? orders.get(row.clubId) : undefined;
    const focusWeight =
      order?.focus
        ? (POSITION_WEIGHTS[row.position as Position][order.focus as Attribute] ?? 0)
        : 0;
    const boost = order
      ? developmentBonus(
          { focus: (order.focus as Attribute | null) ?? null, intensity: order.intensity },
          trainingMultiplier(levels?.trainingGround ?? 0),
          focusWeight,
        )
      : trainingMultiplier(levels?.trainingGround ?? 0);

    const delta = developmentDelta(row, rules, world, boost);
    const changes = Math.abs(delta) >= 0.5 ? applyDelta(row, delta) : {};
    const aged = row.age + 1;

    const retiring = retires({ ...row, age: aged }, world, rng);

    const developed = { ...toSimPlayer(row), age: aged, attributes: { ...toSimPlayer(row).attributes, ...changes } };

    await db
      .update(players)
      .set({
        ...changes,
        age: aged,
        wage: wageForPlayer(developed, rules),
        // A fresh pre-season: rested, fit, and back toward neutral form.
        stamina: Math.round(rng.range(92, 100)),
        form: Math.round(row.form + (50 - row.form) * world.offseasonFormPull),
        xp: 0,
        injuredUntil: null,
        ...(retiring ? { retiredInSeason: season.number } : {}),
      })
      .where(eq(players.id, row.id));

    result.developed += 1;
    if (delta >= 0.5) result.improved += 1;
    if (delta <= -0.5) result.declined += 1;
    if (delta >= 0.5) {
      risers.push({
        name: row.name,
        age: aged,
        from: Math.round(before * 10) / 10,
        to: Math.round((before + delta) * 10) / 10,
      });
    }
    if (retiring) {
      result.retired.push({
        name: row.name,
        age: aged,
        club: row.clubId ? (clubNames.get(row.clubId) ?? null) : null,
      });
    }
  }

  result.biggestRisers = risers.sort((a, b) => b.to - b.from - (a.to - a.from)).slice(0, 5);

  // Deals that ran out: those players walk for nothing, which is the redistribution
  // the league relies on while there is no draft.
  const { expireContracts } = await import('./market.js');
  result.walkedAway = await expireContracts(db, season.number);

  result.intake = await runYouthIntake(db, season.number, rules, world, rng);

  return result;
}

/**
 * Each club's academy refills its squad to shape, with 17-year-olds pitched below
 * the senior squad's level but carrying real potential. This is the only source of
 * new players in the world, which is what keeps talent scarce.
 */
async function runYouthIntake(
  db: Database,
  seasonNumber: number,
  rules: RuleSet,
  world: WorldRules,
  rng: Rng,
): Promise<number> {
  const allClubs = await db.select({ id: clubs.id, short: clubs.short }).from(clubs);
  const facilityLevels = await facilityLevelsByClub(db);
  let created = 0;

  for (const club of allClubs) {
    const squad = await db
      .select()
      .from(players)
      .where(and(eq(players.clubId, club.id), isNull(players.retiredInSeason)));

    const averageRating =
      squad.length > 0
        ? squad.reduce((sum, row) => sum + overall(toSimPlayer(row), rules), 0) / squad.length
        : 60;

    const academy = academyIntakeBonus(facilityLevels.get(club.id)?.academy ?? 0);

    const counts: Record<Position, number> = { chaser: 0, beater: 0, keeper: 0, seeker: 0 };
    for (const row of squad) counts[row.position as Position] += 1;

    for (const position of Object.keys(ROSTER_SHAPE) as Position[]) {
      const missing = ROSTER_SHAPE[position] - counts[position] + (position === 'chaser' ? academy.extra : 0);
      for (let index = 0; index < missing; index += 1) {
        const prospect = generatePlayer(rng, {
          id: 'pending',
          position,
          age: Math.round(rng.range(17, 19)),
          // Raw, but the potential roll in generatePlayer gives the good ones room.
          rating: Math.max(
            30,
            averageRating - world.intakeRatingGap + academy.ratingBonus + rng.normal(0, 3),
          ),
        });
        await db.insert(players).values({
          ...fromSimPlayer(prospect, { clubId: club.id, joinedSeason: seasonNumber + 1 }),
          wage: wageForPlayer(prospect, rules),
          contractUntilSeason: seasonNumber + 1 + 3,
        });
        created += 1;
      }
    }
  }

  return created;
}

/** Total squad size across the world, for the CLI to report. */
export async function countActivePlayers(db: Database): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(players)
    .where(isNull(players.retiredInSeason));
  return row?.count ?? 0;
}

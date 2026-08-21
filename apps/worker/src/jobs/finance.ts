/**
 * Money moving.
 *
 * Every posting is idempotent on (club, kind, reference), so a re-run of a
 * matchday or a payday cannot double-charge a club. That is the whole reason the
 * ledger has that unique index.
 *
 * Wages and upkeep are charged weekly, which at three matchdays a week means every
 * third matchday. Gate receipts land per match. The recurring pair is deliberately
 * larger than the occasional one: a club should be able to plan, and a club that
 * plans badly should feel it every week rather than once a season.
 */

import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  FACILITIES,
  attendanceFill,
  gateReceipts,
  prizeMoney,
  sponsorPerWeek,
  stadiumCapacity,
  upgradeCost,
  weeklyTrainingCost,
  weeklyUpkeep,
  type FacilityKind,
} from '@ql/economy';
import {
  balanceOf,
  clubs,
  divisions,
  ensureFacilities,
  facilityLevels,
  facilityLevelsByClub,
  fixtures,
  matches,
  players,
  postEntry,
  purchaseFacility,
  standings,
  trainingOrderFor,
  type Database,
} from '@ql/db';

/** Three matchdays a week, so every third matchday is a payday. */
export function isPayday(matchday: number): boolean {
  return matchday % 3 === 1;
}

export function weekOf(matchday: number): number {
  return Math.floor((matchday - 1) / 3) + 1;
}

export interface PaydayLine {
  clubId: string;
  short: string;
  sponsor: number;
  wages: number;
  upkeep: number;
  training: number;
  net: number;
  balance: number;
  unpaid: boolean;
}

/**
 * Charge a week.
 *
 * A club that cannot cover its wages still pays them -- the balance goes negative
 * and morale takes the hit. Refusing to pay would be tidier for the ledger and
 * much worse as a game: the consequence has to land on the squad.
 */
export async function runPayday(
  db: Database,
  options: { seasonId: string; seasonNumber: number; matchday: number; tier?: number },
): Promise<PaydayLine[]> {
  const week = weekOf(options.matchday);
  const reference = `s${options.seasonNumber}-w${week}`;
  const tier = options.tier ?? 1;

  const roster = await db.select({ id: clubs.id, short: clubs.short }).from(clubs).orderBy(asc(clubs.name));
  const levelsByClub = await facilityLevelsByClub(db);
  const lines: PaydayLine[] = [];

  for (const club of roster) {
    await ensureFacilities(db, club.id);
    const levels = levelsByClub.get(club.id) ?? (await facilityLevels(db, club.id));

    const squad = await db
      .select({ wage: players.wage })
      .from(players)
      .where(and(eq(players.clubId, club.id), isNull(players.retiredInSeason)));
    const wages = squad.reduce((sum, row) => sum + row.wage, 0);
    const upkeep = weeklyUpkeep(levels);
    const sponsor = sponsorPerWeek(tier);

    const order = await trainingOrderFor(db, club.id, options.seasonId);
    const training = order
      ? weeklyTrainingCost({ focus: null, intensity: order.intensity }, squad.length)
      : 0;

    await postEntry(db, {
      clubId: club.id,
      kind: 'sponsor',
      amount: sponsor,
      reason: `sponsorship, week ${week}`,
      reference,
      seasonId: options.seasonId,
    });
    await postEntry(db, {
      clubId: club.id,
      kind: 'wages',
      amount: -wages,
      reason: `wages for ${squad.length} players, week ${week}`,
      reference,
      seasonId: options.seasonId,
    });
    if (upkeep > 0) {
      await postEntry(db, {
        clubId: club.id,
        kind: 'upkeep',
        amount: -upkeep,
        reason: `facility upkeep, week ${week}`,
        reference,
        seasonId: options.seasonId,
      });
    }
    if (training > 0) {
      await postEntry(db, {
        clubId: club.id,
        kind: 'training',
        amount: -training,
        reason: `${order?.intensity ?? 'normal'} training, week ${week}`,
        reference,
        seasonId: options.seasonId,
      });
    }

    const balance = await balanceOf(db, club.id);
    const unpaid = balance < 0;
    if (unpaid) {
      // The squad notices.
      await db
        .update(players)
        .set({ morale: sql`greatest(0, ${players.morale} - 3)` })
        .where(and(eq(players.clubId, club.id), isNull(players.retiredInSeason)));
    }

    lines.push({
      clubId: club.id,
      short: club.short,
      sponsor,
      wages,
      upkeep,
      training,
      net: sponsor - wages - upkeep - training,
      balance,
      unpaid,
    });
  }

  return lines;
}

/**
 * Gate receipts and appearance fees for one played match.
 *
 * Attendance follows league position and recent form, which is the feedback loop
 * that makes a promotion push pay for itself -- and makes a bad run bite twice.
 */
export async function postMatchIncome(
  db: Database,
  options: {
    matchId: string;
    seasonId: string;
    divisionId: string;
    homeClubId: string;
    awayClubId: string;
  },
): Promise<{ gate: number; fill: number }> {
  const table = await db
    .select({ clubId: standings.clubId, points: standings.tablePoints })
    .from(standings)
    .where(eq(standings.divisionId, options.divisionId))
    .orderBy(desc(standings.tablePoints));

  const position = Math.max(1, table.findIndex((row) => row.clubId === options.homeClubId) + 1);
  const positionShare = table.length > 1 ? 1 - (position - 1) / (table.length - 1) : 0.5;
  const formShare = await recentForm(db, options.seasonId, options.homeClubId);

  const [club] = await db
    .select({ capacity: clubs.stadiumCapacity })
    .from(clubs)
    .where(eq(clubs.id, options.homeClubId));
  const levels = await facilityLevels(db, options.homeClubId);
  const capacity = stadiumCapacity(club?.capacity ?? 8000, levels.stadium);

  const fill = attendanceFill(positionShare, formShare);
  const gate = gateReceipts(capacity, fill);

  await postEntry(db, {
    clubId: options.homeClubId,
    kind: 'gate',
    amount: gate,
    reason: `gate receipts, ${Math.round(capacity * fill).toLocaleString()} in`,
    reference: options.matchId,
    seasonId: options.seasonId,
  });
  for (const clubId of [options.homeClubId, options.awayClubId]) {
    await postEntry(db, {
      clubId,
      kind: 'appearance',
      amount: 1500,
      reason: 'appearance fee',
      reference: options.matchId,
      seasonId: options.seasonId,
    });
  }

  return { gate, fill };
}

/** Wins in the club's last five, on a 0-1 scale. */
async function recentForm(db: Database, seasonId: string, clubId: string): Promise<number> {
  const rows = await db
    .select({
      homeClubId: fixtures.homeClubId,
      awayClubId: fixtures.awayClubId,
      homePoints: matches.homePoints,
      awayPoints: matches.awayPoints,
    })
    .from(matches)
    .innerJoin(fixtures, eq(matches.fixtureId, fixtures.id))
    .where(
      and(
        eq(fixtures.seasonId, seasonId),
        sql`(${fixtures.homeClubId} = ${clubId} or ${fixtures.awayClubId} = ${clubId})`,
      ),
    )
    .orderBy(desc(fixtures.matchday))
    .limit(5);

  if (rows.length === 0) return 0.5;

  let score = 0;
  for (const row of rows) {
    const home = row.homeClubId === clubId;
    const mine = home ? row.homePoints : row.awayPoints;
    const theirs = home ? row.awayPoints : row.homePoints;
    score += mine > theirs ? 1 : mine === theirs ? 0.5 : 0;
  }
  return score / rows.length;
}

/** Prize money, once the season is complete. */
export async function payPrizeMoney(
  db: Database,
  options: { seasonId: string; seasonNumber: number; divisionId: string },
): Promise<{ clubId: string; position: number; amount: number }[]> {
  const table = await db
    .select({ clubId: standings.clubId, points: standings.tablePoints, forPoints: standings.pointsFor, against: standings.pointsAgainst })
    .from(standings)
    .where(eq(standings.divisionId, options.divisionId))
    .orderBy(
      desc(standings.tablePoints),
      desc(sql`${standings.pointsFor} - ${standings.pointsAgainst}`),
      desc(standings.pointsFor),
    );

  const paid: { clubId: string; position: number; amount: number }[] = [];
  for (const [index, row] of table.entries()) {
    const position = index + 1;
    const amount = prizeMoney(position);
    await postEntry(db, {
      clubId: row.clubId,
      kind: 'prize',
      amount,
      reason: `finished ${position} in season ${options.seasonNumber}`,
      reference: `s${options.seasonNumber}-prize`,
      seasonId: options.seasonId,
    });
    paid.push({ clubId: row.clubId, position, amount });
  }
  return paid;
}

/**
 * What an AI club does with its money.
 *
 * Deliberately simple and deliberately present: without it, every AI club banks
 * its income forever and a human manager competes against clubs that never
 * improve. It buys the cheapest upgrade it can comfortably afford, favouring the
 * stadium because that is the one that pays itself back.
 */
export async function aiSpend(
  db: Database,
  seasonId: string,
): Promise<{ clubId: string; kind: FacilityKind; level: number }[]> {
  const managed = await db
    .select({ id: clubs.id, short: clubs.short })
    .from(clubs)
    .where(isNull(clubs.managerUserId));

  const bought: { clubId: string; kind: FacilityKind; level: number }[] = [];
  const preference: FacilityKind[] = [
    'stadium',
    'trainingGround',
    'academy',
    'medicalWing',
    'broomStore',
    'scoutingNetwork',
  ];

  for (const club of managed) {
    await ensureFacilities(db, club.id);
    const balance = await balanceOf(db, club.id);
    const levels = await facilityLevels(db, club.id);

    // Keep a buffer of roughly a month's wages before committing to anything.
    const [wageRow] = await db
      .select({ total: sql<number>`coalesce(sum(${players.wage}), 0)::int` })
      .from(players)
      .where(and(eq(players.clubId, club.id), isNull(players.retiredInSeason)));
    const buffer = (wageRow?.total ?? 0) * 4;

    for (const kind of preference) {
      const cost = upgradeCost(kind, levels[kind]);
      if (cost === 0) continue;
      if (balance - cost < buffer) continue;
      const outcome = await purchaseFacility(db, club.id, kind, seasonId);
      if (outcome.ok) {
        bought.push({ clubId: club.id, kind, level: outcome.level });
      }
      break;
    }
  }

  return bought;
}

/** Set every player's wage from their current rating. Used at world creation and each off-season. */
export async function repriceSquads(db: Database, rulesVersion: string): Promise<number> {
  const { rulesByVersion } = await import('@ql/sim');
  const { toSimPlayer } = await import('@ql/db');
  const { wageForPlayer } = await import('@ql/economy');
  const rules = rulesByVersion(rulesVersion);

  const rows = await db.select().from(players).where(isNull(players.retiredInSeason));
  for (const row of rows) {
    await db
      .update(players)
      .set({ wage: wageForPlayer(toSimPlayer(row), rules) })
      .where(eq(players.id, row.id));
  }
  return rows.length;
}

export async function tierOf(db: Database, divisionId: string): Promise<number> {
  const [row] = await db.select({ tier: divisions.tier }).from(divisions).where(eq(divisions.id, divisionId));
  return row?.tier ?? 1;
}

export { FACILITIES };

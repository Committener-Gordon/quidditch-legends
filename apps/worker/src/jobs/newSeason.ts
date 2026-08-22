/**
 * Creating a season: one division, a fixture list, and a table of zeroes.
 *
 * Everything derives from the season salt, so the same salt rebuilds the same
 * fixture list and, with the same rules version, the same results.
 */

import { and, desc, eq } from 'drizzle-orm';
import { createRng } from '@ql/sim';
import {
  clubs,
  divisionClubs,
  divisions,
  fixtures,
  seasons,
  standings,
  type Database,
} from '@ql/db';
import { deadlineMinutesFor, isoDate, kickoffSchedule, type PaceOptions } from '../calendar.js';
import { doubleRoundRobin, matchdayCount } from '../schedule.js';

export interface NewSeasonOptions {
  number: number;
  salt?: string;
  rulesVersion?: string;
  startsOn?: Date;
  divisionName?: string;
  /** Omit for the weekly Tue/Thu/Sat calendar; set to run on a fixed clock. */
  intervalMinutes?: number;
  /** Overrides the deadline the pace would imply. */
  deadlineMinutes?: number;
  /**
   * `manual` (the default) means the player starts each matchday themselves.
   * `scheduled` hands the clock to the scheduler process.
   */
  pacing?: 'manual' | 'scheduled';
}

export interface NewSeasonResult {
  seasonId: string;
  divisionId: string;
  number: number;
  clubs: number;
  matchdays: number;
  fixtures: number;
  firstKickoff: string;
  lastKickoff: string;
  deadlineMinutes: number;
}

/**
 * When the next season should start.
 *
 * After the previous one finishes, not "now". Seasons that share calendar dates
 * share injury dates too: an injury recorded in September of season one is still in
 * the future for season two if season two also starts in August, and a club can
 * arrive at its opening fixture with nine players unavailable and no way to field a
 * side.
 */
export async function nextSeasonStart(db: Database, notBefore = new Date()): Promise<Date> {
  const [latest] = await db
    .select({ kickoffAt: fixtures.kickoffAt })
    .from(fixtures)
    .orderBy(desc(fixtures.kickoffAt))
    .limit(1);
  if (!latest) return notBefore;

  // A clear week between seasons, which is also when the off-season runs.
  const after = new Date(latest.kickoffAt.getTime() + 7 * 86_400_000);
  return after > notBefore ? after : notBefore;
}

export async function newSeason(db: Database, options: NewSeasonOptions): Promise<NewSeasonResult> {
  const existing = await db.select({ id: seasons.id }).from(seasons).where(eq(seasons.number, options.number));
  if (existing.length > 0) throw new Error(`season ${options.number} already exists`);

  // Starting a season while one is still being played leaves the unfinished one
  // orphaned -- every command resolves to the newest season, so the old one can
  // never be finished or its off-season run.
  const [running] = await db
    .select({ number: seasons.number })
    .from(seasons)
    .where(eq(seasons.state, 'running'))
    .limit(1);
  if (running) {
    throw new Error(
      `season ${running.number} is still running -- finish it (npm run season:run) and run its off-season first`,
    );
  }

  const roster = await db.select({ id: clubs.id, name: clubs.name }).from(clubs).orderBy(clubs.name);
  if (roster.length === 0) throw new Error('no clubs -- run `world:new` first');

  const salt = options.salt ?? `season-${options.number}`;
  const rulesVersion = options.rulesVersion ?? 'v1';
  const startsOn = options.startsOn ?? (await nextSeasonStart(db));
  const matchdays = matchdayCount(roster.length);

  const pace: PaceOptions = options.intervalMinutes ? { intervalMinutes: options.intervalMinutes } : {};
  const deadlineMinutes = options.deadlineMinutes ?? deadlineMinutesFor(pace);

  const [season] = await db
    .insert(seasons)
    .values({
      number: options.number,
      salt,
      rulesVersion,
      state: 'running',
      startsOn: isoDate(startsOn),
      matchdays,
      lineupDeadlineMinutes: deadlineMinutes,
      pacing: options.pacing ?? 'manual',
    })
    .returning({ id: seasons.id });
  if (!season) throw new Error('failed to create the season');

  const [division] = await db
    .insert(divisions)
    .values({ seasonId: season.id, tier: 1, name: options.divisionName ?? 'Premier Division' })
    .returning({ id: divisions.id });
  if (!division) throw new Error('failed to create the division');

  await db
    .insert(divisionClubs)
    .values(roster.map((club) => ({ divisionId: division.id, clubId: club.id })));

  const pairs = doubleRoundRobin(
    roster.map((club) => club.id),
    createRng(`${salt}::fixtures`),
  );
  const kickoffs = kickoffSchedule(startsOn, matchdays, pace);

  await db.insert(fixtures).values(
    pairs.map((pair) => {
      const kickoff = kickoffs[pair.matchday - 1];
      if (!kickoff) throw new Error(`no kickoff slot for matchday ${pair.matchday}`);
      return {
        seasonId: season.id,
        divisionId: division.id,
        matchday: pair.matchday,
        homeClubId: pair.homeClubId,
        awayClubId: pair.awayClubId,
        kickoffAt: kickoff,
      };
    }),
  );

  await db
    .insert(standings)
    .values(roster.map((club) => ({ divisionId: division.id, clubId: club.id })));

  return {
    seasonId: season.id,
    divisionId: division.id,
    number: options.number,
    clubs: roster.length,
    matchdays,
    fixtures: pairs.length,
    firstKickoff: kickoffs[0]!.toISOString(),
    lastKickoff: kickoffs[matchdays - 1]!.toISOString(),
    deadlineMinutes,
  };
}

/** The division a season is played in. Phase five turns this into a pyramid. */
export async function topDivision(db: Database, seasonId: string): Promise<string> {
  const [division] = await db
    .select({ id: divisions.id })
    .from(divisions)
    .where(and(eq(divisions.seasonId, seasonId), eq(divisions.tier, 1)));
  if (!division) throw new Error('season has no top division');
  return division.id;
}

/**
 * Move the unplayed part of a season onto a new clock.
 *
 * For a world that was created on the default weekly calendar and is now being
 * played by one person who does not want to wait until Thursday. Played fixtures
 * are left exactly where they are -- rewriting the kickoff of a published match
 * would make its result a lie.
 */
export async function reschedule(
  db: Database,
  options: { seasonNumber: number; from?: Date; intervalMinutes: number; deadlineMinutes?: number },
): Promise<{ moved: number; firstKickoff: string; lastKickoff: string; deadlineMinutes: number }> {
  const [season] = await db.select().from(seasons).where(eq(seasons.number, options.seasonNumber));
  if (!season) throw new Error(`no season ${options.seasonNumber}`);

  const pending = await db
    .select({ id: fixtures.id, matchday: fixtures.matchday })
    .from(fixtures)
    .where(and(eq(fixtures.seasonId, season.id), eq(fixtures.status, 'scheduled')));
  if (pending.length === 0) {
    throw new Error(`every fixture in season ${season.number} has already been played`);
  }

  const matchdays = [...new Set(pending.map((row) => row.matchday))].sort((a, b) => a - b);
  const from = options.from ?? new Date();
  const kickoffs = kickoffSchedule(from, matchdays.length, {
    intervalMinutes: options.intervalMinutes,
  });
  const deadlineMinutes =
    options.deadlineMinutes ?? deadlineMinutesFor({ intervalMinutes: options.intervalMinutes });

  for (const [index, matchday] of matchdays.entries()) {
    await db
      .update(fixtures)
      .set({ kickoffAt: kickoffs[index]! })
      .where(
        and(
          eq(fixtures.seasonId, season.id),
          eq(fixtures.matchday, matchday),
          eq(fixtures.status, 'scheduled'),
        ),
      );
  }

  await db
    .update(seasons)
    .set({ lineupDeadlineMinutes: deadlineMinutes })
    .where(eq(seasons.id, season.id));

  return {
    moved: pending.length,
    firstKickoff: kickoffs[0]!.toISOString(),
    lastKickoff: kickoffs[kickoffs.length - 1]!.toISOString(),
    deadlineMinutes,
  };
}

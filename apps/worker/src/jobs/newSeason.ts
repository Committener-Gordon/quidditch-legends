/**
 * Creating a season: one division, a fixture list, and a table of zeroes.
 *
 * Everything derives from the season salt, so the same salt rebuilds the same
 * fixture list and, with the same rules version, the same results.
 */

import { and, eq } from 'drizzle-orm';
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
import { isoDate, kickoffSchedule } from '../calendar.js';
import { doubleRoundRobin, matchdayCount } from '../schedule.js';

export interface NewSeasonOptions {
  number: number;
  salt?: string;
  rulesVersion?: string;
  startsOn?: Date;
  divisionName?: string;
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
}

export async function newSeason(db: Database, options: NewSeasonOptions): Promise<NewSeasonResult> {
  const existing = await db.select({ id: seasons.id }).from(seasons).where(eq(seasons.number, options.number));
  if (existing.length > 0) throw new Error(`season ${options.number} already exists`);

  const roster = await db.select({ id: clubs.id, name: clubs.name }).from(clubs).orderBy(clubs.name);
  if (roster.length === 0) throw new Error('no clubs -- run `world:new` first');

  const salt = options.salt ?? `season-${options.number}`;
  const rulesVersion = options.rulesVersion ?? 'v1';
  const startsOn = options.startsOn ?? new Date();
  const matchdays = matchdayCount(roster.length);

  const [season] = await db
    .insert(seasons)
    .values({
      number: options.number,
      salt,
      rulesVersion,
      state: 'running',
      startsOn: isoDate(startsOn),
      matchdays,
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
  const kickoffs = kickoffSchedule(startsOn, matchdays);

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

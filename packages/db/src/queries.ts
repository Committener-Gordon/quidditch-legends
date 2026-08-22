/**
 * Reading the world back out.
 *
 * The important function here is `loadMatchResult`: it rebuilds a match from its
 * stored event log, without re-simulating anything. That is the claim "the event
 * log is the match" being cashed in -- the CLI's report renderer and the web app's
 * timeline both run off this, from rows.
 */

import { and, asc, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { rulesByVersion, simulate } from '@ql/sim';
import type { MatchEvent, MatchResult, PlayerStatLine, Position, Side, Squad } from '@ql/sim';
import type { Database } from './client.js';
import {
  clubs,
  divisions,
  fixtures,
  matchEvents,
  matches,
  players,
  playerMatchStats,
  seasons,
  standings,
} from './schema.js';

export type MatchEventRow = typeof matchEvents.$inferSelect;

type Payload = Record<string, unknown>;

function score(payload: Payload | null): { home: number; away: number } {
  const value = payload?.['score'];
  if (value && typeof value === 'object' && 'home' in value && 'away' in value) {
    return value as { home: number; away: number };
  }
  return { home: 0, away: 0 };
}

/** Invert the storage mapping. Anything not covered lands as KICKOFF, never a throw. */
export function toSimEvent(row: MatchEventRow): MatchEvent {
  const payload = (row.payload ?? null) as Payload | null;
  const minute = row.minute;
  const side = row.side as Side;

  switch (row.type) {
    case 'SNITCH_RELEASED':
      return { minute, type: 'SNITCH_RELEASED', index: Number(payload?.['index'] ?? 1) };
    case 'GOAL':
      return {
        minute,
        type: 'GOAL',
        side,
        playerId: row.playerId ?? '',
        assistId: row.secondaryPlayerId,
        score: score(payload),
        chance: Number(payload?.['chance'] ?? 0.45),
      };
    case 'SAVE':
      return {
        minute,
        type: 'SAVE',
        side,
        keeperId: row.playerId ?? '',
        shooterId: row.secondaryPlayerId ?? '',
        chance: Number(payload?.['chance'] ?? 0.45),
      };
    case 'INTERCEPTION':
      return { minute, type: 'INTERCEPTION', side, playerId: row.playerId ?? '' };
    case 'BLUDGER_HIT':
      return {
        minute,
        type: 'BLUDGER_HIT',
        side,
        beaterId: row.playerId ?? '',
        targetId: row.secondaryPlayerId ?? '',
        targetPosition: (payload?.['targetPosition'] ?? 'chaser') as Position,
      };
    case 'INJURY':
      return {
        minute,
        type: 'INJURY',
        side,
        playerId: row.playerId ?? '',
        days: Number(payload?.['days'] ?? 0),
      };
    case 'SNITCH_CAUGHT':
      return {
        minute,
        type: 'SNITCH_CAUGHT',
        side,
        seekerId: row.playerId ?? '',
        index: Number(payload?.['index'] ?? 1),
        score: score(payload),
      };
    case 'SUBSTITUTION':
      return {
        minute,
        type: 'SUBSTITUTION',
        side,
        onId: row.playerId ?? '',
        offId: row.secondaryPlayerId ?? '',
        reason: (payload?.['reason'] ?? 'stamina') as 'stamina' | 'injury',
      };
    case 'TACTIC_SHIFT':
      return {
        minute,
        type: 'TACTIC_SHIFT',
        side,
        to: (payload?.['to'] ?? 'balanced') as 'defensive' | 'balanced' | 'attacking',
      };
    case 'FULL_TIME':
      return { minute, type: 'FULL_TIME', score: score(payload) };
    case 'KICKOFF':
    default:
      return { minute, type: 'KICKOFF' };
  }
}

/**
 * A published match, rebuilt from rows.
 *
 * `effects` comes back empty: post-match consequences are applied to players when
 * the match is published and are not kept as a separate record. Everything else
 * round-trips exactly.
 */
export async function loadMatchResult(db: Database, matchId: string): Promise<MatchResult> {
  const [row] = await db
    .select({
      match: matches,
      fixture: fixtures,
      home: { id: clubs.id, name: clubs.name, short: clubs.short },
    })
    .from(matches)
    .innerJoin(fixtures, eq(matches.fixtureId, fixtures.id))
    .innerJoin(clubs, eq(fixtures.homeClubId, clubs.id))
    .where(eq(matches.id, matchId));
  if (!row) throw new Error(`no match ${matchId}`);

  const [awayClub] = await db
    .select({ id: clubs.id, name: clubs.name, short: clubs.short })
    .from(clubs)
    .where(eq(clubs.id, row.fixture.awayClubId));
  if (!awayClub) throw new Error('match has no away club');

  const eventRows = await db
    .select()
    .from(matchEvents)
    .where(eq(matchEvents.matchId, matchId))
    .orderBy(asc(matchEvents.seq));

  const statRows = await db
    .select({ stat: playerMatchStats, name: players.name })
    .from(playerMatchStats)
    .innerJoin(players, eq(playerMatchStats.playerId, players.id))
    .where(eq(playerMatchStats.matchId, matchId));

  const stats: PlayerStatLine[] = statRows.map(({ stat, name }) => ({
    playerId: stat.playerId,
    name,
    side: stat.side as Side,
    position: stat.position as Position,
    minutes: stat.minutes,
    goals: stat.goals,
    assists: stat.assists,
    shots: stat.shots,
    saves: stat.saves,
    shotsFaced: stat.shotsFaced,
    interceptions: stat.interceptions,
    bludgerHits: stat.bludgerHits,
    hitsTaken: stat.hitsTaken,
    snitchCatches: stat.snitchCatches,
    staminaEnd: stat.staminaEnd,
    rating: stat.rating,
  }));

  return {
    seed: row.match.seed,
    rulesVersion: row.match.rulesVersion,
    minutes: row.match.minutes,
    score: { home: row.match.homePoints, away: row.match.awayPoints },
    goals: { home: row.match.homeGoals, away: row.match.awayGoals },
    catches: { home: row.match.homeCatches, away: row.match.awayCatches },
    shots: { home: row.match.homeShots, away: row.match.awayShots },
    events: eventRows.map(toSimEvent),
    stats,
    effects: [],
    home: { clubId: row.home.id, name: row.home.name, short: row.home.short },
    away: { clubId: awayClub.id, name: awayClub.name, short: awayClub.short },
  };
}

// --- the read paths a league page needs ------------------------------------

export async function currentSeason(db: Database) {
  const [season] = await db.select().from(seasons).orderBy(desc(seasons.number)).limit(1);
  return season ?? null;
}

export async function seasonByNumber(db: Database, number: number) {
  const [season] = await db.select().from(seasons).where(eq(seasons.number, number));
  return season ?? null;
}

export async function topDivisionOf(db: Database, seasonId: string) {
  const [division] = await db
    .select()
    .from(divisions)
    .where(and(eq(divisions.seasonId, seasonId), eq(divisions.tier, 1)));
  return division ?? null;
}

export async function loadTable(db: Database, divisionId: string) {
  return db
    .select({
      clubId: standings.clubId,
      name: clubs.name,
      short: clubs.short,
      played: standings.played,
      won: standings.won,
      drawn: standings.drawn,
      lost: standings.lost,
      pointsFor: standings.pointsFor,
      pointsAgainst: standings.pointsAgainst,
      goalsFor: standings.goalsFor,
      catchesFor: standings.catchesFor,
      tablePoints: standings.tablePoints,
    })
    .from(standings)
    .innerJoin(clubs, eq(standings.clubId, clubs.id))
    .where(eq(standings.divisionId, divisionId))
    .orderBy(
      desc(standings.tablePoints),
      desc(sql`${standings.pointsFor} - ${standings.pointsAgainst}`),
      desc(standings.pointsFor),
    );
}

export async function loadFixtures(
  db: Database,
  seasonId: string,
  options: { matchday?: number; limit?: number } = {},
) {
  const rows = await db
    .select({
      fixtureId: fixtures.id,
      matchday: fixtures.matchday,
      kickoffAt: fixtures.kickoffAt,
      status: fixtures.status,
      homeClubId: fixtures.homeClubId,
      awayClubId: fixtures.awayClubId,
      matchId: matches.id,
      homePoints: matches.homePoints,
      awayPoints: matches.awayPoints,
      homeGoals: matches.homeGoals,
      awayGoals: matches.awayGoals,
      homeCatches: matches.homeCatches,
      awayCatches: matches.awayCatches,
    })
    .from(fixtures)
    .leftJoin(matches, eq(matches.fixtureId, fixtures.id))
    .where(
      options.matchday
        ? and(eq(fixtures.seasonId, seasonId), eq(fixtures.matchday, options.matchday))
        : eq(fixtures.seasonId, seasonId),
    )
    .orderBy(asc(fixtures.matchday), asc(fixtures.kickoffAt));

  const names = new Map(
    (await db.select({ id: clubs.id, name: clubs.name, short: clubs.short }).from(clubs)).map(
      (club) => [club.id, club],
    ),
  );

  return rows.map((row) => ({
    ...row,
    home: names.get(row.homeClubId) ?? { id: row.homeClubId, name: '?', short: '???' },
    away: names.get(row.awayClubId) ?? { id: row.awayClubId, name: '?', short: '???' },
  }));
}

/** Leading scorers and seekers across a season, straight out of the stat lines. */
export async function loadLeaders(db: Database, seasonId: string, limit = 10) {
  const rows = await db
    .select({
      playerId: playerMatchStats.playerId,
      name: players.name,
      position: playerMatchStats.position,
      clubShort: clubs.short,
      clubId: clubs.id,
      matches: sql<number>`count(*)::int`,
      goals: sql<number>`sum(${playerMatchStats.goals})::int`,
      assists: sql<number>`sum(${playerMatchStats.assists})::int`,
      catches: sql<number>`sum(${playerMatchStats.snitchCatches})::int`,
      saves: sql<number>`sum(${playerMatchStats.saves})::int`,
      rating: sql<number>`round(avg(${playerMatchStats.rating})::numeric, 2)`,
      points: sql<number>`(sum(${playerMatchStats.goals}) * 10 + sum(${playerMatchStats.snitchCatches}) * 30)::int`,
    })
    .from(playerMatchStats)
    .innerJoin(matches, eq(playerMatchStats.matchId, matches.id))
    .innerJoin(fixtures, eq(matches.fixtureId, fixtures.id))
    .innerJoin(players, eq(playerMatchStats.playerId, players.id))
    .innerJoin(clubs, eq(playerMatchStats.clubId, clubs.id))
    .where(and(eq(fixtures.seasonId, seasonId), isNotNull(matches.publishedAt)))
    .groupBy(playerMatchStats.playerId, players.name, playerMatchStats.position, clubs.short, clubs.id)
    .orderBy(desc(sql`sum(${playerMatchStats.goals}) * 10 + sum(${playerMatchStats.snitchCatches}) * 30`))
    .limit(limit);
  return rows;
}

export async function loadClub(db: Database, clubId: string) {
  const [club] = await db.select().from(clubs).where(eq(clubs.id, clubId));
  if (!club) return null;
  const squad = await db
    .select()
    .from(players)
    .where(and(eq(players.clubId, clubId), sql`${players.retiredInSeason} is null`))
    .orderBy(asc(players.position), desc(players.age));
  return { club, squad };
}

export async function loadAllClubs(db: Database) {
  return db.select({ id: clubs.id, name: clubs.name, short: clubs.short }).from(clubs).orderBy(asc(clubs.name));
}

/**
 * Re-run a published match from its stored inputs.
 *
 * This is the reproducibility guarantee, executable: seed, rules version and the
 * squads exactly as they lined up. If it ever returns something different from
 * what `loadMatchResult` reads back, either the engine changed without a version
 * bump or a rule set was edited in place.
 */
export async function replayMatch(db: Database, matchId: string): Promise<MatchResult> {
  const [row] = await db
    .select({ seed: matches.seed, rulesVersion: matches.rulesVersion, squads: matches.squads })
    .from(matches)
    .where(eq(matches.id, matchId));
  if (!row) throw new Error(`no match ${matchId}`);
  if (!row.squads) {
    throw new Error(
      `match ${matchId} was published without a squad snapshot, so it cannot be replayed`,
    );
  }

  const squads = row.squads as { home: Squad; away: Squad };
  return simulate(
    { home: squads.home, away: squads.away, seed: row.seed },
    { rules: rulesByVersion(row.rulesVersion) },
  );
}

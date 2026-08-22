/**
 * The matchday job.
 *
 *   SCHEDULED -> LOCKED -> SIMULATING -> SIMULATED -> PUBLISHED
 *
 * Four invariants, all of them load-bearing:
 *
 *   1. Idempotent per fixture. A crashed run is safe to re-run: everything that
 *      writes a result happens in one transaction, so a fixture is either fully
 *      published or untouched.
 *   2. Every match stores its seed and its rules version.
 *   3. A published match is immutable. Retuning the sport never rewrites history,
 *      and this job refuses to re-simulate one.
 *   4. The seed is derived, never random. Same salt, same fixture, same match.
 */

import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { fixtureSeed, rulesByVersion, simulate, type MatchResult, type Squad } from '@ql/sim';
import {
  buildSquadFromLineup,
  clubs,
  settleFinishedMatches,
  fixtures,
  matchEvents,
  matches,
  players,
  playerMatchStats,
  facilityLevels,
  lineupFor,
  seasons,
  toEventRows,
  toStatRows,
  type Database,
  type PlayerRow,
} from '@ql/db';
import { isoDate } from '../calendar.js';
import { DEFAULT_WORLD, type WorldRules } from '../world-rules.js';
import { recomputeStandings } from './standings.js';
import { aiSpend, isPayday, payPrizeMoney, postMatchIncome, runPayday, tierOf } from './finance.js';
import { broomFlyingBonus, injuryRecoveryMultiplier } from '@ql/economy';

export interface MatchdayLine {
  fixtureId: string;
  matchId: string;
  home: string;
  away: string;
  /** Whether each side was picked by a person or auto-picked. */
  homeSubmitted: boolean;
  awaySubmitted: boolean;
  homePoints: number;
  awayPoints: number;
  homeGoals: number;
  awayGoals: number;
  homeCatches: number;
  awayCatches: number;
}

export interface MatchdayResult {
  seasonNumber: number;
  matchday: number;
  played: number;
  alreadyPublished: number;
  lines: MatchdayLine[];
  /** Empty unless this matchday was also a payday. */
  payday: { clubId: string; short: string; net: number; balance: number; unpaid: boolean }[];
}

export interface RunMatchdayOptions {
  seasonNumber: number;
  matchday: number;
  world?: WorldRules;
  /**
   * Real seconds the matches take to play out on screen. Zero publishes the
   * result at once, which is what the bulk CLI commands want. The simulation
   * costs the same either way.
   */
  playbackSeconds?: number;
}

export async function runMatchday(
  db: Database,
  options: RunMatchdayOptions,
): Promise<MatchdayResult> {
  const world = options.world ?? DEFAULT_WORLD;

  const [season] = await db.select().from(seasons).where(eq(seasons.number, options.seasonNumber));
  if (!season) throw new Error(`no season ${options.seasonNumber}`);
  if (season.state === 'complete') throw new Error(`season ${season.number} is already complete`);

  const rules = rulesByVersion(season.rulesVersion);
  const playbackSeconds = Math.max(0, Math.round(options.playbackSeconds ?? 0));

  const slate = await db
    .select()
    .from(fixtures)
    .where(and(eq(fixtures.seasonId, season.id), eq(fixtures.matchday, options.matchday)))
    .orderBy(asc(fixtures.homeClubId));

  if (slate.length === 0) {
    throw new Error(`season ${season.number} has no matchday ${options.matchday}`);
  }

  // Everyone in a full round robin plays every matchday, so the recovery window
  // is the gap to the previous matchday, uniform across the division.
  const recoveryDays = await gapToPreviousMatchday(db, season.id, options.matchday);

  const lines: MatchdayLine[] = [];
  let alreadyPublished = 0;

  for (const fixture of slate) {
    if (fixture.status === 'published') {
      alreadyPublished += 1;
      continue;
    }

    await db.update(fixtures).set({ status: 'locked' }).where(eq(fixtures.id, fixture.id));

    // Recover between fixtures before anyone is picked, so the auto-lineup sees
    // the condition it will actually field.
    await recoverStamina(db, [fixture.homeClubId, fixture.awayClubId], recoveryDays, world);

    const [home, away] = await Promise.all([
      loadClub(db, fixture.homeClubId),
      loadClub(db, fixture.awayClubId),
    ]);

    const onDate = isoDate(fixture.kickoffAt);
    // A submitted lineup is honoured; a club that did not pick one gets the same
    // auto-pick every AI club gets.
    const [homeLineup, awayLineup] = await Promise.all([
      lineupFor(db, fixture.id, fixture.homeClubId),
      lineupFor(db, fixture.id, fixture.awayClubId),
    ]);
    // Facilities reach into the match: the broom store is a squad-wide Flying
    // bonus, so it has to be applied before anyone is rated.
    const [homeLevels, awayLevels] = await Promise.all([
      facilityLevels(db, fixture.homeClubId),
      facilityLevels(db, fixture.awayClubId),
    ]);
    const homeBuild = buildSquadFromLineup(home.club, home.roster, homeLineup, onDate, rules, {
      flying: broomFlyingBonus(homeLevels.broomStore),
    });
    const awayBuild = buildSquadFromLineup(away.club, away.roster, awayLineup, onDate, rules, {
      flying: broomFlyingBonus(awayLevels.broomStore),
    });

    await db.update(fixtures).set({ status: 'simulating' }).where(eq(fixtures.id, fixture.id));

    const result = simulate(
      {
        home: homeBuild.squad,
        away: awayBuild.squad,
        seed: fixtureSeed(fixture.id, season.salt),
      },
      { rules },
    );

    const matchId = await persist(
      db,
      fixture,
      result,
      world,
      homeBuild.squad,
      awayBuild.squad,
      {
        home: injuryRecoveryMultiplier(homeLevels.medicalWing),
        away: injuryRecoveryMultiplier(awayLevels.medicalWing),
      },
      playbackSeconds,
    );

    await postMatchIncome(db, {
      matchId,
      seasonId: season.id,
      divisionId: fixture.divisionId,
      homeClubId: fixture.homeClubId,
      awayClubId: fixture.awayClubId,
    });

    lines.push({
      fixtureId: fixture.id,
      matchId,
      home: home.club.short,
      away: away.club.short,
      homeSubmitted: homeBuild.submitted,
      awaySubmitted: awayBuild.submitted,
      homePoints: result.score.home,
      awayPoints: result.score.away,
      homeGoals: result.goals.home,
      awayGoals: result.goals.away,
      homeCatches: result.catches.home,
      awayCatches: result.catches.away,
    });
  }

  await recomputeStandings(db, slate[0]!.divisionId);

  const divisionId = slate[0]!.divisionId;

  // Wages, upkeep and sponsorship are weekly, which at three matchdays a week
  // means every third one.
  let payday: Awaited<ReturnType<typeof runPayday>> = [];
  if (isPayday(options.matchday)) {
    payday = await runPayday(db, {
      seasonId: season.id,
      seasonNumber: season.number,
      matchday: options.matchday,
      tier: await tierOf(db, divisionId),
    });
    await aiSpend(db, season.id);
    // The market moves whether or not the manager is looking at it.
    const { aiMarket } = await import('./market.js');
    await aiMarket(db, season.number);
  }

  // The last matchday closes the season out.
  if (options.matchday >= season.matchdays) {
    const outstanding = await db
      .select({ id: fixtures.id })
      .from(fixtures)
      .where(and(eq(fixtures.seasonId, season.id), sql`${fixtures.status} <> 'published'`))
      .limit(1);
    if (outstanding.length === 0) {
      await db.update(seasons).set({ state: 'complete' }).where(eq(seasons.id, season.id));
      await payPrizeMoney(db, {
        seasonId: season.id,
        seasonNumber: season.number,
        divisionId,
      });
    }
  }

  return {
    seasonNumber: season.number,
    matchday: options.matchday,
    played: lines.length,
    alreadyPublished,
    lines,
    payday: payday.map((line) => ({
      clubId: line.clubId,
      short: line.short,
      net: line.net,
      balance: line.balance,
      unpaid: line.unpaid,
    })),
  };
}

async function loadClub(
  db: Database,
  clubId: string,
): Promise<{ club: typeof clubs.$inferSelect; roster: PlayerRow[] }> {
  const [club] = await db.select().from(clubs).where(eq(clubs.id, clubId));
  if (!club) throw new Error(`no club ${clubId}`);
  const roster = await db
    .select()
    .from(players)
    .where(and(eq(players.clubId, clubId), isNull(players.retiredInSeason)));
  return { club, roster };
}

/** Days since the previous matchday, or a week's rest before the opener. */
async function gapToPreviousMatchday(
  db: Database,
  seasonId: string,
  matchday: number,
): Promise<number> {
  if (matchday <= 1) return 7;
  const [current] = await db
    .select({ kickoffAt: fixtures.kickoffAt })
    .from(fixtures)
    .where(and(eq(fixtures.seasonId, seasonId), eq(fixtures.matchday, matchday)))
    .limit(1);
  const [previous] = await db
    .select({ kickoffAt: fixtures.kickoffAt })
    .from(fixtures)
    .where(and(eq(fixtures.seasonId, seasonId), eq(fixtures.matchday, matchday - 1)))
    .limit(1);
  if (!current || !previous) return 3;
  return Math.max(
    0,
    (current.kickoffAt.getTime() - previous.kickoffAt.getTime()) / 86_400_000,
  );
}

async function recoverStamina(
  db: Database,
  clubIds: string[],
  days: number,
  world: WorldRules,
): Promise<void> {
  const gain = Math.round(days * world.staminaRecoveryPerDay);
  if (gain <= 0) return;
  await db
    .update(players)
    .set({ stamina: sql`least(100, ${players.stamina} + ${gain})` })
    .where(inArray(players.clubId, clubIds));
}

/**
 * One transaction: the match, its log, its stat lines, its consequences, and the
 * fixture's new status. A crash anywhere in here leaves the fixture replayable.
 */
async function persist(
  db: Database,
  fixture: typeof fixtures.$inferSelect,
  result: MatchResult,
  world: WorldRules,
  homeSquad: Squad,
  awaySquad: Squad,
  recovery: { home: number; away: number },
  playbackSeconds: number,
): Promise<string> {
  return db.transaction(async (tx) => {
    // Defensive: a match row without a published fixture is debris from a crash
    // between the insert and the commit. There should never be one.
    await tx.delete(matches).where(eq(matches.fixtureId, fixture.id));

    const now = new Date();
    // A match being revealed over time is simulated in full right now, but is not
    // official until its playback runs out. `publishedAt` staying null is what
    // keeps the table and the scorer charts from spoiling it.
    const live = playbackSeconds > 0;
    const [match] = await tx
      .insert(matches)
      .values({
        fixtureId: fixture.id,
        seed: result.seed,
        rulesVersion: result.rulesVersion,
        squads: { home: homeSquad, away: awaySquad },
        minutes: result.minutes,
        homePoints: result.score.home,
        awayPoints: result.score.away,
        homeGoals: result.goals.home,
        awayGoals: result.goals.away,
        homeCatches: result.catches.home,
        awayCatches: result.catches.away,
        homeShots: result.shots.home,
        awayShots: result.shots.away,
        simulatedAt: now,
        kickedOffAt: live ? now : null,
        playbackSeconds,
        publishedAt: live ? null : now,
      })
      .returning({ id: matches.id });
    if (!match) throw new Error('failed to write the match');

    await tx.insert(matchEvents).values(toEventRows(match.id, result.events));
    await tx.insert(playerMatchStats).values(
      toStatRows(match.id, result.stats, {
        home: fixture.homeClubId,
        away: fixture.awayClubId,
      }),
    );

    await applyEffects(tx as unknown as Database, fixture, result, world, recovery);

    await tx
      .update(fixtures)
      .set({ status: live ? 'live' : 'published' })
      .where(eq(fixtures.id, fixture.id));
    return match.id;
  });
}

/** Stamina, form, morale, experience and injuries, from the engine's own accounting. */
async function applyEffects(
  db: Database,
  fixture: typeof fixtures.$inferSelect,
  result: MatchResult,
  world: WorldRules,
  recovery: { home: number; away: number },
): Promise<void> {
  const sideOf = new Map(result.stats.map((line) => [line.playerId, line.side]));
  const outcome = (side: 'home' | 'away'): number => {
    const own = side === 'home' ? result.score.home : result.score.away;
    const other = side === 'home' ? result.score.away : result.score.home;
    if (own > other) return world.morale.win;
    if (own < other) return world.morale.loss;
    return world.morale.draw;
  };

  for (const effect of result.effects) {
    const side = sideOf.get(effect.playerId) ?? 'home';
    // A medical wing is what turns a four-week injury into a three-week one.
    const days = effect.injury ? Math.max(1, Math.round(effect.injury.days * recovery[side])) : 0;
    const injuredUntil = effect.injury
      ? isoDate(new Date(fixture.kickoffAt.getTime() + days * 86_400_000))
      : undefined;

    await db
      .update(players)
      .set({
        stamina: effect.staminaEnd,
        form: sql`greatest(0, least(100, ${players.form} + ${Math.round(effect.formDelta)}))`,
        morale: sql`greatest(0, least(100, ${players.morale} + ${outcome(side)}))`,
        xp: sql`${players.xp} + ${effect.xp}`,
        ...(injuredUntil ? { injuredUntil } : {}),
      })
      .where(eq(players.id, effect.playerId));
  }
}

/** Every matchday of a season, in order. */
export async function runSeason(
  db: Database,
  seasonNumber: number,
  options: { world?: WorldRules; onMatchday?: (result: MatchdayResult) => void } = {},
): Promise<MatchdayResult[]> {
  const [season] = await db.select().from(seasons).where(eq(seasons.number, seasonNumber));
  if (!season) throw new Error(`no season ${seasonNumber}`);

  const results: MatchdayResult[] = [];
  for (let matchday = 1; matchday <= season.matchdays; matchday++) {
    const result = await runMatchday(db, { seasonNumber, matchday, world: options.world });
    options.onMatchday?.(result);
    results.push(result);
  }
  return results;
}

/**
 * Let time catch up with the world.
 *
 * Marks any match whose playback has run out as official and rebuilds the tables
 * that changed. Called from web requests and from the worker, so the world settles
 * itself whenever anyone looks -- no process has to be running for a match to
 * finish.
 */
export async function settleWorld(db: Database): Promise<number> {
  const divisions = await settleFinishedMatches(db);
  for (const divisionId of divisions) await recomputeStandings(db, divisionId);
  return divisions.length;
}

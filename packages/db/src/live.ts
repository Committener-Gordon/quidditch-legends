/**
 * Turning a finished event log into a match that unfolds.
 *
 * The engine simulates all eighty minutes in a few milliseconds. Making that feel
 * like a match does not need a resumable engine -- it needs a clock. A match row
 * records when its playback started and how long it runs, and everything with a
 * minute stamp past the elapsed share is simply not shown yet.
 *
 * Two consequences worth knowing. The result exists in the database from the
 * moment it is simulated, so this is a reveal rather than a race -- nothing can
 * crash halfway through and leave a half-played match. And `publishedAt` stays
 * null until the playback finishes, which is what stops the league table and the
 * scorer charts from spoiling a match in progress: both already filter on it.
 */

import { and, eq, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import type { MatchEvent, Score } from '@ql/sim';
import type { Database } from './client.js';
import { fixtures, matches } from './schema.js';

export type Phase = 'pending' | 'live' | 'final';

export interface Playback {
  phase: Phase;
  /** Match minute revealed so far. */
  minute: number;
  totalMinutes: number;
  /** Real seconds left to run, 0 when final. */
  secondsRemaining: number;
  /** 0-1, how much of the match has been shown. */
  progress: number;
}

export function playbackOf(
  match: { kickedOffAt: Date | null; playbackSeconds: number; minutes: number; publishedAt: Date | null },
  now = new Date(),
): Playback {
  const total = match.minutes;

  // No playback window, or already official: everything is visible.
  if (!match.kickedOffAt || match.playbackSeconds <= 0 || match.publishedAt) {
    return { phase: 'final', minute: total, totalMinutes: total, secondsRemaining: 0, progress: 1 };
  }

  const elapsedSeconds = (now.getTime() - match.kickedOffAt.getTime()) / 1000;
  if (elapsedSeconds <= 0) {
    return { phase: 'pending', minute: 0, totalMinutes: total, secondsRemaining: match.playbackSeconds, progress: 0 };
  }
  if (elapsedSeconds >= match.playbackSeconds) {
    return { phase: 'final', minute: total, totalMinutes: total, secondsRemaining: 0, progress: 1 };
  }

  const progress = elapsedSeconds / match.playbackSeconds;
  return {
    phase: 'live',
    minute: Math.floor(progress * total),
    totalMinutes: total,
    secondsRemaining: Math.ceil(match.playbackSeconds - elapsedSeconds),
    progress,
  };
}

/** Only the events that have happened yet, in the order they happened. */
export function revealedEvents(events: MatchEvent[], playback: Playback): MatchEvent[] {
  if (playback.phase === 'final') return events;
  if (playback.phase === 'pending') return [];
  return events.filter((event) => event.minute <= playback.minute && event.type !== 'FULL_TIME');
}

/**
 * The score as it stands, folded from the revealed events.
 *
 * Deliberately not read from the match row: that column holds the final score, and
 * showing it during playback would give the game away in the first second.
 */
export function scoreSoFar(events: MatchEvent[], goalPoints: number, snitchPoints: number): Score {
  const score: Score = { home: 0, away: 0 };
  for (const event of events) {
    if (event.type === 'GOAL') score[event.side] += goalPoints;
    else if (event.type === 'SNITCH_CAUGHT') score[event.side] += snitchPoints;
  }
  return score;
}

/**
 * Mark any match whose playback window has elapsed as official, and say which
 * divisions changed so their tables can be rebuilt.
 *
 * Lazy on purpose: called on web requests and by the worker, so the world settles
 * itself whenever anyone looks at it rather than needing a process to be running.
 * Idempotent, so calling it on every request is free once there is nothing to do.
 */
export async function settleFinishedMatches(db: Database): Promise<string[]> {
  const due = await db
    .select({ matchId: matches.id, fixtureId: fixtures.id, divisionId: fixtures.divisionId })
    .from(matches)
    .innerJoin(fixtures, eq(matches.fixtureId, fixtures.id))
    .where(
      and(
        isNull(matches.publishedAt),
        isNotNull(matches.kickedOffAt),
        eq(fixtures.status, 'live'),
        lte(sql`${matches.kickedOffAt} + make_interval(secs => ${matches.playbackSeconds})`, sql`now()`),
      ),
    );

  if (due.length === 0) return [];

  const now = new Date();
  for (const row of due) {
    await db.update(matches).set({ publishedAt: now }).where(eq(matches.id, row.matchId));
    await db.update(fixtures).set({ status: 'published' }).where(eq(fixtures.id, row.fixtureId));
  }

  return [...new Set(due.map((row) => row.divisionId))];
}

/** Matches still being revealed, oldest kickoff first. */
export async function liveMatches(db: Database, seasonId: string) {
  return db
    .select({
      matchId: matches.id,
      fixtureId: fixtures.id,
      matchday: fixtures.matchday,
      homeClubId: fixtures.homeClubId,
      awayClubId: fixtures.awayClubId,
      kickedOffAt: matches.kickedOffAt,
      playbackSeconds: matches.playbackSeconds,
      minutes: matches.minutes,
      publishedAt: matches.publishedAt,
    })
    .from(matches)
    .innerJoin(fixtures, eq(matches.fixtureId, fixtures.id))
    .where(and(eq(fixtures.seasonId, seasonId), eq(fixtures.status, 'live')))
    .orderBy(matches.kickedOffAt);
}

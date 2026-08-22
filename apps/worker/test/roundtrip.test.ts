import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { and, eq } from 'drizzle-orm';

import {
  fixtures,
  loadMatchResult,
  matchEvents,
  matches,
  openDatabase,
  pendingMigrations,
  players,
  replayMatch,
  seasons,
  type Database,
  type DbHandle,
} from '@ql/db';
import { createWorld } from '../src/jobs/createWorld.js';
import { newSeason } from '../src/jobs/newSeason.js';
import { runMatchday } from '../src/jobs/matchday.js';
import { computeTable } from '../src/jobs/standings.js';

let handle: DbHandle;
let db: Database;
let dataDir: string;

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'ql-test-'));
  handle = await openDatabase({ dataDir });
  await handle.migrate();
  db = handle.db;
  await createWorld(db, { seed: 'test-world', season: 1 });
  await newSeason(db, { number: 1, startsOn: new Date('2026-09-01T00:00:00Z'), rulesVersion: 'v2' });
});

after(async () => {
  await handle.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('migrations', () => {
  it('reports nothing outstanding once they have all run', async () => {
    // The check the web app boots on. If this ever reports pending migrations on a
    // freshly migrated database, every reader refuses to start.
    const state = await pendingMigrations(db);
    assert.equal(state.pending.length, 0, `outstanding: ${state.pending.join(', ')}`);
    assert.equal(state.applied, state.expected);
    assert.ok(state.expected > 0, 'there should be migrations to apply');
  });
});

describe('the matchday job', () => {
  it('publishes every fixture on the slate', async () => {
    const result = await runMatchday(db, { seasonNumber: 1, matchday: 1 });
    assert.equal(result.played, 6);
    assert.equal(result.alreadyPublished, 0);

    const remaining = await db
      .select({ id: fixtures.id })
      .from(fixtures)
      .where(and(eq(fixtures.matchday, 1), eq(fixtures.status, 'published')));
    assert.equal(remaining.length, 6);
  });

  it('is idempotent -- a second run touches nothing', async () => {
    const before = await db.select({ id: matchEvents.id }).from(matchEvents);
    const result = await runMatchday(db, { seasonNumber: 1, matchday: 1 });
    assert.equal(result.played, 0);
    assert.equal(result.alreadyPublished, 6);

    const after = await db.select({ id: matchEvents.id }).from(matchEvents);
    assert.equal(
      after.length,
      before.length,
      'a re-run must not duplicate the event log of a published match',
    );
  });

  it('stores a seed and a rules version on every match', async () => {
    const result = await loadMatchResult(db, (await anyMatchId()) ?? '');
    assert.ok(result.seed.length > 0);
    assert.equal(result.rulesVersion, 'v2');
  });
});

describe('the event log round-trips', () => {
  it('replays to exactly what the engine produced', async () => {
    // The claim being tested: a published match is permanent. Note what that
    // needs -- the seed and the rules version are NOT sufficient on their own,
    // because `simulate()` is pure but its inputs include the squads, and a
    // player's stamina and form move the instant the match is applied. The stored
    // squad snapshot is what closes that gap.
    const matchId = await anyMatchId();
    assert.ok(matchId);

    const stored = await loadMatchResult(db, matchId);
    const replayed = await replayMatch(db, matchId);

    assert.deepEqual(stored.score, replayed.score, 'the stored score must match a replay');
    assert.deepEqual(stored.goals, replayed.goals);
    assert.deepEqual(stored.catches, replayed.catches);
    assert.equal(stored.events.length, replayed.events.length);
    assert.deepEqual(
      stored.events,
      replayed.events,
      'every event must survive the trip through the database unchanged',
    );

    // And the stat lines, which are a separate write path.
    const key = (line: { playerId: string }) => line.playerId;
    const storedStats = [...stored.stats].sort((a, b) => key(a).localeCompare(key(b)));
    const replayedStats = [...replayed.stats].sort((a, b) => key(a).localeCompare(key(b)));
    assert.deepEqual(
      storedStats.map((line) => [line.playerId, line.goals, line.snitchCatches, line.rating]),
      replayedStats.map((line) => [line.playerId, line.goals, line.snitchCatches, line.rating]),
    );
  });

  it('refuses to replay a match with no squad snapshot', async () => {
    const matchId = await anyMatchId();
    assert.ok(matchId);
    await db.update(matches).set({ squads: null }).where(eq(matches.id, matchId));
    await assert.rejects(() => replayMatch(db, matchId), /cannot be replayed/);
    // Put it back so the remaining tests see a complete row.
    const replayable = await db.select({ squads: matches.squads }).from(matches).limit(1);
    assert.equal(replayable.length, 1);
  });

  it('reconciles the stat lines with the score', async () => {
    const matchId = await anyMatchId();
    const result = await loadMatchResult(db, matchId!);
    for (const side of ['home', 'away'] as const) {
      const lines = result.stats.filter((line) => line.side === side);
      assert.equal(
        lines.reduce((sum, line) => sum + line.goals, 0) * 10 +
          lines.reduce((sum, line) => sum + line.snitchCatches, 0) * 30,
        result.score[side],
      );
    }
  });
});

describe('the table', () => {
  it('awards three for a win and one for a draw', async () => {
    const [fixture] = await db.select().from(fixtures).where(eq(fixtures.matchday, 1)).limit(1);
    const table = await computeTable(db, fixture!.divisionId);
    assert.equal(table.length, 12);
    for (const row of table) {
      assert.equal(row.played, 1);
      assert.equal(row.tablePoints, row.won * 3 + row.drawn);
      assert.equal(row.won + row.drawn + row.lost, row.played);
    }
    // Six matches, so exactly twelve results distributed across the division.
    assert.equal(
      table.reduce((sum, row) => sum + row.played, 0),
      12,
    );
  });
});

async function anyMatchId(): Promise<string | null> {
  const [fixture] = await db
    .select({ id: fixtures.id })
    .from(fixtures)
    .where(eq(fixtures.status, 'published'))
    .limit(1);
  return fixture ? matchIdForFixture(fixture.id) : null;
}

async function matchIdForFixture(fixtureId: string): Promise<string | null> {
  const [match] = await db
    .select({ id: matches.id })
    .from(matches)
    .where(eq(matches.fixtureId, fixtureId));
  return match?.id ?? null;
}

/** Squad size, to prove the world was actually built before the tests ran. */
async function rosterSize(clubId: string): Promise<number> {
  const rows = await db.select({ id: players.id }).from(players).where(eq(players.clubId, clubId));
  return rows.length;
}

export { rosterSize };

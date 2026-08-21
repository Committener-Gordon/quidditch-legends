import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { and, eq, isNull } from 'drizzle-orm';
import { rulesByVersion } from '@ql/sim';
import { upgradeCost, weeklyUpkeep } from '@ql/economy';
import {
  authenticate,
  balanceOf,
  buildSquadFromLineup,
  claimClub,
  clubs,
  createSession,
  deadlineFor,
  destroySession,
  facilityLevels,
  fixtures,
  isPastDeadline,
  ledgerEntries,
  lineupFor,
  openDatabase,
  players,
  postEntry,
  purchaseFacility,
  registerUser,
  saveLineup,
  sessionUser,
  validateSelection,
  type Database,
  type DbHandle,
  type PlayerRow,
} from '@ql/db';
import { createWorld } from '../src/jobs/createWorld.js';
import { newSeason } from '../src/jobs/newSeason.js';
import { runMatchday } from '../src/jobs/matchday.js';
import { isPayday, runPayday, weekOf } from '../src/jobs/finance.js';

let handle: DbHandle;
let db: Database;
let dataDir: string;
let clubId: string;
let seasonId: string;

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'ql-manage-'));
  handle = await openDatabase({ dataDir });
  await handle.migrate();
  db = handle.db;
  await createWorld(db, { seed: 'manage-world', season: 1, rulesVersion: 'v2' });
  const season = await newSeason(db, {
    number: 1,
    startsOn: new Date('2099-09-01T00:00:00Z'),
    rulesVersion: 'v2',
  });
  seasonId = season.seasonId;
  const [club] = await db.select({ id: clubs.id }).from(clubs).where(eq(clubs.short, 'ASH'));
  clubId = club!.id;
});

/**
 * The club's fixture on a given matchday.
 *
 * A lineup is stored per (fixture, club), so saving one against an arbitrary
 * fixture the club is not playing in would never be read back -- which is exactly
 * the mistake this helper exists to prevent.
 */
async function fixtureFor(matchday: number) {
  const rows = await db
    .select()
    .from(fixtures)
    .where(and(eq(fixtures.seasonId, seasonId), eq(fixtures.matchday, matchday)));
  const found = rows.find((row) => row.homeClubId === clubId || row.awayClubId === clubId);
  assert.ok(found, `no matchday ${matchday} fixture for this club`);
  return found;
}

after(async () => {
  await handle.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('accounts', () => {
  it('registers, signs in, and refuses a wrong password', async () => {
    const created = await registerUser(db, {
      email: 'Manager@Example.com',
      displayName: 'A Manager',
      password: 'broomstick99',
    });
    assert.ok(created.ok, created.error);

    const good = await authenticate(db, 'manager@example.com', 'broomstick99');
    assert.ok(good.ok);
    assert.equal(good.userId, created.userId);

    const bad = await authenticate(db, 'manager@example.com', 'broomstick98');
    assert.equal(bad.ok, false);
    // The message must not reveal which half was wrong.
    assert.match(bad.error ?? '', /do not match/);
  });

  it('refuses a duplicate email and a short password', async () => {
    const duplicate = await registerUser(db, {
      email: 'manager@example.com',
      displayName: 'Someone Else',
      password: 'broomstick99',
    });
    assert.equal(duplicate.ok, false);

    const weak = await registerUser(db, {
      email: 'weak@example.com',
      displayName: 'Weak',
      password: 'short',
    });
    assert.equal(weak.ok, false);
  });

  it('issues a session that resolves to the user and can be destroyed', async () => {
    const account = await authenticate(db, 'manager@example.com', 'broomstick99');
    const session = await createSession(db, account.userId!);

    const resolved = await sessionUser(db, session.token);
    assert.equal(resolved?.id, account.userId);

    // A bad token resolves to nobody rather than throwing.
    assert.equal(await sessionUser(db, 'not-a-real-token'), null);

    await destroySession(db, session.token);
    assert.equal(await sessionUser(db, session.token), null);
  });
});

describe('claiming a club', () => {
  it('gives one club to one manager and refuses the rest', async () => {
    const account = await authenticate(db, 'manager@example.com', 'broomstick99');
    const userId = account.userId!;

    const first = await claimClub(db, userId, clubId);
    assert.ok(first.ok, first.error);

    // The same manager cannot take a second club.
    const [other] = await db.select({ id: clubs.id }).from(clubs).where(eq(clubs.short, 'PYR'));
    const second = await claimClub(db, userId, other!.id);
    assert.equal(second.ok, false);

    // And nobody else can take the first one.
    const rival = await registerUser(db, {
      email: 'rival@example.com',
      displayName: 'Rival',
      password: 'broomstick99',
    });
    const taken = await claimClub(db, rival.userId!, clubId);
    assert.equal(taken.ok, false);
    assert.match(taken.error ?? '', /someone else/);
  });
});

describe('the ledger', () => {
  it('is the only source of a balance, and never double-charges', async () => {
    const before = await balanceOf(db, clubId);

    const first = await postEntry(db, {
      clubId,
      kind: 'sponsor',
      amount: 5000,
      reason: 'test sponsorship',
      reference: 'test-week-1',
    });
    assert.equal(first, true);
    assert.equal(await balanceOf(db, clubId), before + 5000);

    // Same club, kind and reference: a job being re-run, not a second payment.
    const repeat = await postEntry(db, {
      clubId,
      kind: 'sponsor',
      amount: 5000,
      reason: 'test sponsorship',
      reference: 'test-week-1',
    });
    assert.equal(repeat, false);
    assert.equal(await balanceOf(db, clubId), before + 5000);
  });

  it('makes payday idempotent', async () => {
    const first = await runPayday(db, { seasonId, seasonNumber: 1, matchday: 1 });
    const balanceAfterFirst = await balanceOf(db, clubId);
    assert.ok(first.length === 12);

    await runPayday(db, { seasonId, seasonNumber: 1, matchday: 1 });
    assert.equal(
      await balanceOf(db, clubId),
      balanceAfterFirst,
      're-running a payday must not charge a club twice',
    );
  });

  it('pays weekly, which is every third matchday', () => {
    assert.deepEqual(
      [1, 2, 3, 4, 5, 6, 7].map(isPayday),
      [true, false, false, true, false, false, true],
    );
    assert.equal(weekOf(1), 1);
    assert.equal(weekOf(4), 2);
    assert.equal(weekOf(22), 8);
  });
});

describe('facilities', () => {
  it('charges the ledger, raises the level, and refuses when short', async () => {
    const levelsBefore = await facilityLevels(db, clubId);
    const cost = upgradeCost('broomStore', levelsBefore.broomStore);
    const balanceBefore = await balanceOf(db, clubId);

    const bought = await purchaseFacility(db, clubId, 'broomStore', seasonId);
    assert.ok(bought.ok, bought.ok ? '' : bought.reason);
    assert.equal(await balanceOf(db, clubId), balanceBefore - cost);

    const levelsAfter = await facilityLevels(db, clubId);
    assert.equal(levelsAfter.broomStore, levelsBefore.broomStore + 1);
    // Upkeep is charged on capital invested, so it must have gone up too.
    assert.ok(weeklyUpkeep(levelsAfter) > weeklyUpkeep(levelsBefore));

    // Drain the account, then try again.
    await postEntry(db, {
      clubId,
      kind: 'adjustment',
      amount: -(await balanceOf(db, clubId)) - 10,
      reason: 'test drain',
      reference: 'test-drain',
    });
    const broke = await purchaseFacility(db, clubId, 'trainingGround', seasonId);
    assert.equal(broke.ok, false);
    assert.match(broke.ok ? '' : broke.reason, /Galleons/);
  });
});

describe('lineups', () => {
  function selectionFrom(roster: PlayerRow[]) {
    const of = (position: string) => roster.filter((row) => row.position === position);
    return {
      keeper: of('keeper')[0]!.id,
      seeker: of('seeker')[0]!.id,
      chasers: of('chaser').slice(0, 3).map((row) => row.id),
      beaters: of('beater').slice(0, 2).map((row) => row.id),
    };
  }

  it('refuses a team that is not a team', async () => {
    const roster = await db.select().from(players).where(eq(players.clubId, clubId));
    const valid = selectionFrom(roster);
    assert.equal(validateSelection(valid, roster, '2099-09-01').ok, true);

    const duplicate = { ...valid, seeker: valid.keeper };
    assert.equal(validateSelection(duplicate, roster, '2099-09-01').ok, false);

    const shortOfChasers = { ...valid, chasers: valid.chasers.slice(0, 2) };
    const result = validateSelection(shortOfChasers, roster, '2099-09-01');
    assert.equal(result.ok, false);
    assert.match(result.errors[0] ?? '', /three chasers/);
  });

  it('locks fifteen minutes before kickoff', () => {
    const kickoff = new Date('2099-09-01T20:00:00Z');
    assert.equal(deadlineFor(kickoff).toISOString(), '2099-09-01T19:45:00.000Z');
    assert.equal(isPastDeadline(kickoff, new Date('2099-09-01T19:44:00Z')), false);
    assert.equal(isPastDeadline(kickoff, new Date('2099-09-01T19:46:00Z')), true);
  });

  it('fields exactly the submitted team, out of position or not', async () => {
    const roster = await db
      .select()
      .from(players)
      .where(and(eq(players.clubId, clubId), isNull(players.retiredInSeason)));
    const fixture = await fixtureFor(1);

    // Deliberately absurd: a beater in goal and a keeper up front. If the engine
    // quietly "fixed" this, a manager's decisions would not be real.
    const beater = roster.find((row) => row.position === 'beater')!;
    const keeper = roster.find((row) => row.position === 'keeper')!;
    const others = roster.filter((row) => row.id !== beater.id && row.id !== keeper.id);
    const selection = {
      keeper: beater.id,
      seeker: others[0]!.id,
      chasers: [keeper.id, others[1]!.id, others[2]!.id],
      beaters: [others[3]!.id, others[4]!.id],
    };

    await saveLineup(db, { fixtureId: fixture.id, clubId, selection, bench: [] });
    const stored = await lineupFor(db, fixture.id, clubId);
    assert.ok(stored);

    const [club] = await db.select().from(clubs).where(eq(clubs.id, clubId));
    const built = buildSquadFromLineup(club!, roster, stored, '2099-09-01', rulesByVersion('v2'));

    assert.equal(built.submitted, true);
    assert.equal(built.squad.lineup.keeper.id, beater.id, 'the beater must be in goal');
    assert.ok(built.squad.lineup.chasers.some((player) => player.id === keeper.id));
  });

  it('replaces a named player who is injured rather than forfeiting', async () => {
    const roster = await db
      .select()
      .from(players)
      .where(and(eq(players.clubId, clubId), isNull(players.retiredInSeason)));
    const fixture = await fixtureFor(1);
    void fixture;

    const keeper = roster.find((row) => row.position === 'keeper')!;
    await db.update(players).set({ injuredUntil: '2099-12-01' }).where(eq(players.id, keeper.id));
    const injured = await db
      .select()
      .from(players)
      .where(and(eq(players.clubId, clubId), isNull(players.retiredInSeason)));

    const stored = await lineupFor(db, fixture.id, clubId);
    const [club] = await db.select().from(clubs).where(eq(clubs.id, clubId));
    const built = buildSquadFromLineup(club!, injured, stored, '2099-09-01', rulesByVersion('v2'));

    // Still a legal side, and the injured player is nowhere in it.
    assert.equal(built.squad.lineup.chasers.length, 3);
    assert.equal(built.squad.lineup.beaters.length, 2);
    const onPitch = [
      built.squad.lineup.keeper.id,
      built.squad.lineup.seeker.id,
      ...built.squad.lineup.chasers.map((player) => player.id),
      ...built.squad.lineup.beaters.map((player) => player.id),
    ];
    assert.equal(onPitch.includes(keeper.id), false);

    await db.update(players).set({ injuredUntil: null }).where(eq(players.id, keeper.id));
  });
});

describe('a human decision reaches a published result', () => {
  it('records which sides were picked by a person', async () => {
    const ours = await fixtureFor(1);
    const result = await runMatchday(db, { seasonNumber: 1, matchday: 1 });

    const line = result.lines.find((entry) => entry.fixtureId === ours.id);
    assert.ok(line, 'our fixture should have been played');
    const picked = ours.homeClubId === clubId ? line.homeSubmitted : line.awaySubmitted;
    assert.equal(picked, true, 'the side with a stored lineup must be marked as submitted');

    // And the other side, which nobody picked, must be marked auto-picked.
    const auto = ours.homeClubId === clubId ? line.awaySubmitted : line.homeSubmitted;
    assert.equal(auto, false);
    // And the ledger saw the gate.
    const entries = await db
      .select({ kind: ledgerEntries.kind })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.kind, 'gate'));
    assert.ok(entries.length > 0, 'a played match must post gate receipts');
  });
});

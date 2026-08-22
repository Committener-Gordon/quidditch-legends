import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { and, eq, isNull } from 'drizzle-orm';
import {
  balanceOf,
  clubs,
  facilityLevels,
  ledgerEntries,
  openDatabase,
  players,
  purchaseFacility,
  type Database,
  type DbHandle,
} from '@ql/db';
import { upgradeCost } from '@ql/economy';
import { createWorld } from '../src/jobs/createWorld.js';
import { newSeason } from '../src/jobs/newSeason.js';
import { executeTransfer, TRANSFER_LEVY } from '../src/jobs/transfer.js';

let handle: DbHandle;
let db: Database;
let dataDir: string;
let buyerId: string;
let sellerId: string;

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'ql-transfer-'));
  handle = await openDatabase({ dataDir });
  await handle.migrate();
  db = handle.db;
  await createWorld(db, { seed: 'transfer-world', season: 1, rulesVersion: 'v2' });
  await newSeason(db, { number: 1, startsOn: new Date('2099-09-01T00:00:00Z'), rulesVersion: 'v2' });

  const [buyer] = await db.select({ id: clubs.id }).from(clubs).where(eq(clubs.short, 'PYR'));
  const [seller] = await db.select({ id: clubs.id }).from(clubs).where(eq(clubs.short, 'ASH'));
  buyerId = buyer!.id;
  sellerId = seller!.id;
});

after(async () => {
  await handle.close();
  rmSync(dataDir, { recursive: true, force: true });
});

async function spareChaser(clubId: string): Promise<string> {
  const roster = await db
    .select({ id: players.id, position: players.position })
    .from(players)
    .where(and(eq(players.clubId, clubId), isNull(players.retiredInSeason)));
  const chaser = roster.filter((row) => row.position === 'chaser').at(-1);
  assert.ok(chaser, 'expected a spare chaser');
  return chaser.id;
}

describe('the seam holds an existing operation', () => {
  it('buys a facility through the aggregate, charging exactly once', async () => {
    const before = await balanceOf(db, buyerId);
    const cost = upgradeCost('broomStore', 0);

    const outcome = await purchaseFacility(db, buyerId, 'broomStore', null);
    assert.equal(outcome.ok, true, outcome.ok ? '' : outcome.reason);
    assert.equal(await balanceOf(db, buyerId), before - cost);
    assert.equal((await facilityLevels(db, buyerId)).broomStore, 1);
  });

  it('refuses when the club is short, and writes nothing', async () => {
    const balance = await balanceOf(db, sellerId);
    // Drain the club, then try the most expensive thing on the list.
    await db.insert(ledgerEntries).values({
      clubId: sellerId,
      kind: 'adjustment',
      amount: -balance,
      reason: 'test drain',
      reference: 'drain-1',
    });

    const outcome = await purchaseFacility(db, sellerId, 'stadium', null);
    assert.equal(outcome.ok, false);
    assert.equal(await balanceOf(db, sellerId), 0, 'a refusal must not move the balance');
    assert.equal((await facilityLevels(db, sellerId)).stadium, 0);

    await db.insert(ledgerEntries).values({
      clubId: sellerId,
      kind: 'adjustment',
      amount: balance,
      reason: 'test restore',
      reference: 'restore-1',
    });
  });
});

describe('a transfer is one fact, all the way to the database', () => {
  it('moves the player and the money together', async () => {
    const playerId = await spareChaser(sellerId);
    const fee = 20_000;
    const buyerBefore = await balanceOf(db, buyerId);
    const sellerBefore = await balanceOf(db, sellerId);

    const outcome = await executeTransfer(db, {
      buyerClubId: buyerId,
      sellerClubId: sellerId,
      playerId,
      fee,
    });
    assert.equal(outcome.ok, true, outcome.ok ? '' : outcome.reason);
    if (!outcome.ok) return;

    const levy = Math.round(fee * TRANSFER_LEVY);
    assert.equal(outcome.value.levy, levy);

    const [moved] = await db.select({ clubId: players.clubId, wage: players.wage }).from(players).where(eq(players.id, playerId));
    assert.equal(moved!.clubId, buyerId, 'the player must have changed clubs');
    assert.ok(moved!.wage > 0, 'the wage is re-struck on the move');

    assert.equal(await balanceOf(db, buyerId), buyerBefore - fee);
    assert.equal(
      await balanceOf(db, sellerId),
      sellerBefore + fee - levy,
      'the seller banks the fee less the levy',
    );

    // The levy leaves the economy rather than moving between clubs.
    const levies = await db.select().from(ledgerEntries).where(eq(ledgerEntries.kind, 'levy'));
    assert.equal(levies.length, 1);
    assert.equal(levies[0]!.amount, -levy);
  });

  it('writes nothing at all when the buyer cannot afford it', async () => {
    const playerId = await spareChaser(sellerId);
    const buyerBefore = await balanceOf(db, buyerId);
    const sellerBefore = await balanceOf(db, sellerId);
    const entriesBefore = (await db.select({ id: ledgerEntries.id }).from(ledgerEntries)).length;

    const outcome = await executeTransfer(db, {
      buyerClubId: buyerId,
      sellerClubId: sellerId,
      playerId,
      fee: 99_000_000,
    });
    assert.equal(outcome.ok, false);

    const [stayed] = await db.select({ clubId: players.clubId }).from(players).where(eq(players.id, playerId));
    assert.equal(stayed!.clubId, sellerId, 'the player must not have moved');
    assert.equal(await balanceOf(db, buyerId), buyerBefore);
    assert.equal(await balanceOf(db, sellerId), sellerBefore);
    assert.equal(
      (await db.select({ id: ledgerEntries.id }).from(ledgerEntries)).length,
      entriesBefore,
      'a refused transfer must not leave a single ledger entry behind',
    );
  });

  it('refuses to strip a club that cannot spare anyone', async () => {
    // Cut the seller down to a bare seven, then try to buy one of them.
    const roster = await db
      .select({ id: players.id })
      .from(players)
      .where(and(eq(players.clubId, sellerId), isNull(players.retiredInSeason)));
    const keep = new Set(await sevenThatCanPlay(sellerId));
    for (const row of roster) {
      if (!keep.has(row.id)) {
        await db.update(players).set({ clubId: null }).where(eq(players.id, row.id));
      }
    }

    const target = [...keep][0]!;
    const outcome = await executeTransfer(db, {
      buyerClubId: buyerId,
      sellerClubId: sellerId,
      playerId: target,
      fee: 1_000,
    });
    assert.equal(outcome.ok, false);
    assert.match(outcome.ok ? '' : outcome.reason, /field a side/);
  });
});

/** Seven players that satisfy the squad rule: a keeper, a seeker and five others. */
async function sevenThatCanPlay(clubId: string): Promise<string[]> {
  const roster = await db
    .select({ id: players.id, position: players.position })
    .from(players)
    .where(and(eq(players.clubId, clubId), isNull(players.retiredInSeason)));
  const keeper = roster.find((row) => row.position === 'keeper')!;
  const seeker = roster.find((row) => row.position === 'seeker')!;
  const rest = roster.filter((row) => row.id !== keeper.id && row.id !== seeker.id).slice(0, 5);
  return [keeper.id, seeker.id, ...rest.map((row) => row.id)];
}

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { and, eq, isNull, sql } from 'drizzle-orm';
import { MARKET, renewalFee, saleProceeds, scoutCost } from '@ql/economy';
import { overall, rulesByVersion } from '@ql/sim';
import {
  balanceOf,
  browseMarket,
  clubs,
  ledgerEntries,
  listingFor,
  openDatabase,
  players,
  reportFor,
  toSimPlayer,
  transferListings,
  valuationOf,
  type Database,
  type DbHandle,
} from '@ql/db';
import { createWorld } from '../src/jobs/createWorld.js';
import { newSeason } from '../src/jobs/newSeason.js';
import {
  buyListed,
  expireContracts,
  listPlayer,
  renewContract,
  scoutPlayer,
  sellToMarket,
  signFreeAgent,
  unlistPlayer,
} from '../src/jobs/market.js';

let handle: DbHandle;
let db: Database;
let dataDir: string;
let mine: string;
let theirs: string;
const rules = rulesByVersion('v2');

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'ql-market-'));
  handle = await openDatabase({ dataDir });
  await handle.migrate();
  db = handle.db;
  await createWorld(db, { seed: 'market-world', season: 1, rulesVersion: 'v2' });
  await newSeason(db, { number: 1, startsOn: new Date('2099-09-01T00:00:00Z'), rulesVersion: 'v2' });
  const [a] = await db.select({ id: clubs.id }).from(clubs).where(eq(clubs.short, 'PYR'));
  const [b] = await db.select({ id: clubs.id }).from(clubs).where(eq(clubs.short, 'ASH'));
  mine = a!.id;
  theirs = b!.id;
});

after(async () => {
  await handle.close();
  rmSync(dataDir, { recursive: true, force: true });
});

async function squadOf(clubId: string) {
  return db
    .select()
    .from(players)
    .where(and(eq(players.clubId, clubId), isNull(players.retiredInSeason)));
}

async function spare(clubId: string, position = 'chaser') {
  const roster = await squadOf(clubId);
  const found = roster.filter((row) => row.position === position).at(-1);
  assert.ok(found, `expected a spare ${position}`);
  return found;
}

describe('the spread is what stops a club printing money', () => {
  it('asks more than it pays', async () => {
    const player = await spare(mine);
    const value = valuationOf(player, rules);
    assert.ok(
      value.asking > value.proceeds,
      `asking ${value.asking} must exceed proceeds ${value.proceeds}`,
    );
    // Buying at 1.12x and selling at 0.85x: a round trip loses about a quarter.
    const round = value.proceeds / value.asking;
    assert.ok(round < 0.8, `a round trip should lose value, got ${(round * 100).toFixed(0)}%`);
  });

  it('pays out less than the valuation when selling to the market', async () => {
    const player = await spare(mine, 'beater');
    const rating = overall(toSimPlayer(player), rules);
    const expected = saleProceeds(rating, player.age, player.potential);
    const before = await balanceOf(db, mine);

    const outcome = await sellToMarket(db, mine, player.id);
    assert.equal(outcome.ok, true, outcome.ok ? '' : outcome.reason);
    assert.equal(await balanceOf(db, mine), before + expected);

    const [gone] = await db.select({ clubId: players.clubId }).from(players).where(eq(players.id, player.id));
    assert.equal(gone!.clubId, null, 'a sold player becomes a free agent');
  });
});

describe('listing and buying', () => {
  it('prices a listing off the valuation and can be withdrawn', async () => {
    const player = await spare(theirs);
    const listed = await listPlayer(db, theirs, player.id);
    assert.equal(listed.ok, true, listed.ok ? '' : listed.reason);
    assert.equal(listed.value, valuationOf(player, rules).asking);

    assert.ok(await listingFor(db, player.id));
    assert.equal((await unlistPlayer(db, theirs, player.id)).ok, true);
    assert.equal(await listingFor(db, player.id), null);
  });

  it('refuses to list someone else’s player', async () => {
    const player = await spare(theirs);
    assert.equal((await listPlayer(db, mine, player.id)).ok, false);
  });

  it('moves the player, the fee and the levy when a listing is bought', async () => {
    const player = await spare(theirs, 'chaser');
    const listed = await listPlayer(db, theirs, player.id);
    assert.equal(listed.ok, true);
    const price = listed.ok ? listed.value : 0;

    const buyerBefore = await balanceOf(db, mine);
    const sellerBefore = await balanceOf(db, theirs);

    const bought = await buyListed(db, mine, player.id);
    assert.equal(bought.ok, true, bought.ok ? '' : bought.reason);

    const levy = Math.round(price * 0.05);
    assert.equal(await balanceOf(db, mine), buyerBefore - price);
    assert.equal(await balanceOf(db, theirs), sellerBefore + price - levy);

    const [moved] = await db.select({ clubId: players.clubId }).from(players).where(eq(players.id, player.id));
    assert.equal(moved!.clubId, mine);
    // Buying takes it off the list, or it could be sold twice.
    assert.equal(await listingFor(db, player.id), null);
  });
});

describe('free agency', () => {
  it('costs a signing-on fee and nothing to the former club', async () => {
    const [free] = await db
      .select()
      .from(players)
      .where(and(isNull(players.clubId), isNull(players.retiredInSeason)))
      .limit(1);
    assert.ok(free, 'the earlier sale should have left a free agent');

    const fee = renewalFee(free.wage);
    const before = await balanceOf(db, mine);
    const signed = await signFreeAgent(db, mine, free.id);
    assert.equal(signed.ok, true, signed.ok ? '' : signed.reason);

    const [now] = await db
      .select({ clubId: players.clubId, until: players.contractUntilSeason })
      .from(players)
      .where(eq(players.id, free.id));
    assert.equal(now!.clubId, mine);
    assert.equal(now!.until, 1 + MARKET.contractSeasons, 'a signing comes with a contract');
    assert.ok(await balanceOf(db, mine) < before, `the signing-on fee of about ${fee} should have been charged`);
  });

  it('refuses a player who already has a club', async () => {
    const player = await spare(theirs, 'beater');
    assert.equal((await signFreeAgent(db, mine, player.id)).ok, false);
  });
});

describe('contracts', () => {
  it('re-strikes the wage on renewal and extends the deal', async () => {
    const player = await spare(mine, 'keeper');
    await db.update(players).set({ contractUntilSeason: 1 }).where(eq(players.id, player.id));

    const outcome = await renewContract(db, mine, player.id);
    assert.equal(outcome.ok, true, outcome.ok ? '' : outcome.reason);
    if (!outcome.ok) return;

    const [after] = await db
      .select({ wage: players.wage, until: players.contractUntilSeason })
      .from(players)
      .where(eq(players.id, player.id));
    assert.equal(after!.until, 1 + MARKET.contractSeasons);
    assert.equal(after!.wage, outcome.value.wage, 'the stored wage must match what was agreed');
  });

  it('lets expired deals lapse, but never below a fieldable squad', async () => {
    // Expire everybody at one club at once. The naive version of this released
    // them all and left the club unable to put seven in the air.
    const roster = await squadOf(theirs);
    await db
      .update(players)
      .set({ contractUntilSeason: 1 })
      .where(and(eq(players.clubId, theirs), isNull(players.retiredInSeason)));

    const walked = await expireContracts(db, 1);
    assert.ok(walked.length > 0, 'some players should have left');

    const left = await squadOf(theirs);
    assert.ok(
      left.length >= 7,
      `a club must keep enough to field a side, kept ${left.length} of ${roster.length}`,
    );
    // And the ones it had to keep were put on emergency terms rather than left expired.
    for (const row of left) {
      assert.ok((row.contractUntilSeason ?? 0) > 1, `${row.name} should have been extended`);
    }
  });
});

describe('scouting', () => {
  it('charges for a report and narrows the range', async () => {
    const [prospect] = await db
      .select()
      .from(players)
      .where(and(eq(players.clubId, mine), isNull(players.retiredInSeason)))
      .orderBy(players.age)
      .limit(1);
    assert.ok(prospect);

    const before = await balanceOf(db, mine);
    const outcome = await scoutPlayer(db, mine, prospect.id);
    assert.equal(outcome.ok, true, outcome.ok ? '' : outcome.reason);
    if (!outcome.ok) return;

    assert.equal(await balanceOf(db, mine), before - scoutCost(0));
    const stored = await reportFor(db, mine, prospect.id);
    assert.ok(stored);
    assert.equal(stored.low, outcome.value.low);

    // An estimate, not the number: the range brackets the truth without revealing it.
    assert.ok(outcome.value.high >= outcome.value.low);
    assert.ok(outcome.value.high - outcome.value.low <= 17, 'a report should be narrower than a guess');
  });

  it('shows a wider range to a club that has not paid', async () => {
    const [prospect] = await db
      .select()
      .from(players)
      .where(and(eq(players.clubId, mine), isNull(players.retiredInSeason)))
      .orderBy(players.age)
      .limit(1);
    const seen = await browseMarket(db, theirs, rules, { limit: 200 });
    const entry = seen.find((row) => row.player.id === prospect!.id);
    if (entry) assert.equal(entry.ceiling.scouted, false, 'the other club has not paid for a report');
  });
});

describe('the market as a whole', () => {
  it('never lets a listed player belong to the viewer', async () => {
    const seen = await browseMarket(db, mine, rules, { limit: 200 });
    for (const entry of seen) {
      assert.notEqual(entry.sellerClubId, mine, 'you cannot buy your own player');
    }
  });

  it('takes the levy out of the economy rather than moving it', async () => {
    const [levies] = await db
      .select({ total: sql<number>`coalesce(sum(${ledgerEntries.amount}), 0)::int` })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.kind, 'levy'));
    assert.ok((levies?.total ?? 0) < 0, 'levies must be a net outflow');
  });
});

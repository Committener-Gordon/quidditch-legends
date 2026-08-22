/**
 * The market: everything a club can do with a player it does not currently have,
 * or no longer wants.
 *
 * Priced against the house rather than negotiated between managers. That is a
 * deliberate first step: the money supply stays exactly where it was put, there is
 * no collusion to police, and the valuation model gets a season of real behaviour to
 * prove itself before anyone is allowed to bid.
 *
 * Every operation that moves money and squad membership goes through the Club
 * aggregate, so none of them can leave the world half-changed -- and none of them
 * can be reinvented somewhere else.
 */

import { and, asc, eq, isNotNull, isNull, lte } from 'drizzle-orm';
import { overall, rulesByVersion, type Position, type RuleSet } from '@ql/sim';
import {
  MARKET,
  renewalFee,
  saleProceeds,
  scoutCost,
  wageForPlayer,
} from '@ql/economy';
import type { Result } from '@ql/domain';
import {
  balanceOf,
  clubs,
  createUnitOfWork,
  currentSeason,
  estimateCeiling,
  facilityLevels,
  listingFor,
  players,
  postEntry,
  scoutReports,
  toSimPlayer,
  transferListings,
  valuationOf,
  type Database,
  type PlayerRow,
} from '@ql/db';
import { executeTransfer } from './transfer.js';

const refuse = (reason: string): Result<never> => ({ ok: false, reason });
const done = <T>(value: T): Result<T> => ({ ok: true, value });

async function rulesFor(db: Database): Promise<{ rules: RuleSet; seasonId: string | null; seasonNumber: number }> {
  const season = await currentSeason(db);
  return {
    rules: rulesByVersion(season?.rulesVersion ?? 'v2'),
    seasonId: season?.id ?? null,
    seasonNumber: season?.number ?? 1,
  };
}

async function playerRow(db: Database, playerId: string): Promise<PlayerRow | null> {
  const [row] = await db.select().from(players).where(eq(players.id, playerId));
  return row ?? null;
}

// --- selling ---------------------------------------------------------------

/** Put one of your own on the list. The price is the valuation, not a haggle. */
export async function listPlayer(db: Database, clubId: string, playerId: string): Promise<Result<number>> {
  const row = await playerRow(db, playerId);
  if (!row || row.clubId !== clubId) return refuse('that player is not yours to sell');
  if (row.retiredInSeason !== null) return refuse('that player has retired');

  const { rules } = await rulesFor(db);
  const price = valuationOf(row, rules).asking;

  await db
    .insert(transferListings)
    .values({ playerId, clubId, price })
    .onConflictDoUpdate({ target: transferListings.playerId, set: { price, clubId, listedAt: new Date() } });
  return done(price);
}

export async function unlistPlayer(db: Database, clubId: string, playerId: string): Promise<Result<null>> {
  const listing = await listingFor(db, playerId);
  if (!listing || listing.clubId !== clubId) return refuse('that player is not on your list');
  await db.delete(transferListings).where(eq(transferListings.playerId, playerId));
  return done(null);
}

/**
 * Sell to the market rather than to a club.
 *
 * Returns less than the valuation, which is the whole reason a club cannot churn
 * its squad for profit: buying costs 12% over the valuation and selling returns 85%
 * of it, so a round trip loses about a quarter of the fee.
 */
export async function sellToMarket(db: Database, clubId: string, playerId: string): Promise<Result<number>> {
  const row = await playerRow(db, playerId);
  if (!row || row.clubId !== clubId) return refuse('that player is not yours to sell');

  const { rules, seasonId } = await rulesFor(db);
  const rating = overall(toSimPlayer(row), rules);
  const proceeds = saleProceeds(rating, row.age, row.potential);

  return createUnitOfWork(db).run(async ({ clubs: repo }) => {
    const club = await repo.get(clubId);
    const released = club.release(playerId);
    if (!released.ok) return released;

    club.receive(proceeds, `sold ${row.name} to the market`, `sale-${playerId}`, 'transfer');
    await repo.save(club, seasonId);
    return done(proceeds);
  });
}

// --- buying ----------------------------------------------------------------

/** Buy a listed player at the asking price. */
export async function buyListed(db: Database, buyerClubId: string, playerId: string): Promise<Result<number>> {
  const listing = await listingFor(db, playerId);
  if (!listing) return refuse('that player is not for sale');
  if (listing.clubId === buyerClubId) return refuse('that player is already yours');

  const outcome = await executeTransfer(db, {
    buyerClubId,
    sellerClubId: listing.clubId,
    playerId,
    fee: listing.price,
  });
  return outcome.ok ? done(listing.price) : outcome;
}

/**
 * Sign a free agent. No fee to anyone -- just a signing-on payment and the wages.
 *
 * Which is what makes an expiring contract matter: the club that let it run down
 * gets nothing, and everyone else gets a player for the price of six weeks' wages.
 */
export async function signFreeAgent(db: Database, clubId: string, playerId: string): Promise<Result<number>> {
  const row = await playerRow(db, playerId);
  if (!row) return refuse('no such player');
  if (row.clubId !== null) return refuse('that player already has a club');
  if (row.retiredInSeason !== null) return refuse('that player has retired');

  const { rules, seasonId, seasonNumber } = await rulesFor(db);
  const wage = wageForPlayer(toSimPlayer(row), rules);
  const fee = renewalFee(wage);

  return createUnitOfWork(db).run(async ({ clubs: repo, contracts }) => {
    const club = await repo.get(clubId);
    if (!club.canAfford(fee)) {
      return refuse(`signing ${row.name} costs ${fee.toLocaleString()} and the club has ${club.balance.toLocaleString()}`);
    }
    const signable = club.canSign(playerId);
    if (!signable.ok) return signable;

    club.spend(fee, `signed ${row.name}`, `signing-${playerId}`, 'transfer');
    club.sign(playerId, row.position as Position, wage);
    await repo.save(club, seasonId);
    await contracts.set(playerId, seasonNumber + MARKET.contractSeasons);
    return done(fee);
  });
}

// --- contracts -------------------------------------------------------------

/** Everyone whose deal runs out at the end of this season. */
export async function expiringSoon(db: Database, clubId: string, seasonNumber: number) {
  return db
    .select()
    .from(players)
    .where(
      and(
        eq(players.clubId, clubId),
        isNull(players.retiredInSeason),
        lte(players.contractUntilSeason, seasonNumber),
      ),
    )
    .orderBy(asc(players.age));
}

/** Re-sign a player at what they are now worth, for a fee up front. */
export async function renewContract(db: Database, clubId: string, playerId: string): Promise<Result<{ fee: number; wage: number; until: number }>> {
  const row = await playerRow(db, playerId);
  if (!row || row.clubId !== clubId) return refuse('that player is not yours');

  const { rules, seasonId, seasonNumber } = await rulesFor(db);
  // The brake on success: a squad that has improved has to be re-signed at what it
  // is now worth, not what it cost.
  const wage = wageForPlayer(toSimPlayer(row), rules);
  const fee = renewalFee(wage);
  const until = seasonNumber + MARKET.contractSeasons;

  return createUnitOfWork(db).run(async ({ clubs: repo, contracts }) => {
    const club = await repo.get(clubId);
    if (!club.canAfford(fee)) {
      return refuse(`renewing ${row.name} costs ${fee.toLocaleString()} and the club has ${club.balance.toLocaleString()}`);
    }
    club.spend(fee, `renewed ${row.name}`, `renewal-${playerId}-${until}`, 'transfer');
    club.rewage(playerId, wage);
    await repo.save(club, seasonId);
    await contracts.set(playerId, until);
    return done({ fee, wage, until });
  });
}

/**
 * Off-season: anyone whose deal has run out walks.
 *
 * Deliberately unforgiving. A club that ignores its contracts loses players for
 * nothing, and those players land in free agency where everyone else can have them
 * for six weeks' wages -- which is the redistribution the league needs while there
 * is no draft.
 */
export async function expireContracts(db: Database, seasonNumber: number): Promise<{ name: string; from: string | null }[]> {
  const expired = await db
    .select({ id: players.id, name: players.name, clubId: players.clubId, wage: players.wage })
    .from(players)
    .where(
      and(
        isNull(players.retiredInSeason),
        isNotNull(players.clubId),
        lte(players.contractUntilSeason, seasonNumber),
      ),
    )
    .orderBy(asc(players.wage));

  const shorts = new Map(
    (await db.select({ id: clubs.id, short: clubs.short }).from(clubs)).map((club) => [club.id, club.short]),
  );

  // Group by club: the squad rule is a rule about a club, so it has to be applied
  // a club at a time. Releasing everyone whose deal ran out with a bulk update --
  // which is how this was written first -- can strip a squad below the seven it
  // needs to field a side, and bypasses the aggregate that exists to prevent
  // exactly that.
  const byClub = new Map<string, typeof expired>();
  for (const row of expired) {
    if (!row.clubId) continue;
    byClub.set(row.clubId, [...(byClub.get(row.clubId) ?? []), row]);
  }

  const walked: { name: string; from: string | null }[] = [];
  const uow = createUnitOfWork(db);

  for (const [clubId, leaving] of byClub) {
    await uow.run(async ({ clubs: repo, contracts }) => {
      const club = await repo.get(clubId);

      // Cheapest first, so a club forced to keep someone keeps its best.
      for (const row of leaving) {
        const released = club.release(row.id);
        if (released.ok) {
          walked.push({ name: row.name, from: shorts.get(clubId) ?? null });
        } else {
          // The club cannot spare them. Emergency terms: one more season, because
          // the alternative is a club that cannot put seven in the air.
          await contracts.set(row.id, seasonNumber + 1);
        }
      }

      await repo.save(club, null);
    });
  }

  return walked;
}

// --- scouting --------------------------------------------------------------

/**
 * Pay for a report.
 *
 * Buys precision, never certainty: the range narrows with the scouting network but
 * stays centred slightly off the truth, and differently off for each club. A market
 * where everyone agrees on every price has no judgement left in it.
 */
export async function scoutPlayer(db: Database, clubId: string, playerId: string): Promise<Result<{ low: number; high: number; cost: number }>> {
  const row = await playerRow(db, playerId);
  if (!row) return refuse('no such player');

  const { rules, seasonId } = await rulesFor(db);
  const level = (await facilityLevels(db, clubId)).scoutingNetwork;
  const cost = scoutCost(level);
  const rating = overall(toSimPlayer(row), rules);

  const balance = await balanceOf(db, clubId);
  if (balance < cost) {
    return refuse(`a report costs ${cost.toLocaleString()} and the club has ${balance.toLocaleString()}`);
  }

  const estimate = estimateCeiling(clubId, row, rating, level);
  await postEntry(db, {
    clubId,
    kind: 'medical',
    amount: -cost,
    reason: `scout report on ${row.name}`,
    reference: `scout-${playerId}-${level}`,
    seasonId,
  });
  await db
    .insert(scoutReports)
    .values({ clubId, playerId, low: estimate.low, high: estimate.high, atLevel: level })
    .onConflictDoUpdate({
      target: [scoutReports.clubId, scoutReports.playerId],
      set: { low: estimate.low, high: estimate.high, atLevel: level, createdAt: new Date() },
    });

  return done({ ...estimate, cost });
}

// --- what the AI clubs do --------------------------------------------------

/** The squad shape every club drifts back toward. */
const SHAPE: Record<Position, number> = { chaser: 6, beater: 4, keeper: 2, seeker: 2 };

export interface AiMarketReport {
  renewed: number;
  listed: number;
  /** Free agents taken on. */
  signed: number;
  /** Bought from another club, which is what makes a listing worth posting. */
  bought: number;
}

/**
 * AI clubs trading.
 *
 * Without this the market is a vending machine that only the human uses: nothing
 * would ever be listed, free agents would pile up forever, and an expiring contract
 * would cost an AI club nothing. Deliberately simple and deliberately bounded --
 * a couple of decisions per club per week, not an optimiser.
 */
export async function aiMarket(db: Database, seasonNumber: number): Promise<AiMarketReport> {
  const { rules, seasonId } = await rulesFor(db);
  const managed = await db
    .select({ id: clubs.id, short: clubs.short })
    .from(clubs)
    .where(isNull(clubs.managerUserId));

  const report: AiMarketReport = { renewed: 0, listed: 0, signed: 0, bought: 0 };
  const uow = createUnitOfWork(db);

  // Free agents are shared, so read them once rather than per club.
  const freeAgents = await db
    .select()
    .from(players)
    .where(and(isNull(players.clubId), isNull(players.retiredInSeason)))
    .orderBy(asc(players.wage));
  const taken = new Set<string>();

  for (const club of managed) {
    const squad = await db
      .select()
      .from(players)
      .where(and(eq(players.clubId, club.id), isNull(players.retiredInSeason)));
    if (squad.length === 0) continue;

    const rated = squad
      .map((row) => ({ row, rating: overall(toSimPlayer(row), rules) }))
      .sort((left, right) => right.rating - left.rating);
    const median = rated[Math.floor(rated.length / 2)]?.rating ?? 0;

    const counts: Record<Position, number> = { chaser: 0, beater: 0, keeper: 0, seeker: 0 };
    for (const row of squad) counts[row.position as Position] += 1;

    // One transaction and one club load for every decision this club makes.
    // Calling the single-action helpers in a loop meant a fresh transaction and a
    // fresh aggregate load per player, which is what made this unusably slow.
    await uow.run(async ({ clubs: repo, contracts }) => {
      const aggregate = await repo.get(club.id);

      // 1. Keep up to three players worth keeping whose deals are running out.
      let renewals = 0;
      for (const entry of rated) {
        if (renewals >= 3) break;
        if ((entry.row.contractUntilSeason ?? 99) > seasonNumber) continue;
        if (entry.rating < median && entry.row.age > 23) continue;

        const wage = wageForPlayer(toSimPlayer(entry.row), rules);
        const fee = renewalFee(wage);
        if (!aggregate.canAfford(fee)) continue;

        aggregate.spend(fee, `renewed ${entry.row.name}`, `renewal-${entry.row.id}-${seasonNumber}`, 'transfer');
        aggregate.rewage(entry.row.id, wage);
        await contracts.set(entry.row.id, seasonNumber + MARKET.contractSeasons);
        renewals += 1;
        report.renewed += 1;
      }

      // 2. Fill the biggest gap from free agency, cheapest first.
      const shortest = (Object.keys(SHAPE) as Position[])
        .map((position) => ({ position, missing: SHAPE[position] - counts[position] }))
        .filter((gap) => gap.missing > 0)
        .sort((left, right) => right.missing - left.missing)[0];

      if (shortest) {
        for (const candidate of freeAgents) {
          if (taken.has(candidate.id)) continue;
          if (candidate.position !== shortest.position) continue;

          const wage = wageForPlayer(toSimPlayer(candidate), rules);
          const fee = renewalFee(wage);
          if (!aggregate.canAfford(fee)) break;
          if (!aggregate.canSign(candidate.id).ok) break;

          aggregate.spend(fee, `signed ${candidate.name}`, `signing-${candidate.id}`, 'transfer');
          aggregate.sign(candidate.id, candidate.position as Position, wage);
          await contracts.set(candidate.id, seasonNumber + MARKET.contractSeasons);
          taken.add(candidate.id);
          report.signed += 1;
          break;
        }
      }

      await repo.save(aggregate, seasonId);
    });

    // 3. If a gap is still open, buy one from another club. This is deliberately
    // outside the transaction above: a club-to-club deal touches two aggregates and
    // has its own. Without it nothing anybody lists ever sells, which makes listing
    // a player pointless for a human manager too.
    // Clubs are refilled to shape by youth intake every off-season, so a club
    // almost never has a gap. Buying only to fill one meant nothing anybody listed
    // ever sold. An AI club will also buy to *improve*: a listed player clearly
    // better than its worst at that position, if it can afford one without
    // emptying the account.
    const affordableShare = 0.5;
    const offers = await db
      .select({ player: players, price: transferListings.price, sellerId: transferListings.clubId })
      .from(transferListings)
      .innerJoin(players, eq(transferListings.playerId, players.id))
      .where(isNull(players.retiredInSeason))
      .orderBy(asc(transferListings.price))
      .limit(20);

    const balance = await balanceOf(db, club.id);
    for (const offer of offers) {
      if (offer.sellerId === club.id) continue;
      if (offer.price > balance * affordableShare) continue;

      const position = offer.player.position as Position;
      const rating = overall(toSimPlayer(offer.player), rules);
      const fillsGap = counts[position] < SHAPE[position];
      const ours = rated.filter((entry) => (entry.row.position as Position) === position);
      const worst = ours.length > 0 ? Math.min(...ours.map((entry) => entry.rating)) : 0;
      // Four points is about half a season's development: worth paying for.
      if (!fillsGap && rating < worst + 4) continue;

      const bought = await buyListed(db, club.id, offer.player.id);
      if (bought.ok) {
        report.bought += 1;
        break;
      }
    }

    // 4. List what it does not need. A listing moves no money, so it needs no
    // aggregate and no transaction.
    let listedThisRun = 0;
    for (const entry of [...rated].reverse()) {
      if (listedThisRun >= 2) break;
      if (squad.length - listedThisRun <= 9) break;
      const position = entry.row.position as Position;
      if (counts[position] <= SHAPE[position] && entry.row.age < 33) continue;
      if (await listingFor(db, entry.row.id)) continue;

      const price = valuationOf(entry.row, rules).asking;
      await db
        .insert(transferListings)
        .values({ playerId: entry.row.id, clubId: club.id, price })
        .onConflictDoNothing();
      listedThisRun += 1;
      report.listed += 1;
    }
  }

  return report;
}

/** Give every player a contract. Used at world creation, where nobody has one. */
export async function seedContracts(db: Database, seasonNumber: number): Promise<number> {
  const roster = await db
    .select({ id: players.id })
    .from(players)
    .where(and(isNotNull(players.clubId), isNull(players.contractUntilSeason)));

  // Staggered, so a whole squad does not run out at once.
  for (const [index, row] of roster.entries()) {
    await db
      .update(players)
      .set({ contractUntilSeason: seasonNumber + (index % 3) + 1 })
      .where(eq(players.id, row.id));
  }
  return roster.length;
}

/**
 * Reading the market.
 *
 * Two kinds of availability: a player whose club has listed them, and a free agent
 * whose `club_id` is null. Free agents cost nothing to sign -- only their wages --
 * which is what makes an expiring contract a real loss to the club that let it run
 * down and a real opportunity to everyone else.
 *
 * Nothing here writes. The market's writes go through the Club aggregate, because
 * every one of them moves money and squad membership together.
 */

import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { UNSCOUTED_RANGE, askingPrice, saleProceeds, scoutRange } from '@ql/economy';
import { overall, type RuleSet } from '@ql/sim';
import type { Database } from './client.js';
import { toSimPlayer, type PlayerRow } from './mapping.js';
import { clubs, players, scoutReports, transferListings } from './schema.js';

export interface MarketEntry {
  player: PlayerRow;
  rating: number;
  /** Null for a free agent: nobody is selling them. */
  price: number | null;
  /** Null for a free agent. */
  sellerClubId: string | null;
  sellerShort: string | null;
  /** What this club's scouts make of the ceiling. */
  ceiling: { low: number; high: number; scouted: boolean };
}

/**
 * What a club sees when it looks at a player's ceiling.
 *
 * Unscouted is deliberately close to useless. Paying for a report buys precision
 * scaled by the scouting network, and the estimate stays slightly wrong on purpose
 * -- a market where every club agrees on every price has no judgement left in it.
 */
export function ceilingFor(
  row: PlayerRow,
  rating: number,
  report: { low: number; high: number } | undefined,
): { low: number; high: number; scouted: boolean } {
  if (report) return { low: report.low, high: report.high, scouted: true };
  const half = UNSCOUTED_RANGE / 2;
  return {
    low: Math.max(Math.round(rating), Math.round(row.potential - half)),
    high: Math.min(99, Math.round(row.potential + half)),
    scouted: false,
  };
}

/** Deterministic per (club, player): two clubs disagree, but each is consistent. */
export function estimateCeiling(
  clubId: string,
  row: PlayerRow,
  rating: number,
  networkLevel: number,
): { low: number; high: number } {
  const range = scoutRange(networkLevel);
  // A cheap stable hash, so re-reading a report never changes what it said.
  let hash = 0;
  for (const char of `${clubId}:${row.id}`) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  const drift = ((Math.abs(hash) % 1000) / 1000 - 0.5) * range;

  const centre = row.potential + drift;
  return {
    low: Math.max(Math.round(rating), Math.round(centre - range / 2)),
    high: Math.min(99, Math.round(centre + range / 2)),
  };
}

export async function reportsFor(db: Database, clubId: string): Promise<Map<string, { low: number; high: number }>> {
  const rows = await db
    .select({ playerId: scoutReports.playerId, low: scoutReports.low, high: scoutReports.high })
    .from(scoutReports)
    .where(eq(scoutReports.clubId, clubId));
  return new Map(rows.map((row) => [row.playerId, { low: row.low, high: row.high }]));
}

export async function reportFor(db: Database, clubId: string, playerId: string) {
  const [row] = await db
    .select()
    .from(scoutReports)
    .where(and(eq(scoutReports.clubId, clubId), eq(scoutReports.playerId, playerId)));
  return row ?? null;
}

export interface MarketFilter {
  position?: string;
  maxPrice?: number;
  freeAgentsOnly?: boolean;
  limit?: number;
}

/** Everything a club could buy right now, priced and scouted from its point of view. */
export async function browseMarket(
  db: Database,
  viewerClubId: string,
  rules: RuleSet,
  filter: MarketFilter = {},
): Promise<MarketEntry[]> {
  const reports = await reportsFor(db, viewerClubId);
  const shorts = new Map(
    (await db.select({ id: clubs.id, short: clubs.short }).from(clubs)).map((club) => [club.id, club.short]),
  );

  const listed = filter.freeAgentsOnly
    ? []
    : await db
        .select({ player: players, price: transferListings.price, clubId: transferListings.clubId })
        .from(transferListings)
        .innerJoin(players, eq(transferListings.playerId, players.id))
        .where(and(isNull(players.retiredInSeason), sql`${transferListings.clubId} <> ${viewerClubId}`))
        .orderBy(asc(transferListings.price));

  const free = await db
    .select()
    .from(players)
    .where(and(isNull(players.clubId), isNull(players.retiredInSeason)))
    .orderBy(desc(players.potential));

  const entries: MarketEntry[] = [
    ...listed.map((row) => {
      const rating = overall(toSimPlayer(row.player), rules);
      return {
        player: row.player,
        rating,
        price: row.price,
        sellerClubId: row.clubId,
        sellerShort: shorts.get(row.clubId) ?? null,
        ceiling: ceilingFor(row.player, rating, reports.get(row.player.id)),
      };
    }),
    ...free.map((row) => {
      const rating = overall(toSimPlayer(row), rules);
      return {
        player: row,
        rating,
        price: null,
        sellerClubId: null,
        sellerShort: null,
        ceiling: ceilingFor(row, rating, reports.get(row.id)),
      };
    }),
  ];

  const filtered = entries.filter((entry) => {
    if (filter.position && entry.player.position !== filter.position) return false;
    if (filter.maxPrice !== undefined && (entry.price ?? 0) > filter.maxPrice) return false;
    return true;
  });

  return filtered.slice(0, filter.limit ?? 60);
}

export async function listingFor(db: Database, playerId: string) {
  const [row] = await db.select().from(transferListings).where(eq(transferListings.playerId, playerId));
  return row ?? null;
}

export async function listingsOf(db: Database, clubId: string) {
  return db.select().from(transferListings).where(eq(transferListings.clubId, clubId));
}

/** What this club would be offered for one of its own, and what others would pay. */
export function valuationOf(row: PlayerRow, rules: RuleSet) {
  const rating = overall(toSimPlayer(row), rules);
  return {
    rating,
    asking: askingPrice(rating, row.age, row.potential),
    proceeds: saleProceeds(rating, row.age, row.potential),
  };
}

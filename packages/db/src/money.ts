/**
 * Reading and moving Galleons.
 *
 * The balance is always a sum over the ledger, never a stored number. Every write
 * goes through `postEntry`, which is idempotent on (club, kind, reference) -- that
 * unique index is what makes a payday job safe to run twice.
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import {
  DEFAULT_LEVELS,
  FACILITIES,
  investedAt,
  upgradeCost,
  weeklyUpkeep,
  type FacilityKind,
} from '@ql/economy';
import type { Database } from './client.js';
import { facilities, ledgerEntries, players, trainingOrders } from './schema.js';

export type LedgerKind = typeof ledgerEntries.$inferSelect['kind'];

export interface LedgerPost {
  clubId: string;
  kind: LedgerKind;
  /** Signed: income positive, cost negative. */
  amount: number;
  reason: string;
  reference?: string | null;
  seasonId?: string | null;
}

export async function balanceOf(db: Database, clubId: string): Promise<number> {
  const [row] = await db
    .select({ balance: sql<number>`coalesce(sum(${ledgerEntries.amount}), 0)::int` })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.clubId, clubId));
  return row?.balance ?? 0;
}

export async function balancesByClub(db: Database): Promise<Map<string, number>> {
  const rows = await db
    .select({
      clubId: ledgerEntries.clubId,
      balance: sql<number>`coalesce(sum(${ledgerEntries.amount}), 0)::int`,
    })
    .from(ledgerEntries)
    .groupBy(ledgerEntries.clubId);
  return new Map(rows.map((row) => [row.clubId, row.balance]));
}

/**
 * Post an entry. Returns false if an identical one already exists, which is not an
 * error -- it is a job being re-run.
 */
export async function postEntry(db: Database, entry: LedgerPost): Promise<boolean> {
  const inserted = await db
    .insert(ledgerEntries)
    .values({
      clubId: entry.clubId,
      kind: entry.kind,
      amount: Math.round(entry.amount),
      reason: entry.reason,
      reference: entry.reference ?? null,
      seasonId: entry.seasonId ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: ledgerEntries.id });
  return inserted.length > 0;
}

export async function ledgerFor(db: Database, clubId: string, limit = 40) {
  return db
    .select()
    .from(ledgerEntries)
    .where(eq(ledgerEntries.clubId, clubId))
    .orderBy(desc(ledgerEntries.id))
    .limit(limit);
}

/** Income and costs grouped by kind, for a finances page that adds up. */
export async function ledgerSummary(db: Database, clubId: string) {
  return db
    .select({
      kind: ledgerEntries.kind,
      total: sql<number>`sum(${ledgerEntries.amount})::int`,
      entries: sql<number>`count(*)::int`,
    })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.clubId, clubId))
    .groupBy(ledgerEntries.kind)
    .orderBy(sql`sum(${ledgerEntries.amount}) desc`);
}

// --- facilities -------------------------------------------------------------

export async function ensureFacilities(db: Database, clubId: string): Promise<void> {
  await db
    .insert(facilities)
    .values(FACILITIES.map((facility) => ({ clubId, kind: facility.kind, level: 0, invested: 0 })))
    .onConflictDoNothing();
}

export async function facilityLevels(
  db: Database,
  clubId: string,
): Promise<Record<FacilityKind, number>> {
  const rows = await db.select().from(facilities).where(eq(facilities.clubId, clubId));
  const levels = { ...DEFAULT_LEVELS };
  for (const row of rows) levels[row.kind as FacilityKind] = row.level;
  return levels;
}

export async function facilityLevelsByClub(
  db: Database,
): Promise<Map<string, Record<FacilityKind, number>>> {
  const rows = await db.select().from(facilities);
  const byClub = new Map<string, Record<FacilityKind, number>>();
  for (const row of rows) {
    const levels = byClub.get(row.clubId) ?? { ...DEFAULT_LEVELS };
    levels[row.kind as FacilityKind] = row.level;
    byClub.set(row.clubId, levels);
  }
  return byClub;
}

export type UpgradeOutcome =
  | { ok: true; kind: FacilityKind; level: number; cost: number; balance: number }
  | { ok: false; reason: string };

/**
 * Buy one level of one facility.
 *
 * Charge and increment in a single transaction, and re-read the balance inside it,
 * so two clicks cannot buy the same level twice or take a club below zero.
 */
export async function purchaseFacility(
  db: Database,
  clubId: string,
  kind: FacilityKind,
  seasonId: string | null,
): Promise<UpgradeOutcome> {
  await ensureFacilities(db, clubId);

  return db.transaction(async (tx) => {
    const scoped = tx as unknown as Database;
    const [row] = await scoped
      .select()
      .from(facilities)
      .where(and(eq(facilities.clubId, clubId), eq(facilities.kind, kind)));
    if (!row) return { ok: false, reason: 'that facility does not exist' };

    const cost = upgradeCost(kind, row.level);
    if (cost === 0) return { ok: false, reason: 'already at the highest level' };

    const balance = await balanceOf(scoped, clubId);
    if (balance < cost) {
      return {
        ok: false,
        reason: `that costs ${cost.toLocaleString()} Galleons and the club has ${balance.toLocaleString()}`,
      };
    }

    const level = row.level + 1;
    await scoped
      .update(facilities)
      .set({ level, invested: investedAt(kind, level), updatedAt: new Date() })
      .where(and(eq(facilities.clubId, clubId), eq(facilities.kind, kind)));

    await postEntry(scoped, {
      clubId,
      kind: 'facility',
      amount: -cost,
      reason: `${kind} to level ${level}`,
      reference: `${kind}-${level}`,
      seasonId,
    });

    return { ok: true, kind, level, cost, balance: balance - cost };
  });
}

export async function upkeepFor(db: Database, clubId: string): Promise<number> {
  return weeklyUpkeep(await facilityLevels(db, clubId));
}

// --- wages ------------------------------------------------------------------

export async function wageBill(db: Database, clubId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${players.wage}), 0)::int` })
    .from(players)
    .where(and(eq(players.clubId, clubId), sql`${players.retiredInSeason} is null`));
  return row?.total ?? 0;
}

// --- training ---------------------------------------------------------------

export async function trainingOrderFor(db: Database, clubId: string, seasonId: string) {
  const [row] = await db
    .select()
    .from(trainingOrders)
    .where(and(eq(trainingOrders.clubId, clubId), eq(trainingOrders.seasonId, seasonId)));
  return row ?? null;
}

export async function setTrainingOrder(
  db: Database,
  clubId: string,
  seasonId: string,
  focus: string | null,
  intensity: 'light' | 'normal' | 'hard',
): Promise<void> {
  await db
    .insert(trainingOrders)
    .values({ clubId, seasonId, focus, intensity })
    .onConflictDoUpdate({
      target: [trainingOrders.clubId, trainingOrders.seasonId],
      set: { focus, intensity, updatedAt: new Date() },
    });
}

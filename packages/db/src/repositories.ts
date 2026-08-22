/**
 * The seam.
 *
 * This is the only file that knows both how a club is stored and what a club is.
 * Everything above it works with the `Club` aggregate and never sees a row; this
 * translates a club's changes into ledger entries, facility levels and squad
 * membership, and nothing else in the codebase needs to know how that is done.
 *
 * `UnitOfWork.run` is the transaction boundary. A transfer touches two clubs, and
 * both are committed or neither is.
 */

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  Club,
  type ClubChange,
  type ClubId,
  type ClubSnapshot,
  type FacilityKind,
  type Position,
} from '@ql/domain';
import { DEFAULT_LEVELS, FACILITIES } from '@ql/economy';
import type { Database } from './client.js';
import { clubs, facilities, ledgerEntries, players } from './schema.js';

export interface ClubsRepository {
  get(id: ClubId): Promise<Club>;
  /** Persists everything the club recorded, then clears it. Saving twice is a no-op. */
  save(club: Club, seasonId?: string | null): Promise<void>;
}

export interface UnitOfWork {
  run<T>(work: (repositories: { clubs: ClubsRepository }) => Promise<T>): Promise<T>;
}

/** Load a club as the aggregate sees it: a balance, a squad, and some buildings. */
async function loadSnapshot(db: Database, id: ClubId): Promise<ClubSnapshot> {
  const [club] = await db.select({ id: clubs.id, name: clubs.name }).from(clubs).where(eq(clubs.id, id));
  if (!club) throw new Error(`no club ${id}`);

  const [balanceRow] = await db
    .select({ balance: sql<number>`coalesce(sum(${ledgerEntries.amount}), 0)::int` })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.clubId, id));

  const squad = await db
    .select({ playerId: players.id, position: players.position, wage: players.wage })
    .from(players)
    .where(and(eq(players.clubId, id), isNull(players.retiredInSeason)));

  const levels = { ...DEFAULT_LEVELS };
  for (const row of await db.select().from(facilities).where(eq(facilities.clubId, id))) {
    levels[row.kind as FacilityKind] = row.level;
  }

  return {
    id: club.id,
    name: club.name,
    balance: balanceRow?.balance ?? 0,
    squad: squad.map((row) => ({
      playerId: row.playerId,
      position: row.position as Position,
      wage: row.wage,
    })),
    facilities: levels,
  };
}

/**
 * Write a club's changes.
 *
 * Squad membership is persisted here rather than through a separate player
 * repository. The sketch had one; it turned out to be redundant, because saving the
 * seller (clubId to null) and then the buyer (clubId to the buyer) inside one
 * transaction already produces the correct final state, and a second repository
 * would have been a second way to move a player.
 */
async function applyChanges(
  db: Database,
  club: Club,
  changes: ClubChange[],
  seasonId: string | null,
): Promise<void> {
  for (const change of changes) {
    switch (change.kind) {
      case 'debit':
      case 'credit': {
        const amount = change.kind === 'debit' ? -change.amount : change.amount;
        await db
          .insert(ledgerEntries)
          .values({
            clubId: club.id,
            kind: change.ledger,
            amount,
            reason: change.reason,
            reference: change.reference,
            seasonId,
          })
          .onConflictDoNothing();
        break;
      }
      case 'facility':
        await db
          .update(facilities)
          .set({ level: change.level, invested: change.invested, updatedAt: new Date() })
          .where(and(eq(facilities.clubId, club.id), eq(facilities.kind, change.facility)));
        break;
      case 'released':
        await db.update(players).set({ clubId: null }).where(eq(players.id, change.playerId));
        break;
      case 'signed':
        await db
          .update(players)
          .set({ clubId: club.id, wage: change.wage })
          .where(eq(players.id, change.playerId));
        break;
    }
  }
}

function repositoryFor(db: Database): ClubsRepository {
  return {
    async get(id) {
      // Facility rows are created lazily, so a club that has never built anything
      // still loads with every level at zero.
      await db
        .insert(facilities)
        .values(FACILITIES.map((facility) => ({ clubId: id, kind: facility.kind, level: 0, invested: 0 })))
        .onConflictDoNothing();
      return Club.rehydrate(await loadSnapshot(db, id));
    },
    async save(club, seasonId = null) {
      const changes = club.pullChanges();
      if (changes.length === 0) return;
      await applyChanges(db, club, changes, seasonId);
    },
  };
}

export function createUnitOfWork(db: Database): UnitOfWork {
  return {
    async run(work) {
      return db.transaction(async (tx) => work({ clubs: repositoryFor(tx as unknown as Database) }));
    },
  };
}

/** For reads that do not need a transaction. */
export function clubsRepository(db: Database): ClubsRepository {
  return repositoryFor(db);
}

/** Squad membership for several clubs at once, for the market to browse later. */
export async function squadsOf(db: Database, clubIds: ClubId[]) {
  if (clubIds.length === 0) return [];
  return db
    .select({ clubId: players.clubId, playerId: players.id, position: players.position, wage: players.wage })
    .from(players)
    .where(and(inArray(players.clubId, clubIds), isNull(players.retiredInSeason)));
}

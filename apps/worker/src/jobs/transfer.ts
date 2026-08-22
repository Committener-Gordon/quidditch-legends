/**
 * Transfers: the application layer around the aggregate.
 *
 * Everything that decides whether a deal is legal lives in `@ql/domain`; this loads
 * the two clubs, hands them over, and commits both in one transaction. If the
 * domain refuses, nothing was written and there is nothing to undo.
 */

import { eq } from 'drizzle-orm';
import { agreeTransfer, type Result, type TransferAgreed, type Position } from '@ql/domain';
import { marketValue, wageForPlayer } from '@ql/economy';
import { overall, rulesByVersion } from '@ql/sim';
import {
  createUnitOfWork,
  currentSeason,
  players,
  toSimPlayer,
  type Database,
} from '@ql/db';

/**
 * What the Ministry takes out of every fee.
 *
 * A fee between two clubs moves money; it does not remove any. Without a sink on
 * the transfer market a busy one inflates forever, and a club that joined in season
 * six can never buy anything.
 */
export const TRANSFER_LEVY = 0.05;

export interface TransferRequest {
  buyerClubId: string;
  sellerClubId: string;
  playerId: string;
  fee: number;
}

export async function executeTransfer(
  db: Database,
  request: TransferRequest,
): Promise<Result<TransferAgreed>> {
  const [row] = await db.select().from(players).where(eq(players.id, request.playerId));
  if (!row) return { ok: false, reason: 'no such player' };
  if (row.clubId !== request.sellerClubId) return { ok: false, reason: 'that club does not hold the player' };
  if (row.retiredInSeason !== null) return { ok: false, reason: 'that player has retired' };

  const season = await currentSeason(db);
  const rules = rulesByVersion(season?.rulesVersion ?? 'v2');
  // A move is a new deal, so the wage is re-struck at what the player is worth now.
  const wage = wageForPlayer(toSimPlayer(row), rules);

  return createUnitOfWork(db).run(async ({ clubs }) => {
    const [buyer, seller] = await Promise.all([
      clubs.get(request.buyerClubId),
      clubs.get(request.sellerClubId),
    ]);

    const outcome = agreeTransfer(buyer, seller, {
      playerId: request.playerId,
      position: row.position as Position,
      wage,
      fee: request.fee,
      levyRate: TRANSFER_LEVY,
    });
    if (!outcome.ok) return outcome;

    // Seller first: it clears the player's club before the buyer claims them.
    await clubs.save(seller, season?.id ?? null);
    await clubs.save(buyer, season?.id ?? null);
    return outcome;
  });
}

/** What the house would ask for a player. Phase four's market prices against this. */
export async function askingPrice(db: Database, playerId: string): Promise<number | null> {
  const [row] = await db.select().from(players).where(eq(players.id, playerId));
  if (!row) return null;
  const season = await currentSeason(db);
  const rules = rulesByVersion(season?.rulesVersion ?? 'v2');
  return marketValue(overall(toSimPlayer(row), rules), row.age, row.potential);
}

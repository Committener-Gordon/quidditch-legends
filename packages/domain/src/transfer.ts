/**
 * A transfer, which is the whole reason the aggregate exists.
 *
 * One business fact spanning two clubs: a player changes hands, a fee moves, a levy
 * is taken. Before this there was no single place that said so, and four separate
 * writes could each be called on their own.
 *
 * This function is pure and mutates only the two in-memory clubs it is handed. If
 * any step refuses, the caller discards both objects and nothing was ever written --
 * which is a cheaper and more obvious failure path than a rollback.
 *
 * Note that a transfer spans two aggregates, and orthodox practice would reach for
 * eventual consistency and a saga here. That would be wrong for this system: there
 * is one database and one writer, so the application layer commits both clubs in a
 * single transaction. A saga would be ceremony bought with real complexity.
 */

import type { Club } from './club.js';
import { ok, refuse, type Galleons, type PlayerId, type Position, type Result } from './types.js';

export interface TransferTerms {
  playerId: PlayerId;
  position: Position;
  /** What the buyer will pay the player each week. */
  wage: Galleons;
  fee: Galleons;
  /** Share of the fee taken out of the economy rather than paid to the seller. */
  levyRate: number;
}

export interface TransferAgreed {
  playerId: PlayerId;
  fee: Galleons;
  levy: Galleons;
  /** What the seller actually banks. */
  proceeds: Galleons;
  buyerBalance: Galleons;
  sellerBalance: Galleons;
}

export function agreeTransfer(buyer: Club, seller: Club, terms: TransferTerms): Result<TransferAgreed> {
  if (buyer.id === seller.id) return refuse('a club cannot buy its own player');
  if (terms.fee < 0) return refuse('a fee cannot be negative');
  if (!seller.has(terms.playerId)) return refuse(`${seller.name} does not hold that player`);

  const reference = `transfer-${terms.playerId}`;
  const levy = Math.round(terms.fee * terms.levyRate);

  // Ask everything before changing anything. A refusal on the third step would
  // otherwise leave the buyer already debited and the seller already stripped, and
  // the caller would have to remember to discard both objects. Checking first makes
  // the deal atomic in memory as well as in the database.
  if (!buyer.canAfford(terms.fee)) {
    return refuse(
      `${buyer.name} cannot afford ${terms.fee.toLocaleString()} Galleons (balance ${buyer.balance.toLocaleString()})`,
    );
  }
  const releasable = seller.canRelease(terms.playerId);
  if (!releasable.ok) return releasable;
  const signable = buyer.canSign(terms.playerId);
  if (!signable.ok) return signable;

  // From here nothing can refuse.
  buyer.spend(terms.fee, `signed ${terms.playerId}`, reference, 'transfer');
  seller.release(terms.playerId);
  buyer.sign(terms.playerId, terms.position, terms.wage);

  // The seller banks the whole fee and then pays the levy out of it. Crediting the
  // net amount *and* charging the levy would take it twice -- which is exactly what
  // this did until a test compared the two balances.
  seller.receive(terms.fee, `sold ${terms.playerId}`, reference, 'transfer');
  if (levy > 0) {
    // The levy leaves the economy entirely. Without it a busy market inflates
    // forever: a fee between two clubs moves money, it does not remove any.
    seller.spend(levy, 'transfer levy', reference, 'levy');
  }
  const proceeds = terms.fee - levy;

  return ok({
    playerId: terms.playerId,
    fee: terms.fee,
    levy,
    proceeds,
    buyerBalance: buyer.balance,
    sellerBalance: seller.balance,
  });
}

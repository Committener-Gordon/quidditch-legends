/**
 * The vocabulary the club rules are written in.
 *
 * No dependencies, here or anywhere else in this package -- the same rule that
 * governs `@ql/sim` and `@ql/economy`. A club's rules should be testable without a
 * database, because they are rules about a club and not about storage.
 */

export type ClubId = string;
export type PlayerId = string;
/** Whole Galleons. There are no fractions of a Galleon anywhere in this game. */
export type Galleons = number;
export type Position = 'chaser' | 'beater' | 'keeper' | 'seeker';
export type FacilityKind =
  | 'trainingGround'
  | 'medicalWing'
  | 'scoutingNetwork'
  | 'academy'
  | 'stadium'
  | 'broomStore';

/**
 * Success or a reason, rather than an exception.
 *
 * Refusing to sell your last keeper is an ordinary answer to an ordinary
 * question, not an exceptional condition -- and the reason has to reach the
 * manager who asked, so it belongs in the return value.
 */
export type Result<T> = { ok: true; value: T } | { ok: false; reason: string };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const refuse = <T = never>(reason: string): Result<T> => ({ ok: false, reason });

export interface SquadMember {
  playerId: PlayerId;
  position: Position;
  wage: Galleons;
}

/** What a club looked like when it was loaded. */
export interface ClubSnapshot {
  id: ClubId;
  name: string;
  /** Summed from the ledger at load time; this aggregate never stores a balance. */
  balance: Galleons;
  squad: SquadMember[];
  facilities: Record<FacilityKind, number>;
}

/**
 * Something that happened to a club, for a repository to persist.
 *
 * Note what these are not: they are not rows. `debit` says money left the club; it
 * is the repository that decides that means an append-only ledger entry. The rule
 * and the storage shape stay independent.
 */
export type ClubChange =
  | { kind: 'debit'; amount: Galleons; reason: string; reference: string | null; ledger: LedgerKind }
  | { kind: 'credit'; amount: Galleons; reason: string; reference: string | null; ledger: LedgerKind }
  | { kind: 'facility'; facility: FacilityKind; level: number; invested: Galleons }
  | { kind: 'released'; playerId: PlayerId }
  | { kind: 'signed'; playerId: PlayerId; wage: Galleons }
  | { kind: 'rewage'; playerId: PlayerId; wage: Galleons };

export type LedgerKind =
  | 'gate'
  | 'appearance'
  | 'sponsor'
  | 'prize'
  | 'wages'
  | 'upkeep'
  | 'facility'
  | 'training'
  | 'medical'
  | 'transfer'
  | 'levy'
  | 'adjustment';

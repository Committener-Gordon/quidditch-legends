/**
 * The Club aggregate.
 *
 * It exists for one reason: money and squad membership have to change together,
 * and before this there was no single place that could say so. Every write that
 * touches both now goes through here, so "a transfer" has exactly one definition
 * and cannot be reinvented three files away.
 *
 * Deliberately small. It holds squad *membership* -- an id, a position and a wage
 * -- not the players themselves. Loading fourteen full player records and an entire
 * ledger to buy a broom cupboard would be a worse design, not a purer one.
 *
 * Nothing here touches storage. Mutations happen in memory and are collected as
 * changes; a refusal therefore costs a discarded object rather than a rollback.
 */

import {
  ok,
  refuse,
  type ClubChange,
  type ClubId,
  type ClubSnapshot,
  type FacilityKind,
  type Galleons,
  type LedgerKind,
  type PlayerId,
  type Position,
  type Result,
  type SquadMember,
} from './types.js';

/** Enough players to field a side, with the two positions nobody else can cover. */
export const MIN_SQUAD = 7;
export const MAX_SQUAD = 18;

/**
 * Can this squad still put seven in the air?
 *
 * The engine's auto-pick will play someone out of position rather than fail, so
 * the hard floor is seven bodies. Keeper and seeker are called out because they are
 * the two slots where playing a stand-in is genuinely ruinous rather than merely
 * bad.
 */
export function canFieldASide(squad: SquadMember[]): boolean {
  if (squad.length < MIN_SQUAD) return false;
  const has = (position: Position): boolean => squad.some((member) => member.position === position);
  return has('keeper') && has('seeker');
}

export class Club {
  private constructor(
    private readonly snapshot: ClubSnapshot,
    private readonly changes: ClubChange[],
  ) {}

  static rehydrate(snapshot: ClubSnapshot): Club {
    return new Club({ ...snapshot, squad: [...snapshot.squad], facilities: { ...snapshot.facilities } }, []);
  }

  get id(): ClubId {
    return this.snapshot.id;
  }
  get name(): string {
    return this.snapshot.name;
  }
  get balance(): Galleons {
    return this.snapshot.balance;
  }
  get squadSize(): number {
    return this.snapshot.squad.length;
  }
  get wageBill(): Galleons {
    return this.snapshot.squad.reduce((total, member) => total + member.wage, 0);
  }
  facilityLevel(kind: FacilityKind): number {
    return this.snapshot.facilities[kind];
  }
  has(playerId: PlayerId): boolean {
    return this.snapshot.squad.some((member) => member.playerId === playerId);
  }

  // --- questions, asked before anything is changed --------------------------
  //
  // An operation spanning two clubs has to know it will succeed before it starts,
  // or a refusal halfway leaves both aggregates half-mutated and the caller has to
  // remember to throw them away. Checking first makes the whole operation atomic in
  // memory, which is a much easier contract to hold.

  canAfford(amount: Galleons): boolean {
    return amount >= 0 && amount <= this.snapshot.balance;
  }

  canRelease(playerId: PlayerId): Result<SquadMember> {
    const member = this.snapshot.squad.find((entry) => entry.playerId === playerId);
    if (!member) return refuse(`that player is not in ${this.snapshot.name}'s squad`);
    if (!canFieldASide(this.snapshot.squad.filter((entry) => entry.playerId !== playerId))) {
      return refuse(`letting them go would leave ${this.snapshot.name} unable to field a side`);
    }
    return ok(member);
  }

  canSign(playerId: PlayerId): Result<null> {
    if (this.has(playerId)) return refuse('that player is already in this squad');
    if (this.snapshot.squad.length >= MAX_SQUAD) {
      return refuse(`${this.snapshot.name} already has ${MAX_SQUAD} players`);
    }
    return ok(null);
  }

  // --- money ---------------------------------------------------------------

  /**
   * Discretionary spending refuses rather than going negative.
   *
   * Wages are the deliberate exception and do not come through here: they are paid
   * whether or not the club can afford them, and the consequence lands on squad
   * morale instead. A club that cannot pay is in trouble, not frozen.
   */
  spend(amount: Galleons, reason: string, reference: string | null, ledger: LedgerKind = 'adjustment'): Result<Galleons> {
    if (amount < 0) return refuse('a negative charge is a credit -- use receive()');
    if (amount > this.snapshot.balance) {
      return refuse(
        `${reason} costs ${amount.toLocaleString()} Galleons and ${this.snapshot.name} has ${this.snapshot.balance.toLocaleString()}`,
      );
    }
    this.snapshot.balance -= amount;
    this.changes.push({ kind: 'debit', amount, reason, reference, ledger });
    return ok(this.snapshot.balance);
  }

  receive(amount: Galleons, reason: string, reference: string | null, ledger: LedgerKind = 'adjustment'): void {
    this.snapshot.balance += amount;
    this.changes.push({ kind: 'credit', amount, reason, reference, ledger });
  }

  // --- facilities ----------------------------------------------------------

  buyFacility(kind: FacilityKind, cost: Galleons, maxLevel: number, investedAfter: Galleons): Result<number> {
    const level = this.snapshot.facilities[kind] + 1;
    if (level > maxLevel) return refuse('already at the highest level');

    const paid = this.spend(cost, `${kind} to level ${level}`, `${kind}-${level}`, 'facility');
    if (!paid.ok) return paid;

    this.snapshot.facilities[kind] = level;
    this.changes.push({ kind: 'facility', facility: kind, level, invested: investedAfter });
    return ok(level);
  }

  // --- squad ---------------------------------------------------------------

  /** The rule the old code had no way to express. */
  release(playerId: PlayerId): Result<SquadMember> {
    const allowed = this.canRelease(playerId);
    if (!allowed.ok) return allowed;
    const member = allowed.value;

    this.snapshot.squad = this.snapshot.squad.filter((entry) => entry.playerId !== playerId);
    this.changes.push({ kind: 'released', playerId });
    return ok(member);
  }

  sign(playerId: PlayerId, position: Position, wage: Galleons): Result<SquadMember> {
    const allowed = this.canSign(playerId);
    if (!allowed.ok) return allowed;

    const member: SquadMember = { playerId, position, wage };
    this.snapshot.squad.push(member);
    this.changes.push({ kind: 'signed', playerId, wage });
    return ok(member);
  }

  /**
   * Re-strike a player's wage, on a renewal.
   *
   * A wage is squad state, so it belongs here rather than in a stray update from
   * the application layer -- which is how it was done first, using the outer
   * database handle from inside a transaction on a single-connection database. That
   * did not fail loudly; it just stopped making progress.
   */
  rewage(playerId: PlayerId, wage: Galleons): Result<Galleons> {
    const member = this.snapshot.squad.find((entry) => entry.playerId === playerId);
    if (!member) return refuse('that player is not in this squad');
    member.wage = wage;
    this.changes.push({ kind: 'rewage', playerId, wage });
    return ok(wage);
  }

  // --- persistence hand-off ------------------------------------------------

  /** Everything that happened since loading. Clears on read, so saving twice is a no-op. */
  pullChanges(): ClubChange[] {
    return this.changes.splice(0, this.changes.length);
  }

  get hasChanges(): boolean {
    return this.changes.length > 0;
  }
}

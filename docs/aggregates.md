# A seam for phase four

**Built, and phase four is built on it.** Steps 1 to 4 below are implemented: `packages/domain` holds the `Club`
aggregate, `packages/db/src/repositories.ts` is the seam, `purchaseFacility` runs
through it, and `executeTransfer` exists and is tested. What remains for phase four
is the market *around* it -- listings, valuations, AI buyers, the screens.

Two things changed while building it, both for the better, and both recorded below
where they differ from the original sketch.

## The invariant that has nowhere to live

A transfer is one business fact made of several writes:

```ts
// what it would look like today
await postEntry(db, { clubId: buyer,  kind: 'transfer', amount: -fee, ... });
await postEntry(db, { clubId: seller, kind: 'transfer', amount: fee - levy, ... });
await postEntry(db, { clubId: seller, kind: 'levy',     amount: -levy, ... });
await db.update(players).set({ clubId: buyer, wage }).where(eq(players.id, id));
```

Four writes, each callable from anywhere, and **162 functions in this repo take a
raw `Database` handle**. Nothing anywhere says "a transfer is exactly these four
things and never three of them." A transaction makes it atomic; it does not make it
*correct*, and it does not stop the next caller inventing a different version of a
transfer six months from now.

That is the whole case for an aggregate. Not layering for its own sake — one rule
that currently has no home.

## Where to draw the boundary

Put it around the invariant, not around the table. The rule that matters is:

> Money and squad membership change together, or not at all. A club can never be
> left unable to field a side, and can never spend money it does not have.

So the aggregate is **Club**, holding its balance, its squad membership and its
facilities. Deliberately *not* holding the full player objects — a Player is an
entity in its own right, referenced by id. Loading fourteen players and an entire
ledger to buy a broom cupboard would be a worse design, not a purer one.

## The sketch

### 1. The aggregate — pure, no I/O

Lives in a new `packages/domain`, next to `sim` and `economy` and under the same
rule: zero dependencies, no database, testable without one.

```ts
export type Result<T> = { ok: true; value: T } | { ok: false; reason: string };

export interface ClubSnapshot {
  id: ClubId;
  name: string;
  /** Summed from the ledger at load time. */
  balance: Galleons;
  squad: { playerId: PlayerId; position: Position; wage: Galleons }[];
  facilities: Record<FacilityKind, number>;
  /** For optimistic concurrency once there is more than one writer. */
  version: number;
}

export class Club {
  private constructor(
    private snapshot: ClubSnapshot,
    private readonly changes: ClubChange[] = [],
  ) {}

  static rehydrate(snapshot: ClubSnapshot): Club {
    return new Club(snapshot);
  }

  get id(): ClubId { return this.snapshot.id; }
  get balance(): Galleons { return this.snapshot.balance; }

  /** Refuses rather than going negative. Wages are the one debit that may. */
  private spend(amount: Galleons, reason: string, reference: string): Result<null> {
    if (amount > this.snapshot.balance) {
      return { ok: false, reason: `${reason} costs ${amount}, the club has ${this.snapshot.balance}` };
    }
    this.snapshot.balance -= amount;
    this.changes.push({ kind: 'debit', amount, reason, reference });
    return { ok: true, value: null };
  }

  receive(amount: Galleons, reason: string, reference: string): void {
    this.snapshot.balance += amount;
    this.changes.push({ kind: 'credit', amount, reason, reference });
  }

  buyFacility(kind: FacilityKind, cost: Galleons): Result<number> {
    const level = this.snapshot.facilities[kind] + 1;
    const paid = this.spend(cost, `${kind} to level ${level}`, `${kind}-${level}`);
    if (!paid.ok) return paid;
    this.snapshot.facilities[kind] = level;
    this.changes.push({ kind: 'facility', facility: kind, level });
    return { ok: true, value: level };
  }

  /** The squad rule the current code has no way to express. */
  release(playerId: PlayerId): Result<PlayerId> {
    const player = this.snapshot.squad.find((entry) => entry.playerId === playerId);
    if (!player) return { ok: false, reason: 'that player is not in this squad' };

    const remaining = this.snapshot.squad.filter((entry) => entry.playerId !== playerId);
    if (!canFieldASide(remaining)) {
      return { ok: false, reason: `selling ${playerId} would leave the club unable to field a side` };
    }
    this.snapshot.squad = remaining;
    this.changes.push({ kind: 'released', playerId });
    return { ok: true, value: playerId };
  }

  sign(playerId: PlayerId, position: Position, wage: Galleons): Result<PlayerId> {
    if (this.snapshot.squad.length >= MAX_SQUAD) {
      return { ok: false, reason: 'the squad is full' };
    }
    this.snapshot.squad.push({ playerId, position, wage });
    this.changes.push({ kind: 'signed', playerId, wage });
    return { ok: true, value: playerId };
  }

  /** Everything that happened, for the repository to persist. Clears on read. */
  pullChanges(): ClubChange[] {
    return this.changes.splice(0, this.changes.length);
  }
}
```

Note what this does *not* do: it never touches the ledger table. It records that a
debit happened; turning that into an append-only row is the repository's job. The
balance rule and the ledger's storage shape stay independent.

### 2. The seam — a repository, and a unit of work

**Change from the sketch:** the separate `Players` repository was dropped. Saving
the seller (club id to null) and then the buyer (club id to the buyer) inside one
transaction already produces the correct final state, so a second repository would
only have been a second way to move a player.

```ts
export interface ClubsRepository {
  get(id: ClubId): Promise<Club>;
  /** Appends the pulled changes as ledger entries, facility levels and squad rows. */
  save(club: Club, seasonId?: string | null): Promise<void>;
}

/** One transaction, scoped repositories. The only thing that knows about Drizzle. */
export interface UnitOfWork {
  run<T>(work: (repos: { clubs: Clubs; players: Players }) => Promise<T>): Promise<T>;
}
```

The Drizzle implementation lives in `packages/db` and is the *only* place that
imports it. `apps/web` stops importing `drizzle-orm` entirely — it has no business
knowing.

### 3. The operation that justifies all of it

A transfer spans two aggregates. Classic DDD would reach for eventual consistency
and a saga here. That would be wrong for this system: there is one database and one
writer, so a transaction across both is honest and a saga would be ceremony. Say so
in the code rather than apologising for it later.

**Change from the sketch:** the sketch mutated as it went, so a refusal on the
third step left the buyer already debited and the seller already stripped, and the
caller had to remember to discard both objects. It now asks every question before
changing anything (`canAfford`, `canRelease`, `canSign`), which makes the deal
atomic in memory as well as in the database. Two tests hold it to that.

```ts
/** Pure: decides whether the deal is legal and what it costs. No I/O. */
export function agreeTransfer(
  buyer: Club,
  seller: Club,
  player: { id: PlayerId; position: Position; wage: Galleons },
  fee: Galleons,
  levyRate: number,
): Result<TransferAgreed> {
  const levy = Math.round(fee * levyRate);

  const released = seller.release(player.id);
  if (!released.ok) return released;

  const signed = buyer.sign(player.id, player.position, player.wage);
  if (!signed.ok) return signed;

  const paid = buyer.spend(fee, `signed ${player.id}`, `transfer-${player.id}`);
  if (!paid.ok) return paid;

  seller.receive(fee - levy, `sold ${player.id}`, `transfer-${player.id}`);
  return { ok: true, value: { fee, levy, playerId: player.id } };
}

/** Application layer: one transaction, both aggregates, nothing half-done. */
export async function executeTransfer(uow: UnitOfWork, deal: TransferRequest): Promise<Result<TransferAgreed>> {
  return uow.run(async ({ clubs, players }) => {
    const buyer = await clubs.get(deal.buyerId);
    const seller = await clubs.get(deal.sellerId);

    const outcome = agreeTransfer(buyer, seller, deal.player, deal.fee, TRANSFER_LEVY);
    if (!outcome.ok) return outcome;   // nothing saved, nothing to undo

    await clubs.save(seller);
    await clubs.save(buyer);
    await players.move(deal.player.id, deal.buyerId, deal.player.wage);
    return outcome;
  });
}
```

The failure path is the point. `agreeTransfer` mutates only in-memory objects, so a
refusal costs a discarded object rather than a rollback — and there is now exactly
one definition of what a transfer is.

## What this is worth, honestly

**Buys:**
- One place that defines a transfer. It becomes impossible to move a player without
  moving the money, because there is no other route.
- Squad rules that cannot currently be expressed at all ("you cannot sell your last
  keeper") get somewhere to live.
- The whole ruleset is testable with no database, like `sim` and `economy` already are.
- `apps/web` stops importing an ORM.

**Costs:**
- A new package and an indirection on every club write.
- Two ways of doing things during the migration, which is genuinely worse than one
  until it is finished.

**Do not extend it to:**
- `packages/sim`. It is already pure, and functions-over-data is the right shape for
  a simulation. Wrapping `resolvePossession` in a class would be pure ceremony.
- The match write path. `persist()` writing match, events, stats and player effects
  in one transaction spans several notional aggregates and is correct as it stands —
  it is a single append of one immutable fact.
- Bounded contexts. There is one schema and one team. Splitting Match / League /
  Club Management into separate models would cost more than it returns at this size.

## Migration path

Incremental, and each step is useful on its own:

1. `packages/domain` with `Club`, `Result` and the change types. Pure, tested, wired
   to nothing. Costs nothing if it stops here.
2. `Clubs` repository interface, and its Drizzle implementation in `packages/db`.
3. Move **one** existing operation behind it — `purchaseFacility`, which already has
   the check-and-charge-in-one-transaction shape. If the seam is wrong, this is where
   it shows, and it is one function to revert.
4. Build transfers on the seam rather than beside it.
5. Move other club writes across opportunistically, as they are touched. Payday is
   the obvious next one; the match write path may never need to move.

Stop at any step. The value is concentrated in steps 3 and 4.

## What it caught immediately

Writing the tests for the aggregate found a real bug in the transfer: the seller was
credited the fee *less* the levy and then charged the levy again, taking it twice.
The unit test agreed with the bug, because it was written in terms of the reported
`proceeds`; the database test compared the two balances independently and disagreed.
That is the argument for both kinds of test, and for expressing an expectation in
terms of the inputs rather than the output.

It also exposed that **test files were never being typechecked** -- they sit outside
every package's `rootDir`. `tsconfig.tests.json` now covers them, and `npm run
typecheck` runs it.

Building the market on top of the seam then caught three more, all of the same
family -- writes that went round the aggregate or round the transaction:

- `expireContracts` was a bulk `UPDATE` that released every player whose deal had
  run out, with no squad rule applied. It could leave a club unable to field a side.
  It now releases a club at a time through the aggregate, and puts the players it
  cannot spare on emergency terms for one more season.
- `aiMarket` wrote wages through the outer `db` handle from inside a `uow.run`
  transaction. On a single-connection database that does not error, it just stops
  making progress -- a four-second season became a six-minute one. A wage is squad
  state, so it is now `Club.rewage()`.
- `clubs.get()` upserted six facility rows on every load, which is fine once and
  ruinous in a loop.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Club, agreeTransfer, canFieldASide, type ClubSnapshot, type SquadMember } from '../src/index.js';

const facilities = {
  trainingGround: 0, medicalWing: 0, scoutingNetwork: 0, academy: 0, stadium: 0, broomStore: 0,
};

function squad(count: number, extra: Partial<SquadMember>[] = []): SquadMember[] {
  const base: SquadMember[] = [
    { playerId: 'k1', position: 'keeper', wage: 500 },
    { playerId: 's1', position: 'seeker', wage: 600 },
    { playerId: 'b1', position: 'beater', wage: 400 },
    { playerId: 'b2', position: 'beater', wage: 400 },
    { playerId: 'c1', position: 'chaser', wage: 700 },
    { playerId: 'c2', position: 'chaser', wage: 700 },
    { playerId: 'c3', position: 'chaser', wage: 700 },
    { playerId: 'c4', position: 'chaser', wage: 300 },
  ];
  return [...base.slice(0, count), ...(extra as SquadMember[])];
}

function club(overrides: Partial<ClubSnapshot> = {}): Club {
  return Club.rehydrate({
    id: overrides.id ?? 'club-a',
    name: overrides.name ?? 'Ashdown Arrows',
    balance: overrides.balance ?? 100_000,
    squad: overrides.squad ?? squad(8),
    facilities: overrides.facilities ?? { ...facilities },
  });
}

describe('a club protects its own balance', () => {
  it('refuses to spend money it does not have, and says how much it has', () => {
    const arrows = club({ balance: 5_000 });
    const outcome = arrows.spend(9_000, 'a new broom', 'broom-1');
    assert.equal(outcome.ok, false);
    assert.match(outcome.ok ? '' : outcome.reason, /9,000.*Ashdown Arrows has 5,000/);
    assert.equal(arrows.balance, 5_000, 'a refused charge must not move the balance');
    assert.equal(arrows.hasChanges, false, 'a refused charge must not record anything');
  });

  it('records a debit and a credit as changes rather than writing anything', () => {
    const arrows = club({ balance: 10_000 });
    assert.equal(arrows.spend(4_000, 'training camp', 'camp-1', 'training').ok, true);
    arrows.receive(1_500, 'appearance fee', 'match-1', 'appearance');
    assert.equal(arrows.balance, 7_500);

    const changes = arrows.pullChanges();
    assert.deepEqual(changes.map((change) => change.kind), ['debit', 'credit']);
    assert.equal(arrows.pullChanges().length, 0, 'pulling twice must yield nothing');
  });
});

describe('a club protects its own squad', () => {
  it('knows when it can still field a side', () => {
    assert.equal(canFieldASide(squad(8)), true);
    assert.equal(canFieldASide(squad(6)), false, 'six players cannot field seven');
    const noKeeper = squad(8).filter((member) => member.position !== 'keeper');
    assert.equal(canFieldASide(noKeeper), false, 'nobody else can play in goal');
  });

  it('refuses to release the last keeper', () => {
    const arrows = club({ squad: squad(7) });
    const outcome = arrows.canRelease('k1');
    assert.equal(outcome.ok, false);
    assert.match(outcome.ok ? '' : outcome.reason, /unable to field a side/);
  });

  it('refuses to release anyone from a bare seven', () => {
    const arrows = club({ squad: squad(7) });
    assert.equal(arrows.release('c3').ok, false);
    assert.equal(arrows.squadSize, 7, 'a refused release must not shrink the squad');
  });

  it('releases happily from a squad with cover', () => {
    const arrows = club({ squad: squad(8) });
    const outcome = arrows.release('c4');
    assert.equal(outcome.ok, true);
    assert.equal(arrows.squadSize, 7);
    assert.equal(arrows.has('c4'), false);
  });

  it('will not sign the same player twice', () => {
    const arrows = club();
    assert.equal(arrows.sign('c1', 'chaser', 500).ok, false);
  });
});

describe('facilities', () => {
  it('charges the club and raises the level together', () => {
    const arrows = club({ balance: 50_000 });
    const outcome = arrows.buyFacility('trainingGround', 40_000, 5, 40_000);
    assert.equal(outcome.ok, true);
    assert.equal(arrows.facilityLevel('trainingGround'), 1);
    assert.equal(arrows.balance, 10_000);
  });

  it('refuses when short, leaving the level alone', () => {
    const arrows = club({ balance: 1_000 });
    assert.equal(arrows.buyFacility('trainingGround', 40_000, 5, 40_000).ok, false);
    assert.equal(arrows.facilityLevel('trainingGround'), 0);
    assert.equal(arrows.hasChanges, false);
  });

  it('refuses past the top level', () => {
    const arrows = club({ balance: 999_999, facilities: { ...facilities, broomStore: 3 } });
    assert.equal(arrows.buyFacility('broomStore', 1_000, 3, 0).ok, false);
  });
});

describe('a transfer is one fact or none of it', () => {
  const terms = { playerId: 'c4', position: 'chaser' as const, wage: 900, fee: 30_000, levyRate: 0.05 };

  it('moves the player, the fee and the levy together', () => {
    const buyer = club({ id: 'buyer', name: 'Pyrewood', balance: 60_000, squad: squad(7) });
    const seller = club({ id: 'seller', name: 'Ashdown', balance: 10_000, squad: squad(8) });

    const outcome = agreeTransfer(buyer, seller, terms);
    assert.equal(outcome.ok, true, outcome.ok ? '' : outcome.reason);
    if (!outcome.ok) return;

    assert.equal(outcome.value.levy, 1_500);
    assert.equal(outcome.value.proceeds, 28_500);
    assert.equal(buyer.balance, 60_000 - 30_000, 'buyer paid the whole fee');
    // Written as fee-minus-levy rather than as the reported proceeds: expressing it
    // in terms of `proceeds` is how this test originally agreed with a bug that took
    // the levy twice.
    assert.equal(seller.balance, 10_000 + 30_000 - 1_500, 'seller banked the fee less the levy');
    assert.equal(buyer.has('c4'), true);
    assert.equal(seller.has('c4'), false);
  });

  it('leaves both clubs untouched when the buyer cannot afford it', () => {
    const buyer = club({ id: 'buyer', name: 'Pyrewood', balance: 1_000, squad: squad(7) });
    const seller = club({ id: 'seller', name: 'Ashdown', balance: 10_000, squad: squad(8) });

    const outcome = agreeTransfer(buyer, seller, terms);
    assert.equal(outcome.ok, false);
    // The important part: a refusal must not half-do the deal, or the caller has to
    // remember to throw both aggregates away.
    assert.equal(buyer.balance, 1_000);
    assert.equal(seller.balance, 10_000);
    assert.equal(seller.has('c4'), true);
    assert.equal(buyer.hasChanges, false);
    assert.equal(seller.hasChanges, false);
  });

  it('leaves both clubs untouched when the seller cannot spare the player', () => {
    const buyer = club({ id: 'buyer', name: 'Pyrewood', balance: 90_000, squad: squad(7) });
    const seller = club({ id: 'seller', name: 'Ashdown', balance: 10_000, squad: squad(7) });

    const outcome = agreeTransfer(buyer, seller, { ...terms, playerId: 'c3' });
    assert.equal(outcome.ok, false);
    assert.equal(buyer.balance, 90_000, 'the buyer must not have been debited');
    assert.equal(seller.squadSize, 7);
    assert.equal(buyer.hasChanges, false);
    assert.equal(seller.hasChanges, false);
  });

  it('refuses a club buying its own player', () => {
    const arrows = club({ id: 'same', squad: squad(8) });
    assert.equal(agreeTransfer(arrows, arrows, terms).ok, false);
  });
});

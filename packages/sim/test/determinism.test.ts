import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULT_RULES, RULE_SETS, createRng, generateClub, rulesByVersion, simulate } from '../src/index.js';

function fixture(seed: string) {
  return {
    home: generateClub(createRng('t-home'), {
      clubId: 'h',
      name: 'Pyrewood Pirates',
      short: 'PYR',
      rating: 70,
    }),
    away: generateClub(createRng('t-away'), {
      clubId: 'a',
      name: 'Ashdown Arrows',
      short: 'ASH',
      rating: 66,
    }),
    seed,
  };
}

describe('determinism', () => {
  it('returns an identical match for an identical seed', () => {
    const a = simulate(fixture('seed-1'));
    const b = simulate(fixture('seed-1'));
    assert.deepEqual(a.score, b.score);
    assert.deepEqual(a.events, b.events);
    assert.deepEqual(a.stats, b.stats);
    assert.deepEqual(a.effects, b.effects);
  });

  it('returns a different match for a different seed', () => {
    const a = simulate(fixture('seed-1'));
    const b = simulate(fixture('seed-2'));
    assert.notDeepEqual(a.events, b.events);
  });

  it('re-simulating the same fixture object does not drift', () => {
    // Catches state leaking out of the engine into the squads it was handed.
    const shared = fixture('seed-3');
    const first = simulate(shared);
    const second = simulate(shared);
    assert.deepEqual(first.score, second.score);
  });

  it('leaves the squads it was handed untouched', () => {
    const shared = fixture('seed-4');
    const keeper = shared.home.lineup.keeper;
    const staminaBefore = keeper.stamina;
    const formBefore = keeper.form;
    simulate(shared);
    assert.equal(keeper.stamina, staminaBefore);
    assert.equal(keeper.form, formBefore);
  });

  it('pins the rules version it was played under', () => {
    const result = simulate(fixture('seed-5'));
    assert.equal(result.rulesVersion, DEFAULT_RULES.version);
    assert.equal(result.seed, 'seed-5');
  });

  it('never calls Math.random', () => {
    const original = Math.random;
    Math.random = () => {
      throw new Error('the engine must not touch Math.random');
    };
    try {
      simulate(fixture('seed-6'));
    } finally {
      Math.random = original;
    }
  });
});

describe('rules versions', () => {
  it('keeps every registered version replayable', () => {
    // The invariant a published match depends on: pinning a version means the
    // result never moves, however much the sport is retuned afterwards.
    for (const version of Object.keys(RULE_SETS)) {
      const rules = rulesByVersion(version);
      const a = simulate(fixture('version-seed'), { rules });
      const b = simulate(fixture('version-seed'), { rules });
      assert.deepEqual(a.score, b.score);
      assert.equal(a.rulesVersion, version);
    }
  });

  it('changes the sport it is measuring', () => {
    // A single seed is too weak here: most dial changes only flip an outcome when
    // a random draw lands inside the gap they moved, so two versions can produce
    // an identical log by chance. Assert the aggregate effect instead -- v2 cut
    // how hard a seeker-focused beater pair suppresses the hunt, so v2 should see
    // more snitches caught.
    const catchesUnder = (version: string): number => {
      const rules = rulesByVersion(version);
      let catches = 0;
      const matches = 150;
      for (let index = 0; index < matches; index++) {
        const result = simulate(fixture(`rules-${index}`), { rules });
        catches += result.catches.home + result.catches.away;
      }
      return catches / matches;
    };

    const v1 = catchesUnder('v1');
    const v2 = catchesUnder('v2');
    assert.ok(
      v2 > v1,
      `v2 relaxed seeker suppression, so it should catch more snitches: v1 ${v1.toFixed(2)}, v2 ${v2.toFixed(2)}`,
    );
  });

  it('produces different logs across a batch of seeds', () => {
    let diverged = 0;
    for (let index = 0; index < 40; index++) {
      const v1 = simulate(fixture(`batch-${index}`), { rules: rulesByVersion('v1') });
      const v2 = simulate(fixture(`batch-${index}`), { rules: rulesByVersion('v2') });
      if (JSON.stringify(v1.events) !== JSON.stringify(v2.events)) diverged += 1;
    }
    assert.ok(diverged > 10, `only ${diverged} of 40 seeds diverged between v1 and v2`);
  });
});

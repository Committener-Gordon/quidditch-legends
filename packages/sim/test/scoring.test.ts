import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULT_RULES, createRng, generateClub, simulate, type MatchResult } from '../src/index.js';

function play(seed: string, homeRating = 68, awayRating = 64): MatchResult {
  return simulate({
    home: generateClub(createRng(`${seed}-h`), {
      clubId: 'h',
      name: 'Home',
      short: 'HOM',
      rating: homeRating,
    }),
    away: generateClub(createRng(`${seed}-a`), {
      clubId: 'a',
      name: 'Away',
      short: 'AWY',
      rating: awayRating,
    }),
    seed,
  });
}

const rules = DEFAULT_RULES;

describe('scoring', () => {
  it('accounts for every point as goals or snitch catches', () => {
    for (let index = 0; index < 40; index++) {
      const result = play(`score-${index}`);
      for (const side of ['home', 'away'] as const) {
        assert.equal(
          result.score[side],
          result.goals[side] * rules.goalPoints + result.catches[side] * rules.snitchPoints,
          `side ${side} of match ${index} has points that are not goals plus catches`,
        );
      }
    }
  });

  it('agrees with its own event log', () => {
    const result = play('events-1');
    const goals = { home: 0, away: 0 };
    const catches = { home: 0, away: 0 };
    for (const event of result.events) {
      if (event.type === 'GOAL') goals[event.side] += 1;
      else if (event.type === 'SNITCH_CAUGHT') catches[event.side] += 1;
    }
    assert.deepEqual(goals, result.goals);
    assert.deepEqual(catches, result.catches);
  });

  it('agrees with its own stat lines', () => {
    const result = play('stats-1');
    for (const side of ['home', 'away'] as const) {
      const lines = result.stats.filter((line) => line.side === side);
      const goals = lines.reduce((sum, line) => sum + line.goals, 0);
      const catches = lines.reduce((sum, line) => sum + line.snitchCatches, 0);
      assert.equal(goals, result.goals[side]);
      assert.equal(catches, result.catches[side]);
    }
  });

  it('runs the full clock regardless of when the snitch is caught', () => {
    for (let index = 0; index < 20; index++) {
      const result = play(`clock-${index}`);
      assert.equal(result.minutes, rules.matchMinutes);
      const fullTime = result.events.at(-1);
      assert.equal(fullTime?.type, 'FULL_TIME');
      assert.equal(fullTime?.minute, rules.matchMinutes);
    }
  });

  it('releases a fresh snitch after every catch', () => {
    for (let index = 0; index < 20; index++) {
      const result = play(`respawn-${index}`);
      const released = result.events.filter((event) => event.type === 'SNITCH_RELEASED').length;
      const caught = result.catches.home + result.catches.away;
      assert.equal(
        released,
        caught + 1,
        'one snitch at kickoff plus one for each that was caught',
      );
    }
  });

  it('keeps minutes and substitutions inside the rules', () => {
    const result = play('limits-1');
    for (const side of ['home', 'away'] as const) {
      const subs = result.events.filter(
        (event) => event.type === 'SUBSTITUTION' && event.side === side,
      ).length;
      assert.ok(subs <= rules.substitutionsAllowed, `${side} used ${subs} substitutions`);
    }
    for (const line of result.stats) {
      assert.ok(line.minutes >= 0 && line.minutes <= rules.matchMinutes);
      assert.ok(line.rating >= 1 && line.rating <= 10);
      assert.ok(line.staminaEnd >= 0 && line.staminaEnd <= 100);
    }
  });
});

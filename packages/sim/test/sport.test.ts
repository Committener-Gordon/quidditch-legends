import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_RULES,
  POSITION_WEIGHTS,
  autoLineup,
  baseRating,
  createRng,
  expectations,
  generateAttributes,
  generateClub,
  generatePlayer,
  generateRoster,
  simulate,
  type Position,
} from '../src/index.js';

const rules = DEFAULT_RULES;

describe('ratings', () => {
  it('weights every position to exactly 1', () => {
    for (const position of Object.keys(POSITION_WEIGHTS) as Position[]) {
      const total = Object.values(POSITION_WEIGHTS[position]).reduce(
        (sum, weight) => sum + (weight ?? 0),
        0,
      );
      assert.ok(Math.abs(total - 1) < 1e-9, `${position} weights sum to ${total}, not 1`);
    }
  });

  it('gives every attribute weight somewhere', () => {
    const used = new Set<string>();
    for (const weights of Object.values(POSITION_WEIGHTS)) {
      for (const attribute of Object.keys(weights)) used.add(attribute);
    }
    for (const attribute of [
      'flying',
      'handling',
      'aim',
      'strength',
      'vision',
      'reflexes',
      'nerve',
    ]) {
      assert.ok(used.has(attribute), `${attribute} is read by no position`);
    }
  });

  it('generates attributes that land on the rating asked for', () => {
    const rng = createRng('attrs');
    for (const position of ['chaser', 'beater', 'keeper', 'seeker'] as Position[]) {
      for (const target of [45, 60, 75, 88]) {
        const attributes = generateAttributes(rng, position, target);
        const player = { position, attributes } as Parameters<typeof baseRating>[0];
        const actual = baseRating(player, position, rules);
        assert.ok(
          Math.abs(actual - target) <= 1.5,
          `${position} at target ${target} generated ${actual.toFixed(1)}`,
        );
      }
    }
  });

  it('generates whole numbers for every stored field', () => {
    // These land in smallint columns, so a fractional value is a runtime failure
    // at insert time rather than a rounding curiosity.
    const rng = createRng('integers');
    for (let index = 0; index < 300; index++) {
      const player = generatePlayer(rng, {
        id: `p${index}`,
        position: (['chaser', 'beater', 'keeper', 'seeker'] as Position[])[index % 4]!,
        rating: 40 + (index % 50) + 0.5,
      });
      for (const [field, value] of Object.entries({
        age: player.age,
        stamina: player.stamina,
        form: player.form,
        morale: player.morale,
        potential: player.potential,
        ...player.attributes,
      })) {
        assert.ok(Number.isInteger(value), `${field} was ${value}`);
      }
    }
  });

  it('penalises playing out of position', () => {
    const player = generatePlayer(createRng('oop'), { id: 'p1', position: 'seeker', rating: 70 });
    assert.ok(baseRating(player, 'keeper', rules) < baseRating(player, 'seeker', rules));
  });
});

describe('lineups', () => {
  it('fields three chasers, two beaters, a keeper and a seeker', () => {
    const roster = generateRoster(createRng('lineup'), {
      clubId: 'c',
      name: 'Club',
      short: 'CLB',
      rating: 65,
    });
    const { lineup, bench } = autoLineup(roster, rules);
    assert.equal(lineup.chasers.length, 3);
    assert.equal(lineup.beaters.length, 2);
    assert.equal(lineup.keeper.position, 'keeper');
    assert.equal(lineup.seeker.position, 'seeker');
    assert.equal(bench.length, roster.length - 7);
  });

  it('refuses to field fewer than seven players', () => {
    const roster = generateRoster(createRng('short'), {
      clubId: 'c',
      name: 'Club',
      short: 'CLB',
      rating: 65,
    }).slice(0, 6);
    assert.throws(() => autoLineup(roster, rules));
  });
});

describe('the sport behaves like a sport', () => {
  function catchesOverSeason(seekerRating: number, seed: string): number {
    let catches = 0;
    const matches = 60;
    for (let index = 0; index < matches; index++) {
      // Identical squads apart from the seeker, so only the hunt differs.
      const home = generateClub(createRng(`${seed}-h${index}`), {
        clubId: 'h',
        name: 'Home',
        short: 'HOM',
        rating: 65,
      });
      const away = generateClub(createRng(`${seed}-a${index}`), {
        clubId: 'a',
        name: 'Away',
        short: 'AWY',
        rating: 65,
      });
      home.lineup.seeker = generatePlayer(createRng(`${seed}-s${index}`), {
        id: 'star',
        position: 'seeker',
        rating: seekerRating,
      });
      catches += simulate({ home, away, seed: `${seed}-m${index}` }).catches.home;
    }
    return catches / matches;
  }

  it('rewards a better seeker with more catches', () => {
    const weak = catchesOverSeason(50, 'weak');
    const strong = catchesOverSeason(88, 'strong');
    assert.ok(
      strong > weak * 1.25,
      `an 88-rated seeker took ${strong.toFixed(2)} catches a match against ${weak.toFixed(2)} for a 50-rated one`,
    );
  });

  it('produces scores in the range the dials predict', () => {
    const predicted = expectations(rules);
    let points = 0;
    let catches = 0;
    const matches = 120;
    for (let index = 0; index < matches; index++) {
      const result = simulate({
        home: generateClub(createRng(`bh${index}`), {
          clubId: 'h',
          name: 'Home',
          short: 'HOM',
          rating: 65,
        }),
        away: generateClub(createRng(`ba${index}`), {
          clubId: 'a',
          name: 'Away',
          short: 'AWY',
          rating: 65,
        }),
        seed: `bal-${index}`,
      });
      points += result.score.home + result.score.away;
      catches += result.catches.home + result.catches.away;
    }
    const pointsPerTeam = points / (matches * 2);
    const catchesPerMatch = catches / matches;

    // Wide bands: this is a smoke test, the harness is where balance is judged.
    assert.ok(
      Math.abs(pointsPerTeam - predicted.pointsPerTeam) < 40,
      `points per team ${pointsPerTeam.toFixed(1)} vs predicted ${predicted.pointsPerTeam.toFixed(1)}`,
    );
    assert.ok(
      Math.abs(catchesPerMatch - predicted.catchesPerMatch) < 1.2,
      `catches per match ${catchesPerMatch.toFixed(2)} vs predicted ${predicted.catchesPerMatch.toFixed(2)}`,
    );
  });

  it('lets the home side score more often than the away side', () => {
    let homeWins = 0;
    let awayWins = 0;
    for (let index = 0; index < 200; index++) {
      const result = simulate({
        home: generateClub(createRng(`hh${index}`), {
          clubId: 'h',
          name: 'Home',
          short: 'HOM',
          rating: 65,
        }),
        away: generateClub(createRng(`ha${index}`), {
          clubId: 'a',
          name: 'Away',
          short: 'AWY',
          rating: 65,
        }),
        seed: `home-${index}`,
      });
      if (result.score.home > result.score.away) homeWins += 1;
      else if (result.score.away > result.score.home) awayWins += 1;
    }
    assert.ok(homeWins > awayWins, `home ${homeWins}, away ${awayWins}`);
  });
});

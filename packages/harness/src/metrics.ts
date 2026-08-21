/**
 * Run a lot of matches, then answer the only question that matters in phase one:
 * is this a sport worth managing?
 *
 * Four numbers decide it. Favourite win rate says squad-building pays without
 * killing upsets. Snitch share says the seeker is the star and not the whole
 * team. Catches per match says the respawn cadence is right. Draw rate says the
 * clock is not producing too many nothing results.
 */

import {
  DEFAULT_RULES,
  createRng,
  expectations,
  simulate,
  type Archetype,
  type MatchResult,
  type RuleSet,
  type Squad,
  type Tactics,
} from '@ql/sim';
import { makeClub, ratingForClub, strengthOf } from './world.js';

export interface BalanceOptions {
  matches: number;
  seed: string;
  rules?: RuleSet;
  /** Size of the club pool matches are drawn from. */
  clubs?: number;
  archetypes?: Archetype[];
  tactics?: Partial<Tactics>;
}

export interface GapBucket {
  label: string;
  min: number;
  max: number;
  matches: number;
  favouriteWins: number;
  draws: number;
}

export interface BalanceReport {
  matches: number;
  rulesVersion: string;
  pointsPerTeam: number;
  quafflePointsPerTeam: number;
  snitchPointsPerTeam: number;
  snitchShare: number;
  goalsPerTeam: number;
  shotsPerTeam: number;
  savesPerKeeper: number;
  catchesPerMatch: number;
  catchesSpread: number[];
  drawRate: number;
  homeWinRate: number;
  favouriteWinRate: number;
  favouriteMatches: number;
  /** Share of matches where the side that won the quaffle exchange lost the match. */
  snitchOverturnRate: number;
  injuriesPerMatch: number;
  substitutionsPerMatch: number;
  meanEndStamina: number;
  eventsPerMatch: number;
  gapBuckets: GapBucket[];
  samples: {
    teamPoints: number[];
    margins: number[];
    goalsPerTeam: number[];
    catchesPerMatch: number[];
  };
}

const GAP_EDGES: [string, number, number][] = [
  ['0-2', 0, 2],
  ['2-5', 2, 5],
  ['5-10', 5, 10],
  ['10+', 10, Infinity],
];

export function runBalance(options: BalanceOptions): BalanceReport {
  const rules = options.rules ?? DEFAULT_RULES;
  const rng = createRng(`${options.seed}::pool`);
  const clubCount = options.clubs ?? 48;
  const archetypes = options.archetypes ?? ['balanced'];

  const pool: { squad: Squad; strength: number }[] = [];
  for (let index = 0; index < clubCount; index++) {
    const squad = makeClub({
      seed: `${options.seed}::club${index}`,
      index,
      rating: ratingForClub(rng),
      archetype: archetypes[index % archetypes.length]!,
      tactics: options.tactics,
      rules,
    });
    pool.push({ squad, strength: strengthOf(squad, rules) });
  }

  let points = 0;
  let quafflePoints = 0;
  let snitchPoints = 0;
  let goals = 0;
  let shots = 0;
  let saves = 0;
  let catches = 0;
  let draws = 0;
  let homeWins = 0;
  let favouriteMatches = 0;
  let favouriteWins = 0;
  let overturned = 0;
  let injuries = 0;
  let substitutions = 0;
  let events = 0;
  let staminaTotal = 0;
  let staminaCount = 0;

  const catchesSpread: number[] = [];
  const samples: BalanceReport['samples'] = {
    teamPoints: [],
    margins: [],
    goalsPerTeam: [],
    catchesPerMatch: [],
  };
  const gapBuckets: GapBucket[] = GAP_EDGES.map(([label, min, max]) => ({
    label,
    min,
    max,
    matches: 0,
    favouriteWins: 0,
    draws: 0,
  }));

  for (let index = 0; index < options.matches; index++) {
    const homeIndex = rng.int(pool.length);
    let awayIndex = rng.int(pool.length);
    if (awayIndex === homeIndex) awayIndex = (awayIndex + 1) % pool.length;
    const home = pool[homeIndex]!;
    const away = pool[awayIndex]!;

    const result = simulate(
      { home: home.squad, away: away.squad, seed: `${options.seed}::m${index}` },
      { rules },
    );

    accumulate(result);

    function accumulate(match: MatchResult): void {
      const homePoints = match.score.home;
      const awayPoints = match.score.away;
      points += homePoints + awayPoints;
      goals += match.goals.home + match.goals.away;
      shots += match.shots.home + match.shots.away;
      quafflePoints += (match.goals.home + match.goals.away) * rules.goalPoints;
      snitchPoints += (match.catches.home + match.catches.away) * rules.snitchPoints;
      const matchCatches = match.catches.home + match.catches.away;
      catches += matchCatches;
      events += match.events.length;

      while (catchesSpread.length <= matchCatches) catchesSpread.push(0);
      catchesSpread[matchCatches] = (catchesSpread[matchCatches] ?? 0) + 1;

      for (const line of match.stats) {
        saves += line.saves;
        if (line.minutes > 0) {
          staminaTotal += line.staminaEnd;
          staminaCount += 1;
        }
      }
      for (const event of match.events) {
        if (event.type === 'INJURY') injuries += 1;
        else if (event.type === 'SUBSTITUTION') substitutions += 1;
      }

      const drawn = homePoints === awayPoints;
      if (drawn) draws += 1;
      else if (homePoints > awayPoints) homeWins += 1;

      // Did the snitch flip the result the quaffle game had earned?
      const quaffleMargin = match.goals.home - match.goals.away;
      const margin = homePoints - awayPoints;
      if (quaffleMargin !== 0 && Math.sign(margin) !== Math.sign(quaffleMargin)) overturned += 1;

      const gap = home.strength - away.strength;
      const absoluteGap = Math.abs(gap);
      if (absoluteGap >= 0.5) {
        favouriteMatches += 1;
        const favouriteWon = gap > 0 ? margin > 0 : margin < 0;
        if (favouriteWon) favouriteWins += 1;

        const bucket = gapBuckets.find((b) => absoluteGap >= b.min && absoluteGap < b.max);
        if (bucket) {
          bucket.matches += 1;
          if (favouriteWon) bucket.favouriteWins += 1;
          if (drawn) bucket.draws += 1;
        }
      }

      // Sampled so the histograms stay cheap on very large runs.
      if (samples.teamPoints.length < 60000) {
        samples.teamPoints.push(homePoints, awayPoints);
        samples.margins.push(margin);
        samples.goalsPerTeam.push(match.goals.home, match.goals.away);
        samples.catchesPerMatch.push(matchCatches);
      }
    }
  }

  const teams = options.matches * 2;
  return {
    matches: options.matches,
    rulesVersion: rules.version,
    pointsPerTeam: points / teams,
    quafflePointsPerTeam: quafflePoints / teams,
    snitchPointsPerTeam: snitchPoints / teams,
    snitchShare: snitchPoints / Math.max(1, points),
    goalsPerTeam: goals / teams,
    shotsPerTeam: shots / teams,
    savesPerKeeper: saves / teams,
    catchesPerMatch: catches / options.matches,
    catchesSpread,
    drawRate: draws / options.matches,
    homeWinRate: homeWins / options.matches,
    favouriteWinRate: favouriteWins / Math.max(1, favouriteMatches),
    favouriteMatches,
    snitchOverturnRate: overturned / options.matches,
    injuriesPerMatch: injuries / options.matches,
    substitutionsPerMatch: substitutions / options.matches,
    meanEndStamina: staminaTotal / Math.max(1, staminaCount),
    eventsPerMatch: events / options.matches,
    gapBuckets,
    samples,
  };
}

export interface Contender {
  label: string;
  archetype?: Archetype;
  tactics?: Partial<Tactics>;
}

export interface MatrixReport {
  contenders: string[];
  /** Points won by row against column, as a share of matches played. */
  winShare: number[][];
  matchesPerPair: number;
  /** Mean snitch catches per match for the row's side, by cell. */
  catchesFor: number[][];
}

/**
 * Round robin between whatever you want to compare, at equal squad rating.
 *
 * Used two ways. With archetypes, it asks whether a squad shape is a shortcut.
 * With tactics, it asks whether a tactical setting is simply correct -- which is
 * the question a season of AI clubs answers loudly, and the harness has to answer
 * first.
 */
export function runContenderMatrix(options: {
  contenders: Contender[];
  matchesPerPair: number;
  seed: string;
  rules?: RuleSet;
  rating?: number;
}): MatrixReport {
  const rules = options.rules ?? DEFAULT_RULES;
  const rating = options.rating ?? 65;
  const size = options.contenders.length;
  const winShare: number[][] = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  const catchesFor: number[][] = Array.from({ length: size }, () => new Array<number>(size).fill(0));

  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      const rowSide = options.contenders[row]!;
      const columnSide = options.contenders[column]!;
      let score = 0;
      let catches = 0;

      for (let match = 0; match < options.matchesPerPair; match++) {
        // Alternate home and away so the home nudge cancels out. A fresh squad
        // per match: reusing a handful leaves generation noise big enough to look
        // like a real edge.
        const rowAtHome = match % 2 === 0;
        const rowSquad = makeClub({
          seed: `${options.seed}::${row}-${column}-r${match}`,
          index: row,
          rating,
          archetype: rowSide.archetype ?? 'balanced',
          ...(rowSide.tactics ? { tactics: rowSide.tactics } : {}),
          rules,
        });
        const columnSquad = makeClub({
          seed: `${options.seed}::${row}-${column}-c${match}`,
          index: column + 6,
          rating,
          archetype: columnSide.archetype ?? 'balanced',
          ...(columnSide.tactics ? { tactics: columnSide.tactics } : {}),
          rules,
        });

        const result = simulate(
          {
            home: rowAtHome ? rowSquad : columnSquad,
            away: rowAtHome ? columnSquad : rowSquad,
            seed: `${options.seed}::m${row}-${column}-${match}`,
          },
          { rules },
        );

        const rowPoints = rowAtHome ? result.score.home : result.score.away;
        const columnPoints = rowAtHome ? result.score.away : result.score.home;
        score += rowPoints > columnPoints ? 1 : rowPoints === columnPoints ? 0.5 : 0;
        catches += rowAtHome ? result.catches.home : result.catches.away;
      }

      winShare[row]![column] = score / options.matchesPerPair;
      catchesFor[row]![column] = catches / options.matchesPerPair;
    }
  }

  return {
    contenders: options.contenders.map((contender) => contender.label),
    winShare,
    catchesFor,
    matchesPerPair: options.matchesPerPair,
  };
}

/** Every option of one tactical dimension, against every other. */
export function tacticsContenders(dimension: keyof Tactics): Contender[] {
  const options: Record<string, unknown[]> = {
    aggression: ['defensive', 'balanced', 'attacking'],
    seekerCommitment: ['hunt', 'balanced', 'support'],
    beaterFocus: ['seeker', 'chasers', 'protect'],
    chaseTheGame: [true, false],
  };
  const values = options[dimension] ?? [];
  return values.map((value) => ({
    label: String(value),
    tactics: { [dimension]: value } as Partial<Tactics>,
  }));
}

export function predicted(rules: RuleSet = DEFAULT_RULES) {
  return expectations(rules);
}

#!/usr/bin/env node
/**
 * The balance harness.
 *
 *   npm run match     -- simulate one match and print the report
 *   npm run balance   -- run many matches and check the sport against its targets
 *   npm run matrix    -- archetype round robin: is any squad shape dominant?
 *   npm run dials     -- print the active rule set and what it predicts
 */

import {
  DEFAULT_RULES,
  createRng,
  expectations,
  renderMatchReport,
  rulesByVersion,
  simulate,
  type Archetype,
  type RuleSet,
} from '@ql/sim';
import { runBalance, runContenderMatrix, tacticsContenders, type MatrixReport } from './metrics.js';
import { makeClub, ratingForClub, strengthOf } from './world.js';
import { heading, histogram, pct, renderChecks, table, type Check } from './format.js';

type Args = { command: string; flags: Record<string, string>; bools: Set<string> };

function parseArgs(argv: string[]): Args {
  const [command = 'balance', ...rest] = argv;
  const flags: Record<string, string> = {};
  const bools = new Set<string>();
  for (let index = 0; index < rest.length; index++) {
    const token = rest[index]!;
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = rest[index + 1];
    if (next && !next.startsWith('--')) {
      flags[key] = next;
      index += 1;
    } else {
      bools.add(key);
    }
  }
  return { command, flags, bools };
}

const ARCHETYPES: Archetype[] = [
  'balanced',
  'chaserHeavy',
  'beaterHeavy',
  'keeperHeavy',
  'seekerHeavy',
];

function rulesFrom(args: Args): RuleSet {
  return args.flags.rules ? rulesByVersion(args.flags.rules) : DEFAULT_RULES;
}

function commandMatch(args: Args): void {
  const rules = rulesFrom(args);
  const seed = args.flags.seed ?? 'demo-1';
  const homeRating = Number(args.flags.home ?? 70);
  const awayRating = Number(args.flags.away ?? 66);
  const homeArchetype = (args.flags.homeArchetype ?? 'balanced') as Archetype;
  const awayArchetype = (args.flags.awayArchetype ?? 'balanced') as Archetype;

  const home = makeClub({ seed: `${seed}::home`, index: 0, rating: homeRating, archetype: homeArchetype, rules });
  const away = makeClub({ seed: `${seed}::away`, index: 1, rating: awayRating, archetype: awayArchetype, rules });

  const result = simulate({ home, away, seed }, { rules });

  console.log(renderMatchReport(result, { texture: !args.bools.has('quiet') }));
  console.log(
    `\nseed ${result.seed}  rules ${result.rulesVersion}  ` +
      `strength ${strengthOf(home, rules).toFixed(1)} v ${strengthOf(away, rules).toFixed(1)}  ` +
      `events ${result.events.length}`,
  );
}

function commandBalance(args: Args): void {
  const rules = rulesFrom(args);
  const matches = Number(args.flags.n ?? 20000);
  const seed = args.flags.seed ?? 'balance-1';
  const archetypes = args.bools.has('mixed') ? ARCHETYPES : (['balanced'] as Archetype[]);

  const started = process.hrtime.bigint();
  const report = runBalance({ matches, seed, rules, archetypes });
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

  const predicted = expectations(rules);

  console.log(heading(`Balance report -- rules ${report.rulesVersion}, ${matches.toLocaleString()} matches`));
  console.log(
    `  ${(elapsedMs / matches).toFixed(3)} ms per match, ${(elapsedMs / 1000).toFixed(1)}s total, ` +
      `${report.eventsPerMatch.toFixed(0)} events per match`,
  );

  console.log(heading('Targets'));
  const bucket = (label: string) => report.gapBuckets.find((b) => b.label === label);
  const bucketRate = (label: string) => {
    const found = bucket(label);
    return found && found.matches > 0 ? found.favouriteWins / found.matches : 0;
  };

  const checks: Check[] = [
    { name: 'snitch share of points', value: report.snitchShare, target: [0.25, 0.32], format: pct },
    { name: 'catches per match', value: report.catchesPerMatch, target: [3.5, 4.5] },
    { name: 'draw rate', value: report.drawRate, target: [0, 0.06], format: pct },
    { name: 'goals per team', value: report.goalsPerTeam, target: [13, 17] },
    { name: 'points per team', value: report.pointsPerTeam, target: [190, 230] },
    {
      name: 'snitch flips the quaffle result',
      value: report.snitchOverturnRate,
      target: [0.12, 0.25],
      format: pct,
      note: 'the drama dial',
    },
    {
      name: 'favourite wins, gap 0-2',
      value: bucketRate('0-2'),
      target: [0.5, 0.57],
      format: pct,
      note: `${bucket('0-2')?.matches.toLocaleString() ?? 0} matches`,
    },
    {
      name: 'favourite wins, gap 2-5',
      value: bucketRate('2-5'),
      target: [0.54, 0.63],
      format: pct,
      note: `${bucket('2-5')?.matches.toLocaleString() ?? 0} matches`,
    },
    {
      name: 'favourite wins, gap 5-10',
      value: bucketRate('5-10'),
      target: [0.62, 0.72],
      format: pct,
      note: `${bucket('5-10')?.matches.toLocaleString() ?? 0} matches`,
    },
    {
      name: 'favourite wins, gap 10+',
      value: bucketRate('10+'),
      target: [0.75, 0.88],
      format: pct,
      note: `${bucket('10+')?.matches.toLocaleString() ?? 0} matches`,
    },
    {
      name: 'favourite wins, pooled',
      value: report.favouriteWinRate,
      target: [0.62, 0.72],
      format: pct,
      note: 'depends on how wide the club pool is -- read the curve above instead',
    },
  ];
  console.log(renderChecks(checks));

  console.log(heading('Predicted vs simulated'));
  console.log(
    table(
      ['quantity', 'predicted', 'simulated'],
      [
        ['shots per team', predicted.shotsPerTeam.toFixed(1), report.shotsPerTeam.toFixed(1)],
        ['goals per team', predicted.goalsPerTeam.toFixed(1), report.goalsPerTeam.toFixed(1)],
        ['saves per keeper', predicted.savesPerKeeper.toFixed(1), report.savesPerKeeper.toFixed(1)],
        ['quaffle points per team', predicted.quafflePointsPerTeam.toFixed(1), report.quafflePointsPerTeam.toFixed(1)],
        ['catches per match', predicted.catchesPerMatch.toFixed(2), report.catchesPerMatch.toFixed(2)],
        ['snitch points per team', predicted.snitchPointsPerTeam.toFixed(1), report.snitchPointsPerTeam.toFixed(1)],
        ['points per team', predicted.pointsPerTeam.toFixed(1), report.pointsPerTeam.toFixed(1)],
        ['snitch share', pct(predicted.snitchShare), pct(report.snitchShare)],
      ],
      ['l', 'r', 'r'],
    ),
  );

  console.log(heading('Match texture'));
  console.log(
    table(
      ['metric', 'value'],
      [
        ['home win rate', pct(report.homeWinRate)],
        ['snitch overturned the quaffle result', pct(report.snitchOverturnRate)],
        ['injuries per match', report.injuriesPerMatch.toFixed(2)],
        ['substitutions per match', report.substitutionsPerMatch.toFixed(2)],
        ['mean stamina at full time', report.meanEndStamina.toFixed(1)],
      ],
      ['l', 'r'],
    ),
  );

  console.log(heading('Favourite win rate by rating gap'));
  console.log(
    table(
      ['gap', 'matches', 'favourite wins', 'draws'],
      report.gapBuckets.map((bucket) => [
        bucket.label,
        bucket.matches.toLocaleString(),
        bucket.matches > 0 ? pct(bucket.favouriteWins / bucket.matches) : '-',
        bucket.matches > 0 ? pct(bucket.draws / bucket.matches) : '-',
      ]),
      ['l', 'r', 'r', 'r'],
    ),
  );

  console.log(heading('Distributions'));
  console.log(histogram(report.samples.teamPoints, { label: 'points scored by a team' }));
  console.log('');
  console.log(histogram(report.samples.margins, { label: 'winning margin (home - away)' }));
  console.log('');
  console.log(
    table(
      ['catches', 'matches', 'share'],
      report.catchesSpread.map((count, catches) => [
        String(catches),
        count.toLocaleString(),
        pct(count / report.matches),
      ]),
      ['r', 'r', 'r'],
    ),
  );
}

function renderMatrix(report: MatrixReport, title: string, note: string): void {
  console.log(heading(title));
  console.log(`  ${note}`);
  console.log('');

  const rows = report.contenders.map((label, row) => [
    label,
    ...report.contenders.map((_, column) => pct(report.winShare[row]![column]!)),
    pct(report.winShare[row]!.reduce((sum, value) => sum + value, 0) / report.contenders.length),
    (
      report.catchesFor[row]!.reduce((sum, value) => sum + value, 0) / report.contenders.length
    ).toFixed(2),
  ]);

  console.log(
    table(
      ['option', ...report.contenders, 'mean', 'snch/mt'],
      rows,
      ['l', ...report.contenders.map(() => 'r' as const), 'r', 'r'],
    ),
  );

  // Every diagonal cell is an option against itself, so it should read 50%.
  // How far off it lands is this run's noise floor -- read no edge smaller.
  const diagonal = report.contenders.map((_, index) => report.winShare[index]![index]!);
  const worst = Math.max(...diagonal.map((value) => Math.abs(value - 0.5)));
  console.log(
    `\n  noise floor: diagonal (option vs itself) spans ` +
      `${pct(Math.min(...diagonal))}-${pct(Math.max(...diagonal))}, so +/-${pct(worst)}.` +
      `\n  treat any edge smaller than that as sampling noise, not balance.`,
  );
}

function commandMatrix(args: Args): void {
  const rules = rulesFrom(args);
  const matchesPerPair = Number(args.flags.n ?? 1500);
  const report = runContenderMatrix({
    contenders: ARCHETYPES.map((archetype) => ({ label: archetype.replace('Heavy', '+'), archetype })),
    matchesPerPair,
    seed: args.flags.seed ?? 'matrix-1',
    rules,
    rating: Number(args.flags.rating ?? 65),
  });
  renderMatrix(
    report,
    `Archetype matrix -- ${matchesPerPair.toLocaleString()} matches per pair, equal squad rating`,
    'row win share against column (draws count a half). 50% is balance.',
  );
}

function commandTactics(args: Args): void {
  const rules = rulesFrom(args);
  const matchesPerPair = Number(args.flags.n ?? 1500);
  const dimensions = args.flags.dimension
    ? [args.flags.dimension as 'aggression' | 'seekerCommitment' | 'beaterFocus' | 'chaseTheGame']
    : (['aggression', 'seekerCommitment', 'beaterFocus'] as const);

  for (const dimension of dimensions) {
    const report = runContenderMatrix({
      contenders: tacticsContenders(dimension),
      matchesPerPair,
      seed: `${args.flags.seed ?? 'tactics-1'}::${dimension}`,
      rules,
      rating: Number(args.flags.rating ?? 65),
    });
    renderMatrix(
      report,
      `${dimension} -- ${matchesPerPair.toLocaleString()} matches per pair, identical squads`,
      'a setting that beats the others is not a decision, it is the answer. 50% is balance.',
    );
  }
}

function commandDials(args: Args): void {
  const rules = rulesFrom(args);
  const predicted = expectations(rules);
  console.log(heading(`Rule set ${rules.version}`));
  console.log(JSON.stringify(rules, null, 2));
  console.log(heading('What these dials predict'));
  console.log(JSON.stringify(predicted, null, 2));
}

function commandSample(args: Args): void {
  // A quick smell test: a handful of scorelines, one line each.
  const rules = rulesFrom(args);
  const count = Number(args.flags.n ?? 12);
  const rng = createRng(args.flags.seed ?? 'sample-1');
  const rows: string[][] = [];

  for (let index = 0; index < count; index++) {
    const home = makeClub({ seed: `s${index}h`, index, rating: ratingForClub(rng), rules });
    const away = makeClub({ seed: `s${index}a`, index: index + 6, rating: ratingForClub(rng), rules });
    const result = simulate({ home, away, seed: `sample-${index}` }, { rules });
    rows.push([
      `${result.home.short} v ${result.away.short}`,
      `${result.score.home}-${result.score.away}`,
      `${result.goals.home}-${result.goals.away}`,
      `${result.catches.home}-${result.catches.away}`,
      `${strengthOf(home, rules).toFixed(0)} v ${strengthOf(away, rules).toFixed(0)}`,
    ]);
  }

  console.log(heading(`${count} sample results`));
  console.log(table(['fixture', 'points', 'goals', 'snitches', 'strength'], rows, ['l', 'r', 'r', 'r', 'r']));
}

const args = parseArgs(process.argv.slice(2));
switch (args.command) {
  case 'match':
    commandMatch(args);
    break;
  case 'balance':
    commandBalance(args);
    break;
  case 'matrix':
    commandMatrix(args);
    break;
  case 'tactics':
    commandTactics(args);
    break;
  case 'dials':
    commandDials(args);
    break;
  case 'sample':
    commandSample(args);
    break;
  default:
    console.error(`Unknown command: ${args.command}\nTry: match | balance | matrix | tactics | sample | dials`);
    process.exit(1);
}

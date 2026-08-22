#!/usr/bin/env node
/**
 * The world's control panel.
 *
 *   world:new      build twelve AI clubs and their squads
 *   season:new     create a season, its division and its fixture list
 *   matchday       play one matchday (defaults to the next unplayed one)
 *   season:run     play every remaining matchday
 *   offseason      develop, retire and refill
 *   cycle          season:new + season:run + offseason, for N seasons
 *   table          the league table
 *   fixtures       the fixture list, played and unplayed
 *   leaders        leading scorers and seekers
 *   report         re-render a stored match from its event log
 *   status         where the world currently is
 *   world:reset    delete everything
 */

import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { DEFAULT_RULES, autoLineup, baseRating, renderMatchReport, rulesByVersion, squadStrength } from '@ql/sim';
import {
  balancesByClub,
  claimClub,
  clubs,
  currentSeason,
  divisionClubs,
  divisions,
  fixtures,
  loadFixtures,
  loadLeaders,
  loadMatchResult,
  loadTable,
  matchEvents,
  matches,
  players,
  playerMatchStats,
  seasons,
  facilityLevelsByClub,
  seasonByNumber,
  standings,
  users,
  topDivisionOf,
  type Database,
} from '@ql/db';
import { toSimPlayer } from '@ql/db';
import { parseInterval } from './calendar.js';
import { connect, recordJob } from './db.js';
import { createWorld } from './jobs/createWorld.js';
import { newSeason, reschedule } from './jobs/newSeason.js';
import { runMatchday, runSeason } from './jobs/matchday.js';
import { runOffseason, countActivePlayers } from './jobs/offseason.js';
import { recomputeStandings } from './jobs/standings.js';
import { repriceSquads } from './jobs/finance.js';
import { weeklyUpkeep } from '@ql/economy';

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2)
    : (sorted[middle] ?? 0);
}

type Args = { command: string; flags: Record<string, string>; bools: Set<string> };

function parseArgs(argv: string[]): Args {
  const [command = 'status', ...rest] = argv;
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
    } else bools.add(key);
  }
  return { command, flags, bools };
}

function heading(text: string): string {
  return `\n${text}\n${'-'.repeat(text.length)}`;
}

function table(headers: string[], rows: string[][], align: ('l' | 'r')[] = []): string {
  const widths = headers.map((head, index) =>
    Math.max(head.length, ...rows.map((row) => (row[index] ?? '').length)),
  );
  const line = (cells: string[]) =>
    '  ' +
    cells
      .map((cell, index) =>
        (align[index] ?? 'r') === 'l'
          ? cell.padEnd(widths[index] ?? 0)
          : cell.padStart(widths[index] ?? 0),
      )
      .join('  ');
  return [
    line(headers),
    '  ' + '-'.repeat(widths.reduce((sum, width) => sum + width + 2, 0) - 2),
    ...rows.map(line),
  ].join('\n');
}

/** The season the CLI acts on: --season, or the latest one. */
async function resolveSeason(db: Database, args: Args) {
  const season = args.flags.season
    ? await seasonByNumber(db, Number(args.flags.season))
    : await currentSeason(db);
  if (!season) throw new Error('no seasons yet -- run `season:new` first');
  return season;
}

async function nextUnplayedMatchday(db: Database, seasonId: string): Promise<number | null> {
  const [row] = await db
    .select({ matchday: fixtures.matchday })
    .from(fixtures)
    .where(and(eq(fixtures.seasonId, seasonId), sql`${fixtures.status} <> 'published'`))
    .orderBy(asc(fixtures.matchday))
    .limit(1);
  return row?.matchday ?? null;
}

/**
 * Squad strength as the engine would rate it: the best seven this roster can field.
 */
async function strengthByClub(db: Database, rulesVersion: string): Promise<Map<string, number>> {
  const rules = (() => {
    try {
      return rulesByVersion(rulesVersion);
    } catch {
      return DEFAULT_RULES;
    }
  })();

  const rows = await db
    .select()
    .from(players)
    .where(isNull(players.retiredInSeason));

  const byClub = new Map<string, ReturnType<typeof toSimPlayer>[]>();
  for (const row of rows) {
    if (!row.clubId) continue;
    const roster = byClub.get(row.clubId) ?? [];
    roster.push(toSimPlayer(row));
    byClub.set(row.clubId, roster);
  }

  const strengths = new Map<string, number>();
  for (const [clubId, roster] of byClub) {
    if (roster.length < 7) continue;
    const { lineup } = autoLineup(roster, rules);
    strengths.set(
      clubId,
      squadStrength(
        [
          ...lineup.chasers.map((player) => ({ player, position: 'chaser' as const })),
          ...lineup.beaters.map((player) => ({ player, position: 'beater' as const })),
          { player: lineup.keeper, position: 'keeper' as const },
          { player: lineup.seeker, position: 'seeker' as const },
        ],
        rules,
      ),
    );
  }
  return strengths;
}

/**
 * Spearman rank correlation between squad strength and where a club finished.
 *
 * This is the number that says whether the league works. At 1.0 the table is
 * simply the squad ratings and nothing else matters; at 0 the season is noise.
 * Somewhere around 0.7-0.9 is a sport: the best squad usually wins, not always.
 */
function rankCorrelation(ranksA: number[], ranksB: number[]): number {
  const n = ranksA.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let index = 0; index < n; index++) {
    const difference = (ranksA[index] ?? 0) - (ranksB[index] ?? 0);
    sum += difference * difference;
  }
  return 1 - (6 * sum) / (n * (n * n - 1));
}

async function printTable(db: Database, seasonNumber: number, divisionId: string): Promise<void> {
  const rows = await loadTable(db, divisionId);
  const [seasonRow] = await db.select().from(seasons).where(eq(seasons.number, seasonNumber));
  const strength = await strengthByClub(db, seasonRow?.rulesVersion ?? 'v2');

  console.log(heading(`Premier Division -- season ${seasonNumber}`));
  console.log(
    table(
      ['#', 'club', 'sqd', 'P', 'W', 'D', 'L', 'PF', 'PA', 'PD', 'goals', 'snch', 'pts'],
      rows.map((row, index) => [
        String(index + 1),
        row.name,
        (strength.get(row.clubId) ?? 0).toFixed(1),
        String(row.played),
        String(row.won),
        String(row.drawn),
        String(row.lost),
        String(row.pointsFor),
        String(row.pointsAgainst),
        (row.pointsFor - row.pointsAgainst > 0 ? '+' : '') + String(row.pointsFor - row.pointsAgainst),
        String(row.goalsFor),
        String(row.catchesFor),
        String(row.tablePoints),
      ]),
      ['r', 'l', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r'],
    ),
  );

  // Did the better squads actually finish higher?
  const strengths = strength;
  const ranked = rows
    .map((row, index) => ({ clubId: row.clubId, position: index + 1, strength: strengths.get(row.clubId) ?? 0 }))
    .filter((entry) => entry.strength > 0);

  if (ranked.length >= 3) {
    const byStrength = [...ranked].sort((left, right) => right.strength - left.strength);
    const strengthRank = new Map(byStrength.map((entry, index) => [entry.clubId, index + 1]));
    const rho = rankCorrelation(
      ranked.map((entry) => entry.position),
      ranked.map((entry) => strengthRank.get(entry.clubId) ?? 0),
    );
    console.log(
      `\n  squad strength vs. final position: rho ${rho.toFixed(2)}` +
        '  (1.0 = the table is just the ratings, 0 = the season was noise)',
    );
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const handle = await connect();
  const { db } = handle;

  try {
    switch (args.command) {
      case 'world:new': {
        const seed = args.flags.seed ?? 'world-1';
        const result = await recordJob(db, 'world:new', seed, async () => ({
          ...(await createWorld(db, { seed, season: 1 })),
        }));
        console.log(
          `built a world on ${handle.backend}: ${result.clubs} clubs, ${result.players} players (seed ${seed})`,
        );
        break;
      }

      case 'season:new': {
        const [latest] = await db.select().from(seasons).orderBy(desc(seasons.number)).limit(1);
        const number = args.flags.number ? Number(args.flags.number) : (latest?.number ?? 0) + 1;
        // Default to starting now. A hardcoded date meant every new world opened
        // with its first kickoff days away and nothing to do.
        const startsOn =
          args.flags.start && args.flags.start !== 'now' ? new Date(args.flags.start) : new Date();
        const interval = args.flags.interval ? parseInterval(args.flags.interval) : undefined;
        const deadline = args.flags.deadline ? parseInterval(args.flags.deadline) : undefined;

        const result = await recordJob(db, 'season:new', String(number), async () => ({
          ...(await newSeason(db, {
            number,
            startsOn,
            rulesVersion: args.flags.rules ?? 'v2',
            ...(interval !== undefined ? { intervalMinutes: interval } : {}),
            ...(deadline !== undefined ? { deadlineMinutes: deadline } : {}),
            pacing: args.flags.pacing === 'scheduled' ? 'scheduled' : 'manual',
          })),
        }));
        console.log(
          `season ${result.number}: ${result.clubs} clubs, ${result.matchdays} matchdays, ` +
            `${result.fixtures} fixtures\n` +
            `  first kickoff ${String(result.firstKickoff).slice(0, 16).replace('T', ' ')} UTC, ` +
            `last ${String(result.lastKickoff).slice(0, 16).replace('T', ' ')} UTC\n` +
            (args.flags.pacing === 'scheduled'
              ? `  scheduled: the scheduler plays each matchday at its kickoff, lineups lock ${result.deadlineMinutes} min before`
              : '  manual: you start each matchday yourself, and lineups stay open until you do'),
        );
        break;
      }

      case 'reschedule': {
        // Move the unplayed part of a season onto a faster clock.
        const season = await resolveSeason(db, args);
        const interval = parseInterval(args.flags.interval ?? '5m');
        const from = args.flags.start && args.flags.start !== 'now' ? new Date(args.flags.start) : new Date();
        const deadline = args.flags.deadline ? parseInterval(args.flags.deadline) : undefined;

        const result = await reschedule(db, {
          seasonNumber: season.number,
          from,
          intervalMinutes: interval,
          ...(deadline !== undefined ? { deadlineMinutes: deadline } : {}),
        });
        console.log(
          `moved ${result.moved} unplayed fixtures onto a ${interval}-minute clock\n` +
            `  next kickoff ${result.firstKickoff.slice(0, 16).replace('T', ' ')} UTC, ` +
            `last ${result.lastKickoff.slice(0, 16).replace('T', ' ')} UTC\n` +
            (args.flags.pacing === 'scheduled'
              ? `  scheduled: the scheduler plays each matchday at its kickoff, lineups lock ${result.deadlineMinutes} min before`
              : '  manual: you start each matchday yourself, and lineups stay open until you do'),
        );
        break;
      }

      case 'matchday': {
        const season = await resolveSeason(db, args);
        const matchday = args.flags.n
          ? Number(args.flags.n)
          : await nextUnplayedMatchday(db, season.id);
        if (matchday === null) {
          console.log(`season ${season.number} is fully played`);
          break;
        }
        const result = await recordJob(
          db,
          'matchday',
          `s${season.number}-md${matchday}`,
          async () => ({ ...(await runMatchday(db, { seasonNumber: season.number, matchday })) }),
        );
        console.log(heading(`Season ${season.number}, matchday ${matchday}`));
        for (const line of (result.lines as Awaited<ReturnType<typeof runMatchday>>['lines'])) {
          console.log(
            `  ${line.home} ${String(line.homePoints).padStart(3)} - ${String(line.awayPoints).padEnd(3)} ${line.away}` +
              `   (goals ${line.homeGoals}-${line.awayGoals}, snitches ${line.homeCatches}-${line.awayCatches})`,
          );
        }
        if (Number(result.alreadyPublished) > 0) {
          console.log(`  ${result.alreadyPublished} fixtures were already published and left alone`);
        }
        break;
      }

      case 'season:run': {
        const season = await resolveSeason(db, args);
        const started = Date.now();
        let played = 0;
        await runSeason(db, season.number, {
          onMatchday: (result) => {
            played += result.played;
            const summary = result.lines
              .map((line) => `${line.home} ${line.homePoints}-${line.awayPoints} ${line.away}`)
              .join('  |  ');
            console.log(`  md${String(result.matchday).padStart(2)}  ${summary}`);
          },
        });
        console.log(
          `\nplayed ${played} matches in ${((Date.now() - started) / 1000).toFixed(1)}s`,
        );
        const divisionId = await topDivisionOf(db, season.id);
        if (divisionId) await printTable(db, season.number, divisionId.id);
        break;
      }

      case 'offseason': {
        const season = await resolveSeason(db, args);
        const result = await recordJob(db, 'offseason', String(season.number), async () => ({
          ...(await runOffseason(db, { seasonNumber: season.number })),
        }));
        const retired = result.retired as { name: string; age: number; club: string | null }[];
        const risers = result.biggestRisers as { name: string; age: number; from: number; to: number }[];
        console.log(heading(`Off-season after season ${season.number}`));
        console.log(
          `  ${result.developed} players processed, ${result.improved} improved, ${result.declined} declined`,
        );
        console.log(`  ${retired.length} retired, ${result.intake} youth players came through`);
        if (risers.length > 0) {
          console.log('\n  biggest risers');
          for (const riser of risers) {
            console.log(
              `    ${riser.name.padEnd(24)} age ${riser.age}   ${riser.from.toFixed(1)} -> ${riser.to.toFixed(1)}`,
            );
          }
        }
        if (retired.length > 0) {
          console.log(
            `\n  retired: ${retired.map((player) => `${player.name} (${player.age}, ${player.club ?? 'free'})`).join(', ')}`,
          );
        }
        break;
      }

      case 'cycle': {
        // Run whole seasons back to back: the closest thing to letting the world
        // simply exist for a while.
        const count = Number(args.flags.seasons ?? 1);
        for (let index = 0; index < count; index++) {
          const [latest] = await db.select().from(seasons).orderBy(desc(seasons.number)).limit(1);
          const number = (latest?.number ?? 0) + 1;
          const created = await newSeason(db, { number, startsOn: new Date() });
          console.log(heading(`Season ${number}`));
          await runSeason(db, number, {
            onMatchday: (result) => {
              if (result.matchday % 6 === 0 || result.matchday === created.matchdays) {
                console.log(`  ...matchday ${result.matchday} of ${created.matchdays}`);
              }
            },
          });
          const division = await topDivisionOf(db, created.seasonId);
          if (division) await printTable(db, number, division.id);
          const off = await runOffseason(db, { seasonNumber: number });
          console.log(
            `\n  off-season: ${off.improved} improved, ${off.declined} declined, ` +
              `${off.retired.length} retired, ${off.intake} youth in`,
          );
        }
        break;
      }

      case 'clubs': {
        // Club records next to the tactics they played, which is how a tactical
        // imbalance shows itself: one setting quietly winning the league.
        const season = await resolveSeason(db, args);
        const division = await topDivisionOf(db, season.id);
        if (!division) throw new Error('season has no division');
        const rows = await db
          .select({
            name: clubs.short,
            full: clubs.name,
            tactics: clubs.tactics,
            played: standings.played,
            goals: standings.goalsFor,
            catches: standings.catchesFor,
            points: standings.tablePoints,
          })
          .from(standings)
          .innerJoin(clubs, eq(standings.clubId, clubs.id))
          .where(eq(standings.divisionId, division.id))
          .orderBy(desc(standings.catchesFor));

        console.log(heading(`Clubs and tactics -- season ${season.number}`));
        console.log(
          table(
            ['club', 'P', 'goals', 'snch', 'pts', 'aggression', 'seeker', 'beaters'],
            rows.map((row) => {
              const tactics = row.tactics as Record<string, string>;
              return [
                row.name,
                String(row.played),
                String(row.goals),
                String(row.catches),
                String(row.points),
                tactics.aggression ?? '?',
                tactics.seekerCommitment ?? '?',
                tactics.beaterFocus ?? '?',
              ];
            }),
            ['l', 'r', 'r', 'r', 'r', 'l', 'l', 'l'],
          ),
        );
        break;
      }

      case 'seekers': {
        // The seeker is the highest-value single position under a respawning
        // snitch, so a club's mean squad rating can hide a star hunter.
        const season = await resolveSeason(db, args);
        const division = await topDivisionOf(db, season.id);
        if (!division) throw new Error('season has no division');
        const rules = rulesByVersion(season.rulesVersion);
        const rosters = await db.select().from(players).where(isNull(players.retiredInSeason));
        const table1 = await loadTable(db, division.id);

        const rows = table1.map((row, index) => {
          const roster = rosters.filter((player) => player.clubId === row.clubId).map((row) => toSimPlayer(row));
          const best = roster
            .filter((player) => player.position === 'seeker')
            .map((player) => baseRating(player, 'seeker', rules))
            .sort((a, b) => b - a)[0] ?? 0;
          const squad = autoLineup(roster, rules).lineup;
          const mean = squadStrength(
            [
              ...squad.chasers.map((player) => ({ player, position: 'chaser' as const })),
              ...squad.beaters.map((player) => ({ player, position: 'beater' as const })),
              { player: squad.keeper, position: 'keeper' as const },
              { player: squad.seeker, position: 'seeker' as const },
            ],
            rules,
          );
          return [
            String(index + 1),
            row.short,
            mean.toFixed(1),
            best.toFixed(1),
            (best - mean >= 0 ? '+' : '') + (best - mean).toFixed(1),
            String(row.catchesFor),
            String(row.tablePoints),
          ];
        });

        console.log(heading(`Seeker quality vs. squad mean -- season ${season.number}`));
        console.log(
          table(['#', 'club', 'squad', 'seeker', 'edge', 'snch', 'pts'], rows, [
            'r', 'l', 'r', 'r', 'r', 'r', 'r',
          ]),
        );
        break;
      }

      case 'finances': {
        // The economy's version of the balance report: is anyone bankrupt, and is
        // anyone hoarding?
        const season = await resolveSeason(db, args);
        const balances = await balancesByClub(db);
        const levelsByClub = await facilityLevelsByClub(db);
        const rows = await db
          .select({ id: clubs.id, short: clubs.short, name: clubs.name, manager: clubs.managerUserId })
          .from(clubs)
          .orderBy(asc(clubs.name));

        const lines: string[][] = [];
        for (const club of rows) {
          const squad = await db
            .select({ wage: players.wage })
            .from(players)
            .where(and(eq(players.clubId, club.id), isNull(players.retiredInSeason)));
          const wages = squad.reduce((sum, row) => sum + row.wage, 0);
          const levels = levelsByClub.get(club.id) ?? {
            trainingGround: 0, medicalWing: 0, scoutingNetwork: 0, academy: 0, stadium: 0, broomStore: 0,
          };
          const built = Object.values(levels).reduce((sum, level) => sum + level, 0);
          lines.push([
            club.short,
            club.manager ? 'human' : 'ai',
            (balances.get(club.id) ?? 0).toLocaleString(),
            wages.toLocaleString(),
            weeklyUpkeep(levels).toLocaleString(),
            String(built),
            String(squad.length),
          ]);
        }

        console.log(heading(`Finances -- season ${season.number}`));
        console.log(
          table(
            ['club', 'run by', 'balance', 'wages/wk', 'upkeep/wk', 'facilities', 'squad'],
            lines,
            ['l', 'l', 'r', 'r', 'r', 'r', 'r'],
          ),
        );

        const all = [...balances.values()];
        const broke = all.filter((value) => value < 0).length;
        const built = lines.map((line) => Number(line[5]));

        console.log(
          `\n  ${broke} of ${all.length} clubs are in the red  |  ` +
            `median balance ${median(all).toLocaleString()}  |  ` +
            `spread ${Math.min(...all).toLocaleString()} to ${Math.max(...all).toLocaleString()}`,
        );

        // The snowball metric. Facility levels are the durable advantage -- cash
        // gets spent, buildings do not -- so the ratio between the best and worst
        // equipped club is what says whether a new manager can ever catch up.
        const bestBuilt = Math.max(...built);
        const worstBuilt = Math.min(...built);
        console.log(
          `  facility levels ${worstBuilt} to ${bestBuilt}` +
            `  (ratio ${(bestBuilt / Math.max(1, worstBuilt)).toFixed(2)}x)` +
            `  -- above about 2.5x a new manager cannot realistically catch up`,
        );
        break;
      }

      case 'claim': {
        // Admin path: hand a club to an existing account without using the site.
        const email = args.flags.email;
        const short = args.flags.club;
        if (!email || !short) throw new Error('need --email and --club SHORT');
        const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email.toLowerCase()));
        if (!user) throw new Error(`no account for ${email}`);
        const [club] = await db.select({ id: clubs.id, name: clubs.name }).from(clubs).where(eq(clubs.short, short));
        if (!club) throw new Error(`no club with code ${short}`);
        const result = await claimClub(db, user.id, club.id);
        console.log(result.ok ? `${email} now manages ${club.name}` : `refused: ${result.error}`);
        break;
      }

      case 'reprice': {
        const season = await resolveSeason(db, args);
        const count = await repriceSquads(db, season.rulesVersion);
        console.log(`set wages for ${count} players from their current ratings`);
        break;
      }

      case 'table': {
        const season = await resolveSeason(db, args);
        const division = await topDivisionOf(db, season.id);
        if (!division) throw new Error('season has no division');
        await recomputeStandings(db, division.id);
        await printTable(db, season.number, division.id);
        break;
      }

      case 'fixtures': {
        const season = await resolveSeason(db, args);
        const rows = await loadFixtures(db, season.id, {
          ...(args.flags.matchday ? { matchday: Number(args.flags.matchday) } : {}),
        });
        console.log(heading(`Fixtures -- season ${season.number}`));
        console.log(
          table(
            ['md', 'kickoff', 'home', '', 'away', 'status', 'match'],
            rows.map((row) => [
              String(row.matchday),
              row.kickoffAt.toISOString().slice(0, 16).replace('T', ' '),
              row.home.name,
              row.matchId ? `${row.homePoints} - ${row.awayPoints}` : 'v',
              row.away.name,
              row.status,
              row.matchId ? row.matchId.slice(0, 8) : '',
            ]),
            ['r', 'l', 'r', 'r', 'l', 'l', 'l'],
          ),
        );
        break;
      }

      case 'leaders': {
        const season = await resolveSeason(db, args);
        const rows = await loadLeaders(db, season.id, Number(args.flags.n ?? 12));
        console.log(heading(`Leading scorers -- season ${season.number}`));
        console.log(
          table(
            ['player', 'club', 'pos', 'apps', 'goals', 'assists', 'snch', 'pts', 'avg rtg'],
            rows.map((row) => [
              row.name,
              row.clubShort,
              row.position.slice(0, 3),
              String(row.matches),
              String(row.goals),
              String(row.assists),
              String(row.catches),
              String(row.points),
              String(row.rating),
            ]),
            ['l', 'l', 'l', 'r', 'r', 'r', 'r', 'r', 'r'],
          ),
        );
        break;
      }

      case 'report': {
        let matchId: string | undefined = args.flags.match ?? args.flags.id;
        if (!matchId) {
          // Default to the most recently published match in the world.
          const [row] = await db
            .select({ id: matches.id })
            .from(matches)
            .orderBy(desc(matches.publishedAt))
            .limit(1);
          matchId = row?.id;
        }
        if (!matchId) throw new Error('no published matches yet');
        const result = await loadMatchResult(db, matchId);
        console.log(renderMatchReport(result, { texture: !args.bools.has('quiet') }));
        console.log(
          `\nrebuilt from ${result.events.length} stored events -- seed ${result.seed}, rules ${result.rulesVersion}`,
        );
        break;
      }

      case 'status': {
        const season = await currentSeason(db);
        const [clubCount] = await db.select({ n: sql<number>`count(*)::int` }).from(clubs);
        const activePlayers = await countActivePlayers(db);
        const [matchCount] = await db.select({ n: sql<number>`count(*)::int` }).from(matches);
        const [eventCount] = await db.select({ n: sql<number>`count(*)::int` }).from(matchEvents);
        const [statCount] = await db.select({ n: sql<number>`count(*)::int` }).from(playerMatchStats);
        const [retired] = await db
          .select({ n: sql<number>`count(*)::int` })
          .from(players)
          .where(sql`${players.retiredInSeason} is not null`);

        console.log(heading(`World status (${handle.backend})`));
        console.log(
          table(
            ['thing', 'count'],
            [
              ['clubs', String(clubCount?.n ?? 0)],
              ['active players', String(activePlayers)],
              ['retired players', String(retired?.n ?? 0)],
              ['matches played', String(matchCount?.n ?? 0)],
              ['match events stored', String(eventCount?.n ?? 0)],
              ['player stat lines', String(statCount?.n ?? 0)],
            ],
            ['l', 'r'],
          ),
        );
        if (season) {
          const next = await nextUnplayedMatchday(db, season.id);
          console.log(
            `\n  season ${season.number} (${season.state}), rules ${season.rulesVersion}, ` +
              `${season.matchdays} matchdays` +
              (next ? `, next unplayed: matchday ${next}` : ', all played'),
          );
        } else {
          console.log('\n  no seasons yet');
        }
        break;
      }

      case 'world:reset': {
        if (!args.bools.has('yes')) {
          console.error('this deletes every club, player and result. re-run with --yes');
          process.exitCode = 1;
          break;
        }
        // Order matters: children before parents.
        await db.delete(matchEvents);
        await db.delete(playerMatchStats);
        await db.delete(matches);
        await db.delete(fixtures);
        await db.delete(standings);
        await db.delete(divisionClubs);
        await db.delete(divisions);
        await db.delete(seasons);
        await db.delete(players);
        await db.delete(clubs);
        console.log('world deleted');
        break;
      }

      default:
        console.error(
          `unknown command: ${args.command}\n` +
            'try: world:new | season:new | reschedule | matchday | season:run | offseason | cycle |\n' +
            '     table | clubs | finances | fixtures | leaders | report | seekers |\n' +
            '     claim | reprice | status | world:reset',
        );
        process.exitCode = 1;
    }
  } finally {
    await handle.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

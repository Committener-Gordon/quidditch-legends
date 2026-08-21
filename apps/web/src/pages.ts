/**
 * The pages. Every one of them is a read: the world is advanced by the worker, and
 * nothing here simulates, schedules or writes.
 */

import { and, desc, eq, isNull } from 'drizzle-orm';
import type { MatchEvent, Side } from '@ql/sim';
import {
  clubs,
  currentSeason,
  fixtures,
  loadAllClubs,
  loadClub,
  loadFixtures,
  loadLeaders,
  loadMatchResult,
  loadTable,
  matches,
  players,
  topDivisionOf,
  toSimPlayer,
  type Database,
} from '@ql/db';
import { DEFAULT_RULES, baseRating, rulesByVersion } from '@ql/sim';
import { escapeHtml, page, tableHtml, type LayoutOptions } from './layout.js';

/** Nav state and any redirect notice, threaded through every page. */
export type Shell = Omit<LayoutOptions, 'title'>;

async function seasonContext(db: Database) {
  const season = await currentSeason(db);
  if (!season) return null;
  const division = await topDivisionOf(db, season.id);
  if (!division) return null;
  return { season, division };
}

function emptyWorld(title: string, shell: Shell): string {
  return page(
    { ...shell, title },
    `<section><div class="card"><h3>No world yet</h3><p class="note">Build one with <span class="mono">npm run world:new</span>, then <span class="mono">npm run season:new</span> and <span class="mono">npm run season:run</span>.</p></div></section>`,
  );
}

// --- the table --------------------------------------------------------------

export async function tablePage(db: Database, shell: Shell = {}): Promise<string> {
  const context = await seasonContext(db);
  if (!context) return emptyWorld('League table', shell);
  const { season, division } = context;

  const rows = await loadTable(db, division.id);
  const recent = (await loadFixtures(db, season.id))
    .filter((row) => row.matchId)
    .slice(-6)
    .reverse();
  const upcoming = (await loadFixtures(db, season.id)).filter((row) => !row.matchId).slice(0, 6);

  const standings = tableHtml(
    [
      { label: '#', num: true },
      { label: 'Club' },
      { label: 'P', num: true },
      { label: 'W', num: true },
      { label: 'D', num: true },
      { label: 'L', num: true },
      { label: 'For', num: true },
      { label: 'Ag', num: true },
      { label: 'Diff', num: true },
      { label: 'Goals', num: true },
      { label: 'Snitch', num: true },
      { label: 'Pts', num: true },
    ],
    rows.map((row, index) => {
      const difference = row.pointsFor - row.pointsAgainst;
      return [
        String(index + 1),
        `<a href="/club/${row.clubId}">${escapeHtml(row.name)}</a>`,
        String(row.played),
        String(row.won),
        String(row.drawn),
        String(row.lost),
        String(row.pointsFor),
        String(row.pointsAgainst),
        (difference > 0 ? '+' : '') + String(difference),
        String(row.goalsFor),
        String(row.catchesFor),
        `<strong>${row.tablePoints}</strong>`,
      ];
    }),
    { highlight: (index) => index === 0 },
  );

  const resultCard = (row: (typeof recent)[number]): string =>
    `<a class="card" style="text-decoration:none;color:inherit" href="/match/${row.matchId}">
       <p class="eyebrow">Matchday ${row.matchday}</p>
       <div class="result"><span>${escapeHtml(row.home.short)}</span><span class="score">${row.homePoints} &ndash; ${row.awayPoints}</span><span>${escapeHtml(row.away.short)}</span></div>
       <p class="note">goals ${row.homeGoals}&ndash;${row.awayGoals} &middot; snitches ${row.homeCatches}&ndash;${row.awayCatches}</p>
     </a>`;

  const fixtureCard = (row: (typeof upcoming)[number]): string =>
    `<div class="card">
       <p class="eyebrow">Matchday ${row.matchday} &middot; ${row.kickoffAt.toISOString().slice(0, 16).replace('T', ' ')} UTC</p>
       <div class="result"><span>${escapeHtml(row.home.name)}</span><span class="tag">v</span><span>${escapeHtml(row.away.name)}</span></div>
     </div>`;

  return page(
    { ...shell, title: division.name, active: '/', subtitle: `Season ${season.number} &middot; rules ${season.rulesVersion}` },
    `<section>${standings}</section>
     ${recent.length > 0 ? `<section><h2>Latest results</h2><div class="grid">${recent.map(resultCard).join('')}</div></section>` : ''}
     ${upcoming.length > 0 ? `<section><h2>Coming up</h2><div class="grid">${upcoming.map(fixtureCard).join('')}</div></section>` : ''}`,
  );
}

// --- fixtures and results ---------------------------------------------------

export async function fixturesPage(db: Database, played: boolean, shell: Shell = {}): Promise<string> {
  const context = await seasonContext(db);
  if (!context) return emptyWorld(played ? 'Results' : 'Fixtures', shell);
  const { season } = context;

  const all = await loadFixtures(db, season.id);
  const rows = played ? all.filter((row) => row.matchId) : all.filter((row) => !row.matchId);
  if (played) rows.reverse();

  const body =
    rows.length === 0
      ? `<div class="card"><p class="note">${played ? 'Nothing has been played yet.' : 'Every fixture in this season has been played.'}</p></div>`
      : tableHtml(
          [
            { label: 'MD', num: true },
            { label: 'Kickoff (UTC)' },
            { label: 'Home' },
            { label: played ? 'Score' : '', num: true },
            { label: 'Away' },
            { label: 'Detail' },
          ],
          rows.map((row) => [
            String(row.matchday),
            row.kickoffAt.toISOString().slice(0, 16).replace('T', ' '),
            escapeHtml(row.home.name),
            row.matchId ? `<span class="score">${row.homePoints} &ndash; ${row.awayPoints}</span>` : 'v',
            escapeHtml(row.away.name),
            row.matchId
              ? `<a href="/match/${row.matchId}">report</a>`
              : `<span class="tag">${row.status}</span>`,
          ]),
        );

  return page(
    {
      ...shell,
      title: played ? 'Results' : 'Fixtures',
      active: played ? '/results' : '/fixtures',
      subtitle: `Season ${season.number}`,
    },
    `<section>${body}</section>`,
  );
}

// --- one match --------------------------------------------------------------

const NAMED: Record<string, true> = { GOAL: true, SNITCH_CAUGHT: true, INJURY: true, SUBSTITUTION: true, TACTIC_SHIFT: true };

function describe(event: MatchEvent, name: (id: string) => string): string | null {
  switch (event.type) {
    case 'KICKOFF':
      return 'The snitch is released and they are away.';
    case 'GOAL':
      return (
        `<strong>${escapeHtml(name(event.playerId))}</strong> scores` +
        (event.assistId ? `, set up by ${escapeHtml(name(event.assistId))}` : '') +
        '.'
      );
    case 'SNITCH_CAUGHT':
      return `<strong>${escapeHtml(name(event.seekerId))}</strong> catches snitch #${event.index} &mdash; thirty points, and a new one is away.`;
    case 'INJURY':
      return `${escapeHtml(name(event.playerId))} is hurt and cannot shake it off (${event.days} days).`;
    case 'SUBSTITUTION':
      return `${escapeHtml(name(event.onId))} replaces ${escapeHtml(name(event.offId))} (${event.reason}).`;
    case 'TACTIC_SHIFT':
      return 'Everything forward.';
    case 'FULL_TIME':
      return 'Full time.';
    default:
      return null;
  }
}

export async function matchPage(db: Database, matchId: string, shell: Shell = {}): Promise<string | null> {
  let result;
  try {
    result = await loadMatchResult(db, matchId);
  } catch {
    return null;
  }

  const names = new Map(result.stats.map((line) => [line.playerId, line.name]));
  const name = (id: string): string => names.get(id) ?? 'someone';
  const shortOf = (side: Side): string => (side === 'home' ? result.home.short : result.away.short);

  const timeline = result.events
    .map((event) => {
      const text = describe(event, name);
      if (!text) return null;
      const cls =
        event.type === 'GOAL' ? ' goal' : event.type === 'SNITCH_CAUGHT' ? ' snitch' : '';
      const who = 'side' in event && event.side ? shortOf(event.side as Side) : '';
      const score = 'score' in event ? `${event.score.home}&ndash;${event.score.away}` : '';
      return `<div class="tl${cls}"><span class="min">${event.minute}'</span><span class="who">${who}</span><span>${text}</span><span class="sc">${score}</span></div>`;
    })
    .filter(Boolean)
    .join('');

  const box = (side: Side): string => {
    const lines = result.stats
      .filter((line) => line.side === side && line.minutes > 0)
      .sort((a, b) => b.rating - a.rating);
    return `<section><h2>${escapeHtml(side === 'home' ? result.home.name : result.away.name)}</h2>${tableHtml(
      [
        { label: 'Pos' },
        { label: 'Player' },
        { label: 'Min', num: true },
        { label: 'G', num: true },
        { label: 'A', num: true },
        { label: 'Sh', num: true },
        { label: 'Sv', num: true },
        { label: 'Int', num: true },
        { label: 'Hits', num: true },
        { label: 'Snch', num: true },
        { label: 'Sta', num: true },
        { label: 'Rating', num: true },
      ],
      lines.map((line) => [
        `<span class="tag">${line.position.slice(0, 3)}</span>`,
        escapeHtml(line.name),
        String(line.minutes),
        String(line.goals),
        String(line.assists),
        String(line.shots),
        String(line.saves),
        String(line.interceptions),
        String(line.bludgerHits),
        String(line.snitchCatches),
        String(line.staminaEnd),
        `<strong>${line.rating.toFixed(1)}</strong>`,
      ]),
    )}</section>`;
  };

  const notable = result.events.filter((event) => NAMED[event.type]).length;

  return page(
    { ...shell, title: `${result.home.short} v ${result.away.short}`, subtitle: 'Match report' },
    `<section>
       <div class="bigscore">
         <span class="side">${escapeHtml(result.home.name)}</span>
         <span class="n">${result.score.home}</span>
         <span class="note">&ndash;</span>
         <span class="n">${result.score.away}</span>
         <span class="side">${escapeHtml(result.away.name)}</span>
       </div>
       <p class="note" style="text-align:center">
         goals ${result.goals.home}&ndash;${result.goals.away} &middot;
         snitches ${result.catches.home}&ndash;${result.catches.away} &middot;
         shots ${result.shots.home}&ndash;${result.shots.away} &middot;
         ${result.minutes} minutes
       </p>
     </section>
     <section><h2>How it happened</h2><div class="timeline">${timeline}</div>
       <p class="note">${notable} notable events of ${result.events.length} in the log &middot;
       seed <span class="mono">${escapeHtml(result.seed)}</span> &middot; rules <span class="mono">${escapeHtml(result.rulesVersion)}</span>.
       This page is rendered from the stored log, not from a fresh simulation.</p>
     </section>
     ${box('home')}
     ${box('away')}`,
  );
}

// --- leaders and clubs ------------------------------------------------------

export async function leadersPage(db: Database, shell: Shell = {}): Promise<string> {
  const context = await seasonContext(db);
  if (!context) return emptyWorld('Leaders', shell);
  const { season } = context;
  const rows = await loadLeaders(db, season.id, 25);

  return page(
    { ...shell, title: 'Leaders', active: '/leaders', subtitle: `Season ${season.number}` },
    `<section>
       <p class="note">Ranked by points produced: ten for a goal, thirty for a snitch. It is the only ranking that puts a seeker and a chaser on the same list.</p>
       ${tableHtml(
         [
           { label: '#', num: true },
           { label: 'Player' },
           { label: 'Club' },
           { label: 'Pos' },
           { label: 'Apps', num: true },
           { label: 'Goals', num: true },
           { label: 'Assists', num: true },
           { label: 'Snitch', num: true },
           { label: 'Points', num: true },
           { label: 'Avg rating', num: true },
         ],
         rows.map((row, index) => [
           String(index + 1),
           escapeHtml(row.name),
           `<a href="/club/${row.clubId}">${escapeHtml(row.clubShort)}</a>`,
           `<span class="tag">${row.position.slice(0, 3)}</span>`,
           String(row.matches),
           String(row.goals),
           String(row.assists),
           String(row.catches),
           `<strong>${row.points}</strong>`,
           String(row.rating),
         ]),
         { highlight: (index) => index === 0 },
       )}
     </section>`,
  );
}

export async function clubsPage(db: Database, shell: Shell = {}): Promise<string> {
  const list = await loadAllClubs(db);
  if (list.length === 0) return emptyWorld('Clubs', shell);

  const cards = await Promise.all(
    list.map(async (club) => {
      const [row] = await db
        .select({ tactics: clubs.tactics, capacity: clubs.stadiumCapacity })
        .from(clubs)
        .where(eq(clubs.id, club.id));
      const tactics = (row?.tactics ?? {}) as Record<string, string>;
      return `<a class="card" style="text-decoration:none;color:inherit" href="/club/${club.id}">
        <h3>${escapeHtml(club.name)}</h3>
        <p class="note">${escapeHtml(tactics.aggression ?? '?')} &middot; seeker ${escapeHtml(tactics.seekerCommitment ?? '?')} &middot; beaters on ${escapeHtml(tactics.beaterFocus ?? '?')}</p>
        <p class="note">${(row?.capacity ?? 0).toLocaleString()} seats</p>
      </a>`;
    }),
  );

  return page(
    { ...shell, title: 'Clubs', active: '/clubs' },
    `<section><div class="grid">${cards.join('')}</div></section>`,
  );
}

export async function clubPage(db: Database, clubId: string, shell: Shell = {}): Promise<string | null> {
  const loaded = await loadClub(db, clubId);
  if (!loaded) return null;
  const { club, squad } = loaded;

  const season = await currentSeason(db);
  const rules = season ? rulesByVersion(season.rulesVersion) : DEFAULT_RULES;
  const tactics = (club.tactics ?? {}) as Record<string, string>;

  const recent = season
    ? (
        await db
          .select({
            id: matches.id,
            homeClubId: fixtures.homeClubId,
            awayClubId: fixtures.awayClubId,
            homePoints: matches.homePoints,
            awayPoints: matches.awayPoints,
            matchday: fixtures.matchday,
          })
          .from(matches)
          .innerJoin(fixtures, eq(matches.fixtureId, fixtures.id))
          .where(eq(fixtures.seasonId, season.id))
          .orderBy(desc(fixtures.matchday))
      ).filter((row) => row.homeClubId === clubId || row.awayClubId === clubId).slice(0, 8)
    : [];

  const names = new Map((await loadAllClubs(db)).map((entry) => [entry.id, entry.short]));

  const squadTable = tableHtml(
    [
      { label: 'Pos' },
      { label: 'Player' },
      { label: 'Age', num: true },
      { label: 'Rating', num: true },
      { label: 'Fly', num: true },
      { label: 'Hand', num: true },
      { label: 'Aim', num: true },
      { label: 'Str', num: true },
      { label: 'Vis', num: true },
      { label: 'Ref', num: true },
      { label: 'Nrv', num: true },
      { label: 'Form', num: true },
      { label: 'Fit', num: true },
    ],
    squad.map((row) => [
      `<span class="tag">${row.position.slice(0, 3)}</span>`,
      escapeHtml(row.name) + (row.injuredUntil ? ' <span class="tag">injured</span>' : ''),
      String(row.age),
      `<strong>${baseRating(toSimPlayer(row), row.position, rules).toFixed(0)}</strong>`,
      String(row.flying),
      String(row.handling),
      String(row.aim),
      String(row.strength),
      String(row.vision),
      String(row.reflexes),
      String(row.nerve),
      String(row.form),
      String(row.stamina),
    ]),
  );

  const results = recent
    .map((row) => {
      const home = row.homeClubId === clubId;
      const own = home ? row.homePoints : row.awayPoints;
      const other = home ? row.awayPoints : row.homePoints;
      const label = own > other ? 'won' : own < other ? 'lost' : 'drew';
      return `<a class="card" style="text-decoration:none;color:inherit" href="/match/${row.id}">
        <p class="eyebrow">Matchday ${row.matchday} &middot; ${home ? 'home' : 'away'}</p>
        <div class="result"><span class="tag">${label}</span><span class="score">${own} &ndash; ${other}</span><span>${escapeHtml(names.get(home ? row.awayClubId : row.homeClubId) ?? '')}</span></div>
      </a>`;
    })
    .join('');

  return page(
    { ...shell, title: club.name, active: '/clubs', subtitle: `${club.stadiumCapacity.toLocaleString()} seats` },
    `<section>
       <div class="card">
         <h3>Tactics</h3>
         <p class="note">Aggression <strong>${escapeHtml(tactics.aggression ?? '?')}</strong> &middot;
           seeker <strong>${escapeHtml(tactics.seekerCommitment ?? '?')}</strong> &middot;
           beaters on <strong>${escapeHtml(tactics.beaterFocus ?? '?')}</strong>
           ${tactics.chaseTheGame === undefined ? '' : `&middot; chases the game`}</p>
         <p class="note">No manager. Phase three lets someone claim this club.</p>
       </div>
     </section>
     ${results ? `<section><h2>Recent matches</h2><div class="grid">${results}</div></section>` : ''}
     <section><h2>Squad</h2>${squadTable}
       <p class="note">Potential is deliberately not shown. A manager only ever sees a scout's estimate of it.</p>
     </section>`,
  );
}

/** Retired players are kept, so the squad query has to exclude them. */
export async function activeSquadSize(db: Database, clubId: string): Promise<number> {
  const rows = await db
    .select({ id: players.id })
    .from(players)
    .where(and(eq(players.clubId, clubId), isNull(players.retiredInSeason)));
  return rows.length;
}

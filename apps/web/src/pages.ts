/**
 * The pages. Every one of them is a read: the world is advanced by the worker, and
 * nothing here simulates, schedules or writes.
 */

import { and, desc, eq, isNull } from 'drizzle-orm';
import type { MatchEvent, Side } from '@ql/sim';
import {
  clubs,
  currentSeason,
  liveMatches,
  playbackOf,
  revealedEvents,
  scoreSoFar,
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
  const fixtureRows = await loadFixtures(db, season.id);
  const recent = fixtureRows.filter((row) => row.status === 'published').slice(-6).reverse();
  const upcoming = fixtureRows.filter((row) => row.status === 'scheduled').slice(0, 6);
  const running = await liveNow(db, season.id);

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

  const liveStrip =
    running.length > 0
      ? `<section>
           <p class="livetag" style="justify-content:flex-start">Live now &mdash; ${running[0]!.playback.minute}' of ${running[0]!.playback.totalMinutes}</p>
           <div class="grid">${running
             .map(
               (match) => `<a class="card livecard" style="text-decoration:none;color:inherit" href="/match/${match.matchId}">
                  <p class="eyebrow">Matchday ${match.matchday}</p>
                  <div class="result"><span>${escapeHtml(match.home.short)}</span><span class="tag">in progress</span><span>${escapeHtml(match.away.short)}</span></div>
                  <p class="note">${Math.ceil(match.playback.secondsRemaining)}s left</p>
                </a>`,
             )
             .join('')}</div>
           <p class="note">The table below will not move until these finish.</p>
         </section>`
      : '';

  return page(
    {
      ...shell,
      title: division.name,
      active: '/',
      subtitle: `Season ${season.number} &middot; rules ${season.rulesVersion}`,
      ...(running.length > 0 ? { refreshSeconds: 10 } : {}),
    },
    `${liveStrip}
     <section>${standings}</section>
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
  // A live match has a match row already -- its final score is sitting right
  // there. Only `published` counts as a result, or the results page spoils the
  // feed the player is watching.
  const rows = played
    ? all.filter((row) => row.status === 'published').reverse()
    : all.filter((row) => row.status !== 'published');

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
            row.status === 'published'
              ? `<span class="score">${row.homePoints} &ndash; ${row.awayPoints}</span>`
              : 'v',
            escapeHtml(row.away.name),
            row.status === 'published'
              ? `<a href="/match/${row.matchId}">report</a>`
              : row.status === 'live'
                ? `<a href="/match/${row.matchId}">watch live</a>`
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

/**
 * What is worth putting in a feed.
 *
 * A match produces about eighty saves. Printing them all is noise, so only the
 * hardest few from each side earn a line.
 *
 * Note that this is deliberately *relative* rather than a fixed difficulty
 * threshold. Measured over forty matches, every shot in this engine is worth
 * between 0.39 and 0.48 -- the deliberately flat rating slopes that stop good
 * sides steamrolling everyone also mean no single shot is ever a sitter or a
 * screamer. Any absolute cut-off would either catch every save or none, and would
 * silently break the next time the sport is retuned.
 *
 * It is also picked per window rather than over the whole match. Chasers tire
 * roughly twice as fast as keepers, so shot quality falls away as the match goes
 * on and a plain "hardest three" puts every highlight in the opening quarter of
 * an hour.
 */
/** Windows the match is split into, so highlights are not all from one spell. */
const HIGHLIGHT_WINDOWS = 3;
const NOTABLE_GOALS_PER_SIDE = 1;

/**
 * Indices of the events worth calling out: the hardest saves each keeper made,
 * and the goal each side scored from the least promising position.
 */
function notableShots(events: MatchEvent[]): Set<number> {
  type Shot = { index: number; side: Side; chance: number; minute: number };
  const saves: Shot[] = [];
  const goals: Shot[] = [];

  events.forEach((event, index) => {
    if (event.type === 'SAVE') {
      saves.push({ index, side: event.side, chance: event.chance, minute: event.minute });
    } else if (event.type === 'GOAL') {
      goals.push({ index, side: event.side, chance: event.chance, minute: event.minute });
    }
  });

  const lastMinute = events.reduce((latest, event) => Math.max(latest, event.minute), 1);
  const windowOf = (minute: number): number =>
    Math.min(HIGHLIGHT_WINDOWS - 1, Math.floor((minute / (lastMinute + 1)) * HIGHLIGHT_WINDOWS));

  const picked = new Set<number>();
  for (const side of ['home', 'away'] as Side[]) {
    const theirs = saves.filter((entry) => entry.side === side);
    for (let window = 0; window < HIGHLIGHT_WINDOWS; window++) {
      const best = theirs
        .filter((entry) => windowOf(entry.minute) === window)
        .sort((left, right) => right.chance - left.chance)[0];
      if (best) picked.add(best.index);
    }
    goals
      .filter((entry) => entry.side === side)
      .sort((left, right) => left.chance - right.chance)
      .slice(0, NOTABLE_GOALS_PER_SIDE)
      .forEach((entry) => picked.add(entry.index));
  }
  return picked;
}

const GOAL_PHRASES = [
  'puts it through the hoop',
  'finds the hoop',
  'scores',
  'buries it',
];

function feedLine(
  event: MatchEvent,
  name: (id: string) => string,
  shortOf: (side: Side) => string,
  index: number,
  notable: boolean,
): { text: string; kind: string; side: Side | null; score: string } | null {
  switch (event.type) {
    case 'KICKOFF':
      return { text: 'The snitch is released and they are away.', kind: 'start', side: null, score: '' };
    case 'GOAL': {
      const remarkable = notable;
      const phrase = GOAL_PHRASES[index % GOAL_PHRASES.length];
      return {
        text:
          `<strong>${escapeHtml(name(event.playerId))}</strong> ${phrase}` +
          (event.assistId ? `, set up by ${escapeHtml(name(event.assistId))}` : '') +
          (remarkable ? ' &mdash; the least likely chance they took all match' : '') +
          ' <span class="pts">+10</span>',
        kind: remarkable ? 'goal special' : 'goal',
        side: event.side,
        score: `${event.score.home}&ndash;${event.score.away}`,
      };
    }
    case 'SNITCH_CAUGHT':
      return {
        text:
          `<strong>${escapeHtml(name(event.seekerId))}</strong> closes a hand round the snitch. ` +
          `A new one is released and the hunt starts again. <span class="pts">+30</span>`,
        kind: 'snitch',
        side: event.side,
        score: `${event.score.home}&ndash;${event.score.away}`,
      };
    case 'SAVE':
      if (!notable) return null;
      return {
        text:
          `<strong>${escapeHtml(name(event.keeperId))}</strong> denies ` +
          `${escapeHtml(name(event.shooterId))} &mdash; the pick of the saves in that spell`,
        kind: 'save',
        side: event.side,
        score: '',
      };
    case 'INJURY':
      return {
        text: `${escapeHtml(name(event.playerId))} takes a bludger badly and cannot continue (${event.days} days)`,
        kind: 'injury',
        side: event.side,
        score: '',
      };
    case 'SUBSTITUTION':
      return {
        text: `${escapeHtml(name(event.onId))} comes on for ${escapeHtml(name(event.offId))} (${event.reason})`,
        kind: 'sub',
        side: event.side,
        score: '',
      };
    case 'TACTIC_SHIFT':
      return { text: `${shortOf(event.side)} throw everything forward`, kind: 'tactic', side: event.side, score: '' };
    case 'FULL_TIME':
      return { text: 'Full time.', kind: 'start', side: null, score: `${event.score.home}&ndash;${event.score.away}` };
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

  const [row] = await db
    .select({
      kickedOffAt: matches.kickedOffAt,
      playbackSeconds: matches.playbackSeconds,
      minutes: matches.minutes,
      publishedAt: matches.publishedAt,
    })
    .from(matches)
    .where(eq(matches.id, matchId));
  if (!row) return null;

  const rules = (() => {
    try {
      return rulesByVersion(result.rulesVersion);
    } catch {
      return DEFAULT_RULES;
    }
  })();

  const playback = playbackOf(row);
  const shown = revealedEvents(result.events, playback);
  const live = playback.phase !== 'final';
  // Never read the final score off the row while a match is running.
  const score = live ? scoreSoFar(shown, rules.goalPoints, rules.snitchPoints) : result.score;

  const names = new Map(result.stats.map((line) => [line.playerId, line.name]));
  const name = (id: string): string => names.get(id) ?? 'someone';
  const shortOf = (side: Side): string => (side === 'home' ? result.home.short : result.away.short);

  const notable = notableShots(result.events);
  const indexOf = new Map(result.events.map((event, index) => [event, index]));

  const ordered = live ? [...shown].reverse() : shown;
  let goalIndex = 0;
  const feed = ordered
    .map((event) => {
      const line = feedLine(event, name, shortOf, goalIndex, notable.has(indexOf.get(event) ?? -1));
      if (event.type === 'GOAL') goalIndex += 1;
      if (!line) return null;
      return `<div class="tl ${line.kind}">
        <span class="min">${event.minute}'</span>
        <span class="who">${line.side ? escapeHtml(shortOf(line.side)) : ''}</span>
        <span>${line.text}</span>
        <span class="sc">${line.score}</span>
      </div>`;
    })
    .filter(Boolean)
    .join('');

  const clock = live
    ? `<div class="clockrow">
         <span class="bigmin">${playback.minute}'</span>
         <div class="progress"><i style="width:${(playback.progress * 100).toFixed(1)}%"></i></div>
         <span class="remaining">${formatRemaining(playback.secondsRemaining)} left</span>
       </div>`
    : '';

  const boxFor = (side: Side): string => {
    const lines = result.stats
      .filter((line) => line.side === side && line.minutes > 0)
      .sort((a, b) => b.rating - a.rating);
    return `<section><h2>${escapeHtml(side === 'home' ? result.home.name : result.away.name)}</h2>${tableHtml(
      [
        { label: 'Pos' }, { label: 'Player' }, { label: 'Min', num: true },
        { label: 'G', num: true }, { label: 'A', num: true }, { label: 'Sh', num: true },
        { label: 'Sv', num: true }, { label: 'Int', num: true }, { label: 'Hits', num: true },
        { label: 'Snch', num: true }, { label: 'Sta', num: true }, { label: 'Rating', num: true },
      ],
      lines.map((line) => [
        `<span class="tag">${line.position.slice(0, 3)}</span>`,
        escapeHtml(line.name),
        String(line.minutes), String(line.goals), String(line.assists), String(line.shots),
        String(line.saves), String(line.interceptions), String(line.bludgerHits),
        String(line.snitchCatches), String(line.staminaEnd),
        `<strong>${line.rating.toFixed(1)}</strong>`,
      ]),
    )}</section>`;
  };

  return page(
    {
      ...shell,
      title: `${result.home.short} v ${result.away.short}`,
      subtitle: live ? 'Live' : 'Match report',
      // A running match reloads itself; a finished one has no reason to.
      ...(live ? { refreshSeconds: 5 } : {}),
    },
    `<section>
       ${live ? '<p class="livetag">Live &mdash; playing now</p>' : ''}
       <div class="bigscore">
         <span class="side">${escapeHtml(result.home.name)}</span>
         <span class="n">${score.home}</span>
         <span class="note">&ndash;</span>
         <span class="n">${score.away}</span>
         <span class="side">${escapeHtml(result.away.name)}</span>
       </div>
       ${clock}
       ${
         live
           ? '<p class="note" style="text-align:center">The result is decided the moment a match kicks off &mdash; what you are watching is it being told to you. The table will not move until it finishes.</p>'
           : `<p class="note" style="text-align:center">
                goals ${result.goals.home}&ndash;${result.goals.away} &middot;
                snitches ${result.catches.home}&ndash;${result.catches.away} &middot;
                shots ${result.shots.home}&ndash;${result.shots.away} &middot;
                ${result.minutes} minutes
              </p>`
       }
     </section>
     <section>
       <h2>${live ? 'As it happens' : 'How it happened'}</h2>
       ${feed ? `<div class="timeline">${feed}</div>` : '<div class="card"><p class="note">Nothing yet. The teams are in the air.</p></div>'}
       <p class="note">${
         live
           ? 'Goals, snitch catches and the saves worth mentioning. Newest first.'
           : `${shown.length} events in the log &middot; seed <span class="mono">${escapeHtml(result.seed)}</span> &middot; rules <span class="mono">${escapeHtml(result.rulesVersion)}</span>. Rendered from the stored log, not a fresh simulation.`
       }</p>
     </section>
     ${live ? '' : boxFor('home')}
     ${live ? '' : boxFor('away')}`,
  );
}

function formatRemaining(seconds: number): string {
  if (seconds <= 0) return '0s';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes}m ${String(rest).padStart(2, '0')}s` : `${rest}s`;
}

/** Anything currently being revealed, for the table page and the dashboard. */
export async function liveNow(db: Database, seasonId: string) {
  const rows = await liveMatches(db, seasonId);
  const names = new Map(
    (await db.select({ id: clubs.id, name: clubs.name, short: clubs.short }).from(clubs)).map((c) => [c.id, c]),
  );
  return rows.map((row) => ({
    ...row,
    playback: playbackOf(row),
    home: names.get(row.homeClubId) ?? { id: row.homeClubId, name: '?', short: '???' },
    away: names.get(row.awayClubId) ?? { id: row.awayClubId, name: '?', short: '???' },
  }));
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

/**
 * The manager's pages: the half of the app that writes.
 *
 * Everything is a plain form POST, so the deadline rule lives in exactly one place
 * -- here, on the server -- rather than being duplicated into a browser bundle
 * that a determined visitor could ignore anyway.
 */

import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import {
  DEFAULT_RULES,
  POSITION_WEIGHTS,
  baseRating,
  overall,
  rulesByVersion,
  type Attribute,
  type Position,
  type Tactics,
} from '@ql/sim';
import {
  FACILITIES,
  INTENSITY,
  scoutRange,
  stadiumCapacity,
  upgradeCost,
  weeklyTrainingCost,
  weeklyUpkeep,
  type FacilityKind,
  type TrainingIntensity,
} from '@ql/economy';
import {
  balanceOf,
  clubs,
  currentSeason,
  deadlineFor,
  facilityLevels,
  fixtures,
  isPastDeadline,
  ledgerFor,
  ledgerSummary,
  lineupFor,
  loadTable,
  players,
  topDivisionOf,
  toSimPlayer,
  trainingOrderFor,
  type Database,
  type LineupSelection,
  type PlayerRow,
  type SessionUser,
} from '@ql/db';
import { escapeHtml, page, tableHtml, type LayoutOptions } from './layout.js';
import { liveNow } from './pages.js';

/** How long a matchday takes to play out on screen. */
const PLAYBACK_CHOICES: [number, string][] = [
  [0, 'no wait — show me the result'],
  [60, '1 minute'],
  [180, '3 minutes'],
  [600, '10 minutes'],
];

const ATTRIBUTES: Attribute[] = [
  'flying',
  'handling',
  'aim',
  'strength',
  'vision',
  'reflexes',
  'nerve',
];

function galleons(amount: number): string {
  const sign = amount < 0 ? 'neg' : amount > 0 ? 'pos' : '';
  return `<span class="money ${sign}">${amount < 0 ? '-' : ''}${Math.abs(amount).toLocaleString()}</span>`;
}

interface Context {
  db: Database;
  user: SessionUser;
  shell: Omit<LayoutOptions, 'title'>;
}

async function clubOf(db: Database, clubId: string) {
  const [club] = await db.select().from(clubs).where(eq(clubs.id, clubId));
  return club ?? null;
}

async function rosterOf(db: Database, clubId: string): Promise<PlayerRow[]> {
  return db
    .select()
    .from(players)
    .where(and(eq(players.clubId, clubId), isNull(players.retiredInSeason)))
    .orderBy(asc(players.position), desc(players.age));
}

// --- sign in and register ---------------------------------------------------

export function loginPage(shell: Omit<LayoutOptions, 'title'>, error?: string): string {
  return page(
    { ...shell, title: 'Sign in' },
    `<section>
       <div class="card" style="max-width:32rem">
         ${error ? `<p class="note" style="color:var(--risk)">${escapeHtml(error)}</p>` : ''}
         <form method="post" action="/login">
           <label>Email<input type="email" name="email" required autocomplete="email"></label>
           <label>Password<input type="password" name="password" required autocomplete="current-password"></label>
           <button class="primary" type="submit">Sign in</button>
         </form>
         <p class="note">No account? <a href="/register">Take over a club</a>.</p>
       </div>
     </section>`,
  );
}

export function registerPage(shell: Omit<LayoutOptions, 'title'>, error?: string): string {
  return page(
    { ...shell, title: 'Take over a club' },
    `<section>
       <div class="card" style="max-width:32rem">
         ${error ? `<p class="note" style="color:var(--risk)">${escapeHtml(error)}</p>` : ''}
         <form method="post" action="/register">
           <label>Name<input type="text" name="displayName" required autocomplete="name"></label>
           <label>Email<input type="email" name="email" required autocomplete="email"></label>
           <label>Password<input type="password" name="password" required minlength="8" autocomplete="new-password">
           </label>
           <button class="primary" type="submit">Create account</button>
         </form>
         <p class="note">Eight characters or more. Already have one? <a href="/login">Sign in</a>.</p>
       </div>
     </section>`,
  );
}

// --- claiming ---------------------------------------------------------------

export async function claimPage(context: Context, available: { id: string; name: string; short: string; capacity: number }[]): Promise<string> {
  const { db } = context;
  const season = await currentSeason(db);
  const table = season ? await loadTable(db, (await topDivisionOf(db, season.id))?.id ?? '') : [];
  const positionOf = new Map(table.map((row, index) => [row.clubId, index + 1]));

  const cards = available.map((club) => {
    const position = positionOf.get(club.id);
    return `<form method="post" action="/claim" class="card">
      <h3>${escapeHtml(club.name)}</h3>
      <p class="note">${club.capacity.toLocaleString()} seats${position ? ` &middot; ${position} in the table` : ''}</p>
      <input type="hidden" name="clubId" value="${club.id}">
      <button class="primary" type="submit">Take charge</button>
    </form>`;
  });

  return page(
    { ...context.shell, title: 'Claim a club', active: '/my' },
    `<section>
       <p class="note">Pick one of the clubs nobody is running. You inherit its squad, its balance and its league position exactly as the AI left them &mdash; and from your first matchday, your team selection decides the result.</p>
       ${cards.length > 0 ? `<div class="grid">${cards.join('')}</div>` : '<div class="card"><p class="note">Every club already has a manager.</p></div>'}
     </section>`,
  );
}

// --- the dashboard ----------------------------------------------------------

export async function dashboardPage(context: Context, clubId: string): Promise<string> {
  const { db } = context;
  const club = await clubOf(db, clubId);
  if (!club) return page({ ...context.shell, title: 'My club' }, '<section><div class="card"><p class="note">That club is gone.</p></div></section>');

  const season = await currentSeason(db);
  const rules = season ? rulesByVersion(season.rulesVersion) : DEFAULT_RULES;
  const roster = await rosterOf(db, clubId);
  const balance = await balanceOf(db, clubId);
  const levels = await facilityLevels(db, clubId);
  const wageBill = roster.reduce((sum, row) => sum + row.wage, 0);
  const upkeep = weeklyUpkeep(levels);
  const order = season ? await trainingOrderFor(db, clubId, season.id) : null;
  const training = order ? weeklyTrainingCost({ focus: null, intensity: order.intensity }, roster.length) : 0;

  const next = season
    ? (
        await db
          .select()
          .from(fixtures)
          .where(and(eq(fixtures.seasonId, season.id), eq(fixtures.status, 'scheduled')))
          .orderBy(asc(fixtures.matchday))
      ).filter((row) => row.homeClubId === clubId || row.awayClubId === clubId)
    : [];

  const opponentNames = new Map(
    (await db.select({ id: clubs.id, name: clubs.name }).from(clubs)).map((row) => [row.id, row.name]),
  );

  const manual = (season?.pacing ?? 'manual') === 'manual';

  const nextCards = await Promise.all(
    next.slice(0, 3).map(async (fixture, index) => {
      const home = fixture.homeClubId === clubId;
      const opponent = opponentNames.get(home ? fixture.awayClubId : fixture.homeClubId) ?? '';
      const lineup = await lineupFor(db, fixture.id, clubId);
      // In manual pacing nothing locks until the player presses play, so the only
      // thing that closes a lineup is the match having been played.
      const locked = manual
        ? fixture.status !== 'scheduled'
        : isPastDeadline(fixture.kickoffAt, new Date(), season?.lineupDeadlineMinutes ?? 15);
      const isNext = index === 0;

      return `<div class="card">
        <p class="eyebrow">Matchday ${fixture.matchday} &middot; ${home ? 'home' : 'away'}${isNext ? ' &middot; next' : ''}</p>
        <h3>${escapeHtml(opponent)}</h3>
        <p class="note">${lineup ? 'Team submitted' : 'No team picked &mdash; the best available side will be used'}</p>
        ${locked ? '<p class="deadline">Closed</p>' : `<a class="buttonlink" href="/my/lineup?fixture=${fixture.id}">${lineup ? 'Change the team' : 'Pick the team'}</a>`}
        ${
          isNext && manual
            ? `<form method="post" action="/my/play" style="margin-top:4px;gap:9px">
                 <input type="hidden" name="matchday" value="${fixture.matchday}">
                 <label style="font-size:.74rem">watch it over
                   <select name="playback">
                     ${PLAYBACK_CHOICES.map(
                       ([seconds, label]) =>
                         `<option value="${seconds}"${(season?.playbackSeconds ?? 180) === seconds ? ' selected' : ''}>${label}</option>`,
                     ).join('')}
                   </select>
                 </label>
                 <button class="primary" type="submit">Play matchday ${fixture.matchday}</button>
               </form>`
            : ''
        }
      </div>`;
    }),
  );

  // Wage bill as a share of income is the one benchmark worth putting in front of
  // a manager: 55-65% is healthy, past 80% nothing can be bought.
  const weeklyIncome = 6000 + Math.round(stadiumCapacity(club.stadiumCapacity, levels.stadium) * 0.72 * 1.5);
  const wageShare = weeklyIncome > 0 ? Math.round((wageBill / weeklyIncome) * 100) : 0;

  const running = season ? await liveNow(db, season.id) : [];
  const ourLive = running.find(
    (match) => match.homeClubId === clubId || match.awayClubId === clubId,
  );

  return page(
    {
      ...context.shell,
      title: club.name,
      active: '/my',
      subtitle: 'Your club',
      ...(ourLive ? { refreshSeconds: 10 } : {}),
    },
    `${
      ourLive
        ? `<section><div class="card livecard">
             <p class="livetag" style="justify-content:flex-start">Live now</p>
             <h3>${escapeHtml(ourLive.home.name)} v ${escapeHtml(ourLive.away.name)}</h3>
             <p class="note">${ourLive.playback.minute}' of ${ourLive.playback.totalMinutes} &middot; ${Math.ceil(ourLive.playback.secondsRemaining)}s left</p>
             <a class="buttonlink" href="/match/${ourLive.matchId}">Watch it</a>
           </div></section>`
        : ''
    }
     <section>
       <dl class="kv">
         <div><dt>Balance</dt><dd>${galleons(balance)}</dd></div>
         <div><dt>Wage bill / week</dt><dd>${galleons(-wageBill)}</dd></div>
         <div><dt>Upkeep / week</dt><dd>${galleons(-upkeep)}</dd></div>
         <div><dt>Training / week</dt><dd>${galleons(-training)}</dd></div>
         <div><dt>Wages of income</dt><dd>${wageShare}%</dd></div>
         <div><dt>Squad</dt><dd>${roster.length}</dd></div>
       </dl>
       <p class="note">${
         wageShare > 80
           ? 'Wages are eating the club. Nothing can be bought until that comes down.'
           : wageShare < 40
             ? 'There is room in the budget. A facility upgrade would compound faster than the cash will.'
             : 'A wage bill between 55% and 65% of income is healthy.'
       }</p>
     </section>
     <section>
       <h2>Next up</h2>
       ${
         manual
           ? '<p class="note">You own the clock. Pick your team, then play the matchday whenever you are ready &mdash; every other club in the division plays at the same time.</p>'
           : '<p class="note">Matchdays play at their kickoff time. Lineups lock shortly before.</p>'
       }
       ${nextCards.length > 0 ? `<div class="grid">${nextCards.join('')}</div>` : `<div class="card"><p class="note">No fixtures left this season.</p>${season?.state === 'complete' ? '<form method="post" action="/my/next-season"><button class="primary" type="submit">Run the off-season and start the next one</button></form>' : ''}</div>`}
     </section>
     <section>
       <h2>Running the club</h2>
       <div class="grid">
         <a class="card" style="text-decoration:none;color:inherit" href="/my/tactics"><h3>Tactics</h3><p class="note">Standing instructions for every match you do not pick individually.</p></a>
         <a class="card" style="text-decoration:none;color:inherit" href="/my/training"><h3>Training</h3><p class="note">One order per season. It decides who develops and how fast.</p></a>
         <a class="card" style="text-decoration:none;color:inherit" href="/my/facilities"><h3>Facilities</h3><p class="note">The only thing worth saving for.</p></a>
         <a class="card" style="text-decoration:none;color:inherit" href="/my/finances"><h3>Finances</h3><p class="note">Every Galleon in and out, with a reason attached.</p></a>
         <a class="card" style="text-decoration:none;color:inherit" href="/my/squad"><h3>Squad</h3><p class="note">Ratings, wages, fitness and what a scout makes of the youngsters.</p></a>
       </div>
     </section>`,
  );
}

// --- the lineup form --------------------------------------------------------

export async function lineupPage(context: Context, clubId: string, fixtureId: string): Promise<string | null> {
  const { db } = context;
  const [fixture] = await db.select().from(fixtures).where(eq(fixtures.id, fixtureId));
  if (!fixture) return null;
  if (fixture.homeClubId !== clubId && fixture.awayClubId !== clubId) return null;

  const season = await currentSeason(db);
  const rules = season ? rulesByVersion(season.rulesVersion) : DEFAULT_RULES;
  const roster = await rosterOf(db, clubId);
  const onDate = fixture.kickoffAt.toISOString().slice(0, 10);
  const existing = await lineupFor(db, fixtureId, clubId);
  const manual = (season?.pacing ?? 'manual') === 'manual';
  const locked =
    fixture.status !== 'scheduled' ||
    (!manual && isPastDeadline(fixture.kickoffAt, new Date(), season?.lineupDeadlineMinutes ?? 15));

  const selection = (existing?.starters as LineupSelection | undefined) ?? null;
  const available = roster.filter((row) => !row.injuredUntil || row.injuredUntil <= onDate);

  const option = (row: PlayerRow, position: Position, selected: boolean): string =>
    `<option value="${row.id}"${selected ? ' selected' : ''}>` +
    `${escapeHtml(row.name)} — ${baseRating(toSimPlayer(row), position, rules).toFixed(0)}` +
    ` (${row.position.slice(0, 3)}, fit ${row.stamina})</option>`;

  const select = (name: string, position: Position, chosen: string | undefined): string =>
    `<div class="slot"><span class="pos">${position}</span>` +
    `<select name="${name}"${locked ? ' disabled' : ''}>` +
    `<option value="">— pick someone —</option>` +
    available
      .slice()
      .sort(
        (left, right) =>
          baseRating(toSimPlayer(right), position, rules) - baseRating(toSimPlayer(left), position, rules),
      )
      .map((row) => option(row, position, row.id === chosen))
      .join('') +
    `</select></div>`;

  const opponentId = fixture.homeClubId === clubId ? fixture.awayClubId : fixture.homeClubId;
  const opponent = await clubOf(db, opponentId);
  const deadline = deadlineFor(fixture.kickoffAt, season?.lineupDeadlineMinutes ?? 15);

  return page(
    { ...context.shell, title: `Matchday ${fixture.matchday}`, active: '/my', subtitle: `v ${opponent?.name ?? ''}` },
    `<section>
       <p class="deadline">${
         locked
           ? 'This match has been played. The team is locked.'
           : manual
             ? 'Open until you play this matchday.'
             : `Deadline ${deadline.toISOString().slice(0, 16).replace('T', ' ')} UTC — ${season?.lineupDeadlineMinutes ?? 15} minutes before kickoff.`
       }</p>
       <p class="note">Anything you leave blank is filled with the best available player. If someone you name is injured by kickoff, that slot is filled the same way rather than costing you the match.</p>
       <form method="post" action="/my/lineup">
         <input type="hidden" name="fixtureId" value="${fixture.id}">
         ${select('keeper', 'keeper', selection?.keeper)}
         ${select('chaser1', 'chaser', selection?.chasers?.[0])}
         ${select('chaser2', 'chaser', selection?.chasers?.[1])}
         ${select('chaser3', 'chaser', selection?.chasers?.[2])}
         ${select('beater1', 'beater', selection?.beaters?.[0])}
         ${select('beater2', 'beater', selection?.beaters?.[1])}
         ${select('seeker', 'seeker', selection?.seeker)}
         ${locked ? '' : '<button class="primary" type="submit">Submit this team</button>'}
       </form>
     </section>
     <section>
       <h2>Unavailable</h2>
       ${
         roster.filter((row) => row.injuredUntil && row.injuredUntil > onDate).length > 0
           ? tableHtml(
               [{ label: 'Player' }, { label: 'Pos' }, { label: 'Back' }],
               roster
                 .filter((row) => row.injuredUntil && row.injuredUntil > onDate)
                 .map((row) => [escapeHtml(row.name), row.position, row.injuredUntil ?? '']),
             )
           : '<p class="note">Everyone is fit.</p>'
       }
     </section>`,
  );
}

// --- tactics, training, facilities, finances, squad -------------------------

export async function tacticsPage(context: Context, clubId: string): Promise<string> {
  const club = await clubOf(context.db, clubId);
  const tactics = (club?.tactics ?? {}) as Partial<Tactics>;

  const choose = (name: keyof Tactics, options: string[], help: string): string =>
    `<label>${name.replace(/([A-Z])/g, ' $1').toLowerCase()}
       <select name="${name}">
         ${options
           .map(
             (value) =>
               `<option value="${value}"${tactics[name] === value ? ' selected' : ''}>${value}</option>`,
           )
           .join('')}
       </select>
       <span class="note" style="font-weight:400">${help}</span>
     </label>`;

  return page(
    { ...context.shell, title: 'Tactics', active: '/my' },
    `<section>
       <p class="note">Standing instructions. Every measured option is within a point or two of every other, so none of these is the right answer &mdash; they are different bets.</p>
       <div class="card" style="max-width:40rem">
         <form method="post" action="/my/tactics">
           ${choose('aggression', ['defensive', 'balanced', 'attacking'], 'Attacking buys shots and concedes possession.')}
           ${choose('seekerCommitment', ['hunt', 'balanced', 'support'], 'Support drops the seeker into open play: fewer snitches, more goals.')}
           ${choose('beaterFocus', ['seeker', 'chasers', 'protect'], 'Seeker suppresses their hunt; chasers wears down their attack; protect shields your own.')}
           <label>chase the game
             <select name="chaseTheGame">
               <option value="yes"${tactics.chaseTheGame !== false ? ' selected' : ''}>yes</option>
               <option value="no"${tactics.chaseTheGame === false ? ' selected' : ''}>no</option>
             </select>
             <span class="note" style="font-weight:400">Throw everything forward when trailing late.</span>
           </label>
           <button class="primary" type="submit">Save tactics</button>
         </form>
       </div>
     </section>`,
  );
}

export async function trainingPage(context: Context, clubId: string): Promise<string> {
  const { db } = context;
  const season = await currentSeason(db);
  if (!season) return page({ ...context.shell, title: 'Training' }, '<section><div class="card"><p class="note">No season is running.</p></div></section>');

  const order = await trainingOrderFor(db, clubId, season.id);
  const roster = await rosterOf(db, clubId);
  const levels = await facilityLevels(db, clubId);

  const costs = (Object.keys(INTENSITY) as TrainingIntensity[]).map((intensity) => [
    intensity,
    galleons(-weeklyTrainingCost({ focus: null, intensity }, roster.length)),
    `${INTENSITY[intensity].gain.toFixed(2)}x`,
    `${INTENSITY[intensity].risk.toFixed(2)}x`,
  ]);

  return page(
    { ...context.shell, title: 'Training', active: '/my' },
    `<section>
       <p class="note">One order per season, charged every week it runs. Development is gated on minutes played, so a prospect who never gets on the pitch barely improves however hard the squad trains &mdash; which is the whole reason to risk playing one.</p>
       <div class="card" style="max-width:40rem">
         <form method="post" action="/my/training">
           <label>focus
             <select name="focus">
               <option value=""${!order?.focus ? ' selected' : ''}>general fitness</option>
               ${ATTRIBUTES.map((attribute) => `<option value="${attribute}"${order?.focus === attribute ? ' selected' : ''}>${attribute}</option>`).join('')}
             </select>
             <span class="note" style="font-weight:400">A focus only helps players whose position reads that attribute. Training strength into a keeper buys nothing.</span>
           </label>
           <label>intensity
             <select name="intensity">
               ${(Object.keys(INTENSITY) as TrainingIntensity[]).map((intensity) => `<option value="${intensity}"${(order?.intensity ?? 'normal') === intensity ? ' selected' : ''}>${intensity}</option>`).join('')}
             </select>
             <span class="note" style="font-weight:400">Hard training develops faster and injures more.</span>
           </label>
           <button class="primary" type="submit">Set the order</button>
         </form>
       </div>
       ${tableHtml(
         [{ label: 'Intensity' }, { label: 'Cost / week', num: true }, { label: 'Development', num: true }, { label: 'Injury risk', num: true }],
         costs,
       )}
       <p class="note">Your training ground is level ${levels.trainingGround}, worth a ${(1 + 0.16 * levels.trainingGround).toFixed(2)}x multiplier on all of it.</p>
     </section>`,
  );
}

export async function facilitiesPage(context: Context, clubId: string): Promise<string> {
  const { db } = context;
  const levels = await facilityLevels(db, clubId);
  const balance = await balanceOf(db, clubId);
  const upkeep = weeklyUpkeep(levels);

  const rows = FACILITIES.map((facility) => {
    const level = levels[facility.kind];
    const cost = upgradeCost(facility.kind, level);
    const affordable = cost > 0 && balance >= cost;
    return `<div class="card">
      <div class="cardhead" style="display:flex;justify-content:space-between;align-items:baseline;gap:10px">
        <h3>${facility.name}</h3><span class="tag">level ${level} / ${facility.maxLevel}</span>
      </div>
      <p class="note">${facility.effect}</p>
      ${
        cost === 0
          ? '<p class="note">Fully built.</p>'
          : `<form method="post" action="/my/facilities">
               <input type="hidden" name="kind" value="${facility.kind}">
               <button class="${affordable ? 'primary' : 'secondary'}" type="submit"${affordable ? '' : ' disabled'}>
                 Upgrade for ${cost.toLocaleString()}
               </button>
             </form>`
      }
    </div>`;
  });

  return page(
    { ...context.shell, title: 'Facilities', active: '/my' },
    `<section>
       <dl class="kv">
         <div><dt>Balance</dt><dd>${galleons(balance)}</dd></div>
         <div><dt>Upkeep / week</dt><dd>${galleons(-upkeep)}</dd></div>
       </dl>
       <p class="note">Upkeep is charged on what you have sunk in, at 1.2% a week. That is deliberate: a club that buys everything carries a fixed cost it has to keep winning to afford.</p>
     </section>
     <section><div class="grid">${rows.join('')}</div></section>`,
  );
}

export async function financesPage(context: Context, clubId: string): Promise<string> {
  const { db } = context;
  const balance = await balanceOf(db, clubId);
  const summary = await ledgerSummary(db, clubId);
  const entries = await ledgerFor(db, clubId, 60);

  return page(
    { ...context.shell, title: 'Finances', active: '/my' },
    `<section>
       <dl class="kv"><div><dt>Balance</dt><dd>${galleons(balance)}</dd></div></dl>
       <p class="note">The balance is the sum of these entries and is never stored as a number of its own. Every Galleon has a reason attached.</p>
     </section>
     <section>
       <h2>By kind</h2>
       ${tableHtml(
         [{ label: 'Kind' }, { label: 'Entries', num: true }, { label: 'Total', num: true }],
         summary.map((row) => [row.kind, String(row.entries), galleons(row.total)]),
       )}
     </section>
     <section>
       <h2>Recent entries</h2>
       ${tableHtml(
         [{ label: 'When' }, { label: 'Kind' }, { label: 'Reason' }, { label: 'Amount', num: true }],
         entries.map((row) => [
           row.createdAt.toISOString().slice(0, 16).replace('T', ' '),
           row.kind,
           escapeHtml(row.reason),
           galleons(row.amount),
         ]),
       )}
     </section>`,
  );
}

/**
 * The squad page a manager sees, as distinct from the public one.
 *
 * The difference is the potential column: a manager gets a scout's range rather
 * than the number, and the range narrows as they pay for a scouting network. That
 * fog is what turns the transfer market from arithmetic into judgement.
 */
export async function squadPage(context: Context, clubId: string): Promise<string> {
  const { db } = context;
  const season = await currentSeason(db);
  const rules = season ? rulesByVersion(season.rulesVersion) : DEFAULT_RULES;
  const roster = await rosterOf(db, clubId);
  const levels = await facilityLevels(db, clubId);
  const range = scoutRange(levels.scoutingNetwork);

  const rows = roster.map((row) => {
    const player = toSimPlayer(row);
    const rating = overall(player, rules);
    const low = Math.max(Math.round(rating), Math.round(row.potential - range / 2));
    const high = Math.min(99, Math.round(row.potential + range / 2));
    return [
      `<span class="tag">${row.position.slice(0, 3)}</span>`,
      escapeHtml(row.name) + (row.injuredUntil ? ' <span class="tag">injured</span>' : ''),
      String(row.age),
      `<strong>${rating.toFixed(0)}</strong>`,
      row.age <= 24 ? `${low}–${high}` : '—',
      galleons(-row.wage),
      String(row.form),
      String(row.stamina),
      String(row.morale),
      String(row.xp),
    ];
  });

  return page(
    { ...context.shell, title: 'Squad', active: '/my' },
    `<section>
       ${tableHtml(
         [
           { label: 'Pos' },
           { label: 'Player' },
           { label: 'Age', num: true },
           { label: 'Rating', num: true },
           { label: 'Ceiling' },
           { label: 'Wage', num: true },
           { label: 'Form', num: true },
           { label: 'Fit', num: true },
           { label: 'Morale', num: true },
           { label: 'XP', num: true },
         ],
         rows,
       )}
       <p class="note">Ceiling is your scouts' estimate, not the number. Your scouting network is level ${levels.scoutingNetwork}, which narrows it to about ${range.toFixed(0)} points; only players 24 and under are worth a report.</p>
     </section>`,
  );
}

export { ATTRIBUTES, POSITION_WEIGHTS };

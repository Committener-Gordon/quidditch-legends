/**
 * Routing, including everything that writes.
 *
 * Two rules hold throughout. A GET never mutates, so the whole read side stays
 * cacheable and safe to reload. And every POST is checked for same-origin, then
 * answers with a redirect rather than a body, so a refresh after submitting a team
 * does not submit it again.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { rulesByVersion, type Attribute, type Tactics } from '@ql/sim';
import type { FacilityKind, TrainingIntensity } from '@ql/economy';
import {
  activeRoster,
  authenticate,
  claimClub,
  clubById,
  createSession,
  currentSeason,
  destroySession,
  fixtureById,
  fixtureOnMatchday,
  isPastDeadline,
  listingFor,
  nextUnplayedMatchday,
  purchaseFacility,
  registerUser,
  saveLineup,
  saveTactics,
  setPlaybackSeconds,
  sessionUser,
  setTrainingOrder,
  toTactics,
  unclaimedClubs,
  validateSelection,
  type Database,
  type DbHandle,
  type LineupSelection,
  type SessionUser,
} from '@ql/db';
import { page } from './layout.js';
import {
  clubPage,
  clubsPage,
  fixturesPage,
  leadersPage,
  matchPage,
  tablePage,
  type Shell,
} from './pages.js';
import {
  buyListed,
  listPlayer,
  newSeason,
  renewContract,
  runMatchday,
  runOffseason,
  scoutPlayer,
  sellToMarket,
  settleWorld,
  signFreeAgent,
  unlistPlayer,
} from '@ql/worker/jobs';
import { guidePage } from './guide.js';
import {
  claimPage,
  contractsPage,
  marketPage,
  marketPlayerPage,
  dashboardPage,
  facilitiesPage,
  financesPage,
  lineupPage,
  loginPage,
  registerPage,
  squadPage,
  tacticsPage,
  trainingPage,
} from './manage.js';
import {
  SESSION_COOKIE,
  clearCookie,
  field,
  readCookie,
  readForm,
  redirect,
  sameOrigin,
  setCookie,
  withNotice,
} from './http.js';

const UUID = '[0-9a-f-]{36}';

function notFound(shell: Shell): string {
  return page(
    { ...shell, title: 'Not found' },
    '<section><div class="card"><p class="note">There is nothing at that address.</p><p><a href="/">Back to the table</a></p></div></section>',
  );
}

function needsSignIn(shell: Shell): string {
  return page(
    { ...shell, title: 'Sign in first' },
    '<section><div class="card"><p class="note">You need an account to run a club.</p><p><a href="/login">Sign in</a> or <a href="/register">create one</a>.</p></div></section>',
  );
}

function html(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(body);
}

export interface RouterOptions {
  port: number;
}

export async function handle(
  db: Database,
  request: IncomingMessage,
  response: ServerResponse,
  options: RouterOptions,
): Promise<void> {
  // Let time catch up before anything is read: any match whose playback has run
  // out becomes official here. Idempotent, and free once there is nothing due.
  await settleWorld(db);

  const url = new URL(request.url ?? '/', `http://localhost:${options.port}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const token = readCookie(request, SESSION_COOKIE);
  const user = await sessionUser(db, token);

  const notice = url.searchParams.get('ok')
    ? { text: url.searchParams.get('ok')!, kind: 'ok' as const }
    : url.searchParams.get('problem')
      ? { text: url.searchParams.get('problem')!, kind: 'problem' as const }
      : null;

  const shell: Shell = {
    user: user ? { displayName: user.displayName, clubId: user.clubId } : null,
    notice,
  };

  if (request.method === 'POST') {
    if (!sameOrigin(request, options.port)) {
      html(response, 403, page({ ...shell, title: 'Refused' }, '<section><div class="card"><p class="note">That request did not come from this site.</p></div></section>'));
      return;
    }
    await post(db, request, response, path, user, token, shell);
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    html(response, 405, notFound(shell));
    return;
  }

  await get(db, response, path, url, user, shell);
}

// --- reads ------------------------------------------------------------------

async function get(
  db: Database,
  response: ServerResponse,
  path: string,
  url: URL,
  user: SessionUser | null,
  shell: Shell,
): Promise<void> {
  switch (path) {
    case '/':
    case '/table':
      return html(response, 200, await tablePage(db, shell));
    case '/fixtures':
      return html(response, 200, await fixturesPage(db, false, shell));
    case '/results':
      return html(response, 200, await fixturesPage(db, true, shell));
    case '/leaders':
      return html(response, 200, await leadersPage(db, shell));
    case '/clubs':
      return html(response, 200, await clubsPage(db, shell));
    case '/guide':
      return html(response, 200, guidePage(shell));
    case '/login':
      return html(response, 200, user ? redirectBody('/my') : loginPage(shell));
    case '/register':
      return html(response, 200, user ? redirectBody('/my') : registerPage(shell));
    default:
      break;
  }

  const match = new RegExp(`^/match/(${UUID})$`).exec(path);
  if (match) {
    const body = await matchPage(db, match[1]!, shell);
    return html(response, body ? 200 : 404, body ?? notFound(shell));
  }

  const club = new RegExp(`^/club/(${UUID})$`).exec(path);
  if (club) {
    const body = await clubPage(db, club[1]!, shell);
    return html(response, body ? 200 : 404, body ?? notFound(shell));
  }

  // Everything below needs an account.
  if (path === '/claim' || path.startsWith('/my') || path.startsWith('/market')) {
    if (!user) return html(response, 401, needsSignIn(shell));
    const context = { db, user, shell };

    if (path === '/claim') {
      if (user.clubId) return redirect(response, '/my');
      return html(response, 200, await claimPage(context, await unclaimedClubs(db)));
    }

    if (!user.clubId) return redirect(response, '/claim');

    if (path === '/market') {
      const position = url.searchParams.get('position');
      return html(
        response,
        200,
        await marketPage(context, user.clubId, position ? { position } : {}),
      );
    }
    const marketPlayer = new RegExp(`^/market/(${UUID})$`).exec(path);
    if (marketPlayer) {
      const body = await marketPlayerPage(context, user.clubId, marketPlayer[1]!);
      return html(response, body ? 200 : 404, body ?? notFound(shell));
    }

    switch (path) {
      case '/my':
        return html(response, 200, await dashboardPage(context, user.clubId));
      case '/my/tactics':
        return html(response, 200, await tacticsPage(context, user.clubId));
      case '/my/training':
        return html(response, 200, await trainingPage(context, user.clubId));
      case '/my/facilities':
        return html(response, 200, await facilitiesPage(context, user.clubId));
      case '/my/finances':
        return html(response, 200, await financesPage(context, user.clubId));
      case '/my/squad':
        return html(response, 200, await squadPage(context, user.clubId));
      case '/my/contracts':
        return html(response, 200, await contractsPage(context, user.clubId));
      case '/my/lineup': {
        const fixtureId = url.searchParams.get('fixture');
        if (!fixtureId) return redirect(response, '/my');
        const body = await lineupPage(context, user.clubId, fixtureId);
        return html(response, body ? 200 : 404, body ?? notFound(shell));
      }
      default:
        return html(response, 404, notFound(shell));
    }
  }

  return html(response, 404, notFound(shell));
}

function redirectBody(to: string): string {
  return `<!doctype html><meta http-equiv="refresh" content="0;url=${to}">`;
}

// --- writes -----------------------------------------------------------------

async function post(
  db: Database,
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  user: SessionUser | null,
  token: string | null,
  shell: Shell,
): Promise<void> {
  const form = await readForm(request);

  if (path === '/login') {
    const result = await authenticate(db, field(form, 'email'), field(form, 'password'));
    if (!result.ok || !result.userId) {
      return html(response, 401, loginPage(shell, result.error));
    }
    const session = await createSession(db, result.userId);
    setCookie(response, SESSION_COOKIE, session.token, { expires: session.expiresAt });
    return redirect(response, '/my');
  }

  if (path === '/register') {
    const result = await registerUser(db, {
      email: field(form, 'email'),
      displayName: field(form, 'displayName'),
      password: field(form, 'password'),
    });
    if (!result.ok || !result.userId) {
      return html(response, 400, registerPage(shell, result.error));
    }
    const session = await createSession(db, result.userId);
    setCookie(response, SESSION_COOKIE, session.token, { expires: session.expiresAt });
    return redirect(response, '/claim');
  }

  if (path === '/logout') {
    await destroySession(db, token);
    clearCookie(response, SESSION_COOKIE);
    return redirect(response, '/');
  }

  if (!user) return html(response, 401, needsSignIn(shell));

  if (path === '/claim') {
    const result = await claimClub(db, user.id, field(form, 'clubId'));
    return redirect(
      response,
      result.ok
        ? withNotice('/my', 'You are in charge. Pick a team for your next match.')
        : withNotice('/claim', result.error ?? 'that did not work', 'problem'),
    );
  }

  if (!user.clubId) return redirect(response, '/claim');
  const clubId = user.clubId;

  if (path === '/my/lineup') {
    return postLineup(db, response, form, clubId, user);
  }

  if (path === '/my/play') {
    return postPlay(db, response, form, clubId);
  }

  if (path === '/market/buy') {
    // One button for both: a listed player has a price, a free agent has a
    // signing-on fee. The manager should not have to know which they clicked.
    const playerId = field(form, 'playerId');
    const listing = await listingFor(db, playerId);
    const outcome = listing
      ? await buyListed(db, clubId, playerId)
      : await signFreeAgent(db, clubId, playerId);
    return redirect(
      response,
      outcome.ok
        ? withNotice('/market', listing ? `Signed for ${outcome.value.toLocaleString()} Galleons.` : `Signed on a free transfer for ${outcome.value.toLocaleString()}.`)
        : withNotice('/market', outcome.reason, 'problem'),
    );
  }

  if (path === '/market/scout') {
    const playerId = field(form, 'playerId');
    const back = field(form, 'back') || '/market';
    const outcome = await scoutPlayer(db, clubId, playerId);
    return redirect(
      response,
      outcome.ok
        ? withNotice(back, `Scouts report a ceiling of ${outcome.value.low}-${outcome.value.high}.`)
        : withNotice(back, outcome.reason, 'problem'),
    );
  }

  if (path === '/my/list' || path === '/my/unlist') {
    const playerId = field(form, 'playerId');
    const outcome =
      path === '/my/list'
        ? await listPlayer(db, clubId, playerId)
        : await unlistPlayer(db, clubId, playerId);
    return redirect(
      response,
      outcome.ok
        ? withNotice('/my/squad', path === '/my/list' ? `Listed at ${Number(outcome.value).toLocaleString()} Galleons.` : 'Taken off the list.')
        : withNotice('/my/squad', outcome.reason, 'problem'),
    );
  }

  if (path === '/my/sell') {
    const outcome = await sellToMarket(db, clubId, field(form, 'playerId'));
    return redirect(
      response,
      outcome.ok
        ? withNotice('/my/squad', `Sold for ${outcome.value.toLocaleString()} Galleons.`)
        : withNotice('/my/squad', outcome.reason, 'problem'),
    );
  }

  if (path === '/my/renew') {
    const outcome = await renewContract(db, clubId, field(form, 'playerId'));
    return redirect(
      response,
      outcome.ok
        ? withNotice('/my/contracts', `Re-signed to season ${outcome.value.until} at ${outcome.value.wage.toLocaleString()} a week.`)
        : withNotice('/my/contracts', outcome.reason, 'problem'),
    );
  }

  if (path === '/my/next-season') {
    return postNextSeason(db, response);
  }

  if (path === '/my/tactics') {
    const club = await clubById(db, clubId);
    const current = toTactics(club?.tactics);
    const next: Tactics = {
      aggression: pick(field(form, 'aggression'), ['defensive', 'balanced', 'attacking'], current.aggression),
      seekerCommitment: pick(field(form, 'seekerCommitment'), ['hunt', 'balanced', 'support'], current.seekerCommitment),
      beaterFocus: pick(field(form, 'beaterFocus'), ['seeker', 'chasers', 'protect'], current.beaterFocus),
      chaseTheGame: field(form, 'chaseTheGame') !== 'no',
    };
    await saveTactics(db, clubId, next);
    return redirect(response, withNotice('/my/tactics', 'Tactics saved.'));
  }

  if (path === '/my/training') {
    const season = await currentSeason(db);
    if (!season) return redirect(response, withNotice('/my/training', 'no season is running', 'problem'));
    const focus = field(form, 'focus');
    const intensity = pick(field(form, 'intensity'), ['light', 'normal', 'hard'], 'normal') as TrainingIntensity;
    await setTrainingOrder(db, clubId, season.id, focus === '' ? null : (focus as Attribute), intensity);
    return redirect(response, withNotice('/my/training', 'Training order set for the season.'));
  }

  if (path === '/my/facilities') {
    const season = await currentSeason(db);
    const kind = field(form, 'kind') as FacilityKind;
    const outcome = await purchaseFacility(db, clubId, kind, season?.id ?? null);
    return redirect(
      response,
      outcome.ok
        ? withNotice('/my/facilities', `Upgraded to level ${outcome.level} for ${outcome.cost.toLocaleString()} Galleons.`)
        : withNotice('/my/facilities', outcome.reason, 'problem'),
    );
  }

  return html(response, 404, notFound(shell));
}

/**
 * Play the next matchday, because the player said so.
 *
 * This is the single-player clock: there is one manager, so there is nobody to be
 * unfair to by letting them decide when the round happens. The whole division
 * plays, not just their fixture -- a league where only your own match resolves is
 * not a league.
 */
async function postPlay(
  db: Database,
  response: ServerResponse,
  form: Map<string, string[]>,
  clubId: string,
): Promise<void> {
  const season = await currentSeason(db);
  if (!season) return redirect(response, withNotice('/my', 'no season is running', 'problem'));
  if (season.pacing !== 'manual') {
    return redirect(
      response,
      withNotice('/my', 'this season runs on a schedule, so matchdays play at their kickoff time', 'problem'),
    );
  }
  if (season.state === 'complete') {
    return redirect(response, withNotice('/my', 'the season is over', 'problem'));
  }

  const asked = Number(field(form, 'matchday'));
  const next = await nextUnplayedMatchday(db, season.id);

  const matchday = Number.isFinite(asked) && asked > 0 ? asked : next;
  if (!matchday) return redirect(response, withNotice('/my', 'nothing left to play', 'problem'));

  // Only ever the next unplayed one, whatever the form said.
  if (next !== null && matchday !== next) {
    return redirect(response, withNotice('/my', `matchday ${next} is next`, 'problem'));
  }

  // How long the matches should take to play out on screen. Remembered on the
  // season so the choice sticks.
  const asked_seconds = field(form, 'playback');
  const playbackSeconds = /^\d+$/.test(asked_seconds)
    ? Math.min(3600, Number(asked_seconds))
    : season.playbackSeconds;
  if (playbackSeconds !== season.playbackSeconds) {
    await setPlaybackSeconds(db, season.id, playbackSeconds);
  }

  const result = await runMatchday(db, { seasonNumber: season.number, matchday, playbackSeconds });

  // Report the player's own fixture, not whichever happened to be first.
  const ours = await fixtureOnMatchday(db, season.id, matchday, clubId);
  const line = result.lines.find((entry) => entry.fixtureId === ours?.id);

  // Straight to the feed if there is something to watch; otherwise the score.
  if (playbackSeconds > 0 && line) {
    return redirect(response, `/match/${line.matchId}`);
  }
  const summary = line
    ? `Matchday ${matchday}: ${line.home} ${line.homePoints}-${line.awayPoints} ${line.away}`
    : `Matchday ${matchday} played.`;
  return redirect(response, withNotice('/my', summary));
}

/** Wrap the season up and start the next one, once every fixture is played. */
async function postNextSeason(db: Database, response: ServerResponse): Promise<void> {
  const season = await currentSeason(db);
  if (!season) return redirect(response, withNotice('/my', 'no season to finish', 'problem'));
  if (season.state !== 'complete') {
    return redirect(response, withNotice('/my', 'there are still fixtures to play', 'problem'));
  }

  await runOffseason(db, { seasonNumber: season.number });
  const created = await newSeason(db, {
    number: season.number + 1,
    rulesVersion: season.rulesVersion,
    pacing: 'manual',
  });

  return redirect(
    response,
    withNotice('/my', `Season ${created.number} is ready. ${created.matchdays} matchdays to play.`),
  );
}

async function postLineup(
  db: Database,
  response: ServerResponse,
  form: Map<string, string[]>,
  clubId: string,
  user: SessionUser,
): Promise<void> {
  const fixtureId = field(form, 'fixtureId');
  const fixture = await fixtureById(db, fixtureId);
  const back = `/my/lineup?fixture=${fixtureId}`;

  if (!fixture || (fixture.homeClubId !== clubId && fixture.awayClubId !== clubId)) {
    return redirect(response, withNotice('/my', 'that is not one of your fixtures', 'problem'));
  }
  // Enforced here, once, on the server. The form disables itself too, but that is
  // a courtesy rather than the rule. Under manual pacing the only thing that
  // closes a lineup is the match having been played -- there is no clock to beat.
  const season = await currentSeason(db);
  const manual = (season?.pacing ?? 'manual') === 'manual';
  if (fixture.status !== 'scheduled') {
    return redirect(response, withNotice(back, 'that match has already been played', 'problem'));
  }
  if (!manual && isPastDeadline(fixture.kickoffAt, new Date(), season?.lineupDeadlineMinutes ?? 15)) {
    return redirect(response, withNotice(back, 'the deadline for that match has passed', 'problem'));
  }

  const selection: LineupSelection = {
    keeper: field(form, 'keeper'),
    seeker: field(form, 'seeker'),
    chasers: [field(form, 'chaser1'), field(form, 'chaser2'), field(form, 'chaser3')].filter(Boolean),
    beaters: [field(form, 'beater1'), field(form, 'beater2')].filter(Boolean),
  };

  const roster = await activeRoster(db, clubId);

  const onDate = fixture.kickoffAt.toISOString().slice(0, 10);
  const check = validateSelection(selection, roster, onDate);
  if (!check.ok) {
    return redirect(response, withNotice(back, check.errors[0] ?? 'that team is not valid', 'problem'));
  }

  const chosen = new Set([selection.keeper, selection.seeker, ...selection.chasers, ...selection.beaters]);
  const bench = roster
    .filter((row) => !chosen.has(row.id) && (!row.injuredUntil || row.injuredUntil <= onDate))
    .sort((left, right) => right.stamina - left.stamina)
    .map((row) => row.id);

  await saveLineup(db, {
    fixtureId,
    clubId,
    selection,
    bench,
    submittedBy: user.id,
  });

  return redirect(response, withNotice(back, 'Team submitted.'));
}

function pick<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export { rulesByVersion };
export type { DbHandle };

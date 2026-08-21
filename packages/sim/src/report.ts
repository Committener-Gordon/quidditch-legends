/**
 * Rendering a match from its event log.
 *
 * The log is the match; everything a reader sees is a fold over it. This module
 * renders the terminal version. The web app will render the same events as a
 * timeline and a box score, from the same data, with no re-simulation.
 */

import { createRng } from './rng.js';
import type { MatchEvent, MatchResult, PlayerStatLine, Side } from './types.js';

interface Names {
  get(playerId: string): string;
}

function nameIndex(stats: PlayerStatLine[]): Names {
  const map = new Map<string, string>();
  for (const line of stats) map.set(line.playerId, line.name);
  return { get: (id) => map.get(id) ?? id };
}

function surname(full: string): string {
  const parts = full.split(' ');
  return parts[parts.length - 1] ?? full;
}

const GOAL_LINES = [
  '{p} slots it through the left hoop',
  '{p} rises above the defence and buries it',
  '{p} beats the keeper at the near hoop',
  '{p} finishes off a flowing move',
  '{p} snaps it in from range',
];

const CATCH_LINES = [
  '{p} closes a hand round the snitch',
  '{p} wins the dive and the snitch is theirs',
  '{p} plucks snitch #{i} out of the air',
  '{p} runs the snitch down at the far end',
];

const SAVE_LINES = ['{k} turns {s} away', '{k} gets a hand to it', '{k} smothers {s} at the hoop'];

const HIT_LINES = [
  '{b} rattles {t} with a bludger',
  '{b} picks out {t} and does not miss',
  '{b} catches {t} square in the ribs',
];

/** How much of the noisy texture to keep in a terminal timeline. */
const SAMPLE = { SAVE: 0.12, BLUDGER_HIT: 0.15, INTERCEPTION: 0.08 } as const;

export interface ReportOptions {
  /** Include sampled saves, hits and interceptions. */
  texture?: boolean;
  /** Print the per-player box score. */
  boxScore?: boolean;
  width?: number;
}

export function renderMatchReport(result: MatchResult, options: ReportOptions = {}): string {
  const { texture = true, boxScore = true, width = 78 } = options;
  const names = nameIndex(result.stats);
  const rng = createRng(`${result.seed}::report`);
  const out: string[] = [];

  const label = (side: Side) => (side === 'home' ? result.home.short : result.away.short);
  const teamName = (side: Side) => (side === 'home' ? result.home.name : result.away.name);

  // --- header ---------------------------------------------------------------
  const homeLine = `${result.home.name}`;
  const awayLine = `${result.away.name}`;
  const scoreLine = `${result.score.home}  -  ${result.score.away}`;
  out.push('='.repeat(width));
  out.push(pad(homeLine, 28) + centre(scoreLine, 20) + padLeft(awayLine, 28));
  out.push(
    centre(
      `goals ${result.goals.home}-${result.goals.away}` +
        `   snitches ${result.catches.home}-${result.catches.away}` +
        `   shots ${result.shots.home}-${result.shots.away}` +
        `   ${result.minutes}'`,
      width,
    ),
  );
  out.push('='.repeat(width));
  out.push('');

  // --- timeline -------------------------------------------------------------
  for (const event of result.events) {
    const line = describe(event, names, label, teamName, rng, texture);
    if (line) out.push(line);
  }

  // --- box score ------------------------------------------------------------
  if (boxScore) {
    for (const side of ['home', 'away'] as Side[]) {
      out.push('');
      out.push(`${teamName(side)}`);
      out.push(renderBoxScore(result.stats.filter((s) => s.side === side)));
    }
  }

  return out.join('\n');
}

function describe(
  event: MatchEvent,
  names: Names,
  label: (side: Side) => string,
  teamName: (side: Side) => string,
  rng: ReturnType<typeof createRng>,
  texture: boolean,
): string | null {
  const stamp = (minute: number, tag: string) => `${String(minute).padStart(3)}'  ${tag.padEnd(5)}`;

  switch (event.type) {
    case 'KICKOFF':
      return `${stamp(0, '')}the snitch is released and they are away`;
    case 'SNITCH_RELEASED':
      return null; // folded into the catch line that caused it
    case 'GOAL': {
      const scorer = names.get(event.playerId);
      const assist = event.assistId ? `, set up by ${surname(names.get(event.assistId))}` : '';
      const text = rng.pick(GOAL_LINES).replace('{p}', scorer) + assist;
      return `${stamp(event.minute, label(event.side))}${text}  [${event.score.home}-${event.score.away}]`;
    }
    case 'SNITCH_CAUGHT': {
      const text = rng
        .pick(CATCH_LINES)
        .replace('{p}', names.get(event.seekerId))
        .replace('{i}', String(event.index));
      return `${stamp(event.minute, label(event.side))}${text} (+30, a new snitch is away)  [${event.score.home}-${event.score.away}]`;
    }
    case 'SAVE': {
      if (!texture || !rng.chance(SAMPLE.SAVE)) return null;
      const text = rng
        .pick(SAVE_LINES)
        .replace('{k}', names.get(event.keeperId))
        .replace('{s}', surname(names.get(event.shooterId)));
      return `${stamp(event.minute, label(event.side))}${text}`;
    }
    case 'BLUDGER_HIT': {
      if (!texture || !rng.chance(SAMPLE.BLUDGER_HIT)) return null;
      const text = rng
        .pick(HIT_LINES)
        .replace('{b}', names.get(event.beaterId))
        .replace('{t}', surname(names.get(event.targetId)));
      return `${stamp(event.minute, label(event.side))}${text}`;
    }
    case 'INTERCEPTION': {
      if (!texture || !rng.chance(SAMPLE.INTERCEPTION)) return null;
      return `${stamp(event.minute, label(event.side))}${names.get(event.playerId)} reads it and takes the quaffle`;
    }
    case 'INJURY':
      return `${stamp(event.minute, label(event.side))}${names.get(event.playerId)} is hurt and cannot shake it off (${event.days} days)`;
    case 'SUBSTITUTION':
      return `${stamp(event.minute, label(event.side))}${names.get(event.onId)} replaces ${surname(names.get(event.offId))} (${event.reason})`;
    case 'TACTIC_SHIFT':
      return `${stamp(event.minute, label(event.side))}${teamName(event.side)} throw everything forward`;
    case 'FULL_TIME':
      return `${stamp(event.minute, '')}full time  [${event.score.home}-${event.score.away}]`;
    default:
      return null;
  }
}

const COLUMNS: { head: string; width: number; get(line: PlayerStatLine): string }[] = [
  { head: 'POS', width: 4, get: (l) => l.position.slice(0, 3).toUpperCase() },
  { head: 'PLAYER', width: 22, get: (l) => l.name },
  { head: 'MIN', width: 4, get: (l) => String(l.minutes) },
  { head: 'G', width: 3, get: (l) => String(l.goals) },
  { head: 'A', width: 3, get: (l) => String(l.assists) },
  { head: 'SH', width: 4, get: (l) => String(l.shots) },
  { head: 'SV', width: 4, get: (l) => String(l.saves) },
  { head: 'INT', width: 4, get: (l) => String(l.interceptions) },
  { head: 'HIT', width: 4, get: (l) => String(l.bludgerHits) },
  { head: 'CAT', width: 4, get: (l) => String(l.snitchCatches) },
  { head: 'STA', width: 4, get: (l) => String(l.staminaEnd) },
  { head: 'RTG', width: 5, get: (l) => l.rating.toFixed(1) },
];

const POSITION_ORDER = { keeper: 0, chaser: 1, beater: 2, seeker: 3 } as const;

export function renderBoxScore(stats: PlayerStatLine[]): string {
  const played = stats
    .filter((line) => line.minutes > 0)
    .sort((a, b) => POSITION_ORDER[a.position] - POSITION_ORDER[b.position] || b.minutes - a.minutes);
  const unused = stats.filter((line) => line.minutes === 0);

  const rows: string[] = [];
  rows.push(
    COLUMNS.map((column, index) =>
      index <= 1 ? pad(column.head, column.width) : padLeft(column.head, column.width),
    ).join(''),
  );
  rows.push('-'.repeat(COLUMNS.reduce((sum, column) => sum + column.width, 0)));

  for (const line of played) {
    rows.push(
      COLUMNS.map((column, index) =>
        index <= 1 ? pad(column.get(line), column.width) : padLeft(column.get(line), column.width),
      ).join(''),
    );
  }

  if (unused.length > 0) {
    rows.push(`unused: ${unused.map((line) => surname(line.name)).join(', ')}`);
  }

  return rows.join('\n');
}

function pad(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width - 1) + ' ' : text.padEnd(width);
}

function padLeft(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width) : text.padStart(width);
}

function centre(text: string, width: number): string {
  if (text.length >= width) return text;
  const left = Math.floor((width - text.length) / 2);
  return ' '.repeat(left) + text + ' '.repeat(width - text.length - left);
}

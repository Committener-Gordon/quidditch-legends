/**
 * The seam between the database and the engine.
 *
 * The engine knows nothing about rows and the database knows nothing about
 * simulation. Everything that crosses between them crosses here, which is why
 * this file is the one to read when a stat line and a table disagree.
 */

import {
  DEFAULT_TACTICS,
  autoLineup,
  type MatchEvent,
  type Player,
  type PlayerStatLine,
  type Position,
  type RuleSet,
  type Side,
  type Squad,
  type Tactics,
} from '@ql/sim';
import type { clubs, matchEvents, players, playerMatchStats } from './schema.js';

export type PlayerRow = typeof players.$inferSelect;
export type ClubRow = typeof clubs.$inferSelect;
export type MatchEventInsert = typeof matchEvents.$inferInsert;
export type PlayerStatInsert = typeof playerMatchStats.$inferInsert;

/** A squad-wide attribute bonus, which is what the broom store buys. */
export interface AttributeBonus {
  flying?: number;
}

export function toSimPlayer(row: PlayerRow, bonus: AttributeBonus = {}): Player {
  const cap = (value: number): number => Math.min(99, Math.max(1, value));
  return {
    id: row.id,
    name: row.name,
    age: row.age,
    position: row.position as Position,
    attributes: {
      flying: cap(row.flying + (bonus.flying ?? 0)),
      handling: row.handling,
      aim: row.aim,
      strength: row.strength,
      vision: row.vision,
      reflexes: row.reflexes,
      nerve: row.nerve,
    },
    stamina: row.stamina,
    form: row.form,
    morale: row.morale,
    potential: row.potential,
  };
}

export function toTactics(value: unknown): Tactics {
  if (!value || typeof value !== 'object') return { ...DEFAULT_TACTICS };
  return { ...DEFAULT_TACTICS, ...(value as Partial<Tactics>) };
}

/** A player is available unless their injury runs past kickoff, or they have retired. */
export function isAvailable(row: PlayerRow, onDate: string): boolean {
  if (row.retiredInSeason !== null) return false;
  if (row.injuredUntil && row.injuredUntil > onDate) return false;
  return true;
}

export interface SquadBuild {
  squad: Squad;
  /** Players left out because they were injured or suspended. */
  unavailable: PlayerRow[];
}

/**
 * Build a matchday squad from rows. Nobody has set a lineup in phase two, so this
 * is the auto-pick path -- the same one that will cover any manager who misses
 * the deadline in phase three.
 */
export function buildSquadFromRows(
  club: ClubRow,
  roster: PlayerRow[],
  onDate: string,
  rules: RuleSet,
): SquadBuild {
  const available: PlayerRow[] = [];
  const unavailable: PlayerRow[] = [];
  for (const row of roster) {
    (isAvailable(row, onDate) ? available : unavailable).push(row);
  }

  if (available.length < 7) {
    throw new Error(
      `${club.name} cannot field seven players (${available.length} available of ${roster.length})`,
    );
  }

  const { lineup, bench } = autoLineup(available.map((row) => toSimPlayer(row)), rules);
  return {
    squad: {
      clubId: club.id,
      name: club.name,
      short: club.short,
      lineup,
      bench,
      tactics: toTactics(club.tactics),
    },
    unavailable,
  };
}

/** Pull the two player references out of an event so they land in real columns. */
function eventPlayers(event: MatchEvent): { playerId: string | null; secondary: string | null } {
  switch (event.type) {
    case 'GOAL':
      return { playerId: event.playerId, secondary: event.assistId };
    case 'SAVE':
      return { playerId: event.keeperId, secondary: event.shooterId };
    case 'INTERCEPTION':
    case 'INJURY':
      return { playerId: event.playerId, secondary: null };
    case 'BLUDGER_HIT':
      return { playerId: event.beaterId, secondary: event.targetId };
    case 'SNITCH_CAUGHT':
      return { playerId: event.seekerId, secondary: null };
    case 'SUBSTITUTION':
      return { playerId: event.onId, secondary: event.offId };
    default:
      return { playerId: null, secondary: null };
  }
}

/** Everything about an event that is not already a column. */
function eventPayload(event: MatchEvent): Record<string, unknown> | null {
  switch (event.type) {
    case 'GOAL':
    case 'SNITCH_CAUGHT':
    case 'FULL_TIME':
      return { score: (event as { score: unknown }).score, ...('index' in event ? { index: event.index } : {}) };
    case 'INJURY':
      return { days: event.days };
    case 'SUBSTITUTION':
      return { reason: event.reason };
    case 'BLUDGER_HIT':
      return { targetPosition: event.targetPosition };
    case 'SNITCH_RELEASED':
      return { index: event.index };
    case 'TACTIC_SHIFT':
      return { to: event.to };
    default:
      return null;
  }
}

export function toEventRows(matchId: string, events: MatchEvent[]): MatchEventInsert[] {
  return events.map((event, seq) => {
    const { playerId, secondary } = eventPlayers(event);
    return {
      matchId,
      seq,
      minute: event.minute,
      type: event.type,
      side: 'side' in event ? (event.side as Side) : null,
      playerId,
      secondaryPlayerId: secondary,
      payload: eventPayload(event),
    };
  });
}

export function toStatRows(
  matchId: string,
  stats: PlayerStatLine[],
  clubIdBySide: Record<Side, string>,
): PlayerStatInsert[] {
  return stats.map((line) => ({
    matchId,
    playerId: line.playerId,
    clubId: clubIdBySide[line.side],
    side: line.side,
    position: line.position,
    minutes: line.minutes,
    goals: line.goals,
    assists: line.assists,
    shots: line.shots,
    saves: line.saves,
    shotsFaced: line.shotsFaced,
    interceptions: line.interceptions,
    bludgerHits: line.bludgerHits,
    hitsTaken: line.hitsTaken,
    snitchCatches: line.snitchCatches,
    staminaEnd: line.staminaEnd,
    rating: line.rating,
  }));
}

export type PlayerInsert = typeof players.$inferInsert;

/** A generated or developed engine player, on its way into the database. */
export function fromSimPlayer(
  player: Player,
  options: { clubId: string | null; joinedSeason: number },
): PlayerInsert {
  return {
    clubId: options.clubId,
    name: player.name,
    age: player.age,
    position: player.position,
    flying: player.attributes.flying,
    handling: player.attributes.handling,
    aim: player.attributes.aim,
    strength: player.attributes.strength,
    vision: player.attributes.vision,
    reflexes: player.attributes.reflexes,
    nerve: player.attributes.nerve,
    stamina: player.stamina,
    form: player.form,
    morale: player.morale,
    potential: player.potential ?? player.attributes.flying,
    joinedSeason: options.joinedSeason,
  };
}

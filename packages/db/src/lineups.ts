/**
 * Submitted lineups, and the deadline they have to beat.
 *
 * A lineup is per fixture, not per club, so a manager can rest a player for one
 * match without changing their standing side. If none was submitted by the
 * deadline the matchday job auto-picks -- the same code path every AI club uses,
 * which means a manager who forgets still fields a sensible team.
 */

import { and, eq } from 'drizzle-orm';
import { autoLineup, type Player, type RuleSet, type Squad, type Tactics } from '@ql/sim';
import type { Database } from './client.js';
import {
  isAvailable,
  toSimPlayer,
  toTactics,
  type AttributeBonus,
  type ClubRow,
  type PlayerRow,
} from './mapping.js';
import { fixtures, lineups } from './schema.js';

/** Minutes before kickoff that a lineup stops being editable. */
export const DEADLINE_MINUTES = 15;

export interface LineupSelection {
  keeper: string;
  seeker: string;
  chasers: string[];
  beaters: string[];
}

export type LineupRow = typeof lineups.$inferSelect;

export function deadlineFor(kickoffAt: Date): Date {
  return new Date(kickoffAt.getTime() - DEADLINE_MINUTES * 60_000);
}

export function isPastDeadline(kickoffAt: Date, now = new Date()): boolean {
  return now >= deadlineFor(kickoffAt);
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * Check a selection before it is stored, so an invalid team is refused at the form
 * rather than discovered by the matchday job at kickoff.
 */
export function validateSelection(
  selection: LineupSelection,
  roster: PlayerRow[],
  onDate: string,
): ValidationResult {
  const errors: string[] = [];
  const byId = new Map(roster.map((row) => [row.id, row]));

  if (selection.chasers.length !== 3) errors.push('pick exactly three chasers');
  if (selection.beaters.length !== 2) errors.push('pick exactly two beaters');
  if (!selection.keeper) errors.push('pick a keeper');
  if (!selection.seeker) errors.push('pick a seeker');

  const chosen = [selection.keeper, selection.seeker, ...selection.chasers, ...selection.beaters].filter(
    Boolean,
  );
  if (new Set(chosen).size !== chosen.length) {
    errors.push('a player cannot fill two positions at once');
  }

  for (const id of chosen) {
    const row = byId.get(id);
    if (!row) {
      errors.push('one of those players is not in this squad');
      continue;
    }
    if (!isAvailable(row, onDate)) errors.push(`${row.name} is not available for this match`);
  }

  return { ok: errors.length === 0, errors };
}

export async function lineupFor(
  db: Database,
  fixtureId: string,
  clubId: string,
): Promise<LineupRow | null> {
  const [row] = await db
    .select()
    .from(lineups)
    .where(and(eq(lineups.fixtureId, fixtureId), eq(lineups.clubId, clubId)));
  return row ?? null;
}

export interface SaveLineupInput {
  fixtureId: string;
  clubId: string;
  selection: LineupSelection;
  /** Ordered: the auto-subs reach for the front of this list first. */
  bench: string[];
  tactics?: Partial<Tactics> | null;
  submittedBy?: string | null;
}

export async function saveLineup(db: Database, input: SaveLineupInput): Promise<void> {
  await db
    .insert(lineups)
    .values({
      fixtureId: input.fixtureId,
      clubId: input.clubId,
      starters: input.selection,
      bench: input.bench,
      tactics: input.tactics ?? null,
      submittedBy: input.submittedBy ?? null,
      submittedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [lineups.fixtureId, lineups.clubId],
      set: {
        starters: input.selection,
        bench: input.bench,
        tactics: input.tactics ?? null,
        submittedBy: input.submittedBy ?? null,
        submittedAt: new Date(),
      },
    });
}

export interface SquadBuildResult {
  squad: Squad;
  /** True when this side was picked by a person rather than auto-picked. */
  submitted: boolean;
  /** Anything the submitted lineup asked for that could not be honoured. */
  notes: string[];
}

/**
 * Turn a stored lineup into a squad the engine can play.
 *
 * A submitted lineup is honoured where it can be. If it names a player who has
 * since been injured, that slot falls back to the best available replacement
 * rather than failing the whole fixture: a manager should not forfeit a match
 * because someone limped off three days ago.
 */
export function buildSquadFromLineup(
  club: ClubRow,
  roster: PlayerRow[],
  lineup: LineupRow | null,
  onDate: string,
  rules: RuleSet,
  bonus: AttributeBonus = {},
): SquadBuildResult {
  const available = roster.filter((row) => isAvailable(row, onDate));
  if (available.length < 7) {
    throw new Error(`${club.name} cannot field seven players (${available.length} available)`);
  }

  const clubTactics = toTactics(club.tactics);

  if (!lineup) {
    const { lineup: picked, bench } = autoLineup(
      available.map((row) => toSimPlayer(row, bonus)),
      rules,
    );
    return {
      squad: { clubId: club.id, name: club.name, short: club.short, lineup: picked, bench, tactics: clubTactics },
      submitted: false,
      notes: [],
    };
  }

  const notes: string[] = [];
  const byId = new Map(available.map((row) => [row.id, toSimPlayer(row, bonus)]));
  const used = new Set<string>();

  const take = (id: string | undefined, position: Player['position']): Player | null => {
    if (!id) return null;
    const player = byId.get(id);
    if (!player || used.has(id)) {
      const missing = roster.find((row) => row.id === id);
      if (missing) notes.push(`${missing.name} was unavailable and had to be replaced`);
      return null;
    }
    used.add(id);
    void position;
    return player;
  };

  const selection = lineup.starters as LineupSelection;
  const slots: { position: Player['position']; id?: string }[] = [
    { position: 'keeper', ...(selection.keeper ? { id: selection.keeper } : {}) },
    { position: 'seeker', ...(selection.seeker ? { id: selection.seeker } : {}) },
    { position: 'beater', ...(selection.beaters?.[0] ? { id: selection.beaters[0] } : {}) },
    { position: 'beater', ...(selection.beaters?.[1] ? { id: selection.beaters[1] } : {}) },
    { position: 'chaser', ...(selection.chasers?.[0] ? { id: selection.chasers[0] } : {}) },
    { position: 'chaser', ...(selection.chasers?.[1] ? { id: selection.chasers[1] } : {}) },
    { position: 'chaser', ...(selection.chasers?.[2] ? { id: selection.chasers[2] } : {}) },
  ];

  const filled: { position: Player['position']; player: Player }[] = [];
  for (const slot of slots) {
    const player = take(slot.id, slot.position);
    if (player) filled.push({ position: slot.position, player });
  }

  // Fill anything the submission left open with the best remaining player.
  for (const slot of slots) {
    if (filled.filter((entry) => entry.position === slot.position).length >= countFor(slot.position)) {
      continue;
    }
    const remaining = [...byId.entries()].filter(([id]) => !used.has(id));
    if (remaining.length === 0) break;
    const { lineup: best } = autoLineup(
      remaining.map(([, player]) => player),
      rules,
    );
    const replacement =
      slot.position === 'keeper'
        ? best.keeper
        : slot.position === 'seeker'
          ? best.seeker
          : slot.position === 'beater'
            ? best.beaters[0]
            : best.chasers[0];
    if (!replacement) break;
    used.add(replacement.id);
    filled.push({ position: slot.position, player: replacement });
  }

  const keeper = filled.find((entry) => entry.position === 'keeper')?.player;
  const seeker = filled.find((entry) => entry.position === 'seeker')?.player;
  const beaters = filled.filter((entry) => entry.position === 'beater').map((entry) => entry.player);
  const chasers = filled.filter((entry) => entry.position === 'chaser').map((entry) => entry.player);

  if (!keeper || !seeker || beaters.length < 2 || chasers.length < 3) {
    // Not enough of the submitted side survived. Fall back entirely.
    const { lineup: picked, bench } = autoLineup(
      available.map((row) => toSimPlayer(row, bonus)),
      rules,
    );
    return {
      squad: { clubId: club.id, name: club.name, short: club.short, lineup: picked, bench, tactics: clubTactics },
      submitted: false,
      notes: [...notes, 'too much of the submitted lineup was unavailable, so it was auto-picked'],
    };
  }

  const benchOrder = (lineup.bench as string[] | null) ?? [];
  const bench = [
    ...benchOrder.map((id) => byId.get(id)).filter((player): player is Player => !!player && !used.has(player.id)),
    ...[...byId.values()].filter((player) => !used.has(player.id) && !benchOrder.includes(player.id)),
  ];
  const seen = new Set<string>();
  const uniqueBench = bench.filter((player) => (seen.has(player.id) ? false : seen.add(player.id)));

  return {
    squad: {
      clubId: club.id,
      name: club.name,
      short: club.short,
      lineup: { keeper, seeker, beaters: beaters.slice(0, 2), chasers: chasers.slice(0, 3) },
      bench: uniqueBench,
      tactics: { ...clubTactics, ...((lineup.tactics as Partial<Tactics> | null) ?? {}) },
    },
    submitted: true,
    notes,
  };
}

function countFor(position: Player['position']): number {
  return position === 'chaser' ? 3 : position === 'beater' ? 2 : 1;
}

/** Fixtures a club can still pick a side for. */
export async function upcomingFor(db: Database, clubId: string, seasonId: string, limit = 5) {
  const rows = await db
    .select()
    .from(fixtures)
    .where(eq(fixtures.seasonId, seasonId))
    .orderBy(fixtures.matchday);
  return rows
    .filter((row) => (row.homeClubId === clubId || row.awayClubId === clubId) && row.status === 'scheduled')
    .slice(0, limit);
}

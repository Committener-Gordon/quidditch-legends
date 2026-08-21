/**
 * Mutable state for one match in flight. Created by simulate(), thrown away when
 * the match ends, and never observed from outside the engine -- the only outputs
 * are the event log and the stat lines derived from it.
 */

import type { RatedPlayer } from './ratings.js';
import type { RuleSet } from './rules.js';
import type { Rng } from './rng.js';
import type {
  Aggression,
  MatchEvent,
  Player,
  PlayerStatLine,
  Position,
  Score,
  Side,
  Squad,
  Tactics,
} from './types.js';

export interface PlayerState extends RatedPlayer {
  side: Side;
  onPitch: boolean;
  injury: { days: number } | null;
  /** Minute the current bludger debuff expires. */
  debuffUntil: number;
  stats: PlayerStatLine;
}

export interface TeamState {
  side: Side;
  clubId: string;
  name: string;
  short: string;
  tactics: Tactics;
  /** Current aggression, which chaseTheGame can shift mid-match. */
  aggression: Aggression;
  chasers: PlayerState[];
  beaters: PlayerState[];
  keeper: PlayerState;
  seeker: PlayerState;
  bench: PlayerState[];
  /** Everyone in the matchday squad, starters and bench alike. */
  all: PlayerState[];
  subsUsed: number;
  points: number;
  goals: number;
  catches: number;
  shots: number;
}

export interface MatchContext {
  rules: RuleSet;
  rng: Rng;
  minute: number;
  events: MatchEvent[];
  home: TeamState;
  away: TeamState;
  /** 1-based index of the snitch currently in play. */
  snitchIndex: number;
  /** Minutes since the current snitch was released. */
  snitchAge: number;
}

function newStatLine(player: Player, side: Side, position: Position): PlayerStatLine {
  return {
    playerId: player.id,
    name: player.name,
    side,
    position,
    minutes: 0,
    goals: 0,
    assists: 0,
    shots: 0,
    saves: 0,
    shotsFaced: 0,
    interceptions: 0,
    bludgerHits: 0,
    hitsTaken: 0,
    snitchCatches: 0,
    staminaEnd: player.stamina,
    rating: 6,
  };
}

function newPlayerState(
  player: Player,
  side: Side,
  position: Position,
  onPitch: boolean,
): PlayerState {
  return {
    player,
    position,
    stamina: player.stamina,
    debuff: 0,
    side,
    onPitch,
    injury: null,
    debuffUntil: 0,
    stats: newStatLine(player, side, position),
  };
}

export function createTeamState(squad: Squad, side: Side): TeamState {
  const chasers = squad.lineup.chasers.map((p) => newPlayerState(p, side, 'chaser', true));
  const beaters = squad.lineup.beaters.map((p) => newPlayerState(p, side, 'beater', true));
  const keeper = newPlayerState(squad.lineup.keeper, side, 'keeper', true);
  const seeker = newPlayerState(squad.lineup.seeker, side, 'seeker', true);
  // A bench player is listed in their natural position until they come on.
  const bench = squad.bench.map((p) => newPlayerState(p, side, p.position, false));

  return {
    side,
    clubId: squad.clubId,
    name: squad.name,
    short: squad.short,
    tactics: squad.tactics,
    aggression: squad.tactics.aggression,
    chasers,
    beaters,
    keeper,
    seeker,
    bench,
    all: [...chasers, ...beaters, keeper, seeker, ...bench],
    subsUsed: 0,
    points: 0,
    goals: 0,
    catches: 0,
    shots: 0,
  };
}

export function teamOf(ctx: MatchContext, side: Side): TeamState {
  return side === 'home' ? ctx.home : ctx.away;
}

export function opponentOf(ctx: MatchContext, side: Side): TeamState {
  return side === 'home' ? ctx.away : ctx.home;
}

export function scoreOf(ctx: MatchContext): Score {
  return { home: ctx.home.points, away: ctx.away.points };
}

export function emit(ctx: MatchContext, event: MatchEvent): void {
  ctx.events.push(event);
}

/** Everyone currently flying, in a stable order. */
export function onPitch(team: TeamState): PlayerState[] {
  return [...team.chasers, ...team.beaters, team.keeper, team.seeker];
}

/** Rating points added to a side's units. Home sides get a nudge. */
export function sideBonus(ctx: MatchContext, side: Side): number {
  return side === 'home' ? ctx.rules.homeAdvantage : 0;
}

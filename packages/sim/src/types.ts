/**
 * Core domain types for the Quidditch Legends match engine.
 *
 * Nothing in this package touches a database, a clock or the network. A match is
 * a pure function of (squads, tactics, seed, rules) and is therefore exactly
 * reproducible from the seed plus the rules version.
 */

export type Attribute =
  | 'flying'
  | 'handling'
  | 'aim'
  | 'strength'
  | 'vision'
  | 'reflexes'
  | 'nerve';

export type Position = 'chaser' | 'beater' | 'keeper' | 'seeker';

export type Side = 'home' | 'away';

/** All attributes are on a 1-99 scale. */
export type Attributes = Record<Attribute, number>;

export interface Player {
  id: string;
  name: string;
  age: number;
  /** Natural position. Playing out of position carries a rating penalty. */
  position: Position;
  attributes: Attributes;
  /** Condition at kickoff, 0-100. */
  stamina: number;
  /** 0-100, 50 is neutral. */
  form: number;
  /** 0-100, 50 is neutral. */
  morale: number;
  /** Hidden ceiling, 0-99. Never shown to a manager without a scout report. */
  potential?: number;
}

/** Trade shot volume against turnover risk. */
export type Aggression = 'defensive' | 'balanced' | 'attacking';
/** Trade snitch catch rate against quaffle contribution. */
export type SeekerCommitment = 'hunt' | 'balanced' | 'support';
/** Where the beaters point the bludgers. */
export type BeaterFocus = 'seeker' | 'chasers' | 'protect';

export interface Tactics {
  aggression: Aggression;
  seekerCommitment: SeekerCommitment;
  beaterFocus: BeaterFocus;
  /** Raise aggression a step when trailing late. */
  chaseTheGame: boolean;
}

export interface Lineup {
  /** Exactly 3. */
  chasers: Player[];
  /** Exactly 2. */
  beaters: Player[];
  keeper: Player;
  seeker: Player;
}

export interface Squad {
  clubId: string;
  name: string;
  /** 3-4 letter code used in reports. */
  short: string;
  lineup: Lineup;
  bench: Player[];
  tactics: Tactics;
}

export interface Score {
  home: number;
  away: number;
}

export type MatchEvent =
  | { minute: number; type: 'KICKOFF' }
  | { minute: number; type: 'SNITCH_RELEASED'; index: number }
  | {
      minute: number;
      type: 'GOAL';
      side: Side;
      playerId: string;
      assistId: string | null;
      score: Score;
    }
  | {
      minute: number;
      type: 'SAVE';
      /** The side that made the save. */
      side: Side;
      keeperId: string;
      shooterId: string;
    }
  | {
      minute: number;
      type: 'INTERCEPTION';
      /** The side that won the quaffle back. */
      side: Side;
      playerId: string;
    }
  | {
      minute: number;
      type: 'BLUDGER_HIT';
      /** The side that struck. */
      side: Side;
      beaterId: string;
      targetId: string;
      targetPosition: Position;
    }
  | { minute: number; type: 'INJURY'; side: Side; playerId: string; days: number }
  | {
      minute: number;
      type: 'SNITCH_CAUGHT';
      side: Side;
      seekerId: string;
      index: number;
      score: Score;
    }
  | {
      minute: number;
      type: 'SUBSTITUTION';
      side: Side;
      offId: string;
      onId: string;
      reason: 'stamina' | 'injury';
    }
  | { minute: number; type: 'TACTIC_SHIFT'; side: Side; to: Aggression }
  | { minute: number; type: 'FULL_TIME'; score: Score };

export type MatchEventType = MatchEvent['type'];

export interface PlayerStatLine {
  playerId: string;
  name: string;
  side: Side;
  /** Position actually played, which may differ from the player's natural one. */
  position: Position;
  minutes: number;
  goals: number;
  assists: number;
  shots: number;
  saves: number;
  shotsFaced: number;
  interceptions: number;
  bludgerHits: number;
  hitsTaken: number;
  snitchCatches: number;
  staminaEnd: number;
  /** 1.0-10.0, one decimal. */
  rating: number;
}

export interface PlayerEffect {
  playerId: string;
  staminaEnd: number;
  /** Change to apply to the player's stored form, already clamped. */
  formDelta: number;
  xp: number;
  injury?: { days: number };
}

export interface MatchResult {
  seed: string;
  rulesVersion: string;
  minutes: number;
  score: Score;
  goals: Score;
  catches: Score;
  shots: Score;
  events: MatchEvent[];
  stats: PlayerStatLine[];
  effects: PlayerEffect[];
  home: { clubId: string; name: string; short: string };
  away: { clubId: string; name: string; short: string };
}

export interface Fixture {
  home: Squad;
  away: Squad;
  seed: string;
}

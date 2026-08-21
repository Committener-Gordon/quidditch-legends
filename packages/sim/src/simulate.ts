/**
 * simulate(): the whole sport, as one pure function.
 *
 * No database, no wall clock, no I/O. Given the same squads, seed and rule set it
 * returns byte-identical output forever, which is what makes a published match
 * report safe to treat as a permanent record.
 */

import { expectations } from './expectations.js';
import { DEFAULT_RULES, type RuleSet } from './rules.js';
import { clamp } from './ratings.js';
import { createRng } from './rng.js';
import { resolveBludger } from './bludgers.js';
import { resolvePossession } from './quaffle.js';
import { resolveSnitch } from './snitch.js';
import { applyEndgame, drainStamina, expireDebuffs, runSubstitutions } from './subs.js';
import { createTeamState, emit, onPitch, scoreOf, type MatchContext, type PlayerState, type TeamState } from './state.js';
import type { Fixture, MatchResult, PlayerEffect, PlayerStatLine, Score } from './types.js';

export interface SimulateOptions {
  rules?: RuleSet;
}

export function simulate(fixture: Fixture, options: SimulateOptions = {}): MatchResult {
  const rules = options.rules ?? DEFAULT_RULES;
  const rng = createRng(fixture.seed);

  const ctx: MatchContext = {
    rules,
    rng,
    minute: 0,
    events: [],
    home: createTeamState(fixture.home, 'home'),
    away: createTeamState(fixture.away, 'away'),
    snitchIndex: 1,
    snitchAge: 0,
  };

  emit(ctx, { minute: 0, type: 'KICKOFF' });
  emit(ctx, { minute: 0, type: 'SNITCH_RELEASED', index: 1 });

  // Fractional rates accumulate, so 1.5 possessions a minute means alternating
  // one and two rather than a rounded-off 1 or an inflated 2.
  let possessionCarry = 0;
  let bludgerCarry = 0;

  for (let minute = 1; minute <= rules.matchMinutes; minute++) {
    ctx.minute = minute;

    expireDebuffs(ctx);
    drainStamina(ctx);
    runSubstitutions(ctx);
    applyEndgame(ctx);

    for (const team of [ctx.home, ctx.away]) {
      for (const player of onPitch(team)) player.stats.minutes += 1;
    }

    possessionCarry += rules.possessionsPerMinute;
    while (possessionCarry >= 1) {
      resolvePossession(ctx);
      possessionCarry -= 1;
    }

    bludgerCarry += rules.bludgerEventsPerMinute;
    while (bludgerCarry >= 1) {
      resolveBludger(ctx);
      bludgerCarry -= 1;
    }

    resolveSnitch(ctx);
  }

  ctx.minute = rules.matchMinutes;
  const score = scoreOf(ctx);
  emit(ctx, { minute: rules.matchMinutes, type: 'FULL_TIME', score });

  const stats: PlayerStatLine[] = [];
  const effects: PlayerEffect[] = [];
  for (const team of [ctx.home, ctx.away]) {
    const opponent = team.side === 'home' ? ctx.away : ctx.home;
    for (const player of team.all) {
      finalise(player, team, opponent, rules, score);
      stats.push(player.stats);
      effects.push(effectFor(player, rules));
    }
  }

  return {
    seed: fixture.seed,
    rulesVersion: rules.version,
    minutes: rules.matchMinutes,
    score,
    goals: { home: ctx.home.goals, away: ctx.away.goals },
    catches: { home: ctx.home.catches, away: ctx.away.catches },
    shots: { home: ctx.home.shots, away: ctx.away.shots },
    events: ctx.events,
    stats,
    effects,
    home: { clubId: ctx.home.clubId, name: ctx.home.name, short: ctx.home.short },
    away: { clubId: ctx.away.clubId, name: ctx.away.name, short: ctx.away.short },
  };
}

/**
 * Player rating out of 10, judged against what the dials predict for the minutes
 * played. A chaser is not rated on scoring five goals; they are rated on scoring
 * five when the rule set expected five.
 */
function finalise(
  player: PlayerState,
  team: TeamState,
  opponent: TeamState,
  rules: RuleSet,
  score: Score,
): void {
  const stats = player.stats;
  stats.staminaEnd = Math.round(player.stamina);

  if (stats.minutes === 0) {
    stats.rating = 6;
    return;
  }

  const share = stats.minutes / rules.matchMinutes;
  const expected = expectations(rules);
  let rating = 6.3;

  switch (player.position) {
    case 'chaser': {
      const expectedGoals = (expected.goalsPerTeam / 3) * share;
      const expectedAssists = expectedGoals * rules.assistChance;
      const expectedInterceptions = 8 * share;
      rating +=
        0.28 * (stats.goals - expectedGoals) +
        0.12 * (stats.assists - expectedAssists) +
        0.02 * (stats.interceptions - expectedInterceptions);
      break;
    }
    case 'beater': {
      const expectedHits = (expected.bludgerHitsPerTeam / 2) * share;
      rating += 0.13 * (stats.bludgerHits - expectedHits);
      break;
    }
    case 'keeper': {
      const expectedSaves = expected.savesPerKeeper * share;
      const expectedConceded = expected.goalsPerTeam * share;
      const conceded = stats.shotsFaced - stats.saves;
      rating += 0.06 * (stats.saves - expectedSaves) - 0.1 * (conceded - expectedConceded);
      break;
    }
    case 'seeker': {
      const expectedCatches = expected.catchesPerTeam * share;
      rating += 0.55 * (stats.snitchCatches - expectedCatches);
      break;
    }
  }

  const own = team.side === 'home' ? score.home : score.away;
  const other = team.side === 'home' ? score.away : score.home;
  rating += own > other ? 0.3 : own < other ? -0.3 : 0;

  // Coming off injured is not a bad performance.
  if (player.injury) rating += 0.1;

  stats.rating = Math.round(clamp(rating, 1, 10) * 10) / 10;
  void opponent;
}

function effectFor(player: PlayerState, rules: RuleSet): PlayerEffect {
  const stats = player.stats;
  const effect: PlayerEffect = {
    playerId: player.player.id,
    staminaEnd: Math.round(player.stamina),
    formDelta: Math.round(clamp((stats.rating - 6.3) * 2.5, -12, 12) * 10) / 10,
    xp: Math.round(stats.minutes * (0.6 + stats.rating / 10)),
  };
  if (player.injury) effect.injury = { days: player.injury.days };
  void rules;
  return effect;
}

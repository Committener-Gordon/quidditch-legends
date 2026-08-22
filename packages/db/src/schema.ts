/**
 * The relational model.
 *
 * Phase two builds exactly what a world with nobody in it needs: clubs, players,
 * a season of fixtures, the matches they produce, and a table. Where phase three
 * will plug in, there is a nullable hook (`clubs.managerUserId`) rather than an
 * unused table.
 *
 * Two columns carry the whole reproducibility guarantee: `matches.seed` and
 * `matches.rulesVersion`. Together they mean any published match can be replayed
 * exactly, and that retuning the sport never rewrites history.
 */

import { relations, sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const positionEnum = pgEnum('position', ['chaser', 'beater', 'keeper', 'seeker']);
export const sideEnum = pgEnum('side', ['home', 'away']);
export const seasonStateEnum = pgEnum('season_state', ['setup', 'running', 'complete']);
/**
 * Who owns the clock.
 *
 * `manual` is a single player advancing the world themselves: they press play and
 * the matchday happens. `scheduled` is a league full of people, where kickoff
 * times are real and the scheduler plays a matchday when its time arrives. The
 * fixtures, the engine and the results are identical either way -- the only
 * difference is what makes a match start.
 */
export const seasonPacingEnum = pgEnum('season_pacing', ['manual', 'scheduled']);
export const ledgerKindEnum = pgEnum('ledger_kind', [
  'gate',
  'appearance',
  'sponsor',
  'prize',
  'wages',
  'upkeep',
  'facility',
  'training',
  'medical',
  'adjustment',
]);
export const facilityKindEnum = pgEnum('facility_kind', [
  'trainingGround',
  'medicalWing',
  'scoutingNetwork',
  'academy',
  'stadium',
  'broomStore',
]);
export const intensityEnum = pgEnum('training_intensity', ['light', 'normal', 'hard']);

export const fixtureStatusEnum = pgEnum('fixture_status', [
  'scheduled',
  'locked',
  'simulating',
  'simulated',
  'published',
]);

// --- people -----------------------------------------------------------------

/** Phase three fills this in. It exists so clubs can be claimed without a migration. */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  /** scrypt, with the salt and parameters encoded alongside the hash. */
  passwordHash: text('password_hash'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
});

/**
 * Sessions.
 *
 * The cookie carries a random token; only its hash is stored, so a leaked
 * database does not hand over live sessions.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('sessions_user_idx').on(table.userId)],
);

// --- clubs ------------------------------------------------------------------

export const clubs = pgTable('clubs', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  short: text('short').notNull(),
  /** Null means an AI manager runs this club, which is the phase two default. */
  managerUserId: uuid('manager_user_id').references(() => users.id, { onDelete: 'set null' }),
  stadiumCapacity: integer('stadium_capacity').notNull().default(8000),
  /** Aggression, seeker commitment, beater focus, chase-the-game. Shape matches sim.Tactics. */
  tactics: jsonb('tactics').notNull(),
  foundedSeason: integer('founded_season').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const players = pgTable(
  'players',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clubId: uuid('club_id').references(() => clubs.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    age: smallint('age').notNull(),
    position: positionEnum('position').notNull(),

    // Attributes are columns, not a blob: the market will need to sort and filter
    // on them, and the engine wants them typed.
    flying: smallint('flying').notNull(),
    handling: smallint('handling').notNull(),
    aim: smallint('aim').notNull(),
    strength: smallint('strength').notNull(),
    vision: smallint('vision').notNull(),
    reflexes: smallint('reflexes').notNull(),
    nerve: smallint('nerve').notNull(),

    stamina: smallint('stamina').notNull().default(100),
    form: smallint('form').notNull().default(50),
    morale: smallint('morale').notNull().default(50),

    /** Hidden ceiling. Never exposed to a manager without a scout report. */
    potential: smallint('potential').notNull(),
    xp: integer('xp').notNull().default(0),
    /** Weekly wage in Galleons, derived from rating, age and potential. */
    wage: integer('wage').notNull().default(0),

    /** Unavailable while this is in the future. */
    injuredUntil: date('injured_until'),
    retiredInSeason: integer('retired_in_season'),
    joinedSeason: integer('joined_season').notNull().default(1),
  },
  (table) => [index('players_club_idx').on(table.clubId, table.position)],
);

// --- the calendar -----------------------------------------------------------

export const seasons = pgTable('seasons', {
  id: uuid('id').primaryKey().defaultRandom(),
  number: integer('number').notNull().unique(),
  /** Seeds every fixture in the season. Stored so the whole season is reproducible. */
  salt: text('salt').notNull(),
  rulesVersion: text('rules_version').notNull(),
  state: seasonStateEnum('state').notNull().default('setup'),
  startsOn: date('starts_on').notNull(),
  matchdays: integer('matchdays').notNull(),
  /**
   * How long before kickoff a lineup locks. Stored per season because it has to
   * follow the season's pace: fifteen minutes is right for a two-day gap between
   * matchdays and absurd for a five-minute one.
   */
  lineupDeadlineMinutes: integer('lineup_deadline_minutes').notNull().default(15),
  pacing: seasonPacingEnum('pacing').notNull().default('manual'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const divisions = pgTable(
  'divisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    seasonId: uuid('season_id')
      .notNull()
      .references(() => seasons.id, { onDelete: 'cascade' }),
    /** 1 is the top flight. */
    tier: integer('tier').notNull(),
    name: text('name').notNull(),
  },
  (table) => [uniqueIndex('divisions_season_tier_idx').on(table.seasonId, table.tier)],
);

/** Which clubs play in which division this season. */
export const divisionClubs = pgTable(
  'division_clubs',
  {
    divisionId: uuid('division_id')
      .notNull()
      .references(() => divisions.id, { onDelete: 'cascade' }),
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.divisionId, table.clubId] })],
);

export const fixtures = pgTable(
  'fixtures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    seasonId: uuid('season_id')
      .notNull()
      .references(() => seasons.id, { onDelete: 'cascade' }),
    divisionId: uuid('division_id')
      .notNull()
      .references(() => divisions.id, { onDelete: 'cascade' }),
    matchday: integer('matchday').notNull(),
    homeClubId: uuid('home_club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'restrict' }),
    awayClubId: uuid('away_club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'restrict' }),
    kickoffAt: timestamp('kickoff_at', { withTimezone: true }).notNull(),
    status: fixtureStatusEnum('status').notNull().default('scheduled'),
  },
  (table) => [
    uniqueIndex('fixtures_slot_idx').on(table.divisionId, table.matchday, table.homeClubId),
    index('fixtures_due_idx').on(table.status, table.kickoffAt),
    index('fixtures_matchday_idx').on(table.seasonId, table.matchday),
  ],
);

// --- results ----------------------------------------------------------------

export const matches = pgTable(
  'matches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fixtureId: uuid('fixture_id')
      .notNull()
      .unique()
      .references(() => fixtures.id, { onDelete: 'cascade' }),

    /**
     * What it takes to reproduce this match exactly.
     *
     * The seed and the rules version are not enough on their own: `simulate()` is
     * pure, but its inputs include the squads, and a player's stamina and form
     * change the moment the match is applied. So the two teams as they were at
     * kickoff are stored alongside -- lineup, bench, tactics and every attribute.
     * Nullable because a match published before this column existed cannot be
     * backfilled; `replayMatch` says so rather than guessing.
     */
    seed: text('seed').notNull(),
    rulesVersion: text('rules_version').notNull(),
    squads: jsonb('squads'),

    minutes: integer('minutes').notNull(),
    homePoints: integer('home_points').notNull(),
    awayPoints: integer('away_points').notNull(),
    homeGoals: integer('home_goals').notNull(),
    awayGoals: integer('away_goals').notNull(),
    homeCatches: integer('home_catches').notNull(),
    awayCatches: integer('away_catches').notNull(),
    homeShots: integer('home_shots').notNull(),
    awayShots: integer('away_shots').notNull(),

    simulatedAt: timestamp('simulated_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (table) => [index('matches_published_idx').on(table.publishedAt)],
);

export const matchEvents = pgTable(
  'match_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    matchId: uuid('match_id')
      .notNull()
      .references(() => matches.id, { onDelete: 'cascade' }),
    /** Position in the log. The log is the match, so its order is data. */
    seq: integer('seq').notNull(),
    minute: integer('minute').notNull(),
    type: text('type').notNull(),
    side: sideEnum('side'),
    playerId: uuid('player_id').references(() => players.id, { onDelete: 'set null' }),
    secondaryPlayerId: uuid('secondary_player_id').references(() => players.id, {
      onDelete: 'set null',
    }),
    /** Whatever else the event carries: score after, injury days, substitution reason. */
    payload: jsonb('payload'),
  },
  (table) => [
    uniqueIndex('match_events_seq_idx').on(table.matchId, table.seq),
    index('match_events_player_idx').on(table.playerId, table.type),
  ],
);

export const playerMatchStats = pgTable(
  'player_match_stats',
  {
    matchId: uuid('match_id')
      .notNull()
      .references(() => matches.id, { onDelete: 'cascade' }),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'cascade' }),
    side: sideEnum('side').notNull(),
    position: positionEnum('position').notNull(),
    minutes: integer('minutes').notNull(),
    goals: integer('goals').notNull(),
    assists: integer('assists').notNull(),
    shots: integer('shots').notNull(),
    saves: integer('saves').notNull(),
    shotsFaced: integer('shots_faced').notNull(),
    interceptions: integer('interceptions').notNull(),
    bludgerHits: integer('bludger_hits').notNull(),
    hitsTaken: integer('hits_taken').notNull(),
    snitchCatches: integer('snitch_catches').notNull(),
    staminaEnd: integer('stamina_end').notNull(),
    rating: real('rating').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.matchId, table.playerId] }),
    index('pms_player_idx').on(table.playerId),
    index('pms_club_idx').on(table.clubId),
  ],
);

/**
 * Materialised league table. Cheap to recompute from matches, but keeping it lets
 * a table page be one indexed read, and gives the matchday job something concrete
 * to finish with.
 */
export const standings = pgTable(
  'standings',
  {
    divisionId: uuid('division_id')
      .notNull()
      .references(() => divisions.id, { onDelete: 'cascade' }),
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'cascade' }),
    played: integer('played').notNull().default(0),
    won: integer('won').notNull().default(0),
    drawn: integer('drawn').notNull().default(0),
    lost: integer('lost').notNull().default(0),
    pointsFor: integer('points_for').notNull().default(0),
    pointsAgainst: integer('points_against').notNull().default(0),
    goalsFor: integer('goals_for').notNull().default(0),
    catchesFor: integer('catches_for').notNull().default(0),
    /** League points: three for a win, one for a draw. */
    tablePoints: integer('table_points').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.divisionId, table.clubId] })],
);

/**
 * The money, as an append-only ledger.
 *
 * A club's balance is the sum of its entries and is never stored as a mutable
 * number. That costs one table and buys audit trails, refunds, and an actual
 * answer when a manager asks where their Galleons went.
 */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'cascade' }),
    kind: ledgerKindEnum('kind').notNull(),
    /** Signed: income is positive, a cost is negative. */
    amount: integer('amount').notNull(),
    reason: text('reason').notNull(),
    /** What caused it -- a match id, a facility kind, a matchday number. */
    reference: text('reference'),
    seasonId: uuid('season_id').references(() => seasons.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('ledger_club_idx').on(table.clubId, table.createdAt),
    index('ledger_kind_idx').on(table.kind),
    // One charge per club per thing: what makes the payday job safe to re-run.
    uniqueIndex('ledger_once_idx').on(table.clubId, table.kind, table.reference),
  ],
);

export const facilities = pgTable(
  'facilities',
  {
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'cascade' }),
    kind: facilityKindEnum('kind').notNull(),
    level: integer('level').notNull().default(0),
    /** Capital sunk in, which is what weekly upkeep is charged on. */
    invested: integer('invested').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.clubId, table.kind] })],
);

export const trainingOrders = pgTable(
  'training_orders',
  {
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'cascade' }),
    seasonId: uuid('season_id')
      .notNull()
      .references(() => seasons.id, { onDelete: 'cascade' }),
    /** Null means general fitness rather than one attribute. */
    focus: text('focus'),
    intensity: intensityEnum('intensity').notNull().default('normal'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.clubId, table.seasonId] })],
);

/**
 * A submitted lineup for one fixture.
 *
 * Absent means nobody picked one, and the matchday job auto-picks -- the same path
 * every AI club takes. Present and the job uses it, which is the moment a human
 * decision starts changing a published result.
 */
export const lineups = pgTable(
  'lineups',
  {
    fixtureId: uuid('fixture_id')
      .notNull()
      .references(() => fixtures.id, { onDelete: 'cascade' }),
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'cascade' }),
    /** { keeper, seeker, chasers: [id, id, id], beaters: [id, id] } */
    starters: jsonb('starters').notNull(),
    /** Ordered player ids; the auto-subs reach for the front of this list first. */
    bench: jsonb('bench').notNull(),
    /** Overrides the club's standing tactics for this fixture only. */
    tactics: jsonb('tactics'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    submittedBy: uuid('submitted_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (table) => [primaryKey({ columns: [table.fixtureId, table.clubId] })],
);

/** An append-only record of what the world did to itself, for debugging a season. */
export const jobRuns = pgTable(
  'job_runs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    job: text('job').notNull(),
    /** Season number, matchday, or whatever identifies the unit of work. */
    subject: text('subject').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    ok: boolean('ok'),
    detail: jsonb('detail'),
  },
  (table) => [index('job_runs_job_idx').on(table.job, table.subject)],
);

// --- relations --------------------------------------------------------------

export const clubRelations = relations(clubs, ({ many, one }) => ({
  players: many(players),
  manager: one(users, { fields: [clubs.managerUserId], references: [users.id] }),
}));

export const playerRelations = relations(players, ({ one }) => ({
  club: one(clubs, { fields: [players.clubId], references: [clubs.id] }),
}));

export const seasonRelations = relations(seasons, ({ many }) => ({
  divisions: many(divisions),
  fixtures: many(fixtures),
}));

export const divisionRelations = relations(divisions, ({ many, one }) => ({
  season: one(seasons, { fields: [divisions.seasonId], references: [seasons.id] }),
  clubs: many(divisionClubs),
  fixtures: many(fixtures),
}));

export const fixtureRelations = relations(fixtures, ({ one }) => ({
  season: one(seasons, { fields: [fixtures.seasonId], references: [seasons.id] }),
  division: one(divisions, { fields: [fixtures.divisionId], references: [divisions.id] }),
  home: one(clubs, { fields: [fixtures.homeClubId], references: [clubs.id] }),
  away: one(clubs, { fields: [fixtures.awayClubId], references: [clubs.id] }),
  match: one(matches, { fields: [fixtures.id], references: [matches.fixtureId] }),
}));

export const matchRelations = relations(matches, ({ many, one }) => ({
  fixture: one(fixtures, { fields: [matches.fixtureId], references: [fixtures.id] }),
  events: many(matchEvents),
  stats: many(playerMatchStats),
}));

export const isoDate = (value: Date): string => value.toISOString().slice(0, 10);
export const nowSql = sql`now()`;

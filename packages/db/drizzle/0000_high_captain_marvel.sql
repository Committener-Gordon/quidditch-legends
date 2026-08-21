CREATE TYPE "public"."fixture_status" AS ENUM('scheduled', 'locked', 'simulating', 'simulated', 'published');--> statement-breakpoint
CREATE TYPE "public"."position" AS ENUM('chaser', 'beater', 'keeper', 'seeker');--> statement-breakpoint
CREATE TYPE "public"."season_state" AS ENUM('setup', 'running', 'complete');--> statement-breakpoint
CREATE TYPE "public"."side" AS ENUM('home', 'away');--> statement-breakpoint
CREATE TABLE "clubs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"short" text NOT NULL,
	"manager_user_id" uuid,
	"stadium_capacity" integer DEFAULT 8000 NOT NULL,
	"tactics" jsonb NOT NULL,
	"founded_season" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clubs_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "division_clubs" (
	"division_id" uuid NOT NULL,
	"club_id" uuid NOT NULL,
	CONSTRAINT "division_clubs_division_id_club_id_pk" PRIMARY KEY("division_id","club_id")
);
--> statement-breakpoint
CREATE TABLE "divisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"tier" integer NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fixtures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"division_id" uuid NOT NULL,
	"matchday" integer NOT NULL,
	"home_club_id" uuid NOT NULL,
	"away_club_id" uuid NOT NULL,
	"kickoff_at" timestamp with time zone NOT NULL,
	"status" "fixture_status" DEFAULT 'scheduled' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"job" text NOT NULL,
	"subject" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"ok" boolean,
	"detail" jsonb
);
--> statement-breakpoint
CREATE TABLE "match_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"match_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"minute" integer NOT NULL,
	"type" text NOT NULL,
	"side" "side",
	"player_id" uuid,
	"secondary_player_id" uuid,
	"payload" jsonb
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fixture_id" uuid NOT NULL,
	"seed" text NOT NULL,
	"rules_version" text NOT NULL,
	"minutes" integer NOT NULL,
	"home_points" integer NOT NULL,
	"away_points" integer NOT NULL,
	"home_goals" integer NOT NULL,
	"away_goals" integer NOT NULL,
	"home_catches" integer NOT NULL,
	"away_catches" integer NOT NULL,
	"home_shots" integer NOT NULL,
	"away_shots" integer NOT NULL,
	"simulated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "matches_fixture_id_unique" UNIQUE("fixture_id")
);
--> statement-breakpoint
CREATE TABLE "player_match_stats" (
	"match_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"club_id" uuid NOT NULL,
	"side" "side" NOT NULL,
	"position" "position" NOT NULL,
	"minutes" integer NOT NULL,
	"goals" integer NOT NULL,
	"assists" integer NOT NULL,
	"shots" integer NOT NULL,
	"saves" integer NOT NULL,
	"shots_faced" integer NOT NULL,
	"interceptions" integer NOT NULL,
	"bludger_hits" integer NOT NULL,
	"hits_taken" integer NOT NULL,
	"snitch_catches" integer NOT NULL,
	"stamina_end" integer NOT NULL,
	"rating" real NOT NULL,
	CONSTRAINT "player_match_stats_match_id_player_id_pk" PRIMARY KEY("match_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid,
	"name" text NOT NULL,
	"age" smallint NOT NULL,
	"position" "position" NOT NULL,
	"flying" smallint NOT NULL,
	"handling" smallint NOT NULL,
	"aim" smallint NOT NULL,
	"strength" smallint NOT NULL,
	"vision" smallint NOT NULL,
	"reflexes" smallint NOT NULL,
	"nerve" smallint NOT NULL,
	"stamina" smallint DEFAULT 100 NOT NULL,
	"form" smallint DEFAULT 50 NOT NULL,
	"morale" smallint DEFAULT 50 NOT NULL,
	"potential" smallint NOT NULL,
	"xp" integer DEFAULT 0 NOT NULL,
	"injured_until" date,
	"retired_in_season" integer,
	"joined_season" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer NOT NULL,
	"salt" text NOT NULL,
	"rules_version" text NOT NULL,
	"state" "season_state" DEFAULT 'setup' NOT NULL,
	"starts_on" date NOT NULL,
	"matchdays" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seasons_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "standings" (
	"division_id" uuid NOT NULL,
	"club_id" uuid NOT NULL,
	"played" integer DEFAULT 0 NOT NULL,
	"won" integer DEFAULT 0 NOT NULL,
	"drawn" integer DEFAULT 0 NOT NULL,
	"lost" integer DEFAULT 0 NOT NULL,
	"points_for" integer DEFAULT 0 NOT NULL,
	"points_against" integer DEFAULT 0 NOT NULL,
	"goals_for" integer DEFAULT 0 NOT NULL,
	"catches_for" integer DEFAULT 0 NOT NULL,
	"table_points" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "standings_division_id_club_id_pk" PRIMARY KEY("division_id","club_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "clubs" ADD CONSTRAINT "clubs_manager_user_id_users_id_fk" FOREIGN KEY ("manager_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "division_clubs" ADD CONSTRAINT "division_clubs_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."divisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "division_clubs" ADD CONSTRAINT "division_clubs_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "divisions" ADD CONSTRAINT "divisions_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."divisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_home_club_id_clubs_id_fk" FOREIGN KEY ("home_club_id") REFERENCES "public"."clubs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_away_club_id_clubs_id_fk" FOREIGN KEY ("away_club_id") REFERENCES "public"."clubs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_events" ADD CONSTRAINT "match_events_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_events" ADD CONSTRAINT "match_events_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_events" ADD CONSTRAINT "match_events_secondary_player_id_players_id_fk" FOREIGN KEY ("secondary_player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_fixture_id_fixtures_id_fk" FOREIGN KEY ("fixture_id") REFERENCES "public"."fixtures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD CONSTRAINT "player_match_stats_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD CONSTRAINT "player_match_stats_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD CONSTRAINT "player_match_stats_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standings" ADD CONSTRAINT "standings_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."divisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standings" ADD CONSTRAINT "standings_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "divisions_season_tier_idx" ON "divisions" USING btree ("season_id","tier");--> statement-breakpoint
CREATE UNIQUE INDEX "fixtures_slot_idx" ON "fixtures" USING btree ("division_id","matchday","home_club_id");--> statement-breakpoint
CREATE INDEX "fixtures_due_idx" ON "fixtures" USING btree ("status","kickoff_at");--> statement-breakpoint
CREATE INDEX "fixtures_matchday_idx" ON "fixtures" USING btree ("season_id","matchday");--> statement-breakpoint
CREATE INDEX "job_runs_job_idx" ON "job_runs" USING btree ("job","subject");--> statement-breakpoint
CREATE UNIQUE INDEX "match_events_seq_idx" ON "match_events" USING btree ("match_id","seq");--> statement-breakpoint
CREATE INDEX "match_events_player_idx" ON "match_events" USING btree ("player_id","type");--> statement-breakpoint
CREATE INDEX "matches_published_idx" ON "matches" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "pms_player_idx" ON "player_match_stats" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "pms_club_idx" ON "player_match_stats" USING btree ("club_id");--> statement-breakpoint
CREATE INDEX "players_club_idx" ON "players" USING btree ("club_id","position");
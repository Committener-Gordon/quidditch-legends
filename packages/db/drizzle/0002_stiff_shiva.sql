CREATE TYPE "public"."facility_kind" AS ENUM('trainingGround', 'medicalWing', 'scoutingNetwork', 'academy', 'stadium', 'broomStore');--> statement-breakpoint
CREATE TYPE "public"."training_intensity" AS ENUM('light', 'normal', 'hard');--> statement-breakpoint
CREATE TYPE "public"."ledger_kind" AS ENUM('gate', 'appearance', 'sponsor', 'prize', 'wages', 'upkeep', 'facility', 'training', 'medical', 'adjustment');--> statement-breakpoint
CREATE TABLE "facilities" (
	"club_id" uuid NOT NULL,
	"kind" "facility_kind" NOT NULL,
	"level" integer DEFAULT 0 NOT NULL,
	"invested" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "facilities_club_id_kind_pk" PRIMARY KEY("club_id","kind")
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"club_id" uuid NOT NULL,
	"kind" "ledger_kind" NOT NULL,
	"amount" integer NOT NULL,
	"reason" text NOT NULL,
	"reference" text,
	"season_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lineups" (
	"fixture_id" uuid NOT NULL,
	"club_id" uuid NOT NULL,
	"starters" jsonb NOT NULL,
	"bench" jsonb NOT NULL,
	"tactics" jsonb,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_by" uuid,
	CONSTRAINT "lineups_fixture_id_club_id_pk" PRIMARY KEY("fixture_id","club_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "training_orders" (
	"club_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"focus" text,
	"intensity" "training_intensity" DEFAULT 'normal' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_orders_club_id_season_id_pk" PRIMARY KEY("club_id","season_id")
);
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "wage" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "facilities" ADD CONSTRAINT "facilities_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lineups" ADD CONSTRAINT "lineups_fixture_id_fixtures_id_fk" FOREIGN KEY ("fixture_id") REFERENCES "public"."fixtures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lineups" ADD CONSTRAINT "lineups_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lineups" ADD CONSTRAINT "lineups_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_orders" ADD CONSTRAINT "training_orders_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_orders" ADD CONSTRAINT "training_orders_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_club_idx" ON "ledger_entries" USING btree ("club_id","created_at");--> statement-breakpoint
CREATE INDEX "ledger_kind_idx" ON "ledger_entries" USING btree ("kind");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_once_idx" ON "ledger_entries" USING btree ("club_id","kind","reference");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");
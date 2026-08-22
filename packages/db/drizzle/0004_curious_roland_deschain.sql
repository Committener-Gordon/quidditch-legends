CREATE TYPE "public"."season_pacing" AS ENUM('manual', 'scheduled');--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "pacing" "season_pacing" DEFAULT 'manual' NOT NULL;
ALTER TYPE "public"."fixture_status" ADD VALUE 'live' BEFORE 'published';--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "kicked_off_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "playback_seconds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "playback_seconds" integer DEFAULT 180 NOT NULL;
CREATE TABLE "scout_reports" (
	"club_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"low" smallint NOT NULL,
	"high" smallint NOT NULL,
	"at_level" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scout_reports_club_id_player_id_pk" PRIMARY KEY("club_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "transfer_listings" (
	"player_id" uuid PRIMARY KEY NOT NULL,
	"club_id" uuid NOT NULL,
	"price" integer NOT NULL,
	"listed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "contract_until_season" integer;--> statement-breakpoint
ALTER TABLE "scout_reports" ADD CONSTRAINT "scout_reports_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scout_reports" ADD CONSTRAINT "scout_reports_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_listings" ADD CONSTRAINT "transfer_listings_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_listings" ADD CONSTRAINT "transfer_listings_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "listings_club_idx" ON "transfer_listings" USING btree ("club_id");
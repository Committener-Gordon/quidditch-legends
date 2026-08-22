ALTER TYPE "public"."ledger_kind" ADD VALUE 'transfer' BEFORE 'adjustment';--> statement-breakpoint
ALTER TYPE "public"."ledger_kind" ADD VALUE 'levy' BEFORE 'adjustment';
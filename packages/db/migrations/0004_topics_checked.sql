ALTER TABLE "questions" ADD COLUMN "topics_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "topics_checked_at" timestamp with time zone;
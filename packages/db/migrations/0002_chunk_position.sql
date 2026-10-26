DROP INDEX "chunks_source_id_index";--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "position" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_sourceId_position_unique" UNIQUE("source_id","position");
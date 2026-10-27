CREATE TABLE "ingest_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"manifest_s_3_key" text,
	"file_count" integer DEFAULT 0 NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ingest_batches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "source_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"parent_id" uuid,
	"title" text NOT NULL,
	"page_start" integer,
	"page_end" integer,
	"node_id" uuid,
	"origin" text NOT NULL,
	"confidence" real,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_sections_sourceId_position_unique" UNIQUE("source_id","position")
);
--> statement-breakpoint
ALTER TABLE "source_sections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "index_outbox" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "index_outbox_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"org_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"op" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "member_settings" (
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"ui_locale" text DEFAULT 'en' NOT NULL,
	"content_language" text DEFAULT 'bilingual' NOT NULL,
	"default_model_id" text,
	"default_exam_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_settings_org_id_user_id_pk" PRIMARY KEY("org_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "member_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "member_subjects" (
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"subject_node_id" uuid NOT NULL,
	"exam_id" uuid,
	"is_head" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_subjects_user_id_subject_node_id_pk" PRIMARY KEY("user_id","subject_node_id")
);
--> statement-breakpoint
ALTER TABLE "member_subjects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "org_settings" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"branding" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ai_policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "org_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "chat_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"client_turn_id" text NOT NULL,
	"user_message_id" uuid,
	"assistant_message_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"stream_key" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "chat_turns_sessionId_clientTurnId_unique" UNIQUE("session_id","client_turn_id")
);
--> statement-breakpoint
ALTER TABLE "chat_turns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "document_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"format" text NOT NULL,
	"variant" text NOT NULL,
	"set_code" text,
	"s3_key" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "document_exports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "generation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"session_id" uuid,
	"workflow_id" text NOT NULL,
	"spec" jsonb NOT NULL,
	"slot_plan" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"slot_states" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'planning' NOT NULL,
	"estimated_cost_usd" numeric(12, 6),
	"actual_cost_usd" numeric(12, 6),
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "generation_runs_workflowId_unique" UNIQUE("workflow_id")
);
--> statement-breakpoint
ALTER TABLE "generation_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "page_label" text;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "extractor_version" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "subject_node_id" uuid;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "exam_codes" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "class_level" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "year" smallint;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "set_code" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "answer_key_for_source_id" uuid;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "page_offset" integer;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "font_hint" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "manifest_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "question_tags" ADD COLUMN "method" text NOT NULL;--> statement-breakpoint
ALTER TABLE "question_tags" ADD COLUMN "tagger_version" text;--> statement-breakpoint
ALTER TABLE "question_tags" ADD COLUMN "is_primary" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "chunk_tags" ADD COLUMN "method" text NOT NULL;--> statement-breakpoint
ALTER TABLE "chunk_tags" ADD COLUMN "tagger_version" text;--> statement-breakpoint
ALTER TABLE "chunk_tags" ADD COLUMN "is_primary" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "section_id" uuid;--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "heading_path" text;--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "kind" text DEFAULT 'prose' NOT NULL;--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "chunker_version" text;--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "embedding_version_id" text;--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "indexed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "exams" ADD COLUMN "family" text;--> statement-breakpoint
ALTER TABLE "exams" ADD COLUMN "paper_code" text;--> statement-breakpoint
ALTER TABLE "taxonomy_nodes" ADD COLUMN "code" text;--> statement-breakpoint
-- Existing nodes get a slug from their English name before the column becomes required.
UPDATE "taxonomy_nodes" SET "code" = trim(both '_' from lower(regexp_replace("name_en", '[^A-Za-z0-9]+', '_', 'g')));--> statement-breakpoint
ALTER TABLE "taxonomy_nodes" ALTER COLUMN "code" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "taxonomy_nodes" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "taxonomy_nodes" ADD COLUMN "meta" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD COLUMN "turn_id" uuid;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD COLUMN "workflow_id" text;--> statement-breakpoint
ALTER TABLE "chat_sessions" ADD COLUMN "draft_spec" jsonb;--> statement-breakpoint
ALTER TABLE "chat_sessions" ADD COLUMN "status" text DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_sessions" ADD COLUMN "pinned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_sessions" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "exam_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "subject_node_id" uuid;--> statement-breakpoint
ALTER TABLE "ingest_batches" ADD CONSTRAINT "ingest_batches_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_batches" ADD CONSTRAINT "ingest_batches_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_sections" ADD CONSTRAINT "source_sections_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_sections" ADD CONSTRAINT "source_sections_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_sections" ADD CONSTRAINT "source_sections_parent_id_source_sections_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."source_sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_sections" ADD CONSTRAINT "source_sections_node_id_taxonomy_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."taxonomy_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "index_outbox" ADD CONSTRAINT "index_outbox_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_settings" ADD CONSTRAINT "member_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_settings" ADD CONSTRAINT "member_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_settings" ADD CONSTRAINT "member_settings_default_model_id_llm_models_id_fk" FOREIGN KEY ("default_model_id") REFERENCES "public"."llm_models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_settings" ADD CONSTRAINT "member_settings_default_exam_id_exams_id_fk" FOREIGN KEY ("default_exam_id") REFERENCES "public"."exams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_subjects" ADD CONSTRAINT "member_subjects_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_subjects" ADD CONSTRAINT "member_subjects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_subjects" ADD CONSTRAINT "member_subjects_subject_node_id_taxonomy_nodes_id_fk" FOREIGN KEY ("subject_node_id") REFERENCES "public"."taxonomy_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_subjects" ADD CONSTRAINT "member_subjects_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_settings" ADD CONSTRAINT "org_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_turns" ADD CONSTRAINT "chat_turns_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_turns" ADD CONSTRAINT "chat_turns_session_id_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_turns" ADD CONSTRAINT "chat_turns_user_message_id_chat_messages_id_fk" FOREIGN KEY ("user_message_id") REFERENCES "public"."chat_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_turns" ADD CONSTRAINT "chat_turns_assistant_message_id_chat_messages_id_fk" FOREIGN KEY ("assistant_message_id") REFERENCES "public"."chat_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_exports" ADD CONSTRAINT "document_exports_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_exports" ADD CONSTRAINT "document_exports_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_exports" ADD CONSTRAINT "document_exports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_session_id_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "index_outbox_processed_at_id_index" ON "index_outbox" USING btree ("processed_at","id");--> statement-breakpoint
CREATE INDEX "member_subjects_org_id_subject_node_id_index" ON "member_subjects" USING btree ("org_id","subject_node_id");--> statement-breakpoint
CREATE INDEX "document_exports_org_id_document_id_index" ON "document_exports" USING btree ("org_id","document_id");--> statement-breakpoint
CREATE INDEX "generation_runs_org_id_document_id_index" ON "generation_runs" USING btree ("org_id","document_id");--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_subject_node_id_taxonomy_nodes_id_fk" FOREIGN KEY ("subject_node_id") REFERENCES "public"."taxonomy_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_answer_key_for_source_id_sources_id_fk" FOREIGN KEY ("answer_key_for_source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_manifest_batch_id_ingest_batches_id_fk" FOREIGN KEY ("manifest_batch_id") REFERENCES "public"."ingest_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_section_id_source_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."source_sections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_embedding_version_id_embedding_versions_id_fk" FOREIGN KEY ("embedding_version_id") REFERENCES "public"."embedding_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_subject_node_id_taxonomy_nodes_id_fk" FOREIGN KEY ("subject_node_id") REFERENCES "public"."taxonomy_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxonomy_nodes" ADD CONSTRAINT "taxonomy_nodes_orgId_parentId_code_unique" UNIQUE NULLS NOT DISTINCT("org_id","parent_id","code");--> statement-breakpoint
CREATE POLICY "ingest_batches_org_isolation" ON "ingest_batches" AS PERMISSIVE FOR ALL TO "vidyam_app" USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "source_sections_org_isolation" ON "source_sections" AS PERMISSIVE FOR ALL TO "vidyam_app" USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "member_settings_org_isolation" ON "member_settings" AS PERMISSIVE FOR ALL TO "vidyam_app" USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "member_subjects_org_isolation" ON "member_subjects" AS PERMISSIVE FOR ALL TO "vidyam_app" USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "org_settings_org_isolation" ON "org_settings" AS PERMISSIVE FOR ALL TO "vidyam_app" USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "chat_turns_org_isolation" ON "chat_turns" AS PERMISSIVE FOR ALL TO "vidyam_app" USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "document_exports_org_isolation" ON "document_exports" AS PERMISSIVE FOR ALL TO "vidyam_app" USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "generation_runs_org_isolation" ON "generation_runs" AS PERMISSIVE FOR ALL TO "vidyam_app" USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);
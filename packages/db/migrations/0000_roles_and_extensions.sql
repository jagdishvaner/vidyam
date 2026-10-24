-- Runtime role used by the API and the AI engine. Row-level security applies to it because it does not own
-- the tables. Its password is set per environment (scripts/migrate.ts locally, Secrets Manager on AWS).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vidyam_app') THEN
    CREATE ROLE vidyam_app NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO vidyam_app;
--> statement-breakpoint
-- Tables and sequences created by later migrations (run by the owner) are usable by the runtime role.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vidyam_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO vidyam_app;
--> statement-breakpoint
-- Trigram search for admin screens (library, question bank). Retrieval itself is Qdrant's job.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

/** Center-wide settings and each staff member's profile: the subjects they teach and their defaults. */
import { boolean, index, jsonb, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";

import { organizations, users } from "./auth.js";
import { exams, taxonomyNodes } from "./knowledge.js";
import { llmModels } from "./llm.js";
import { createdAt, orgId, orgIsolation, timestamps } from "./_shared.js";

export const UI_LOCALES = ["en", "hi"] as const;
export const CONTENT_LANGUAGES = ["hi", "en", "bilingual"] as const;

/** One row per center: export branding and AI policy (shapes: OrgBranding, AiPolicy in @vidyam/contracts). */
export const orgSettings = pgTable(
  "org_settings",
  {
    orgId: uuid()
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    branding: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    aiPolicy: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  () => [orgIsolation("org_settings")],
).enableRLS();

/** A staff member's own defaults inside one center (Settings page). */
export const memberSettings = pgTable(
  "member_settings",
  {
    orgId: orgId(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    uiLocale: text({ enum: UI_LOCALES }).notNull().default("en"),
    contentLanguage: text({ enum: CONTENT_LANGUAGES }).notNull().default("bilingual"),
    /** Only models the admin marked teacher-selectable. */
    defaultModelId: text().references(() => llmModels.id, { onDelete: "set null" }),
    defaultExamId: uuid().references(() => exams.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] }), orgIsolation("member_settings")],
).enableRLS();

/**
 * The subjects a staff member teaches. A soft default scope for generation and content (not a wall), and the
 * routing for reviews: `isHead` marks the head of department for that subject.
 */
export const memberSubjects = pgTable(
  "member_subjects",
  {
    orgId: orgId(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subjectNodeId: uuid()
      .notNull()
      .references(() => taxonomyNodes.id, { onDelete: "cascade" }),
    examId: uuid().references(() => exams.id, { onDelete: "set null" }),
    isHead: boolean().notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.subjectNodeId] }),
    index().on(t.orgId, t.subjectNodeId),
    orgIsolation("member_subjects"),
  ],
).enableRLS();

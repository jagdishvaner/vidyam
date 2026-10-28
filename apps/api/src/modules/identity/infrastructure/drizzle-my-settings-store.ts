import { Injectable } from "@nestjs/common";
import { AuthService } from "@thallesp/nestjs-better-auth";
import { AiPolicy, type MemberSettings, type MySettings } from "@vidyam/contracts";
import { schema } from "@vidyam/db";
import { and, asc, eq } from "drizzle-orm";

import { OrgDatabase } from "../../../shared/database/org-database.js";
import type { MySettingsStore } from "../application/my-settings.js";
import type { Auth } from "./better-auth.js";

const { memberSettings, memberSubjects, taxonomyNodes, exams, orgSettings, llmModels } = schema;

const DEFAULTS: MemberSettings = {
  uiLocale: "en",
  contentLanguage: "bilingual",
  defaultModelId: null,
  defaultExamId: null,
};

@Injectable()
export class DrizzleMySettingsStore implements MySettingsStore {
  constructor(
    private readonly orgDb: OrgDatabase,
    private readonly auth: AuthService<Auth>,
  ) {}

  load(orgId: string, userId: string): Promise<MySettings> {
    return this.orgDb.run(orgId, async (tx) => {
      const [own] = await tx.select().from(memberSettings).where(eq(memberSettings.userId, userId));
      const [center] = await tx.select({ aiPolicy: orgSettings.aiPolicy }).from(orgSettings);
      const policy = AiPolicy.parse(center?.aiPolicy ?? {});
      const selectable = await tx
        .select({ id: llmModels.id, displayName: llmModels.displayName, provider: llmModels.provider })
        .from(llmModels)
        .where(and(eq(llmModels.enabled, true), eq(llmModels.teacherSelectable, true)))
        .orderBy(asc(llmModels.provider), asc(llmModels.displayName));
      const allowed = policy.allowedModelIds.length
        ? selectable.filter((m) => policy.allowedModelIds.includes(m.id))
        : selectable;
      const papers = await tx
        .select({ id: exams.id, code: exams.code, nameEn: exams.nameEn, nameHi: exams.nameHi })
        .from(exams)
        .orderBy(asc(exams.family), asc(exams.nameEn));
      const subjects = await tx
        .select({
          nodeId: memberSubjects.subjectNodeId,
          isHead: memberSubjects.isHead,
          code: taxonomyNodes.code,
          nameEn: taxonomyNodes.nameEn,
          nameHi: taxonomyNodes.nameHi,
        })
        .from(memberSubjects)
        .innerJoin(taxonomyNodes, eq(taxonomyNodes.id, memberSubjects.subjectNodeId))
        .where(eq(memberSubjects.userId, userId))
        .orderBy(asc(taxonomyNodes.sortOrder));
      return {
        settings: own
          ? {
              uiLocale: own.uiLocale,
              contentLanguage: own.contentLanguage,
              defaultModelId: own.defaultModelId,
              defaultExamId: own.defaultExamId,
            }
          : DEFAULTS,
        models: allowed,
        exams: papers,
        subjects,
      };
    });
  }

  save(orgId: string, userId: string, settings: MemberSettings): Promise<void> {
    return this.orgDb.run(orgId, async (tx) => {
      await tx
        .insert(memberSettings)
        .values({ orgId, userId, ...settings })
        .onConflictDoUpdate({
          target: [memberSettings.orgId, memberSettings.userId],
          set: { ...settings, updatedAt: new Date() },
        });
    });
  }

  /** Through Better Auth, which also refreshes the user cached in their active sessions. */
  async rename(userId: string, name: string): Promise<void> {
    const { internalAdapter } = await this.auth.instance.$context;
    await internalAdapter.updateUser(userId, { name });
  }
}

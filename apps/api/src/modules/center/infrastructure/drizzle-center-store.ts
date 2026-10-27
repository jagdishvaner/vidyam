import { Inject, Injectable } from "@nestjs/common";
import { AiPolicy, OrgBranding, type CenterProfile, type SelectableModel } from "@vidyam/contracts";
import { schema, type DatabaseHandle } from "@vidyam/db";
import { and, asc, eq } from "drizzle-orm";

import { OrgDatabase } from "../../../shared/database/org-database.js";
import { DATABASE } from "../../../shared/database/tokens.js";
import type { CenterStore } from "../application/manage-center.js";

const { organizations, orgSettings, llmModels } = schema;

/** One org_settings row per center, created on first save; until then branding starts from the center's name. */
@Injectable()
export class DrizzleCenterStore implements CenterStore {
  constructor(
    private readonly orgDb: OrgDatabase,
    @Inject(DATABASE) private readonly database: DatabaseHandle,
  ) {}

  load(orgId: string): Promise<Omit<CenterProfile, "logoUrl" | "selectableModels"> | null> {
    return this.orgDb.run(orgId, async (tx) => {
      const [organization] = await tx
        .select({ id: organizations.id, name: organizations.name, slug: organizations.slug })
        .from(organizations)
        .where(eq(organizations.id, orgId));
      if (!organization) return null;
      const [settings] = await tx.select().from(orgSettings).where(eq(orgSettings.orgId, orgId));
      const branding = OrgBranding.safeParse(settings?.branding);
      return {
        organization,
        branding: branding.success ? branding.data : OrgBranding.parse({ name: { en: organization.name } }),
        aiPolicy: AiPolicy.parse(settings?.aiPolicy ?? {}),
      };
    });
  }

  /** The model registry is global (no row-level security), so it is read outside any center's context. */
  selectableModels(): Promise<SelectableModel[]> {
    return this.database.db
      .select({ id: llmModels.id, displayName: llmModels.displayName, provider: llmModels.provider })
      .from(llmModels)
      .where(and(eq(llmModels.enabled, true), eq(llmModels.teacherSelectable, true)))
      .orderBy(asc(llmModels.provider), asc(llmModels.displayName));
  }

  saveBranding(orgId: string, branding: OrgBranding): Promise<void> {
    return this.upsert(orgId, { branding });
  }

  saveAiPolicy(orgId: string, aiPolicy: AiPolicy): Promise<void> {
    return this.upsert(orgId, { aiPolicy });
  }

  private upsert(orgId: string, values: { branding?: OrgBranding; aiPolicy?: AiPolicy }): Promise<void> {
    return this.orgDb.run(orgId, async (tx) => {
      await tx
        .insert(orgSettings)
        .values({ orgId, ...values })
        .onConflictDoUpdate({ target: orgSettings.orgId, set: { ...values, updatedAt: new Date() } });
    });
  }
}

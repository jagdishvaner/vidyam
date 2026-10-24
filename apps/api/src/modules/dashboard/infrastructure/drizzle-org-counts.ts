import { Injectable } from "@nestjs/common";
import type { DashboardSummary } from "@vidyam/contracts";
import { schema } from "@vidyam/db";
import { count } from "drizzle-orm";

import { OrgDatabase } from "../../../shared/database/org-database.js";
import type { OrgCounts } from "../application/get-dashboard-summary.js";

/** No explicit org filter: row-level security scopes every count to the organization. */
@Injectable()
export class DrizzleOrgCounts implements OrgCounts {
  constructor(private readonly orgDb: OrgDatabase) {}

  forOrganization(orgId: string): Promise<DashboardSummary> {
    return this.orgDb.run(orgId, async (tx) => {
      const [[sources], [questions], [documents]] = await Promise.all([
        tx.select({ n: count() }).from(schema.sources),
        tx.select({ n: count() }).from(schema.questions),
        tx.select({ n: count() }).from(schema.documents),
      ]);
      return { sources: sources?.n ?? 0, questions: questions?.n ?? 0, documents: documents?.n ?? 0 };
    });
  }
}

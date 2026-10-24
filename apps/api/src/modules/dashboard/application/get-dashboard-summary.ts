import { Inject, Injectable } from "@nestjs/common";
import type { DashboardSummary } from "@vidyam/contracts";

/** Port: counts scoped to one organization. */
export interface OrgCounts {
  forOrganization(orgId: string): Promise<DashboardSummary>;
}
export const ORG_COUNTS = Symbol("ORG_COUNTS");

@Injectable()
export class GetDashboardSummary {
  constructor(@Inject(ORG_COUNTS) private readonly counts: OrgCounts) {}

  execute(orgId: string): Promise<DashboardSummary> {
    return this.counts.forOrganization(orgId);
  }
}

import { Inject, Injectable } from "@nestjs/common";
import type { CoverageReport } from "@vidyam/contracts";

/** Port: what the center's material covers, by subject (the coverage_stats view). */
export interface CoverageStore {
  bySubject(orgId: string): Promise<CoverageReport>;
}
export const COVERAGE_STORE = Symbol("COVERAGE_STORE");

/** The admin dashboard's coverage (plan v3 §2): which subjects and chapters have material, and how much. */
@Injectable()
export class GetCoverage {
  constructor(@Inject(COVERAGE_STORE) private readonly store: CoverageStore) {}

  execute(orgId: string): Promise<CoverageReport> {
    return this.store.bySubject(orgId);
  }
}

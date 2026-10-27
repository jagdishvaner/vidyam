import { Injectable } from "@nestjs/common";
import type { StaffDirectory, StaffSubject, UpdateStaffMemberRequest } from "@vidyam/contracts";
import { schema } from "@vidyam/db";
import { and, asc, eq, gte, inArray, isNotNull, isNull, sql, sum } from "drizzle-orm";

import { OrgDatabase } from "../../../shared/database/org-database.js";
import type { StaffStore } from "../application/manage-staff.js";
import { asOrgRole, isPlatformAdminRole, type OrgRoleName } from "../domain/roles.js";

const { members, users, memberSubjects, taxonomyNodes, quotas, llmCalls } = schema;

const subjectLevel = and(eq(taxonomyNodes.level, "subject"), isNull(taxonomyNodes.parentId));

/** Memberships live in Better Auth's tables; subjects, budgets and spend in tenant tables under RLS. */
@Injectable()
export class DrizzleStaffStore implements StaffStore {
  constructor(private readonly orgDb: OrgDatabase) {}

  directory(organizationId: string): Promise<StaffDirectory> {
    return this.orgDb.run(organizationId, async (tx) => {
      const people = await tx
        .select({
          userId: members.userId,
          role: members.role,
          joinedAt: members.createdAt,
          name: users.name,
          email: users.email,
          platformRole: users.role,
        })
        .from(members)
        .innerJoin(users, eq(users.id, members.userId))
        .where(eq(members.organizationId, organizationId))
        .orderBy(asc(users.name));
      const subjects = await tx
        .select({
          nodeId: taxonomyNodes.id,
          code: taxonomyNodes.code,
          nameEn: taxonomyNodes.nameEn,
          nameHi: taxonomyNodes.nameHi,
        })
        .from(taxonomyNodes)
        .where(and(subjectLevel, eq(taxonomyNodes.isActive, true)))
        .orderBy(asc(taxonomyNodes.sortOrder), asc(taxonomyNodes.nameEn));
      const assigned = await tx
        .select({
          userId: memberSubjects.userId,
          nodeId: memberSubjects.subjectNodeId,
          isHead: memberSubjects.isHead,
          code: taxonomyNodes.code,
          nameEn: taxonomyNodes.nameEn,
          nameHi: taxonomyNodes.nameHi,
        })
        .from(memberSubjects)
        .innerJoin(taxonomyNodes, eq(taxonomyNodes.id, memberSubjects.subjectNodeId))
        .orderBy(asc(taxonomyNodes.sortOrder));
      const budgets = await tx
        .select({ userId: quotas.userId, limit: quotas.monthlyLimitUsd })
        .from(quotas)
        .where(isNotNull(quotas.userId));
      const spend = await tx
        .select({ userId: llmCalls.userId, total: sum(llmCalls.costUsd) })
        .from(llmCalls)
        .where(gte(llmCalls.createdAt, sql`date_trunc('month', now())`))
        .groupBy(llmCalls.userId);

      const subjectsOf = new Map<string, StaffSubject[]>();
      for (const { userId, ...subject } of assigned) {
        subjectsOf.set(userId, [...(subjectsOf.get(userId) ?? []), subject]);
      }
      const budgetOf = new Map(budgets.map((b) => [b.userId, Number(b.limit)]));
      const spentBy = new Map(spend.map((s) => [s.userId, Number(s.total ?? 0)]));
      return {
        members: people.flatMap((person) => {
          const role = asOrgRole(person.role);
          if (!role) return [];
          return [
            {
              userId: person.userId,
              name: person.name,
              email: person.email,
              role,
              platformAdmin: isPlatformAdminRole(person.platformRole),
              subjects: subjectsOf.get(person.userId) ?? [],
              monthlyBudgetUsd: budgetOf.get(person.userId) ?? null,
              spentThisMonthUsd: spentBy.get(person.userId) ?? 0,
              joinedAt: person.joinedAt.toISOString(),
            },
          ];
        }),
        subjects,
      };
    });
  }

  async find(
    organizationId: string,
    userId: string,
  ): Promise<{ role: OrgRoleName; platformAdmin: boolean } | null> {
    const [row] = await this.orgDb.run(organizationId, (tx) =>
      tx
        .select({ role: members.role, platformRole: users.role })
        .from(members)
        .innerJoin(users, eq(users.id, members.userId))
        .where(and(eq(members.organizationId, organizationId), eq(members.userId, userId)))
        .limit(1),
    );
    const role = asOrgRole(row?.role);
    return row && role ? { role, platformAdmin: isPlatformAdminRole(row.platformRole) } : null;
  }

  async knownSubjects(organizationId: string, nodeIds: string[]): Promise<Set<string>> {
    if (nodeIds.length === 0) return new Set();
    const rows = await this.orgDb.run(organizationId, (tx) =>
      tx
        .select({ id: taxonomyNodes.id })
        .from(taxonomyNodes)
        .where(and(subjectLevel, inArray(taxonomyNodes.id, nodeIds))),
    );
    return new Set(rows.map((r) => r.id));
  }

  update(organizationId: string, userId: string, change: UpdateStaffMemberRequest): Promise<void> {
    return this.orgDb.run(organizationId, async (tx) => {
      await tx
        .update(members)
        .set({ role: change.role })
        .where(and(eq(members.organizationId, organizationId), eq(members.userId, userId)));
      await tx.delete(memberSubjects).where(eq(memberSubjects.userId, userId));
      if (change.subjects.length) {
        await tx.insert(memberSubjects).values(
          change.subjects.map((s) => ({
            orgId: organizationId,
            userId,
            subjectNodeId: s.nodeId,
            isHead: s.isHead,
          })),
        );
      }
      if (change.monthlyBudgetUsd === null) {
        await tx.delete(quotas).where(eq(quotas.userId, userId));
      } else {
        const monthlyLimitUsd = change.monthlyBudgetUsd.toFixed(2);
        await tx
          .insert(quotas)
          .values({ orgId: organizationId, userId, monthlyLimitUsd })
          .onConflictDoUpdate({ target: [quotas.orgId, quotas.userId], set: { monthlyLimitUsd } });
      }
    });
  }
}

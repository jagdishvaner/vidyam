import type { UpdateStaffMemberRequest } from "@vidyam/contracts";
import { describe, expect, it } from "vitest";

import { DomainError } from "../../../shared/kernel/errors.js";
import { UpdateStaffMember, type StaffStore } from "./manage-staff.js";

const ORG = "0b6f2c1e-0000-4000-8000-000000000001";
const ADMIN = "0b6f2c1e-0000-4000-8000-000000000002";
const TEACHER = "0b6f2c1e-0000-4000-8000-000000000003";
const PHYSICS = "0b6f2c1e-0000-4000-8000-0000000000a1";
const CHAPTER = "0b6f2c1e-0000-4000-8000-0000000000a2";

function store(member: Awaited<ReturnType<StaffStore["find"]>> = { role: "teacher", platformAdmin: false }) {
  const updates: [string, UpdateStaffMemberRequest][] = [];
  const fake: StaffStore = {
    directory: async () => ({ members: [], subjects: [] }),
    find: async () => member,
    knownSubjects: async (_org, ids) => new Set(ids.filter((id) => id === PHYSICS)),
    update: async (_org, userId, change) => {
      updates.push([userId, change]);
    },
  };
  return { fake, updates };
}

const change: UpdateStaffMemberRequest = {
  role: "reviewer",
  subjects: [{ nodeId: PHYSICS, isHead: true }],
  monthlyBudgetUsd: 25,
};
const action = { organizationId: ORG, actorId: ADMIN, actorIsPlatformAdmin: false, userId: TEACHER, change };

describe("UpdateStaffMember", () => {
  it("saves the role, subjects and budget together", async () => {
    const { fake, updates } = store();
    await new UpdateStaffMember(fake).execute(action);
    expect(updates).toEqual([[TEACHER, change]]);
  });

  it("refuses someone outside the center", async () => {
    const { fake, updates } = store(null);
    await expect(new UpdateStaffMember(fake).execute(action)).rejects.toMatchObject({ kind: "not_found" });
    expect(updates).toEqual([]);
  });

  it("leaves a platform admin's profile to another platform admin", async () => {
    const { fake } = store({ role: "admin", platformAdmin: true });
    await expect(new UpdateStaffMember(fake).execute(action)).rejects.toMatchObject({ kind: "forbidden" });
    await expect(
      new UpdateStaffMember(fake).execute({
        ...action,
        actorIsPlatformAdmin: true,
        change: { ...change, role: "admin" },
      }),
    ).resolves.toBeUndefined();
  });

  it("won't let an admin change their own role, but lets them set their own subjects", async () => {
    const { fake, updates } = store({ role: "admin", platformAdmin: false });
    const self = { ...action, userId: ADMIN };
    await expect(new UpdateStaffMember(fake).execute(self)).rejects.toBeInstanceOf(DomainError);
    await new UpdateStaffMember(fake).execute({ ...self, change: { ...change, role: "admin" } });
    expect(updates).toHaveLength(1);
  });

  it("assigns only subjects of the center's syllabus, not chapters or unknown ids", async () => {
    const { fake } = store();
    const chapter = { ...action, change: { ...change, subjects: [{ nodeId: CHAPTER, isHead: false }] } };
    await expect(new UpdateStaffMember(fake).execute(chapter)).rejects.toMatchObject({ kind: "invalid" });
  });
});

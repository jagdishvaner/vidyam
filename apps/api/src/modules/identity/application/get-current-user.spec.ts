import { describe, expect, it } from "vitest";

import { GetCurrentUser, type Membership, type MembershipReader } from "./get-current-user.js";

const ORG = { id: "0b6f2c1e-0000-4000-8000-000000000001", name: "Center A", slug: "center-a" };

function useCase(membership: Membership | null) {
  const reader: MembershipReader = { find: async () => membership };
  return new GetCurrentUser(reader);
}

const user = { id: "u1", name: "Asha", email: "asha@example.com" };

describe("GetCurrentUser", () => {
  it("returns the active organization and the member's role", async () => {
    const result = await useCase({ organization: ORG, role: "teacher" }).execute({
      user,
      activeOrganizationId: ORG.id,
    });
    expect(result).toEqual({ ...user, platformRole: null, organization: ORG, orgRole: "teacher" });
  });

  it("recognises the platform super-admin, whether role is a string or a list", async () => {
    const one = await useCase(null).execute({
      user: { ...user, role: "superadmin" },
      activeOrganizationId: null,
    });
    const many = await useCase(null).execute({
      user: { ...user, role: ["user", "superadmin"] },
      activeOrganizationId: null,
    });
    expect([one.platformRole, many.platformRole]).toEqual(["superadmin", "superadmin"]);
  });

  it("ignores roles the platform doesn't know", async () => {
    const result = await useCase({ organization: ORG, role: "owner" }).execute({
      user,
      activeOrganizationId: ORG.id,
    });
    expect(result.orgRole).toBeNull();
  });

  it("has no organization when the session has none", async () => {
    const result = await useCase({ organization: ORG, role: "admin" }).execute({
      user,
      activeOrganizationId: null,
    });
    expect(result.organization).toBeNull();
  });
});

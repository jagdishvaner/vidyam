import { describe, expect, it } from "vitest";

import { DomainError } from "../../../shared/kernel/errors.js";
import { AddMember, RemoveMember, SetMemberPassword, type MemberAccounts } from "./manage-members.js";

const ORG = "0b6f2c1e-0000-4000-8000-000000000001";
const USER = "0b6f2c1e-0000-4000-8000-000000000002";

function fakeAccounts(overrides: Partial<MemberAccounts> = {}) {
  const calls = { created: [] as unknown[], passwords: [] as [string, string][], removed: [] as string[] };
  const accounts: MemberAccounts = {
    emailInUse: async () => false,
    create: async (input) => {
      calls.created.push(input);
      return USER;
    },
    findMember: async () => ({ isPlatformAdmin: false }),
    setPassword: async (userId, password) => {
      calls.passwords.push([userId, password]);
    },
    remove: async (_organizationId, userId) => {
      calls.removed.push(userId);
    },
    ...overrides,
  };
  return { accounts, calls };
}

const request = {
  name: "Asha Sharma",
  email: "Asha@Example.com",
  role: "teacher" as const,
  password: "x".repeat(10),
};

describe("AddMember", () => {
  it("creates the login in the admin's center, with the email lower-cased", async () => {
    const { accounts, calls } = fakeAccounts();
    await expect(new AddMember(accounts).execute(ORG, request)).resolves.toEqual({ userId: USER });
    expect(calls.created).toEqual([{ ...request, email: "asha@example.com", organizationId: ORG }]);
  });

  it("refuses an email that already has an account", async () => {
    const { accounts, calls } = fakeAccounts({ emailInUse: async () => true });
    await expect(new AddMember(accounts).execute(ORG, request)).rejects.toMatchObject({ kind: "conflict" });
    expect(calls.created).toEqual([]);
  });
});

describe("SetMemberPassword", () => {
  const input = { organizationId: ORG, actorIsPlatformAdmin: false, userId: USER, password: "y".repeat(10) };

  it("sets the password of someone in the admin's center", async () => {
    const { accounts, calls } = fakeAccounts();
    await new SetMemberPassword(accounts).execute(input);
    expect(calls.passwords).toEqual([[USER, input.password]]);
  });

  it("can't reach people outside the admin's center", async () => {
    const { accounts, calls } = fakeAccounts({ findMember: async () => null });
    const error = await new SetMemberPassword(accounts).execute(input).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).kind).toBe("not_found");
    expect(calls.passwords).toEqual([]);
  });

  it("lets only a platform admin change a platform admin's password", async () => {
    const { accounts, calls } = fakeAccounts({ findMember: async () => ({ isPlatformAdmin: true }) });
    await expect(new SetMemberPassword(accounts).execute(input)).rejects.toMatchObject({ kind: "forbidden" });
    await new SetMemberPassword(accounts).execute({ ...input, actorIsPlatformAdmin: true });
    expect(calls.passwords).toHaveLength(1);
  });
});

describe("RemoveMember", () => {
  const ADMIN = "0b6f2c1e-0000-4000-8000-000000000003";
  const input = { organizationId: ORG, actorIsPlatformAdmin: false, actorId: ADMIN, userId: USER };

  it("removes someone from the admin's center", async () => {
    const { accounts, calls } = fakeAccounts();
    await new RemoveMember(accounts).execute(input);
    expect(calls.removed).toEqual([USER]);
  });

  it("won't let admins remove themselves, so a center always keeps an admin who can sign in", async () => {
    const { accounts, calls } = fakeAccounts();
    await expect(new RemoveMember(accounts).execute({ ...input, userId: ADMIN })).rejects.toMatchObject({
      kind: "invalid",
    });
    expect(calls.removed).toEqual([]);
  });

  it("follows the same reach rules as password changes", async () => {
    const outsider = fakeAccounts({ findMember: async () => null });
    await expect(new RemoveMember(outsider.accounts).execute(input)).rejects.toMatchObject({
      kind: "not_found",
    });
    const platformAdmin = fakeAccounts({ findMember: async () => ({ isPlatformAdmin: true }) });
    await expect(new RemoveMember(platformAdmin.accounts).execute(input)).rejects.toMatchObject({
      kind: "forbidden",
    });
    expect([...outsider.calls.removed, ...platformAdmin.calls.removed]).toEqual([]);
  });
});

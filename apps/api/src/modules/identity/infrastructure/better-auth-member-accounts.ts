import { Inject, Injectable } from "@nestjs/common";
import { AuthService } from "@thallesp/nestjs-better-auth";
import { schema, type DatabaseHandle } from "@vidyam/db";
import { and, eq } from "drizzle-orm";

import { DATABASE } from "../../../shared/database/tokens.js";
import type { MemberAccounts } from "../application/manage-members.js";
import { PLATFORM_ADMIN, type OrgRoleName } from "../domain/roles.js";
import type { Auth } from "./better-auth.js";

/**
 * Better Auth's server-side API, called without request headers: `createUser` and `addMember` then skip their
 * own session checks, so authorization happens in the controller (@OrgRoles) and the use cases.
 */
@Injectable()
export class BetterAuthMemberAccounts implements MemberAccounts {
  constructor(
    private readonly auth: AuthService<Auth>,
    @Inject(DATABASE) private readonly database: DatabaseHandle,
  ) {}

  async emailInUse(email: string): Promise<boolean> {
    const context = await this.auth.instance.$context;
    return (await context.internalAdapter.findUserByEmail(email)) !== null;
  }

  async create(input: {
    organizationId: string;
    name: string;
    email: string;
    password: string;
    role: OrgRoleName;
  }): Promise<string> {
    const { user } = await this.auth.api.createUser({
      body: { name: input.name, email: input.email, password: input.password },
    });
    try {
      await this.auth.api.addMember({
        body: { userId: user.id, organizationId: input.organizationId, role: input.role },
      });
    } catch (error) {
      // Don't leave behind a login that belongs to no center.
      await (await this.auth.instance.$context).internalAdapter.deleteUser(user.id);
      throw error;
    }
    return user.id;
  }

  async findMember(organizationId: string, userId: string): Promise<{ isPlatformAdmin: boolean } | null> {
    const [row] = await this.database.db
      .select({ platformRole: schema.users.role })
      .from(schema.members)
      .innerJoin(schema.users, eq(schema.users.id, schema.members.userId))
      .where(and(eq(schema.members.organizationId, organizationId), eq(schema.members.userId, userId)))
      .limit(1);
    if (!row) return null;
    return { isPlatformAdmin: (row.platformRole ?? "").split(",").includes(PLATFORM_ADMIN) };
  }

  async setPassword(userId: string, password: string): Promise<void> {
    const context = await this.auth.instance.$context;
    await context.internalAdapter.updatePassword(userId, await context.password.hash(password));
    await context.internalAdapter.deleteUserSessions(userId);
  }

  async remove(organizationId: string, userId: string): Promise<void> {
    const { db } = this.database;
    const remaining = await db.transaction(async (tx) => {
      await tx
        .delete(schema.members)
        .where(and(eq(schema.members.organizationId, organizationId), eq(schema.members.userId, userId)));
      return tx.$count(schema.members, eq(schema.members.userId, userId));
    });
    const { internalAdapter } = await this.auth.instance.$context;
    // Sessions remember the active center, so end them either way; a login with no center left is deleted.
    if (remaining === 0) await internalAdapter.deleteUser(userId);
    else await internalAdapter.deleteUserSessions(userId);
  }
}

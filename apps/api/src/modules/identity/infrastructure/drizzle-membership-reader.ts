import { Inject, Injectable } from "@nestjs/common";
import { schema, type DatabaseHandle } from "@vidyam/db";
import { and, eq } from "drizzle-orm";

import { DATABASE } from "../../../shared/database/tokens.js";
import type { Membership, MembershipReader } from "../application/get-current-user.js";

@Injectable()
export class DrizzleMembershipReader implements MembershipReader {
  constructor(@Inject(DATABASE) private readonly database: DatabaseHandle) {}

  async find(userId: string, organizationId: string): Promise<Membership | null> {
    const [row] = await this.database.db
      .select({
        id: schema.organizations.id,
        name: schema.organizations.name,
        slug: schema.organizations.slug,
        role: schema.members.role,
      })
      .from(schema.members)
      .innerJoin(schema.organizations, eq(schema.organizations.id, schema.members.organizationId))
      .where(and(eq(schema.members.userId, userId), eq(schema.members.organizationId, organizationId)))
      .limit(1);
    return row ? { organization: { id: row.id, name: row.name, slug: row.slug }, role: row.role } : null;
  }
}

import { Inject, Injectable } from "@nestjs/common";
import type { CurrentUser } from "@vidyam/contracts";

import { asOrgRole, PLATFORM_ADMIN } from "../domain/roles.js";

export interface Membership {
  organization: { id: string; name: string; slug: string };
  role: string;
}

/** Port: reads a user's membership in an organization. */
export interface MembershipReader {
  find(userId: string, organizationId: string): Promise<Membership | null>;
}
export const MEMBERSHIP_READER = Symbol("MEMBERSHIP_READER");

export interface SessionInfo {
  user: { id: string; name: string; email: string; role?: string | string[] | null };
  activeOrganizationId: string | null;
}

@Injectable()
export class GetCurrentUser {
  constructor(@Inject(MEMBERSHIP_READER) private readonly memberships: MembershipReader) {}

  async execute({ user, activeOrganizationId }: SessionInfo): Promise<CurrentUser> {
    const membership = activeOrganizationId
      ? await this.memberships.find(user.id, activeOrganizationId)
      : null;
    const roles = Array.isArray(user.role) ? user.role : [user.role];
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      platformRole: roles.includes(PLATFORM_ADMIN) ? PLATFORM_ADMIN : null,
      organization: membership?.organization ?? null,
      orgRole: asOrgRole(membership?.role),
    };
  }
}

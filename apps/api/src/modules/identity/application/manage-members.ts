import { Inject, Injectable } from "@nestjs/common";
import type { AddMemberRequest } from "@vidyam/contracts";

import { DomainError } from "../../../shared/kernel/errors.js";
import type { OrgRoleName } from "../domain/roles.js";

/** Port: user accounts and organization memberships (Better Auth behind it). */
export interface MemberAccounts {
  emailInUse(email: string): Promise<boolean>;
  /** Creates the account with this password and adds it to the organization; all or nothing. */
  create(input: {
    organizationId: string;
    name: string;
    email: string;
    password: string;
    role: OrgRoleName;
  }): Promise<string>;
  /** The member's standing, or null when the user is not in this organization. */
  findMember(organizationId: string, userId: string): Promise<{ isPlatformAdmin: boolean } | null>;
  /** Replaces the password and ends every session the user has. */
  setPassword(userId: string, password: string): Promise<void>;
  /** Takes the user out of the organization and signs them out; deletes the login if no center is left. */
  remove(organizationId: string, userId: string): Promise<void>;
}
export const MEMBER_ACCOUNTS = Symbol("MEMBER_ACCOUNTS");

/** A center admin creates a member's login directly (ADR 0011: no emailed invitations). */
@Injectable()
export class AddMember {
  constructor(@Inject(MEMBER_ACCOUNTS) private readonly accounts: MemberAccounts) {}

  async execute(organizationId: string, request: AddMemberRequest): Promise<{ userId: string }> {
    const email = request.email.toLowerCase();
    if (await this.accounts.emailInUse(email)) {
      throw new DomainError(`An account with ${email} already exists.`, "conflict");
    }
    const userId = await this.accounts.create({ ...request, email, organizationId });
    return { userId };
  }
}

export interface MemberAction {
  organizationId: string;
  actorIsPlatformAdmin: boolean;
  userId: string;
}

/** The target must be in the admin's center, and a platform admin's login is off limits to center admins. */
async function assertManageable(accounts: MemberAccounts, action: MemberAction): Promise<void> {
  const member = await accounts.findMember(action.organizationId, action.userId);
  if (!member) throw new DomainError("No such member in this center.", "not_found");
  // A platform admin can act on every center, so only another platform admin may take over that login.
  if (member.isPlatformAdmin && !action.actorIsPlatformAdmin) {
    throw new DomainError("Only a platform admin can manage a platform admin's login.", "forbidden");
  }
}

/** A center admin sets a new password for someone in their center (ADR 0011: no emailed reset links). */
@Injectable()
export class SetMemberPassword {
  constructor(@Inject(MEMBER_ACCOUNTS) private readonly accounts: MemberAccounts) {}

  async execute(input: MemberAction & { password: string }): Promise<void> {
    await assertManageable(this.accounts, input);
    await this.accounts.setPassword(input.userId, input.password);
  }
}

/** A center admin removes someone who has left; their sessions end immediately. */
@Injectable()
export class RemoveMember {
  constructor(@Inject(MEMBER_ACCOUNTS) private readonly accounts: MemberAccounts) {}

  async execute(input: MemberAction & { actorId: string }): Promise<void> {
    if (input.userId === input.actorId) {
      throw new DomainError("You can't remove yourself; ask another admin.", "invalid");
    }
    await assertManageable(this.accounts, input);
    await this.accounts.remove(input.organizationId, input.userId);
  }
}

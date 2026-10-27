import { Inject, Injectable } from "@nestjs/common";
import type { StaffDirectory, UpdateStaffMemberRequest } from "@vidyam/contracts";

import { DomainError } from "../../../shared/kernel/errors.js";
import type { OrgRoleName } from "../domain/roles.js";

/** Port: staff profiles inside one center (role, subjects, personal AI budget). */
export interface StaffStore {
  directory(organizationId: string): Promise<StaffDirectory>;
  find(organizationId: string, userId: string): Promise<{ role: OrgRoleName; platformAdmin: boolean } | null>;
  /** Which of these ids are subjects of the center's syllabus. */
  knownSubjects(organizationId: string, nodeIds: string[]): Promise<Set<string>>;
  /** Role, subjects and budget together, all or nothing. */
  update(organizationId: string, userId: string, change: UpdateStaffMemberRequest): Promise<void>;
}
export const STAFF_STORE = Symbol("STAFF_STORE");

@Injectable()
export class ListStaff {
  constructor(@Inject(STAFF_STORE) private readonly store: StaffStore) {}

  execute(organizationId: string): Promise<StaffDirectory> {
    return this.store.directory(organizationId);
  }
}

export interface StaffChange {
  organizationId: string;
  actorId: string;
  actorIsPlatformAdmin: boolean;
  userId: string;
  change: UpdateStaffMemberRequest;
}

/** A center admin sets someone's role, the subjects they teach (and head), and their monthly AI budget. */
@Injectable()
export class UpdateStaffMember {
  constructor(@Inject(STAFF_STORE) private readonly store: StaffStore) {}

  async execute({
    organizationId,
    actorId,
    actorIsPlatformAdmin,
    userId,
    change,
  }: StaffChange): Promise<void> {
    const member = await this.store.find(organizationId, userId);
    if (!member) throw new DomainError("No such member in this center.", "not_found");
    if (member.platformAdmin && !actorIsPlatformAdmin) {
      throw new DomainError(
        "Only a platform admin can change a platform admin's staff profile.",
        "forbidden",
      );
    }
    // A center must never lose its last admin by accident; another admin can change yours.
    if (userId === actorId && change.role !== member.role) {
      throw new DomainError("You can't change your own role; ask another admin.", "invalid");
    }
    const known = await this.store.knownSubjects(
      organizationId,
      change.subjects.map((s) => s.nodeId),
    );
    if (change.subjects.some((s) => !known.has(s.nodeId))) {
      throw new DomainError("Only subjects from the center's syllabus can be assigned.", "invalid");
    }
    await this.store.update(organizationId, userId, change);
  }
}

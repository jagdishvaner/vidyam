import { PERMISSIONS, ROLE_PERMISSIONS } from "@vidyam/contracts";
import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc as platformAdminAc,
  defaultStatements as platformStatements,
  userAc as platformUserAc,
} from "better-auth/plugins/admin/access";
import { adminAc, defaultStatements } from "better-auth/plugins/organization/access";

import { PLATFORM_ADMIN, type OrgRoleName } from "../domain/roles.js";

/** Platform-level roles (admin plugin): the super-admin manages users across every center. */
export const platformAccessControl = createAccessControl(platformStatements);

export const platformRoles = {
  [PLATFORM_ADMIN]: platformAccessControl.newRole(platformAdminAc.statements),
  user: platformAccessControl.newRole(platformUserAc.statements),
};

/**
 * What each organization role may do: the fixed matrix in @vidyam/contracts (which the web app also reads), plus
 * Better Auth's own organization statements (members, invitations), which only admins hold. Checked with
 * @MemberHasPermission.
 */
export const accessControl = createAccessControl({ ...defaultStatements, ...PERMISSIONS });

export const orgRoles: Record<OrgRoleName, ReturnType<typeof accessControl.newRole>> = {
  admin: accessControl.newRole({ ...adminAc.statements, ...ROLE_PERMISSIONS.admin }),
  reviewer: accessControl.newRole(ROLE_PERMISSIONS.reviewer),
  teacher: accessControl.newRole(ROLE_PERMISSIONS.teacher),
  content_operator: accessControl.newRole(ROLE_PERMISSIONS.content_operator),
};

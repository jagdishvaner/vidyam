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

/** What each organization role may do. Checked with @MemberHasPermission / Better Auth's hasPermission. */
const statements = {
  ...defaultStatements,
  library: ["upload", "review"],
  paper: ["create", "edit", "approve", "publish"],
  settings: ["manage"],
} as const;

export const accessControl = createAccessControl(statements);

export const orgRoles: Record<OrgRoleName, ReturnType<typeof accessControl.newRole>> = {
  // Center admin: manages members and settings, and can do everything a reviewer and operator can.
  admin: accessControl.newRole({
    ...adminAc.statements,
    library: ["upload", "review"],
    paper: ["create", "edit", "approve", "publish"],
    settings: ["manage"],
  }),
  // Head of department: approves and publishes papers, reviews OCR output.
  reviewer: accessControl.newRole({ library: ["review"], paper: ["create", "edit", "approve", "publish"] }),
  // Generates and edits papers; publishing needs a reviewer.
  teacher: accessControl.newRole({ paper: ["create", "edit"] }),
  // Uploads content and corrects OCR output.
  content_operator: accessControl.newRole({ library: ["upload", "review"] }),
};

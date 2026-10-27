import { PERMISSIONS, roleCan, type PermissionResource } from "@vidyam/contracts";
import { describe, expect, it } from "vitest";

import { ORG_ROLES } from "../domain/roles.js";
import { orgRoles } from "./access-control.js";

describe("organization roles", () => {
  it("grant exactly the shared role matrix", () => {
    for (const role of ORG_ROLES) {
      for (const [resource, actions] of Object.entries(PERMISSIONS) as [
        PermissionResource,
        readonly string[],
      ][]) {
        for (const action of actions) {
          const granted = orgRoles[role].authorize({ [resource]: [action] }).success;
          expect(granted, `${role} ${resource}:${action}`).toBe(roleCan(role, resource, action as never));
        }
      }
    }
  });

  it("leave member management to admins", () => {
    expect(orgRoles.admin.authorize({ member: ["create", "delete"] }).success).toBe(true);
    for (const role of ["reviewer", "teacher", "content_operator"] as const) {
      expect(orgRoles[role].authorize({ member: ["create"] }).success).toBe(false);
    }
  });
});

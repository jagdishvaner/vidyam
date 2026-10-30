import { roleCan } from "@vidyam/contracts";

import { ADMIN_URL } from "@vidyam/app-shell/server/env";
import { getCurrentUser } from "@vidyam/app-shell/server/session";
import { SystemStatus } from "@vidyam/app-shell/system-status";

import { CenterUsage, ContentHealth } from "./center";

/**
 * What the center's admins also see (plan v3 §2): its AI spend, what the library covers and what is waiting
 * to be processed, and the system's health. Each part shows only to those whose role can act on it; the
 * admin panel has the details.
 */
export async function AdminSections() {
  const user = await getCurrentUser();
  const usage = roleCan(user.orgRole, "budget", "manage");
  const content = roleCan(user.orgRole, "library", "process");
  const health = roleCan(user.orgRole, "settings", "manage");
  if (!usage && !content && !health) return null;
  return (
    <div className="space-y-6">
      {(usage || health) && (
        <div className="grid gap-6 lg:grid-cols-2">
          {usage && <CenterUsage adminUrl={ADMIN_URL} />}
          {health && <SystemStatus />}
        </div>
      )}
      {content && <ContentHealth adminUrl={ADMIN_URL} />}
    </div>
  );
}

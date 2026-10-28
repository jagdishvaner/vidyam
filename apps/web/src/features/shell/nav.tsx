import { ADMIN_URL } from "@vidyam/app-shell/server/env";
import { getCurrentUser } from "@vidyam/app-shell/server/session";
import { roleCan } from "@vidyam/contracts";

import { NavLinks } from "./nav-links";

/** Server part: the Admin link appears only for those who can manage the center (must sit inside <Suspense>). */
export async function Nav() {
  const user = await getCurrentUser();
  return <NavLinks adminUrl={roleCan(user.orgRole, "settings", "manage") ? ADMIN_URL : null} />;
}

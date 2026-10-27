import { roleCan } from "@vidyam/contracts";

import { getCurrentUser } from "@/lib/server/session";

import { NavLinks } from "./nav-links";

/** Server part: Admin appears only for those who can manage the center (must sit inside <Suspense>). */
export async function Nav() {
  const user = await getCurrentUser();
  return <NavLinks isAdmin={roleCan(user.orgRole, "settings", "manage")} />;
}

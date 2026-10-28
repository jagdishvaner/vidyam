import { getCurrentUser } from "../server/session";

import { UserMenuClient } from "./user-menu-client";

/** Server part: reads the session (must sit inside <Suspense>), then renders the interactive menu. */
export async function UserMenu() {
  const user = await getCurrentUser();
  return <UserMenuClient user={user} />;
}

import { ADMIN_URL } from "@vidyam/app-shell/server/env";
import { redirect } from "next/navigation";

/** Members moved to the admin panel (its own subdomain); old links and bookmarks still work. */
export default async function MembersPage({ params }: PageProps<"/[locale]/settings/members">) {
  const { locale } = await params;
  redirect(`${ADMIN_URL}/${locale}/staff`);
}

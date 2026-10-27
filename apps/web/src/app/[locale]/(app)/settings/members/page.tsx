import { redirect } from "@/i18n/navigation";

/** Members moved to Admin → Staff; old links and bookmarks still work. */
export default async function MembersPage({ params }: PageProps<"/[locale]/settings/members">) {
  const { locale } = await params;
  redirect({ href: "/admin/staff", locale });
}

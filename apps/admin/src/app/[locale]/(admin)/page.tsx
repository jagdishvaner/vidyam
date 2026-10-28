import { redirect } from "@vidyam/app-shell/i18n/navigation";

/** The panel opens on Staff, the section admins use most. */
export default async function AdminHome({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  redirect({ href: "/staff", locale });
}

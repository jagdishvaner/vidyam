import { Skeleton } from "@vidyam/ui/components/skeleton";
import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { Suspense } from "react";

import { SettingsPage } from "@/features/settings/settings-page";
import { getCurrentUser } from "@vidyam/app-shell/server/session";

export const metadata: Metadata = { title: "Settings" };

async function Settings() {
  const user = await getCurrentUser();
  return <SettingsPage user={user} />;
}

export default function SettingsRoute() {
  const t = useTranslations("settings");
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>
      <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
        <Settings />
      </Suspense>
    </div>
  );
}

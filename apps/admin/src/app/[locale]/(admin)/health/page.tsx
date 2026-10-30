import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { Suspense } from "react";

import { SystemStatus } from "@vidyam/app-shell/system-status";
import { RecentProblems } from "@/features/health/recent-problems";

export const metadata: Metadata = { title: "System health" };

/** The same live status as on the dashboard, and what failed in the last day. */
export default function HealthPage() {
  const t = useTranslations("admin.sections");
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t("health")}</h1>
      <SystemStatus />
      <Suspense>
        <RecentProblems />
      </Suspense>
    </div>
  );
}

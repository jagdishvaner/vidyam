import type { Metadata } from "next";
import { useTranslations } from "next-intl";

import { SystemStatus } from "@/features/dashboard/system-status";

export const metadata: Metadata = { title: "System health" };

/** The same live status as on the dashboard: every service and dependency the platform needs. */
export default function HealthPage() {
  const t = useTranslations("admin.sections");
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold tracking-tight">{t("health")}</h2>
      <SystemStatus />
    </div>
  );
}

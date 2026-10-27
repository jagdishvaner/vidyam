import type { Metadata } from "next";
import { useTranslations } from "next-intl";

import { AuditLog } from "@/features/audit/audit-log";

export const metadata: Metadata = { title: "Audit log" };

export default function AuditPage() {
  const t = useTranslations("audit");
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      <AuditLog />
    </div>
  );
}

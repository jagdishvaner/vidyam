import type { Metadata } from "next";
import { useTranslations } from "next-intl";

import { UsageAdmin } from "@/features/usage/usage-admin";

export const metadata: Metadata = { title: "Usage & budgets" };

export default function UsagePage() {
  const t = useTranslations("usage");
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      <UsageAdmin />
    </div>
  );
}

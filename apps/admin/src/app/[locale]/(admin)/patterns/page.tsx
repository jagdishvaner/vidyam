import type { Metadata } from "next";
import { useTranslations } from "next-intl";

import { PatternsAdmin } from "@/features/patterns/patterns-admin";

export const metadata: Metadata = { title: "Paper patterns" };

export default function PatternsPage() {
  const t = useTranslations("patterns");
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>
      <PatternsAdmin />
    </div>
  );
}

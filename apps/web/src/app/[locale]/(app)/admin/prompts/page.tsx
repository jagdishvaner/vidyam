import type { Metadata } from "next";
import { useTranslations } from "next-intl";

import { PromptsAdmin } from "@/features/ai-models/prompts-admin";

export const metadata: Metadata = { title: "Prompts" };

export default function PromptsPage() {
  const t = useTranslations("prompts");
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      <PromptsAdmin />
    </div>
  );
}

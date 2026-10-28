import type { Metadata } from "next";
import { useTranslations } from "next-intl";

import { PromptsAdmin } from "@/features/ai-models/prompts-admin";

export const metadata: Metadata = { title: "Prompts" };

export default function PromptsPage() {
  const t = useTranslations("prompts");
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>
      <PromptsAdmin />
    </div>
  );
}

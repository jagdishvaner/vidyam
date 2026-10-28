import type { Metadata } from "next";
import { useTranslations } from "next-intl";

import { AiModelsAdmin } from "@/features/ai-models/ai-models-admin";

export const metadata: Metadata = { title: "AI models" };

export default function AiModelsPage() {
  const t = useTranslations("aiModels");
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>
      <AiModelsAdmin />
    </div>
  );
}

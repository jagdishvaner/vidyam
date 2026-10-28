import type { Metadata } from "next";
import { useTranslations } from "next-intl";

import { CenterProfile } from "@/features/center/center-profile";

export const metadata: Metadata = { title: "Center profile" };

export default function CenterPage() {
  const t = useTranslations("center");
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>
      <CenterProfile />
    </div>
  );
}

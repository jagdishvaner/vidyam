import type { Metadata } from "next";
import { useTranslations } from "next-intl";

import { CenterProfile } from "@/features/center/center-profile";

export const metadata: Metadata = { title: "Center profile" };

export default function CenterPage() {
  const t = useTranslations("center");
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      <CenterProfile />
    </div>
  );
}

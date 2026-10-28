import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { Suspense } from "react";

import { StaffManager } from "@/features/staff/staff-manager";
import { getCurrentUser } from "@vidyam/app-shell/server/session";

export const metadata: Metadata = { title: "Staff" };

async function Staff() {
  const user = await getCurrentUser();
  return <StaffManager currentUserId={user.id} />;
}

export default function StaffPage() {
  const t = useTranslations("members");
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>
      <Suspense>
        <Staff />
      </Suspense>
    </div>
  );
}

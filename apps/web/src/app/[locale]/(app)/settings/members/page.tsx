import { Alert, AlertDescription } from "@vidyam/ui/components/alert";
import { Skeleton } from "@vidyam/ui/components/skeleton";
import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { MembersManager } from "@/features/members/members-manager";
import { getCurrentUser } from "@/lib/server/session";

export const metadata: Metadata = { title: "Members" };

/** UI gate only: the API enforces the same rule (Better Auth organization permissions). */
async function MembersGate() {
  const [user, t] = await Promise.all([getCurrentUser(), getTranslations("members")]);
  const canManage = user.platformRole === "superadmin" || user.orgRole === "admin";
  if (!canManage) {
    return (
      <Alert>
        <AlertDescription>{t("adminOnly")}</AlertDescription>
      </Alert>
    );
  }
  return <MembersManager />;
}

export default function MembersPage() {
  const t = useTranslations("members");
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>
      <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
        <MembersGate />
      </Suspense>
    </div>
  );
}

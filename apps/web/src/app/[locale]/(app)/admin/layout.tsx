import { roleCan } from "@vidyam/contracts";
import { Alert, AlertDescription } from "@vidyam/ui/components/alert";
import { Skeleton } from "@vidyam/ui/components/skeleton";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense, type ReactNode } from "react";

import { AdminNav } from "@/features/admin/admin-nav";
import { getCurrentUser } from "@/lib/server/session";

/** UI gate only: every admin endpoint is enforced by the API as well. */
async function AdminGate({ children }: { children: ReactNode }) {
  const [user, t] = await Promise.all([getCurrentUser(), getTranslations("admin")]);
  if (!roleCan(user.orgRole, "settings", "manage")) {
    return (
      <Alert>
        <AlertDescription>{t("adminOnly")}</AlertDescription>
      </Alert>
    );
  }
  return children;
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  const t = useTranslations("admin");
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <aside>
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <AdminNav />
          </Suspense>
        </aside>
        <div className="min-w-0">
          <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
            <AdminGate>{children}</AdminGate>
          </Suspense>
        </div>
      </div>
    </div>
  );
}

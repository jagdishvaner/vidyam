import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@vidyam/ui/components/card";
import { Skeleton } from "@vidyam/ui/components/skeleton";
import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { Suspense } from "react";

import { SummaryCards } from "@/features/dashboard/summary-cards";
import { SystemStatus } from "@/features/dashboard/system-status";
import { Welcome } from "@/features/dashboard/welcome";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  const t = useTranslations("dashboard");
  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <Suspense
        fallback={
          <div className="space-y-2">
            <Skeleton className="h-8 w-72" />
            <Skeleton className="h-5 w-96" />
          </div>
        }
      >
        <Welcome />
      </Suspense>
      <SummaryCards />
      <div className="grid gap-6 lg:grid-cols-3">
        <SystemStatus className="lg:col-span-2" />
        <Card>
          <CardHeader>
            <CardTitle>{t("nextUp")}</CardTitle>
            <CardDescription>{t("nextUpBody")}</CardDescription>
          </CardHeader>
          <CardContent />
        </Card>
      </div>
    </div>
  );
}

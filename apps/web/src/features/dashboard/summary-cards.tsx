"use client";

import { Card, CardDescription, CardHeader, CardTitle } from "@vidyam/ui/components/card";
import { Skeleton } from "@vidyam/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";

import { api } from "@/lib/client/api";

const METRICS = ["sources", "questions", "documents"] as const;

export function SummaryCards() {
  const t = useTranslations("dashboard");
  const format = useFormatter();
  const { data, isPending } = useQuery({
    queryKey: ["dashboard", "summary"],
    queryFn: async () => (await api.GET("/api/dashboard/summary")).data ?? null,
  });

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {METRICS.map((metric) => (
        <Card key={metric}>
          <CardHeader>
            <CardDescription>{t(metric)}</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {isPending ? <Skeleton className="h-9 w-16" /> : format.number(data?.[metric] ?? 0)}
            </CardTitle>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}

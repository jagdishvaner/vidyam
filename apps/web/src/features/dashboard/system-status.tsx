"use client";

import { Badge } from "@vidyam/ui/components/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@vidyam/ui/components/card";
import { Skeleton } from "@vidyam/ui/components/skeleton";
import { cn } from "@vidyam/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { CircleCheck, CircleX } from "lucide-react";
import { useTranslations } from "next-intl";

import { api } from "@/lib/client/api";

export function SystemStatus({ className }: { className?: string }) {
  const t = useTranslations("dashboard");
  const { data, isPending } = useQuery({
    queryKey: ["system", "status"],
    queryFn: async () => (await api.GET("/api/system/status")).data ?? null,
    refetchInterval: 15_000,
  });

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {t("systemStatus")}
          {data && (
            <Badge variant={data.ok ? "secondary" : "destructive"}>
              {data.ok ? t("allOperational") : t("degraded")}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>{t("checkedEvery")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 sm:grid-cols-2">
        {isPending && [0, 1].map((i) => <Skeleton key={i} className="h-40 w-full" />)}
        {data?.services.map((service) => (
          <section key={service.service} className="space-y-2">
            <h3 className="flex items-center justify-between text-sm font-medium">
              {t(`service.${service.service}`)}
              <span className="text-xs font-normal text-muted-foreground">v{service.version}</span>
            </h3>
            <ul className="space-y-1.5">
              {service.dependencies.map((dep) => (
                <li
                  key={dep.name}
                  className="flex items-center gap-2 text-sm"
                  title={dep.detail ?? undefined}
                >
                  {dep.ok ? (
                    <CircleCheck className="size-4 shrink-0 text-emerald-600" />
                  ) : (
                    <CircleX className="size-4 shrink-0 text-destructive" />
                  )}
                  <span className={cn(!dep.ok && "text-destructive")}>{dep.name}</span>
                  <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                    {dep.latencyMs} ms
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </CardContent>
    </Card>
  );
}

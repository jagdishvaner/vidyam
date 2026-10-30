"use client";

import type { Problem } from "@vidyam/contracts";
import { Badge } from "@vidyam/ui/components/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@vidyam/ui/components/card";
import { Skeleton } from "@vidyam/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Bot, CircleCheck, FileDown, FileText, FileWarning, MessageSquare } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";

import { api } from "@vidyam/app-shell/client/api";

const ICONS: Record<Problem["kind"], typeof Bot> = {
  generation: FileText,
  export: FileDown,
  chat: MessageSquare,
  ai_call: Bot,
  source: FileWarning,
};

/** What failed in the last day (plan v3 step 31), newest first, from what the services already record. */
export function RecentProblems() {
  const t = useTranslations("problems");
  const tc = useTranslations("common");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const problems = useQuery({
    queryKey: ["system", "problems"],
    queryFn: async () => (await api.GET("/api/system/problems")).data ?? null,
    refetchInterval: 60_000,
  });
  const items = problems.data?.items;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {t("title")}
          {!!items?.length && <Badge variant="destructive">{items.length}</Badge>}
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {problems.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : !items ? (
          <p className="text-sm text-destructive">{tc("somethingWentWrong")}</p>
        ) : !items.length ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CircleCheck className="size-4 text-emerald-600" />
            {t("none")}
          </p>
        ) : (
          <ul className="divide-y" aria-label={t("title")}>
            {items.map((problem) => {
              const Icon = ICONS[problem.kind];
              return (
                <li key={`${problem.kind}-${problem.id}`} className="space-y-1 py-3 text-sm">
                  <div className="flex items-center gap-2">
                    <Icon className="size-4 shrink-0 text-destructive" />
                    <span className="font-medium">{t(`kinds.${problem.kind}`)}</span>
                    {problem.count > 1 && (
                      <Badge variant="secondary" className="tabular-nums">
                        {t("times", { count: problem.count })}
                      </Badge>
                    )}
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {format.relativeTime(new Date(problem.at), now)}
                    </span>
                  </div>
                  <p className="truncate pl-6">
                    {problem.subject}
                    {problem.person && <span className="text-muted-foreground"> · {problem.person}</span>}
                  </p>
                  <p className="line-clamp-2 pl-6 font-mono text-xs break-all text-muted-foreground">
                    {problem.error}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

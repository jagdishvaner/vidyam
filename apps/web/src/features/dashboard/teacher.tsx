"use client";

import { Badge } from "@vidyam/ui/components/badge";
import { Button } from "@vidyam/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@vidyam/ui/components/card";
import { Skeleton } from "@vidyam/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, FileText, HelpCircle, MessageSquare, NotebookPen, ScrollText } from "lucide-react";
import Link from "next/link";
import { useFormatter, useLocale, useNow, useTranslations } from "next-intl";

import { api } from "@vidyam/app-shell/client/api";
import { useLabels } from "@/features/chat/labels";

import { Meter } from "./meter";

/** Start a chat with the request half-written, for the teacher to finish. */
export function QuickActions() {
  const t = useTranslations("dashboard.actions");
  const locale = useLocale();
  const actions = [
    { key: "paper", icon: ScrollText },
    { key: "doubt", icon: HelpCircle },
    { key: "notes", icon: NotebookPen },
  ] as const;
  return (
    <div className="flex flex-wrap gap-2">
      {actions.map(({ key, icon: Icon }) => (
        <Button key={key} asChild variant={key === "paper" ? "default" : "outline"}>
          <Link href={`/${locale}/chat?prompt=${encodeURIComponent(t(`${key}Prompt`))}`}>
            <Icon />
            {t(key)}
          </Link>
        </Button>
      ))}
    </div>
  );
}

/** The teacher's latest chats and the papers and notes made in them. */
export function RecentWork() {
  const t = useTranslations("dashboard");
  const labels = useLabels();
  const format = useFormatter();
  const locale = useLocale();
  const chats = useQuery({
    queryKey: ["dashboard", "chats"],
    queryFn: async () =>
      (await api.GET("/api/chat/sessions", { params: { query: { show: "active" } } })).data ?? null,
  });
  const documents = useQuery({
    queryKey: ["dashboard", "documents"],
    queryFn: async () => (await api.GET("/api/documents", { params: { query: { limit: 5 } } })).data ?? null,
  });
  const now = useNow({ updateInterval: 60_000 });
  const when = (iso: string) => format.relativeTime(new Date(iso), now);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="size-4" />
            {t("recentChats")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {chats.isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : !chats.data?.items.length ? (
            <p className="text-sm text-muted-foreground">{t("noChats")}</p>
          ) : (
            <ul className="divide-y text-sm" aria-label={t("recentChats")}>
              {chats.data.items.slice(0, 5).map((chat) => (
                <li key={chat.id} className="flex items-center gap-2 py-2">
                  <Link
                    href={`/${locale}/chat/${chat.id}`}
                    className="min-w-0 flex-1 truncate hover:underline"
                  >
                    {chat.title || t("untitledChat")}
                  </Link>
                  <span className="shrink-0 text-xs text-muted-foreground">{when(chat.updatedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="size-4" />
            {t("recentDocuments")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {documents.isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : !documents.data?.length ? (
            <p className="text-sm text-muted-foreground">{t("noDocuments")}</p>
          ) : (
            <ul className="divide-y text-sm" aria-label={t("recentDocuments")}>
              {documents.data.map((doc) => (
                <li key={doc.id} className="flex items-center gap-2 py-2">
                  <Badge variant="secondary" className="shrink-0">
                    {labels.kind(doc.kind)}
                  </Badge>
                  {doc.chatId ? (
                    <Link
                      href={`/${locale}/chat/${doc.chatId}`}
                      className="min-w-0 flex-1 truncate hover:underline"
                    >
                      {doc.title}
                    </Link>
                  ) : (
                    <span className="min-w-0 flex-1 truncate">{doc.title}</span>
                  )}
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {doc.currentVersion ? t("version", { version: doc.currentVersion }) : t("beingMade")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** What the teacher's AI use cost this month, against their own budget. */
export function MyUsageCard() {
  const t = useTranslations("dashboard.usage");
  const format = useFormatter();
  const usage = useQuery({
    queryKey: ["dashboard", "my-usage"],
    queryFn: async () => (await api.GET("/api/me/usage")).data ?? null,
  });
  const money = (usd: number) => format.number(usd, { style: "currency", currency: "USD" });
  const data = usage.data;
  return (
    <Card>
      <CardHeader>
        <CardDescription>{t("mine")}</CardDescription>
        <CardTitle className="text-3xl tabular-nums">
          {usage.isPending ? <Skeleton className="h-9 w-24" /> : money(data?.costUsd ?? 0)}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {data && (
          <>
            {data.budgetUsd !== null ? (
              <Meter
                label={t("ofBudget", { budget: money(data.budgetUsd) })}
                value={data.costUsd}
                max={data.budgetUsd}
              />
            ) : (
              <p className="text-muted-foreground">{t("noBudget")}</p>
            )}
            <p className="text-muted-foreground">{t("calls", { calls: data.calls })}</p>
            {data.centerExhausted && (
              <p className="flex items-center gap-1.5 text-destructive">
                <AlertTriangle className="size-4" />
                {t("centerExhausted")}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

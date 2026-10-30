"use client";

import { Button } from "@vidyam/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@vidyam/ui/components/card";
import { Skeleton } from "@vidyam/ui/components/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@vidyam/ui/components/table";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";

import { api } from "@vidyam/app-shell/client/api";

import { Meter } from "./meter";

function AdminLink({ href, label }: { href: string; label: string }) {
  return (
    <Button asChild variant="ghost" size="sm" className="ml-auto">
      <a href={href}>
        {label}
        <ArrowUpRight />
      </a>
    </Button>
  );
}

/** The center's AI spend this month against its budget, and who and what it went on (plan v3 §2). */
export function CenterUsage({ adminUrl }: { adminUrl: string }) {
  const t = useTranslations("dashboard.center");
  const tasks = useTranslations("dashboard.tasks");
  const format = useFormatter();
  const locale = useLocale();
  const report = useQuery({
    queryKey: ["dashboard", "center-usage"],
    queryFn: async () => (await api.GET("/api/usage", { params: { query: {} } })).data ?? null,
  });
  const money = (usd: number) => format.number(usd, { style: "currency", currency: "USD" });
  const data = report.data;
  return (
    <Card>
      <CardHeader className="flex flex-row items-start gap-2">
        <div className="space-y-1.5">
          <CardDescription>{t("spend")}</CardDescription>
          <CardTitle className="text-3xl tabular-nums">
            {report.isPending ? <Skeleton className="h-9 w-24" /> : money(data?.totals.costUsd ?? 0)}
          </CardTitle>
        </div>
        <AdminLink href={`${adminUrl}/${locale}/usage`} label={t("details")} />
      </CardHeader>
      {data && (
        <CardContent className="space-y-4 text-sm">
          {data.budget.monthlyLimitUsd !== null ? (
            <Meter
              label={t("ofBudget", { budget: money(data.budget.monthlyLimitUsd) })}
              value={data.totals.costUsd}
              max={data.budget.monthlyLimitUsd}
            />
          ) : (
            <p className="text-muted-foreground">{t("noBudget")}</p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Top
              title={t("byTeacher")}
              rows={data.byTeacher.slice(0, 3).map((row) => [row.name ?? t("noOne"), money(row.costUsd)])}
              empty={t("nothingYet")}
            />
            <Top
              title={t("byTask")}
              rows={data.byTask
                .slice(0, 3)
                .map((row) => [tasks.has(row.task) ? tasks(row.task) : row.task, money(row.costUsd)])}
              empty={t("nothingYet")}
            />
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function Top({ title, rows, empty }: { title: string; rows: [string, string][]; empty: string }) {
  return (
    <div className="space-y-1">
      <p className="font-medium">{title}</p>
      {rows.length === 0 ? (
        <p className="text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-0.5">
          {rows.map(([name, value]) => (
            <li key={name} className="flex justify-between gap-2">
              <span className="truncate">{name}</span>
              <span className="tabular-nums">{value}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Which subjects the material covers, and what is waiting to be read, split or tagged. */
export function ContentHealth({ adminUrl }: { adminUrl: string }) {
  const t = useTranslations("dashboard.content");
  const format = useFormatter();
  const locale = useLocale();
  const coverage = useQuery({
    queryKey: ["dashboard", "coverage"],
    queryFn: async () => (await api.GET("/api/dashboard/coverage")).data ?? null,
  });
  const backlogs = useQuery({
    queryKey: ["dashboard", "backlogs"],
    queryFn: async () => (await api.GET("/api/admin/content/backlogs")).data ?? null,
  });
  const subjects = coverage.data?.subjects ?? [];
  const covered = subjects.filter((s) => s.passages > 0 || s.questions > 0);
  const shown = (covered.length ? covered : subjects).slice(0, 8);
  return (
    <Card>
      <CardHeader className="flex flex-row items-start gap-2">
        <div className="space-y-1.5">
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>
            {covered.length ? t("covered", { count: covered.length, total: subjects.length }) : t("empty")}
          </CardDescription>
        </div>
        <AdminLink href={`${adminUrl}/${locale}/content`} label={t("details")} />
      </CardHeader>
      <CardContent className="space-y-5">
        {coverage.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <Table aria-label={t("title")}>
            <TableHeader>
              <TableRow>
                <TableHead>{t("subject")}</TableHead>
                <TableHead>{t("chapters")}</TableHead>
                <TableHead className="text-right">{t("passages")}</TableHead>
                <TableHead className="text-right">{t("questions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((subject) => (
                <TableRow key={subject.nodeId}>
                  <TableCell>
                    {(locale === "hi" ? subject.name.hi : subject.name.en) ?? subject.name.en}
                  </TableCell>
                  <TableCell className="min-w-32">
                    <Meter
                      label={t("chaptersCovered", {
                        covered: subject.chaptersWithMaterial,
                        total: subject.chapters,
                      })}
                      value={subject.chaptersWithMaterial}
                      max={Math.max(1, subject.chapters)}
                    />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{format.number(subject.passages)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {format.number(subject.questions)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <div className="space-y-1 text-sm">
          <p className="font-medium">{t("waiting")}</p>
          {backlogs.isPending ? (
            <Skeleton className="h-10 w-full" />
          ) : !backlogs.data?.reachable ? (
            <p className="text-muted-foreground">{t("unreachable")}</p>
          ) : (
            <ul className="flex flex-wrap gap-x-6 gap-y-1">
              {backlogs.data.backlogs.map((backlog) => (
                <li key={backlog.kind}>
                  {t(`backlog.${backlog.kind}`, { items: backlog.items })}
                  {backlog.items > 0 && (
                    <span className="text-muted-foreground">
                      {" "}
                      · {format.number(backlog.costUsd, { style: "currency", currency: "USD" })}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

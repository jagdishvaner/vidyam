"use client";

import type { UsageReport } from "@vidyam/contracts";
import { Button } from "@vidyam/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@vidyam/ui/components/card";
import { Input } from "@vidyam/ui/components/input";
import { Label } from "@vidyam/ui/components/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@vidyam/ui/components/select";
import { Skeleton } from "@vidyam/ui/components/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@vidyam/ui/components/table";
import { cn } from "@vidyam/ui/lib/utils";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { api } from "@/lib/client/api";
import { errorMessage } from "@/lib/client/errors";

import { DailySpendChart } from "./daily-spend-chart";

/** The current month and the eleven before it, in India time. */
function recentMonths(): string[] {
  const now = new Date(Date.now() + 5.5 * 3600_000);
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    return d.toISOString().slice(0, 7);
  });
}

const usd = (v: number) => `$${v.toFixed(2)}`;

export function UsageAdmin() {
  const t = useTranslations("usage");
  const tc = useTranslations("common");
  const format = useFormatter();
  const months = recentMonths();
  const [month, setMonth] = useState(months[0]!);
  const monthId = useId();

  const report = useQuery({
    queryKey: ["usage", month],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/usage", { params: { query: { month } } });
      if (error || !data) throw new Error(errorMessage(error, tc("somethingWentWrong")));
      return data;
    },
  });
  const monthName = (m: string) =>
    format.dateTime(new Date(`${m}-15T00:00:00Z`), { month: "long", year: "numeric" });

  return (
    <div className="space-y-6">
      {/* One filter row above everything it scopes. */}
      <div className="flex items-center gap-3">
        <Label htmlFor={monthId}>{t("month")}</Label>
        <Select value={month} onValueChange={setMonth}>
          <SelectTrigger id={monthId} className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {months.map((m) => (
              <SelectItem key={m} value={m}>
                {monthName(m)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {!report.data ? (
        <Skeleton className="h-96 w-full rounded-xl" />
      ) : (
        // On a month change the previous report stays, dimmed, instead of flashing a skeleton.
        <div className={cn("space-y-6 transition-opacity", report.isPlaceholderData && "opacity-60")}>
          <Overview report={report.data} />
          <div className="grid gap-6 xl:grid-cols-2">
            <Breakdowns report={report.data} />
          </div>
        </div>
      )}
    </div>
  );
}

function Overview({ report }: { report: UsageReport }) {
  const t = useTranslations("usage");
  const { costUsd, calls, batchCalls } = report.totals;
  const limit = report.budget.monthlyLimitUsd;
  const share = limit ? costUsd / limit : 0;
  const status = !limit
    ? null
    : share > 1
      ? "over"
      : share * 100 >= report.budget.softLimitPct
        ? "warning"
        : "ok";
  const StatusIcon = status === "over" ? CircleAlert : status === "warning" ? TriangleAlert : CircleCheck;

  return (
    <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_22rem]">
      <Card>
        <CardHeader>
          <CardTitle>{t("daily")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">{t("spent")}</p>
              <p className="text-3xl font-semibold">{usd(costUsd)}</p>
              <p className="text-sm text-muted-foreground">
                {limit === null ? t("noBudget") : t("ofBudget", { budget: usd(limit) })}
              </p>
              {status && (
                <p className="flex items-center gap-1.5 text-sm">
                  <StatusIcon
                    className={cn(
                      "size-4",
                      status === "ok" && "text-primary",
                      status === "warning" && "text-amber-600 dark:text-amber-400",
                      status === "over" && "text-destructive",
                    )}
                  />
                  {t(`status.${status}`)}
                </p>
              )}
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">{t("calls")}</p>
              <p className="text-3xl font-semibold">{calls.toLocaleString()}</p>
              {batchCalls > 0 && (
                <p className="text-sm text-muted-foreground">{t("batchShare", { count: batchCalls })}</p>
              )}
            </div>
          </div>
          {calls === 0 ? (
            <p className="text-sm text-muted-foreground">{t("none")}</p>
          ) : (
            <>
              <DailySpendChart report={report} />
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">{t("showTable")}</summary>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("day")}</TableHead>
                      <TableHead className="text-right">{t("callsColumn")}</TableHead>
                      <TableHead className="text-right">{t("cost")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.byDay.map((d) => (
                      <TableRow key={d.date}>
                        <TableCell className="tabular-nums">{d.date}</TableCell>
                        <TableCell className="text-right tabular-nums">{d.calls}</TableCell>
                        <TableCell className="text-right tabular-nums">{d.costUsd.toFixed(4)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </details>
            </>
          )}
        </CardContent>
      </Card>
      <BudgetCard key={`${report.budget.monthlyLimitUsd}-${report.budget.softLimitPct}`} report={report} />
    </div>
  );
}

function BudgetCard({ report }: { report: UsageReport }) {
  const t = useTranslations("usage");
  const tc = useTranslations("common");
  const queryClient = useQueryClient();
  const ids = { limit: useId(), warn: useId() };
  const [limit, setLimit] = useState(report.budget.monthlyLimitUsd?.toString() ?? "");
  const [warnAt, setWarnAt] = useState(String(report.budget.softLimitPct));
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await api.PUT("/api/usage/budget", {
        body: { monthlyLimitUsd: limit.trim() === "" ? null : Number(limit), softLimitPct: Number(warnAt) },
      });
      if (error) throw new Error(errorMessage(error, tc("somethingWentWrong")));
    },
    onSuccess: () => {
      toast.success(t("saved"));
      void queryClient.invalidateQueries({ queryKey: ["usage"] });
    },
    onError: (error) => toast.error(error.message),
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <Card className="self-start">
      <CardHeader>
        <CardTitle>{t("budget")}</CardTitle>
        <CardDescription>{t("budgetHint")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={ids.limit}>{t("limit")}</Label>
            <Input
              id={ids.limit}
              type="number"
              min={0}
              step="1"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t("limitHint")}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor={ids.warn}>{t("warnAt")}</Label>
            <Input
              id={ids.warn}
              type="number"
              min={1}
              max={100}
              required
              value={warnAt}
              onChange={(e) => setWarnAt(e.target.value)}
              className="w-28"
            />
          </div>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? t("saving") : t("save")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Breakdowns({ report }: { report: UsageReport }) {
  const t = useTranslations("usage");
  const tt = useTranslations("aiModels.tasks");
  return (
    <>
      <Ranked
        title={t("byTeacher")}
        label={t("teacher")}
        extra={t("personalBudget")}
        rows={report.byTeacher.map((r) => ({
          key: r.userId ?? "system",
          name: r.name ?? t("system"),
          calls: r.calls,
          costUsd: r.costUsd,
          extra: r.monthlyBudgetUsd === null ? "—" : usd(r.monthlyBudgetUsd),
        }))}
      />
      <Ranked
        title={t("byTask")}
        label={t("task")}
        rows={report.byTask.map((r) => ({
          key: r.task,
          name: tt.has(r.task as never) ? tt(r.task as never) : r.task,
          calls: r.calls,
          costUsd: r.costUsd,
        }))}
      />
      <Ranked
        title={t("byModel")}
        label={t("model")}
        rows={report.byModel.map((r) => ({
          key: r.modelId,
          name: r.modelId,
          calls: r.calls,
          costUsd: r.costUsd,
        }))}
      />
    </>
  );
}

function Ranked({
  title,
  label,
  extra,
  rows,
}: {
  title: string;
  label: string;
  extra?: string;
  rows: { key: string; name: string; calls: number; costUsd: number; extra?: string }[];
}) {
  const t = useTranslations("usage");
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("none")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{label}</TableHead>
                <TableHead className="text-right">{t("callsColumn")}</TableHead>
                <TableHead className="text-right">{t("cost")}</TableHead>
                {extra && <TableHead className="text-right">{extra}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.key}>
                  <TableCell className="whitespace-normal">{row.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.calls.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.costUsd.toFixed(2)}</TableCell>
                  {extra && <TableCell className="text-right tabular-nums">{row.extra}</TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

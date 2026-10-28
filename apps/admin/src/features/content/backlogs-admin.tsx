"use client";

import type { BacklogEstimate, BacklogKind, BacklogRun } from "@vidyam/contracts";
import { Alert, AlertDescription, AlertTitle } from "@vidyam/ui/components/alert";
import { Badge } from "@vidyam/ui/components/badge";
import { Button } from "@vidyam/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@vidyam/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@vidyam/ui/components/dialog";
import { Input } from "@vidyam/ui/components/input";
import { Label } from "@vidyam/ui/components/label";
import { Skeleton } from "@vidyam/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, FileScan, FileText, Loader2, Tags, type LucideIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";

import { api } from "@vidyam/app-shell/client/api";
import { errorMessage } from "@vidyam/app-shell/client/errors";

const ORDER: { kind: BacklogKind; icon: LucideIcon }[] = [
  { kind: "ocr", icon: FileScan },
  { kind: "segment", icon: FileText },
  { kind: "tag", icon: Tags },
];

const usd = (v: number) => `US$${v.toFixed(2)}`;

/** Admin → Content (plan v3 §2): the paid backlogs, each with its estimate, and a run button behind a confirm. */
export function BacklogsAdmin() {
  const t = useTranslations("content");
  const tc = useTranslations("common");
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<BacklogEstimate | null>(null);

  const overview = useQuery({
    queryKey: ["content-backlogs"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/admin/content/backlogs");
      if (error || !data) throw new Error(errorMessage(error, tc("somethingWentWrong")));
      return data;
    },
    // While a run is going on, its results arrive in the background: keep the counts fresh.
    refetchInterval: (query) => (query.state.data?.runs.some((r) => r.status === "running") ? 10_000 : false),
  });

  const run = useMutation({
    mutationFn: async ({ kind, limit }: { kind: BacklogKind; limit: number | null }) => {
      const { data, error } = await api.POST("/api/admin/content/backlogs/{kind}/run", {
        params: { path: { kind } },
        body: { limit },
      });
      if (error || !data) throw new Error(errorMessage(error, tc("somethingWentWrong")));
      return data;
    },
    onSuccess: (_, { kind }) => {
      toast.success(t("started", { name: t(`kinds.${kind}.title`) }));
      setConfirming(null);
      void queryClient.invalidateQueries({ queryKey: ["content-backlogs"] });
    },
    onError: (error) => toast.error(error.message),
  });

  if (overview.isError) {
    return (
      <Alert variant="destructive">
        <CircleAlert />
        <AlertDescription>{overview.error.message}</AlertDescription>
      </Alert>
    );
  }
  if (!overview.data) return <Skeleton className="h-72 w-full rounded-xl" />;
  const { backlogs, runs, reachable } = overview.data;
  const onStub = backlogs.some((b) => b.provider === "stub");

  return (
    <div className="space-y-6">
      {!reachable && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>{t("unreachableTitle")}</AlertTitle>
          <AlertDescription>{t("unreachableBody")}</AlertDescription>
        </Alert>
      )}
      {onStub && (
        <Alert>
          <CircleAlert />
          <AlertTitle>{t("stubTitle")}</AlertTitle>
          <AlertDescription>{t("stubBody")}</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        {ORDER.map(({ kind, icon }) => (
          <BacklogCard
            key={kind}
            kind={kind}
            icon={icon}
            estimate={backlogs.find((b) => b.kind === kind) ?? null}
            run={runs.find((r) => r.kind === kind) ?? null}
            onRun={setConfirming}
          />
        ))}
      </div>
      <p className="text-sm text-muted-foreground">{t("batchNote")}</p>
      <ConfirmRun
        estimate={confirming}
        pending={run.isPending}
        onCancel={() => setConfirming(null)}
        onConfirm={(limit) => confirming && run.mutate({ kind: confirming.kind, limit })}
      />
    </div>
  );
}

function BacklogCard({
  kind,
  icon: Icon,
  estimate,
  run,
  onRun,
}: {
  kind: BacklogKind;
  icon: LucideIcon;
  estimate: BacklogEstimate | null;
  run: BacklogRun | null;
  onRun: (estimate: BacklogEstimate) => void;
}) {
  const t = useTranslations("content");
  const format = useFormatter();
  const running = run?.status === "running";
  const items = estimate?.items ?? 0;
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" />
          {t(`kinds.${kind}.title`)}
        </CardTitle>
        <CardDescription>{t(`kinds.${kind}.body`)}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 space-y-3">
        <p className="text-3xl font-semibold tabular-nums">
          {format.number(items)}
          <span className="ml-2 text-base font-normal text-muted-foreground">
            {t(`kinds.${kind}.unit`, { count: items })}
          </span>
        </p>
        {estimate && items > 0 && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{t("requests")}</dt>
            <dd className="tabular-nums">{format.number(estimate.requests)}</dd>
            <dt className="text-muted-foreground">{t("model")}</dt>
            <dd>
              {estimate.modelId ?? "—"}
              {estimate.provider === "stub" && (
                <Badge variant="secondary" className="ml-2">
                  {t("stubBadge")}
                </Badge>
              )}
            </dd>
            <dt className="text-muted-foreground">{t("cost")}</dt>
            <dd className="font-medium tabular-nums">{usd(estimate.costUsd)}</dd>
          </dl>
        )}
        {estimate?.blocked && items > 0 && <p className="text-sm text-destructive">{estimate.blocked}</p>}
        {run && (
          <p className="text-sm text-muted-foreground">
            {t(`runs.${run.status}`, {
              when: format.relativeTime(new Date(run.startedAt)),
            })}
          </p>
        )}
      </CardContent>
      <CardFooter>
        <Button
          className="w-full"
          disabled={!estimate || items === 0 || !!estimate.blocked || running}
          onClick={() => estimate && onRun(estimate)}
        >
          {running && <Loader2 className="animate-spin" />}
          {running ? t("running") : t("run")}
        </Button>
      </CardFooter>
    </Card>
  );
}

function ConfirmRun({
  estimate,
  pending,
  onCancel,
  onConfirm,
}: {
  estimate: BacklogEstimate | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (limit: number | null) => void;
}) {
  const t = useTranslations("content");
  const limitId = useId();
  const [limit, setLimit] = useState("");
  const parsed = limit.trim() === "" ? null : Number(limit);
  const valid = parsed === null || (Number.isInteger(parsed) && parsed > 0);
  return (
    <Dialog
      open={estimate !== null}
      onOpenChange={(open) => {
        if (!open) {
          setLimit("");
          onCancel();
        }
      }}
    >
      <DialogContent>
        {estimate && (
          <>
            <DialogHeader>
              <DialogTitle>{t("confirmTitle", { name: t(`kinds.${estimate.kind}.title`) })}</DialogTitle>
              <DialogDescription>
                {t("confirmBody", {
                  items: estimate.items,
                  unit: t(`kinds.${estimate.kind}.unit`, { count: estimate.items }),
                  cost: usd(estimate.costUsd),
                  model: estimate.modelId ?? "—",
                })}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor={limitId}>{t("limitLabel")}</Label>
              <Input
                id={limitId}
                inputMode="numeric"
                placeholder={t("limitPlaceholder")}
                value={limit}
                onChange={(event) => setLimit(event.target.value)}
                aria-invalid={!valid}
              />
              <p className="text-sm text-muted-foreground">{t("limitHint")}</p>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={onCancel}>
                {t("cancel")}
              </Button>
              <Button disabled={!valid || pending} onClick={() => onConfirm(parsed)}>
                {pending && <Loader2 className="animate-spin" />}
                {t("confirm", { cost: usd(estimate.costUsd) })}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

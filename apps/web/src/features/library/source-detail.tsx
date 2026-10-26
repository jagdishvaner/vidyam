"use client";

import { Alert, AlertDescription, AlertTitle } from "@vidyam/ui/components/alert";
import { Badge } from "@vidyam/ui/components/badge";
import { Button } from "@vidyam/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@vidyam/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@vidyam/ui/components/dialog";
import { Skeleton } from "@vidyam/ui/components/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@vidyam/ui/components/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Link, useRouter } from "@/i18n/navigation";
import { api } from "@/lib/client/api";

import { StateBadge } from "./state-badge";

const POLL_MS = 3000;

export function SourceDetail({ sourceId, canRemove }: { sourceId: string; canRemove: boolean }) {
  const t = useTranslations("library");
  const format = useFormatter();
  const [confirming, setConfirming] = useState(false);
  const router = useRouter();
  const queryClient = useQueryClient();

  const detail = useQuery({
    queryKey: ["library", "source", sourceId],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/library/{sourceId}", { params: { path: { sourceId } } });
      if (response.status === 404) return null;
      if (!data) throw new Error(t("notFound"));
      return data;
    },
    refetchInterval: (q) => {
      const state = q.state.data?.source.state;
      return state === "queued" || state === "reading" ? POLL_MS : false;
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await api.DELETE("/api/library/{sourceId}", { params: { path: { sourceId } } });
      if (error) throw new Error((error as { message?: string }).message ?? "");
    },
    onSuccess: () => {
      toast.success(t("removed", { name: detail.data?.source.filename ?? "" }));
      void queryClient.invalidateQueries({ queryKey: ["library"] });
      router.push("/library");
    },
    onError: (error) => toast.error(error.message),
  });

  const back = (
    <Link
      href="/library"
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
    >
      <ArrowLeft className="size-4" /> {t("back")}
    </Link>
  );

  if (detail.isPending) return <Skeleton className="h-96 w-full rounded-xl" />;
  if (!detail.data) {
    return (
      <div className="space-y-4">
        {back}
        <Alert>
          <AlertDescription>{t("notFound")}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const { source, pageReadings, sectionPreview } = detail.data;
  const busy = source.state === "queued" || source.state === "reading";

  return (
    <div className="space-y-6">
      {back}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight break-all">{source.filename}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <StateBadge state={source.state} />
            <Badge variant="outline">{t(`kinds.${source.kind}`)}</Badge>
            <Badge variant="outline">{t(`licences.${source.licence}`)}</Badge>
            {source.language && <span>{t(`languages.${source.language}`)}</span>}
            <span>
              · {format.dateTime(new Date(source.addedAt), { dateStyle: "medium", timeStyle: "short" })}
            </span>
            {Object.entries(source.meta).map(([key, value]) => (
              <Badge key={key} variant="secondary">
                {key}: {value}
              </Badge>
            ))}
          </div>
        </div>
        {canRemove && (
          <Button
            variant="outline"
            className="text-destructive"
            disabled={busy}
            onClick={() => setConfirming(true)}
          >
            {t("remove")}
          </Button>
        )}
      </div>

      {source.error && (
        <Alert variant="destructive">
          <AlertTitle>{t("error")}</AlertTitle>
          <AlertDescription>{source.error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>{t("preview")}</CardTitle>
            <CardDescription>{t("previewBody")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {sectionPreview.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("noSections")}</p>
            )}
            {sectionPreview.map((section, index) => (
              <section key={index} className="space-y-1 rounded-md border p-3">
                <p className="text-xs text-muted-foreground">
                  {section.pageStart === null
                    ? t("wholeFile")
                    : section.pageStart === section.pageEnd
                      ? t("singlePage", { page: section.pageStart })
                      : t("pageRange", {
                          start: section.pageStart,
                          end: section.pageEnd ?? section.pageStart,
                        })}
                  {" · "}
                  {t(`languages.${section.language}`)}
                </p>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{section.text}</p>
              </section>
            ))}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t("howRead")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("pageColumn")}</TableHead>
                  <TableHead>{t("readColumn")}</TableHead>
                  <TableHead className="text-right">{t("qualityColumn")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageReadings.map((page, index) => (
                  <TableRow key={index}>
                    <TableCell className="tabular-nums">{page.pageNo ?? t("wholeFile")}</TableCell>
                    <TableCell className="whitespace-normal">
                      {t(`pageStates.${page.state}`)}
                      {page.note && <p className="text-xs text-muted-foreground">{page.note}</p>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {page.confidence === null ? "—" : format.number(page.confidence, { style: "percent" })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("removeTitle", { name: source.filename })}</DialogTitle>
            <DialogDescription>{t("removeBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {t("cancel")}
            </Button>
            <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
              {remove.isPending ? t("removing") : t("remove")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

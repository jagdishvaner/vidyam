"use client";

import type { LibraryFilter, LibrarySource } from "@vidyam/contracts";
import { Badge } from "@vidyam/ui/components/badge";
import { Button } from "@vidyam/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@vidyam/ui/components/card";
import { Input } from "@vidyam/ui/components/input";
import { Skeleton } from "@vidyam/ui/components/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@vidyam/ui/components/table";
import { Tabs, TabsList, TabsTrigger } from "@vidyam/ui/components/tabs";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { BookOpenText } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useDeferredValue, useState } from "react";

import { Link } from "@vidyam/app-shell/i18n/navigation";
import { api } from "@vidyam/app-shell/client/api";

import { StateBadge } from "./state-badge";

const FILTERS = [
  "all",
  "ready",
  "in_progress",
  "needs_ocr",
  "failed",
] as const satisfies readonly LibraryFilter[];
const SUMMARY = ["files", "sections", "ocrPages", "failed"] as const;
/** While anything is being read, refresh every few seconds so progress shows without reloading. */
const POLL_MS = 3000;
const busy = (source: LibrarySource) => source.state === "queued" || source.state === "reading";

export function LibraryView() {
  const t = useTranslations("library");
  const format = useFormatter();
  const [show, setShow] = useState<LibraryFilter>("all");
  const [search, setSearch] = useState("");
  const query = useDeferredValue(search.trim());
  const [page, setPage] = useState(1);

  const summary = useQuery({
    queryKey: ["library", "summary"],
    queryFn: async () => (await api.GET("/api/library/summary")).data ?? null,
    refetchInterval: (q) => (q.state.data?.inProgress ? POLL_MS : false),
  });
  const list = useQuery({
    queryKey: ["library", "list", show, query, page],
    queryFn: async () =>
      (await api.GET("/api/library", { params: { query: { show, search: query || undefined, page } } }))
        .data ?? null,
    placeholderData: keepPreviousData,
    refetchInterval: (q) => (q.state.data?.items.some(busy) ? POLL_MS : false),
  });

  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;
  const empty = summary.data?.files === 0;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {SUMMARY.map((metric) => (
          <Card key={metric}>
            <CardHeader>
              <CardDescription>{t(metric)}</CardDescription>
              <CardTitle className="text-3xl tabular-nums">
                {summary.isPending ? (
                  <Skeleton className="h-9 w-16" />
                ) : (
                  format.number(summary.data?.[metric] ?? 0)
                )}
              </CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      {empty ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <BookOpenText className="size-10 text-muted-foreground" />
            <p className="font-medium">{t("empty")}</p>
            <p className="max-w-md text-sm text-muted-foreground">{t("emptyBody")}</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="gap-4 sm:flex sm:flex-row sm:items-center sm:justify-between">
            <Tabs
              value={show}
              onValueChange={(value) => {
                setShow(value as LibraryFilter);
                setPage(1);
              }}
            >
              <TabsList className="flex-wrap">
                {FILTERS.map((filter) => (
                  <TabsTrigger key={filter} value={filter}>
                    {t(`filters.${filter}`)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <Input
              aria-label={t("search")}
              placeholder={t("search")}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              className="sm:max-w-64"
            />
          </CardHeader>
          <CardContent className="space-y-4">
            {list.isPending ? (
              <Skeleton className="h-40 w-full" />
            ) : list.data?.items.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("columns.file")}</TableHead>
                    <TableHead>{t("columns.language")}</TableHead>
                    <TableHead className="text-right">{t("columns.pages")}</TableHead>
                    <TableHead className="text-right">{t("columns.sections")}</TableHead>
                    <TableHead>{t("columns.status")}</TableHead>
                    <TableHead>{t("columns.added")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.data.items.map((source) => (
                    <TableRow key={source.id}>
                      <TableCell className="max-w-80 whitespace-normal">
                        <Link
                          href={`/library/${source.id}`}
                          className="font-medium break-all hover:underline"
                        >
                          {source.filename}
                        </Link>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <Badge variant="outline">{t(`kinds.${source.kind}`)}</Badge>
                          {Object.entries(source.meta).map(([key, value]) => (
                            <Badge key={key} variant="secondary">
                              {key}: {value}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>{source.language ? t(`languages.${source.language}`) : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{source.pages ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{source.sections}</TableCell>
                      <TableCell className="whitespace-normal">
                        <StateBadge state={source.state} />
                        {source.ocrPages > 0 && source.state === "ready" && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {t("ocrSome", { count: source.ocrPages })}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {format.dateTime(new Date(source.addedAt), { dateStyle: "medium" })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">{t("noMatches")}</p>
            )}
            {pages > 1 && (
              <div className="flex items-center justify-end gap-2 text-sm">
                <span className="text-muted-foreground">{t("pageOf", { page, pages })}</span>
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  {t("previous")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= pages}
                  onClick={() => setPage(page + 1)}
                >
                  {t("next")}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

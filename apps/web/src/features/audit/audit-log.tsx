"use client";

import type { AuditPage } from "@vidyam/contracts";
import { Button } from "@vidyam/ui/components/button";
import { Card, CardContent } from "@vidyam/ui/components/card";
import { Label } from "@vidyam/ui/components/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@vidyam/ui/components/select";
import { Skeleton } from "@vidyam/ui/components/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@vidyam/ui/components/table";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useState } from "react";

import { api } from "@/lib/client/api";
import { errorMessage } from "@/lib/client/errors";

const AREAS = [
  "member",
  "staff",
  "library",
  "syllabus",
  "exam",
  "pattern",
  "center",
  "ai",
  "prompt",
  "budget",
] as const;
const ALL = "__all__";

export function AuditLog() {
  const t = useTranslations("audit");
  const tc = useTranslations("common");
  const format = useFormatter();
  const ids = { area: useId(), person: useId() };
  const [area, setArea] = useState<string>(ALL);
  const [person, setPerson] = useState<string>(ALL);

  const staff = useQuery({
    queryKey: ["staff"],
    queryFn: async () => (await api.GET("/api/staff")).data ?? null,
  });
  const log = useInfiniteQuery({
    queryKey: ["audit", area, person],
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page: AuditPage) => page.nextCursor ?? undefined,
    queryFn: async ({ pageParam }): Promise<AuditPage> => {
      const query = {
        action: area === ALL ? undefined : area,
        userId: person === ALL ? undefined : person,
        cursor: pageParam,
      };
      const { data, error } = await api.GET("/api/audit", { params: { query } });
      if (error || !data) throw new Error(errorMessage(error, tc("somethingWentWrong")));
      return data;
    },
  });
  const entries = log.data?.pages.flatMap((p) => p.entries) ?? [];
  const label = (action: string) =>
    t.has(`actions.${action}` as never) ? t(`actions.${action}` as never) : action;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Label htmlFor={ids.area}>{t("area")}</Label>
          <Select value={area} onValueChange={setArea}>
            <SelectTrigger id={ids.area} className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("everything")}</SelectItem>
              {AREAS.map((a) => (
                <SelectItem key={a} value={a}>
                  {t(`areas.${a}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor={ids.person}>{t("person")}</Label>
          <Select value={person} onValueChange={setPerson}>
            <SelectTrigger id={ids.person} className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("everyone")}</SelectItem>
              {staff.data?.members.map((m) => (
                <SelectItem key={m.userId} value={m.userId}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card>
        <CardContent>
          {log.isPending ? (
            <Skeleton className="h-64 w-full" />
          ) : entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("none")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("when")}</TableHead>
                  <TableHead>{t("who")}</TableHead>
                  <TableHead>{t("what")}</TableHead>
                  <TableHead>{t("target")}</TableHead>
                  <TableHead>{t("details")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id} className="align-top">
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {format.dateTime(new Date(entry.at), { dateStyle: "medium", timeStyle: "short" })}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      {entry.actor ? (
                        <>
                          <p>{entry.actor.name}</p>
                          <p className="text-xs text-muted-foreground">{entry.actor.email}</p>
                        </>
                      ) : (
                        <span className="text-muted-foreground">{t("nobody")}</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-normal">{label(entry.action)}</TableCell>
                    <TableCell className="max-w-48 font-mono text-xs break-all whitespace-normal">
                      {entry.entityType}: {entry.entityId}
                    </TableCell>
                    <TableCell className="max-w-96 whitespace-normal">
                      {Object.keys(entry.data).length > 0 && (
                        <details>
                          <summary className="cursor-pointer text-xs text-muted-foreground">
                            {t("details")}
                          </summary>
                          <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted/50 p-2 text-xs">
                            {JSON.stringify(entry.data, null, 2)}
                          </pre>
                        </details>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {log.hasNextPage && (
            <Button
              variant="outline"
              className="mt-4"
              disabled={log.isFetchingNextPage}
              onClick={() => void log.fetchNextPage()}
            >
              {t("loadMore")}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

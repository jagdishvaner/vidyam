"use client";

import type { DocumentDetail, DocumentVersionSummary } from "@vidyam/contracts";
import { Badge } from "@vidyam/ui/components/badge";
import { Button } from "@vidyam/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@vidyam/ui/components/dialog";
import { Skeleton } from "@vidyam/ui/components/skeleton";
import { cn } from "@vidyam/ui/lib/utils";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

import { useRestore, useVersion, useVersions } from "./api";
import { diff, unchanged } from "./diff";

/**
 * Every version of a document, newest first: who made it and what they changed. Picking one shows how it
 * differs from the current version; restoring it saves it again as the newest, so nothing is ever lost.
 */
export function VersionHistory({ detail, onClose }: { detail: DocumentDetail; onClose: () => void }) {
  const t = useTranslations("canvas.versions");
  const format = useFormatter();
  const id = detail.document.id;
  const current = detail.document.currentVersion;
  const versions = useVersions(id, true);
  const [picked, setPicked] = useState<number | null>(null);
  const restore = useRestore(id);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("hint")}</DialogDescription>
        </DialogHeader>
        {versions.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <ol className="space-y-2">
            {(versions.data ?? []).map((version) => (
              <li key={version.version}>
                <button
                  type="button"
                  onClick={() => setPicked(version.version === picked ? null : version.version)}
                  className={cn(
                    "w-full rounded-lg border p-3 text-left text-sm hover:bg-muted",
                    picked === version.version && "border-primary",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{t("version", { version: version.version })}</span>
                    {version.version === current && <Badge variant="secondary">{t("current")}</Badge>}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {format.dateTime(new Date(version.createdAt), {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </span>
                  </div>
                  <p className="text-muted-foreground">{describe(version, t)}</p>
                </button>
                {picked === version.version && version.version !== current && (
                  <Compare
                    detail={detail}
                    version={version.version}
                    restoring={restore.isPending}
                    onRestore={() =>
                      restore.mutate(
                        { baseVersion: current, version: version.version },
                        { onSuccess: () => setPicked(null) },
                      )
                    }
                  />
                )}
              </li>
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}

function describe(version: DocumentVersionSummary, t: ReturnType<typeof useTranslations<"canvas.versions">>) {
  const who = version.authorKind === "agent" ? t("byVidyam") : (version.authorName ?? t("byYou"));
  if (!version.changes.length) return who;
  const what = version.changes.map((change) => t(`changes.${change}` as never)).join(", ");
  return `${who}: ${what}`;
}

function Compare({
  detail,
  version,
  restoring,
  onRestore,
}: {
  detail: DocumentDetail;
  version: number;
  restoring: boolean;
  onRestore: () => void;
}) {
  const t = useTranslations("canvas.versions");
  const old = useVersion(detail.document.id, version);
  if (old.isPending) return <Skeleton className="mt-2 h-16 w-full" />;
  if (!old.data) return null;
  // What going back to this version would change in the current one.
  const changes = diff(detail.content, old.data.content);
  const lines = [
    changes.title && t("diff.title"),
    changes.added.length > 0 && t("diff.added", { count: changes.added.length }),
    changes.removed.length > 0 && t("diff.removed", { count: changes.removed.length }),
    changes.changed.length > 0 && t("diff.changed", { count: changes.changed.length }),
    changes.details.length > 0 && t("diff.details"),
    changes.reordered && t("diff.reordered"),
  ].filter(Boolean);
  return (
    <div className="mt-2 space-y-2 rounded-lg bg-muted/40 p-3 text-sm">
      <p className="font-medium">{t("diffTitle")}</p>
      {unchanged(changes) ? (
        <p className="text-muted-foreground">{t("diff.none")}</p>
      ) : (
        <ul className="list-disc pl-5">
          {lines.map((line) => (
            <li key={String(line)}>{line}</li>
          ))}
        </ul>
      )}
      <Button size="sm" onClick={onRestore} disabled={restoring}>
        {t("restore")}
      </Button>
    </div>
  );
}

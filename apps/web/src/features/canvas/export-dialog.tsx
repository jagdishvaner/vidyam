"use client";

import type { DocumentDetail, ExportFormat, ExportVariant, PaperDocument } from "@vidyam/contracts";
import { Button } from "@vidyam/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@vidyam/ui/components/dialog";
import { Label } from "@vidyam/ui/components/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@vidyam/ui/components/select";
import { Skeleton } from "@vidyam/ui/components/skeleton";
import { AlertTriangle, Download, Loader2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

import { exportUrl, useExports, useRequestExport } from "./api";

const FORMATS: ExportFormat[] = ["pdf", "docx", "krutidev_docx"];
const VARIANTS: ExportVariant[] = ["paper", "answer_key", "solutions"];
const PAPER_ORDER = "__paper__";

/**
 * Printable files of the document (plan v3 step 29): PDF, Word, or Word in Kruti Dev; for papers, the paper,
 * its answer key or its solutions, in the paper's order or a booklet set's. Files are made in the background
 * from the version on screen and listed here to download.
 */
export function ExportDialog({
  detail,
  setCode,
  onClose,
}: {
  detail: DocumentDetail;
  setCode: string | null;
  onClose: () => void;
}) {
  const t = useTranslations("canvas.export");
  const format = useFormatter();
  const id = detail.document.id;
  const paper = "slots" in detail.content;
  const sets = paper ? (detail.content as PaperDocument).sets.map((set) => set.code) : [];
  const [chosen, setChosen] = useState<{
    format: ExportFormat;
    variant: ExportVariant;
    setCode: string | null;
  }>({
    format: "pdf",
    variant: "paper",
    setCode,
  });
  const files = useExports(id, true);
  const make = useRequestExport(id);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("hint", { version: detail.document.currentVersion })}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Choice
            label={t("format")}
            value={chosen.format}
            options={FORMATS.map((value) => [value, t(`formats.${value}`)])}
            onChange={(value) => setChosen((c) => ({ ...c, format: value as ExportFormat }))}
          />
          {paper && (
            <Choice
              label={t("variant")}
              value={chosen.variant}
              options={VARIANTS.map((value) => [value, t(`variants.${value}`)])}
              onChange={(value) => setChosen((c) => ({ ...c, variant: value as ExportVariant }))}
            />
          )}
          {sets.length > 0 && (
            <Choice
              label={t("set")}
              value={chosen.setCode ?? PAPER_ORDER}
              options={[
                [PAPER_ORDER, t("paperOrder")],
                ...sets.map((code): [string, string] => [code, t("setCode", { code })]),
              ]}
              onChange={(value) =>
                setChosen((c) => ({ ...c, setCode: value === PAPER_ORDER ? null : value }))
              }
            />
          )}
        </div>
        {chosen.format === "krutidev_docx" && (
          <p className="text-xs text-muted-foreground">{t("krutiDevHint")}</p>
        )}
        <Button onClick={() => make.mutate(chosen)} disabled={make.isPending}>
          {make.isPending && <Loader2 className="animate-spin" />}
          {t("make")}
        </Button>

        <div className="space-y-2">
          <p className="text-sm font-medium">{t("files")}</p>
          {files.isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : !files.data?.length ? (
            <p className="text-sm text-muted-foreground">{t("none")}</p>
          ) : (
            <ul className="divide-y rounded-lg border text-sm" aria-label={t("files")}>
              {files.data.map((file) => (
                <li key={file.id} className="flex items-center gap-2 p-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{file.filename}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("madeFrom", { version: file.version })} ·{" "}
                      {format.dateTime(new Date(file.createdAt), { dateStyle: "medium", timeStyle: "short" })}
                    </p>
                    {file.status === "failed" && (
                      <p className="flex items-center gap-1 text-xs text-destructive">
                        <AlertTriangle className="size-3" />
                        {t("failed")}
                      </p>
                    )}
                  </div>
                  {file.status === "pending" && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Loader2 className="size-3.5 animate-spin" />
                      {t("making")}
                    </span>
                  )}
                  {file.status === "done" && (
                    <Button asChild size="sm" variant="outline">
                      <a href={exportUrl(id, file.id)} download={file.filename}>
                        <Download />
                        {t("download")}
                      </a>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([option, name]) => (
            <SelectItem key={option} value={option}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

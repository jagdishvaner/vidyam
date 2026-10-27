"use client";

import type { ExamPaper, PaperPattern } from "@vidyam/contracts";
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
import { cn } from "@vidyam/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { api } from "@/lib/client/api";
import { errorMessage } from "@/lib/client/errors";

import { JsonImportButton } from "../syllabus/json-import-button";
import { PatternEditor, type EditorState, type ScopeOption } from "./pattern-editor";

export function PatternsAdmin() {
  const t = useTranslations("patterns");
  const tc = useTranslations("common");
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [examId, setExamId] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditorState | null>(null);
  const [retiring, setRetiring] = useState<PaperPattern | null>(null);
  const name = (item: { nameEn: string; nameHi: string | null }) =>
    (locale === "hi" && item.nameHi) || item.nameEn;

  const exams = useQuery({
    queryKey: ["exams"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/exams");
      if (error || !data) throw new Error(errorMessage(error, tc("somethingWentWrong")));
      return data;
    },
  });
  const patterns = useQuery({
    queryKey: ["patterns"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/patterns", { params: { query: {} } });
      if (error || !data) throw new Error(errorMessage(error, tc("somethingWentWrong")));
      return data;
    },
  });
  const subjects = useQuery({
    queryKey: ["syllabus"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/syllabus");
      if (error || !data) throw new Error(errorMessage(error, tc("somethingWentWrong")));
      return data;
    },
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["patterns"] });
  const exam = exams.data?.find((e) => e.id === examId) ?? exams.data?.[0] ?? null;
  const countFor = (paper: ExamPaper) => patterns.data?.filter((p) => p.examId === paper.id).length ?? 0;
  const shown = patterns.data?.filter((p) => p.examId === exam?.id) ?? [];
  // A section can draw from a whole subject of the paper, or from any part the paper links.
  const scopeOptions: ScopeOption[] = exam
    ? [
        ...[...new Set(exam.syllabus.map((part) => part.path.split("/")[0]!))].flatMap((code) => {
          const subject = subjects.data?.subjects.find((s) => s.code === code);
          return subject ? [{ path: code, nameEn: subject.nameEn, nameHi: subject.nameHi }] : [];
        }),
        ...exam.syllabus.filter((part) => part.path.includes("/")),
      ]
    : [];

  const retire = useMutation({
    mutationFn: async (pattern: PaperPattern) => {
      const { error } = await api.DELETE("/api/patterns/{patternId}", {
        params: { path: { patternId: pattern.id } },
      });
      if (error) throw new Error(errorMessage(error, tc("somethingWentWrong")));
      return pattern;
    },
    onSuccess: (pattern) => {
      toast.success(t("retired", { name: pattern.name }));
      setRetiring(null);
      refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  if (exams.data?.length === 0) return <p className="text-sm text-muted-foreground">{t("noExams")}</p>;

  return (
    <div className="grid gap-6 2xl:grid-cols-[18rem_minmax(0,1fr)]">
      <Card className="self-start">
        <CardHeader>
          <CardTitle>{t("examPapers")}</CardTitle>
        </CardHeader>
        {/* Wrapping buttons above the patterns until the screen is wide enough for a side list. */}
        <CardContent className="flex flex-wrap gap-1 2xl:flex-col">
          {exams.isPending && <Skeleton className="h-48 w-full" />}
          {exams.data?.map((paper) => (
            <button
              key={paper.id}
              type="button"
              onClick={() => setExamId(paper.id)}
              className={cn(
                "flex items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent 2xl:w-full",
                paper.id === exam?.id && "bg-accent font-medium",
              )}
            >
              <span className="min-w-0">{name(paper)}</span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{countFor(paper)}</span>
            </button>
          ))}
        </CardContent>
      </Card>

      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <JsonImportButton
            label={t("import")}
            send={async (json) => {
              const body = Array.isArray(json) ? { blueprints: json } : json;
              const { data, error } = await api.POST("/api/patterns/import", { body: body as never });
              if (error || !data) throw new Error(errorMessage(error, tc("somethingWentWrong")));
              return data;
            }}
            onDone={refresh}
          />
          {exam && (
            <Button onClick={() => setEditing({ exam, pattern: null, scopeOptions })}>
              <Plus data-icon="inline-start" />
              {t("new")}
            </Button>
          )}
        </div>
        {patterns.isPending && <Skeleton className="h-64 w-full" />}
        {patterns.data && exam && shown.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("noPatterns")}</p>
        )}
        {exam &&
          shown.map((pattern) => (
            <PatternCard
              key={pattern.id}
              pattern={pattern}
              scopeOptions={scopeOptions}
              onEdit={() => setEditing({ exam, pattern, scopeOptions })}
              onRetire={() => setRetiring(pattern)}
            />
          ))}
      </div>

      <PatternEditor
        state={editing}
        onClose={() => setEditing(null)}
        onDone={() => {
          setEditing(null);
          refresh();
        }}
      />
      <Dialog open={retiring !== null} onOpenChange={(open) => !open && setRetiring(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("retireTitle", { name: retiring?.name ?? "" })}</DialogTitle>
            <DialogDescription>{t("retireBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRetiring(null)}>
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={retire.isPending}
              onClick={() => retiring && retire.mutate(retiring)}
            >
              {t("retire")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PatternCard({
  pattern,
  scopeOptions,
  onEdit,
  onRetire,
}: {
  pattern: PaperPattern;
  scopeOptions: ScopeOption[];
  onEdit: () => void;
  onRetire: () => void;
}) {
  const t = useTranslations("patterns");
  const locale = useLocale();
  const nameOf = (path: string) => {
    const part = scopeOptions.find((s) => s.path === path);
    return part ? (locale === "hi" && part.nameHi) || part.nameEn : path;
  };
  const sectionName = (s: PaperPattern["blueprint"]["sections"][number]) =>
    (locale === "hi" ? (s.name.hi ?? s.name.en) : (s.name.en ?? s.name.hi)) ?? "—";

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle>
            {pattern.name}{" "}
            <span className="text-xs font-normal text-muted-foreground">
              {t("version", { version: pattern.version })}
            </span>
          </CardTitle>
          <CardDescription className="tabular-nums">
            {t("totals", {
              questions: pattern.totalQuestions,
              marks: pattern.totalMarks,
              minutes: pattern.blueprint.durationMinutes,
            })}
          </CardDescription>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" aria-label={`${t("edit")}: ${pattern.name}`} onClick={onEdit}>
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`${t("retire")}: ${pattern.name}`}
            onClick={onRetire}
          >
            <Trash2 />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("section")}</TableHead>
              <TableHead>{t("type")}</TableHead>
              <TableHead className="text-right">{t("count")}</TableHead>
              <TableHead className="text-right">{t("marksEach")}</TableHead>
              <TableHead className="text-right">{t("negative")}</TableHead>
              <TableHead>{t("scope")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pattern.blueprint.sections.map((section, i) => (
              <TableRow key={i}>
                <TableCell className="whitespace-normal">{sectionName(section)}</TableCell>
                <TableCell className="whitespace-normal">{t(`questionTypes.${section.qtype}`)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {section.attemptAny ? `${section.attemptAny}/${section.count}` : section.count}
                </TableCell>
                <TableCell className="text-right tabular-nums">{section.marksEach}</TableCell>
                <TableCell className="text-right tabular-nums">{section.negativeMarks || "—"}</TableCell>
                <TableCell className="whitespace-normal">
                  <div className="flex flex-wrap gap-1">
                    {section.scope.length === 0 ? (
                      <span className="text-xs text-muted-foreground">{t("wholePaper")}</span>
                    ) : (
                      section.scope.map((path) => (
                        <Badge key={path} variant="outline" title={path}>
                          {nameOf(path)}
                        </Badge>
                      ))
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

"use client";

import type { ExamPaper } from "@vidyam/contracts";
import { Badge } from "@vidyam/ui/components/badge";
import { Button } from "@vidyam/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@vidyam/ui/components/card";
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
import { Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { api } from "@/lib/client/api";
import { errorMessage } from "@/lib/client/errors";

import { JsonImportButton } from "./json-import-button";

export function ExamPapersPanel() {
  const t = useTranslations("syllabus");
  const tc = useTranslations("common");
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = useState<ExamPaper | null>(null);
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
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["exams"] });

  const remove = useMutation({
    mutationFn: async (paper: ExamPaper) => {
      const { error } = await api.DELETE("/api/exams/{examId}", { params: { path: { examId: paper.id } } });
      if (error) throw new Error(errorMessage(error, tc("somethingWentWrong")));
      return paper;
    },
    onSuccess: (paper) => {
      toast.success(t("deleted", { name: name(paper) }));
      setDeleting(null);
      refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle>{t("examsTab")}</CardTitle>
        <JsonImportButton
          label={t("importExams")}
          send={async (json) => {
            const body = Array.isArray(json) ? { exams: json } : json;
            const { data, error } = await api.POST("/api/exams/import", { body: body as never });
            if (error || !data) throw new Error(errorMessage(error, tc("somethingWentWrong")));
            return data;
          }}
          onDone={refresh}
        />
      </CardHeader>
      <CardContent>
        {exams.isPending && <Skeleton className="h-48 w-full" />}
        {exams.data?.length === 0 && <p className="text-sm text-muted-foreground">{t("noExams")}</p>}
        {exams.data && exams.data.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("paper")}</TableHead>
                <TableHead>{t("language")}</TableHead>
                <TableHead>{t("covers")}</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {exams.data.map((paper) => (
                <TableRow key={paper.id}>
                  <TableCell className="whitespace-normal">
                    <p className="font-medium">{name(paper)}</p>
                    <p className="font-mono text-xs text-muted-foreground">{paper.code}</p>
                  </TableCell>
                  <TableCell>{t(`languages.${paper.authoritativeLanguage}`)}</TableCell>
                  <TableCell className="whitespace-normal">
                    <div className="flex flex-wrap gap-1">
                      {paper.syllabus.map((part) => (
                        <Badge key={part.nodeId} variant="outline" title={part.path}>
                          {name(part)}
                          {part.weightage !== null && ` · ${Math.round(part.weightage * 100)}%`}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`${t("deleteExam")}: ${paper.nameEn}`}
                      onClick={() => setDeleting(paper)}
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteTitle", { name: deleting ? name(deleting) : "" })}</DialogTitle>
            <DialogDescription>{t("deleteBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => deleting && remove.mutate(deleting)}
            >
              {remove.isPending ? t("deleting") : t("deleteExam")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

"use client";

import type { ChatBlock, PaperSection } from "@vidyam/contracts";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@vidyam/ui/components/table";
import { CheckCircle2 } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";

import { useExams, useScope } from "./api";
import type { ChatInput } from "./conversation";
import { localName, useLabels } from "./labels";

type Review = Extract<ChatBlock, { type: "spec_review" }>;

/**
 * The spec review card (plan v3 §6): everything that will be made, what the bank already has for each chapter,
 * and what making the rest costs. Only Confirm starts paid work.
 */
export function SpecReview({
  block,
  live,
  send,
}: {
  block: Review;
  live: boolean;
  send: (input: ChatInput) => void;
}) {
  const t = useTranslations("chat.review");
  const labels = useLabels();
  const format = useFormatter();
  const locale = useLocale();
  const exams = useExams();
  const spec = block.spec;
  const scope = useScope(null, spec.taxonomyNodeIds);
  const names = new Map((scope.data?.nodes ?? []).map((node) => [node.id, localName(locale, node)]));
  const exam = exams.data?.find((e) => e.code === spec.examCode);
  const paper = spec.kind === "question_paper" || spec.kind === "worksheet";
  const sections: PaperSection[] = "sections" in spec ? spec.sections : [];
  const questions = sections.reduce((sum, section) => sum + section.count, 0);
  const marks = sections.reduce((sum, section) => sum + section.count * section.marksEach, 0);
  const money = (usd: number) => format.number(usd, { style: "currency", currency: "USD" });
  const { usdLow, usdHigh, minutes } = block.estimate;

  const facts: [string, string][] = [
    [t("kind"), labels.kind(spec.kind)],
    ...(exam ? ([[t("exam"), localName(locale, exam)]] as [string, string][]) : []),
    [t("chapters"), spec.taxonomyNodeIds.map((id) => names.get(id) ?? "…").join(", ")],
    [t("languages"), spec.languages.map(labels.language).join(", ")],
  ];
  if ("sections" in spec) {
    facts.push(
      [t("questions"), t("questionsValue", { questions, marks })],
      [t("duration"), spec.durationMinutes ? t("minutes", { minutes: spec.durationMinutes }) : t("noLimit")],
      [t("layout"), labels.layout(spec.layout)],
      [t("sourcing"), labels.sourcing(spec.sourcing)],
    );
    if (spec.setCodes.length) facts.push([t("sets"), spec.setCodes.join(", ")]);
  } else {
    facts.push(
      [t("depth"), labels.depth(spec.depth)],
      [t("examples"), spec.includeExamples ? t("yes") : t("no")],
      [t("practice"), spec.includePractice ? t("yes") : t("no")],
    );
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {spec.title}
          {block.confirmedAt && (
            <Badge>
              <CheckCircle2 />
              {t("confirmed")}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          {t("estimate", {
            cost: usdLow === usdHigh ? money(usdLow) : `${money(usdLow)}–${money(usdHigh)}`,
            minutes: format.number(minutes, { maximumFractionDigits: 0 }),
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          {facts.map(([term, detail]) => (
            <div key={term} className="contents">
              <dt className="text-muted-foreground">{term}</dt>
              <dd>{detail}</dd>
            </div>
          ))}
        </dl>
        {sections.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("section")}</TableHead>
                <TableHead className="text-right">{t("count")}</TableHead>
                <TableHead className="text-right">{t("marksEach")}</TableHead>
                <TableHead className="text-right">{t("negative")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sections.map((section, n) => (
                <TableRow key={n}>
                  <TableCell>{labels.qtype(section.qtype)}</TableCell>
                  <TableCell className="text-right tabular-nums">{section.count}</TableCell>
                  <TableCell className="text-right tabular-nums">{section.marksEach}</TableCell>
                  <TableCell className="text-right tabular-nums">{section.negativeMarks}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {paper && block.availability.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("chapter")}</TableHead>
                <TableHead className="text-right">{t("fromBank")}</TableHead>
                <TableHead className="text-right">{t("toGenerate")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {block.availability.map((row) => (
                <TableRow key={row.nodeId}>
                  <TableCell>{names.get(row.nodeId) ?? row.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.fromBank}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.toGenerate}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {live && !block.confirmedAt && (
        <CardFooter className="mt-5 justify-end gap-2">
          <Button variant="outline" onClick={() => send({ kind: "action", action: "cancel" })}>
            {t("cancel")}
          </Button>
          <Button onClick={() => send({ kind: "action", action: "confirm_spec" })}>{t("confirm")}</Button>
        </CardFooter>
      )}
    </Card>
  );
}

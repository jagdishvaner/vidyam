"use client";

import type { ImportSummary } from "@vidyam/contracts";
import { Button } from "@vidyam/ui/components/button";
import { useMutation } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef } from "react";
import { toast } from "sonner";

/** Picks a JSON file, hands its contents to `send`, and reports what the import changed. */
export function JsonImportButton({
  label,
  send,
  onDone,
}: {
  label: string;
  send: (json: unknown) => Promise<ImportSummary>;
  onDone: () => void;
}) {
  const t = useTranslations("syllabus");
  const input = useRef<HTMLInputElement>(null);
  const run = useMutation({
    mutationFn: async (file: File) => {
      let json: unknown;
      try {
        json = JSON.parse(await file.text());
      } catch {
        throw new Error(t("notJson"));
      }
      return send(json);
    },
    onSuccess: (summary) => {
      toast.success(t("imported", summary));
      onDone();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) run.mutate(file);
          event.target.value = "";
        }}
      />
      <Button variant="outline" disabled={run.isPending} onClick={() => input.current?.click()}>
        <Upload data-icon="inline-start" />
        {run.isPending ? t("importing") : label}
      </Button>
    </>
  );
}

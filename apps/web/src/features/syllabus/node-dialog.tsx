"use client";

import type { SyllabusNode } from "@vidyam/contracts";
import { Button } from "@vidyam/ui/components/button";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@vidyam/ui/components/select";
import { Switch } from "@vidyam/ui/components/switch";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { api } from "@/lib/client/api";
import { errorMessage } from "@/lib/client/errors";

const LEVELS = ["subject", "unit", "chapter", "topic", "subtopic"] as const;
type Level = (typeof LEVELS)[number];

/** Either editing an existing node, or adding a child under `parent` (null parent = a new subject). */
export type NodeDialogState =
  { mode: "edit"; node: SyllabusNode } | { mode: "add"; parent: SyllabusNode | null };

const lines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

export function NodeDialog({
  state,
  onClose,
  onDone,
}: {
  state: NodeDialogState | null;
  onClose: () => void;
  onDone: (node: SyllabusNode) => void;
}) {
  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {state && (
          <NodeForm
            key={state.mode === "edit" ? state.node.id : `add-${state.parent?.id ?? "root"}`}
            state={state}
            onClose={onClose}
            onDone={onDone}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function NodeForm({
  state,
  onClose,
  onDone,
}: {
  state: NodeDialogState;
  onClose: () => void;
  onDone: (node: SyllabusNode) => void;
}) {
  const t = useTranslations("syllabus");
  const tc = useTranslations("common");
  const node = state.mode === "edit" ? state.node : null;
  const parent = state.mode === "add" ? state.parent : null;
  const allowed: Level[] = parent ? LEVELS.slice(LEVELS.indexOf(parent.level) + 1) : ["subject"];
  const [level, setLevel] = useState<Level>(node?.level ?? allowed[0] ?? "topic");
  const [active, setActive] = useState(node?.isActive ?? true);

  const save = useMutation({
    mutationFn: async (form: FormData) => {
      const fields = {
        nameEn: String(form.get("nameEn")),
        nameHi: String(form.get("nameHi")).trim() || null,
        aliases: lines(String(form.get("aliases"))),
        objectives: lines(String(form.get("objectives"))),
      };
      const { data, error } = node
        ? await api.PUT("/api/syllabus/nodes/{nodeId}", {
            params: { path: { nodeId: node.id } },
            body: { ...fields, isActive: active },
          })
        : await api.POST("/api/syllabus/nodes", {
            body: { ...fields, parentId: parent?.id ?? null, code: String(form.get("code")), level },
          });
      if (error || !data) throw new Error(errorMessage(error, tc("somethingWentWrong")));
      return data;
    },
    onSuccess: (saved) => {
      toast.success(t("saved"));
      onDone(saved);
    },
    onError: (error) => toast.error(error.message),
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save.mutate(new FormData(event.currentTarget));
  }

  const title = node
    ? t("editTitle", { name: node.nameEn })
    : parent
      ? t("addTitle", { name: parent.nameEn })
      : t("addSubjectTitle");

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {node && <DialogDescription className="font-mono text-xs">{node.path}</DialogDescription>}
      </DialogHeader>

      {!node && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="node-code">{t("code")}</Label>
            <Input
              id="node-code"
              name="code"
              required
              pattern="[a-z0-9]+(_[a-z0-9]+)*"
              autoComplete="off"
              className="font-mono"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="node-level">{t("level")}</Label>
            <Select value={level} onValueChange={(value) => setLevel(value as Level)}>
              <SelectTrigger id="node-level" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {allowed.map((l) => (
                  <SelectItem key={l} value={l}>
                    {t(`levels.${l}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2">{t("codeHint")}</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="node-name-en">{t("nameEn")}</Label>
          <Input id="node-name-en" name="nameEn" required maxLength={200} defaultValue={node?.nameEn} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="node-name-hi">{t("nameHi")}</Label>
          <Input
            id="node-name-hi"
            name="nameHi"
            maxLength={200}
            defaultValue={node?.nameHi ?? ""}
            lang="hi"
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="node-aliases">{t("aliases")}</Label>
        <textarea
          id="node-aliases"
          name="aliases"
          rows={3}
          defaultValue={node?.aliases.join("\n")}
          className="w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <p className="text-xs text-muted-foreground">{t("aliasesHint")}</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="node-objectives">{t("objectives")}</Label>
        <textarea
          id="node-objectives"
          name="objectives"
          rows={2}
          defaultValue={node?.objectives.join("\n")}
          className="w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <p className="text-xs text-muted-foreground">{t("objectivesHint")}</p>
      </div>
      {node && (
        <label className="flex items-start gap-3">
          <Switch checked={active} onCheckedChange={setActive} className="mt-0.5" />
          <span className="space-y-1">
            <span className="block text-sm font-medium">{t("active")}</span>
            <span className="block text-xs text-muted-foreground">{t("activeHint")}</span>
          </span>
        </label>
      )}

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? t("saving") : t("save")}
        </Button>
      </DialogFooter>
    </form>
  );
}

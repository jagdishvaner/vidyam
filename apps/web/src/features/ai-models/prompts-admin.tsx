"use client";

import { LlmTask, PromptFamily, type PromptVersion } from "@vidyam/contracts";
import { Alert, AlertDescription } from "@vidyam/ui/components/alert";
import { Badge } from "@vidyam/ui/components/badge";
import { Button } from "@vidyam/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@vidyam/ui/components/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@vidyam/ui/components/dialog";
import { Skeleton } from "@vidyam/ui/components/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@vidyam/ui/components/tabs";
import { cn } from "@vidyam/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { api } from "@/lib/client/api";
import { errorMessage } from "@/lib/client/errors";

export function PromptsAdmin() {
  const t = useTranslations("prompts");
  const tt = useTranslations("aiModels.tasks");
  const tc = useTranslations("common");
  const format = useFormatter();
  const queryClient = useQueryClient();
  const [task, setTask] = useState<LlmTask>("chat_title");
  const [family, setFamily] = useState<PromptFamily>("any");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const prompts = useQuery({
    queryKey: ["prompts"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/prompts");
      if (error || !data) throw new Error(errorMessage(error, tc("somethingWentWrong")));
      return data;
    },
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["prompts"] });
  const activate = useMutation({
    mutationFn: async (version: PromptVersion) => {
      const { error } = await api.POST("/api/prompts/{promptId}/activate", {
        params: { path: { promptId: version.id } },
      });
      if (error) throw new Error(errorMessage(error, tc("somethingWentWrong")));
      return version;
    },
    onSuccess: (version) => {
      toast.success(t("madeLive", { version: version.version }));
      refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  if (!prompts.data) return <Skeleton className="h-96 w-full rounded-xl" />;
  const { versions: all, canEdit } = prompts.data;
  const versions = all.filter((v) => v.name === task && v.modelFamily === family);
  const selected =
    versions.find((v) => v.id === selectedId) ?? versions.find((v) => v.isActive) ?? versions[0];
  const countFor = (name: LlmTask) => all.filter((v) => v.name === name).length;

  return (
    <div className="space-y-6">
      {!canEdit && (
        <Alert>
          <AlertDescription>{t("readOnly")}</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-6 2xl:grid-cols-[18rem_minmax(0,1fr)]">
        <Card className="self-start">
          <CardContent className="flex flex-wrap gap-1 2xl:flex-col">
            {LlmTask.options.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => {
                  setTask(name);
                  setSelectedId(null);
                }}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent 2xl:w-full",
                  name === task && "bg-accent font-medium",
                  countFor(name) === 0 && "text-muted-foreground",
                )}
              >
                <span>{tt(name)}</span>
                <span className="text-xs tabular-nums">{countFor(name)}</span>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
            <CardTitle>{tt(task)}</CardTitle>
            <Tabs
              value={family}
              onValueChange={(value) => {
                setFamily(value as PromptFamily);
                setSelectedId(null);
              }}
            >
              <TabsList>
                {PromptFamily.options.map((f) => (
                  <TabsTrigger key={f} value={f}>
                    {t(`families.${f}`)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent className="space-y-4">
            {versions.length === 0 && <p className="text-sm text-muted-foreground">{t("noVersions")}</p>}
            {versions.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {versions.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setSelectedId(v.id)}
                    aria-pressed={v.id === selected?.id}
                  >
                    <Badge variant={v.id === selected?.id ? "default" : "outline"}>
                      {t("version", { version: v.version })}
                      {v.isActive && ` · ${t("live")}`}
                    </Badge>
                  </button>
                ))}
              </div>
            )}
            {selected && (
              <>
                <p className="text-xs text-muted-foreground">
                  {selected.source === "package"
                    ? t("fromPackage")
                    : t("byAuthor", { name: selected.createdByName ?? "—" })}
                  {" · "}
                  {format.dateTime(new Date(selected.createdAt), { dateStyle: "medium", timeStyle: "short" })}
                </p>
                <pre className="max-h-[32rem] overflow-auto rounded-md border bg-muted/40 p-4 text-sm whitespace-pre-wrap">
                  {selected.body}
                </pre>
              </>
            )}
            {canEdit && (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => setEditing(selected?.body ?? "")}>
                  <Plus data-icon="inline-start" />
                  {t("newVersion")}
                </Button>
                {selected && !selected.isActive && (
                  <Button disabled={activate.isPending} onClick={() => activate.mutate(selected)}>
                    {t("makeLive")}
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-3xl">
          {editing !== null && (
            <NewVersionForm
              task={task}
              family={family}
              initial={editing}
              onClose={() => setEditing(null)}
              onDone={(version) => {
                setEditing(null);
                setSelectedId(version.id);
                refresh();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NewVersionForm({
  task,
  family,
  initial,
  onClose,
  onDone,
}: {
  task: LlmTask;
  family: PromptFamily;
  initial: string;
  onClose: () => void;
  onDone: (version: PromptVersion) => void;
}) {
  const t = useTranslations("prompts");
  const tt = useTranslations("aiModels.tasks");
  const tc = useTranslations("common");
  const [body, setBody] = useState(initial);
  const save = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST("/api/prompts", {
        body: { name: task, modelFamily: family, body },
      });
      if (error || !data) throw new Error(errorMessage(error, tc("somethingWentWrong")));
      return data;
    },
    onSuccess: (version) => {
      toast.success(t("saved", { version: version.version }));
      onDone(version);
    },
    onError: (error) => toast.error(error.message),
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>{t("editorTitle", { job: tt(task), family: t(`families.${family}`) })}</DialogTitle>
      </DialogHeader>
      <textarea
        aria-label={t("newVersion")}
        rows={20}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        className="w-full rounded-md border bg-transparent px-3 py-2 font-mono text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <p className="text-xs text-muted-foreground">{t("editorHint")}</p>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={save.isPending || body.trim().length < 20}>
          {save.isPending ? t("saving") : t("save")}
        </Button>
      </DialogFooter>
    </form>
  );
}

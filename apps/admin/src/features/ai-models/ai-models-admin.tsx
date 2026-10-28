"use client";

import { Effort, type AiModel, type AiOverview, type TaskRoute } from "@vidyam/contracts";
import { Alert, AlertDescription } from "@vidyam/ui/components/alert";
import { Badge } from "@vidyam/ui/components/badge";
import { Button } from "@vidyam/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@vidyam/ui/components/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@vidyam/ui/components/dialog";
import { Input } from "@vidyam/ui/components/input";
import { Label } from "@vidyam/ui/components/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@vidyam/ui/components/select";
import { Skeleton } from "@vidyam/ui/components/skeleton";
import { Switch } from "@vidyam/ui/components/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@vidyam/ui/components/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, CircleDashed, FlaskConical, Pencil, RotateCcw, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { api } from "@vidyam/app-shell/client/api";
import { errorMessage } from "@vidyam/app-shell/client/errors";

const NO_FALLBACK = "__none__";

export function AiModelsAdmin() {
  const tc = useTranslations("common");
  const overview = useQuery({
    queryKey: ["ai"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/ai");
      if (error || !data) throw new Error(errorMessage(error, tc("somethingWentWrong")));
      return data;
    },
  });
  if (!overview.data) return <Skeleton className="h-96 w-full rounded-xl" />;
  return (
    <div className="space-y-6">
      <ProvidersCard engine={overview.data.engine} />
      <RoutesCard overview={overview.data} />
      <ModelsCard overview={overview.data} />
    </div>
  );
}

function ProvidersCard({ engine }: { engine: AiOverview["engine"] }) {
  const t = useTranslations("aiModels");
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("providers")}</CardTitle>
        <CardDescription>{t("keysHint")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!engine && (
          <Alert>
            <TriangleAlert />
            <AlertDescription>{t("engineDown")}</AlertDescription>
          </Alert>
        )}
        {engine?.stubActive && (
          <Alert>
            <FlaskConical />
            <AlertDescription>{t("stubActive")}</AlertDescription>
          </Alert>
        )}
        {engine && (
          <ul className="grid gap-3 sm:grid-cols-2">
            {engine.providers.map((p) => (
              <li key={p.provider} className="flex items-center gap-3 rounded-md border p-3">
                {p.configured ? (
                  <CircleCheck className="size-5 text-primary" />
                ) : (
                  <CircleDashed className="size-5 text-muted-foreground" />
                )}
                <div>
                  <p className="font-medium">
                    {p.provider === "anthropic" ? "Anthropic (Claude)" : "OpenAI (GPT)"}
                    {p.endpoint && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {t(`endpoints.${p.endpoint as "anthropic" | "aws"}`)}
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {p.configured ? t("keySet") : t("keyMissing")}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function RoutesCard({ overview }: { overview: AiOverview }) {
  const t = useTranslations("aiModels");
  const tc = useTranslations("common");
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<TaskRoute | null>(null);
  const name = (id: string | null) => overview.models.find((m) => m.id === id)?.displayName ?? id ?? "—";

  const reset = useMutation({
    mutationFn: async (route: TaskRoute) => {
      const { error } = await api.DELETE("/api/ai/routes/{task}", { params: { path: { task: route.task } } });
      if (error) throw new Error(errorMessage(error, tc("somethingWentWrong")));
    },
    onSuccess: () => {
      toast.success(t("routeReset"));
      void queryClient.invalidateQueries({ queryKey: ["ai"] });
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("routes")}</CardTitle>
        <CardDescription>{t("routesHint")}</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("job")}</TableHead>
              <TableHead>{t("model")}</TableHead>
              <TableHead>{t("effort")}</TableHead>
              <TableHead className="text-right">{t("maxTokens")}</TableHead>
              <TableHead>{t("fallback")}</TableHead>
              <TableHead>{t("source")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {overview.routes.map((route) => (
              <TableRow key={route.task}>
                <TableCell className="min-w-44 whitespace-normal">{t(`tasks.${route.task}`)}</TableCell>
                <TableCell>{name(route.modelId)}</TableCell>
                <TableCell>{route.effort ? t(`efforts.${route.effort}`) : "—"}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {route.maxTokens?.toLocaleString() ?? "—"}
                </TableCell>
                <TableCell>{route.fallbackModelId ? name(route.fallbackModelId) : "—"}</TableCell>
                <TableCell>
                  <Badge variant={route.source === "center" ? "default" : "secondary"}>
                    {t(`sources.${route.source}`)}
                  </Badge>
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`${t("editRoute")}: ${t(`tasks.${route.task}`)}`}
                    title={t("editRoute")}
                    onClick={() => setEditing(route)}
                  >
                    <Pencil />
                  </Button>
                  {route.source === "center" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`${t("resetRoute")}: ${t(`tasks.${route.task}`)}`}
                      title={t("resetRoute")}
                      disabled={reset.isPending}
                      onClick={() => reset.mutate(route)}
                    >
                      <RotateCcw />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          {editing && (
            <RouteForm
              key={editing.task}
              route={editing}
              models={overview.models.filter((m) => m.enabled)}
              onDone={() => {
                setEditing(null);
                void queryClient.invalidateQueries({ queryKey: ["ai"] });
              }}
              onClose={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function RouteForm({
  route,
  models,
  onDone,
  onClose,
}: {
  route: TaskRoute;
  models: AiModel[];
  onDone: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("aiModels");
  const tc = useTranslations("common");
  const ids = { model: useId(), effort: useId(), tokens: useId(), fallback: useId() };
  const [modelId, setModelId] = useState(route.modelId ?? models[0]?.id ?? "");
  const [effort, setEffort] = useState<Effort>(route.effort ?? "medium");
  const [maxTokens, setMaxTokens] = useState(String(route.maxTokens ?? 8000));
  const [fallback, setFallback] = useState(route.fallbackModelId ?? NO_FALLBACK);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await api.PUT("/api/ai/routes/{task}", {
        params: { path: { task: route.task } },
        body: {
          modelId,
          effort,
          maxTokens: Number(maxTokens),
          fallbackModelId: fallback === NO_FALLBACK ? null : fallback,
        },
      });
      if (error) throw new Error(errorMessage(error, tc("somethingWentWrong")));
    },
    onSuccess: () => {
      toast.success(t("routeSaved"));
      onDone();
    },
    onError: (error) => toast.error(error.message),
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save.mutate();
  }

  const modelOptions = models.map((m) => (
    <SelectItem key={m.id} value={m.id}>
      {m.displayName}
    </SelectItem>
  ));

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>{t("routeTitle", { job: t(`tasks.${route.task}`) })}</DialogTitle>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor={ids.model}>{t("model")}</Label>
        <Select value={modelId} onValueChange={setModelId}>
          <SelectTrigger id={ids.model} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>{modelOptions}</SelectContent>
        </Select>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={ids.effort}>{t("effort")}</Label>
          <Select value={effort} onValueChange={(value) => setEffort(value as Effort)}>
            <SelectTrigger id={ids.effort} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Effort.options.map((e) => (
                <SelectItem key={e} value={e}>
                  {t(`efforts.${e}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor={ids.tokens}>{t("maxTokens")}</Label>
          <Input
            id={ids.tokens}
            type="number"
            min={256}
            max={200000}
            step={256}
            required
            value={maxTokens}
            onChange={(e) => setMaxTokens(e.target.value)}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor={ids.fallback}>{t("fallback")}</Label>
        <Select value={fallback} onValueChange={setFallback}>
          <SelectTrigger id={ids.fallback} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_FALLBACK}>{t("noFallback")}</SelectItem>
            {modelOptions}
          </SelectContent>
        </Select>
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={save.isPending || !modelId}>
          {save.isPending ? t("saving") : t("save")}
        </Button>
      </DialogFooter>
    </form>
  );
}

function ModelsCard({ overview }: { overview: AiOverview }) {
  const t = useTranslations("aiModels");
  const tc = useTranslations("common");
  const queryClient = useQueryClient();
  const update = useMutation({
    mutationFn: async ({
      model,
      enabled,
      teacherSelectable,
    }: {
      model: AiModel;
      enabled: boolean;
      teacherSelectable: boolean;
    }) => {
      const { error } = await api.PUT("/api/ai/models/{modelId}", {
        params: { path: { modelId: model.id } },
        body: { enabled, teacherSelectable: enabled && teacherSelectable },
      });
      if (error) throw new Error(errorMessage(error, tc("somethingWentWrong")));
      return model;
    },
    onSuccess: (model) => {
      toast.success(t("updated", { model: model.displayName }));
      void queryClient.invalidateQueries({ queryKey: ["ai"] });
    },
    onError: (error) => toast.error(error.message),
  });
  const price = (m: AiModel) =>
    m.prices.input !== undefined && m.prices.output !== undefined
      ? `${m.prices.input} · ${m.prices.output}`
      : "—";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("registry")}</CardTitle>
        {!overview.canEditModels && <CardDescription>{t("registryReadOnly")}</CardDescription>}
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("model")}</TableHead>
              <TableHead>{t("provider")}</TableHead>
              <TableHead className="text-right">{t("context")}</TableHead>
              <TableHead className="text-right">{t("price")}</TableHead>
              <TableHead className="text-center">{t("enabled")}</TableHead>
              <TableHead className="text-center">{t("teacherPick")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {overview.models.map((m) => (
              <TableRow key={m.id}>
                <TableCell>
                  <p className="font-medium">{m.displayName}</p>
                  <p className="font-mono text-xs text-muted-foreground">{m.apiModel}</p>
                </TableCell>
                <TableCell>
                  {m.provider === "anthropic" ? "Anthropic" : m.provider === "openai" ? "OpenAI" : m.provider}
                </TableCell>
                <TableCell className="text-right tabular-nums">{m.contextWindow.toLocaleString()}</TableCell>
                <TableCell className="text-right tabular-nums">{price(m)}</TableCell>
                <TableCell className="text-center">
                  <Switch
                    checked={m.enabled}
                    disabled={!overview.canEditModels || update.isPending}
                    aria-label={`${t("enabled")}: ${m.displayName}`}
                    onCheckedChange={(enabled) =>
                      update.mutate({ model: m, enabled, teacherSelectable: m.teacherSelectable })
                    }
                  />
                </TableCell>
                <TableCell className="text-center">
                  <Switch
                    checked={m.teacherSelectable}
                    disabled={!overview.canEditModels || !m.enabled || update.isPending}
                    aria-label={`${t("teacherPick")}: ${m.displayName}`}
                    onCheckedChange={(teacherSelectable) =>
                      update.mutate({ model: m, enabled: m.enabled, teacherSelectable })
                    }
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

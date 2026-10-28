"use client";

import {
  LOGO_TYPES,
  Sourcing,
  type AiPolicy,
  type CenterProfile as Profile,
  type LocalizedText,
  type UpdateBrandingRequest,
} from "@vidyam/contracts";
import { Button } from "@vidyam/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@vidyam/ui/components/card";
import { Checkbox } from "@vidyam/ui/components/checkbox";
import { Input } from "@vidyam/ui/components/input";
import { Label } from "@vidyam/ui/components/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@vidyam/ui/components/select";
import { Skeleton } from "@vidyam/ui/components/skeleton";
import { Switch } from "@vidyam/ui/components/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImageUp, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { api } from "@vidyam/app-shell/client/api";
import { errorMessage } from "@vidyam/app-shell/client/errors";

const TEXTAREA =
  "w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function CenterProfile() {
  const tc = useTranslations("common");
  const profile = useQuery({
    queryKey: ["center"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/center");
      if (error || !data) throw new Error(errorMessage(error, tc("somethingWentWrong")));
      return data;
    },
  });
  if (!profile.data) return <Skeleton className="h-96 w-full rounded-xl" />;
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      {/* Keyed by the saved values, so the form restarts from what the server holds after each save. */}
      <BrandingForm key={JSON.stringify(profile.data.branding)} profile={profile.data} />
      <div className="space-y-6">
        <LogoCard profile={profile.data} />
        <AiPolicyCard key={JSON.stringify(profile.data.aiPolicy)} profile={profile.data} />
      </div>
    </div>
  );
}

const lines = (value: string | null | undefined) => value?.split("\n").filter(Boolean) ?? [];
const localized = (en: string, hi: string): LocalizedText | null =>
  en.trim() || hi.trim() ? { en: en.trim() || undefined, hi: hi.trim() || undefined } : null;

function BrandingForm({ profile }: { profile: Profile }) {
  const t = useTranslations("center");
  const tc = useTranslations("common");
  const queryClient = useQueryClient();
  const b = profile.branding;
  const [draft, setDraft] = useState({
    nameEn: b.name.en ?? "",
    nameHi: b.name.hi ?? "",
    headerEn: b.headerLines?.en ?? "",
    headerHi: b.headerLines?.hi ?? "",
    footerEn: b.footer?.en ?? "",
    footerHi: b.footer?.hi ?? "",
    instructionsEn: b.defaultInstructions?.en ?? "",
    instructionsHi: b.defaultInstructions?.hi ?? "",
  });
  const field = (key: keyof typeof draft) => ({
    value: draft[key],
    onChange: (e: { target: { value: string } }) => setDraft({ ...draft, [key]: e.target.value }),
  });

  const save = useMutation({
    mutationFn: async () => {
      const body: UpdateBrandingRequest = {
        name: localized(draft.nameEn, draft.nameHi) ?? { en: profile.organization.name },
        headerLines: localized(draft.headerEn, draft.headerHi),
        footer: localized(draft.footerEn, draft.footerHi),
        defaultInstructions: localized(draft.instructionsEn, draft.instructionsHi),
      };
      const { error } = await api.PUT("/api/center/branding", { body });
      if (error) throw new Error(errorMessage(error, tc("somethingWentWrong")));
    },
    onSuccess: () => {
      toast.success(t("saved"));
      void queryClient.invalidateQueries({ queryKey: ["center"] });
    },
    onError: (error) => toast.error(error.message),
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("branding")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-5">
            <Pair>
              <Field label={t("nameEn")}>
                {(id) => <Input id={id} maxLength={200} {...field("nameEn")} />}
              </Field>
              <Field label={t("nameHi")}>
                {(id) => <Input id={id} lang="hi" maxLength={200} {...field("nameHi")} />}
              </Field>
            </Pair>
            <Pair hint={t("headerHint")}>
              <Field label={t("headerEn")}>
                {(id) => <textarea id={id} rows={3} className={TEXTAREA} {...field("headerEn")} />}
              </Field>
              <Field label={t("headerHi")}>
                {(id) => <textarea id={id} lang="hi" rows={3} className={TEXTAREA} {...field("headerHi")} />}
              </Field>
            </Pair>
            <Pair>
              <Field label={t("footerEn")}>{(id) => <Input id={id} {...field("footerEn")} />}</Field>
              <Field label={t("footerHi")}>
                {(id) => <Input id={id} lang="hi" {...field("footerHi")} />}
              </Field>
            </Pair>
            <Pair hint={t("instructionsHint")}>
              <Field label={t("instructionsEn")}>
                {(id) => <textarea id={id} rows={4} className={TEXTAREA} {...field("instructionsEn")} />}
              </Field>
              <Field label={t("instructionsHi")}>
                {(id) => (
                  <textarea id={id} lang="hi" rows={4} className={TEXTAREA} {...field("instructionsHi")} />
                )}
              </Field>
            </Pair>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? t("saving") : t("save")}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("preview")}</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Roughly how the top of an exported paper will look, from the unsaved values. */}
          <div className="flex items-center gap-4 rounded-md border bg-white p-4 text-neutral-900">
            {profile.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- the logo is private (session cookie); next/image's optimizer can't send it
              <img src={profile.logoUrl} alt="" className="size-16 object-contain" />
            )}
            <div className="min-w-0 flex-1 text-center">
              {draft.nameHi && (
                <p className="text-lg font-semibold" lang="hi">
                  {draft.nameHi}
                </p>
              )}
              <p className={draft.nameHi ? "font-medium" : "text-lg font-semibold"}>
                {draft.nameEn || profile.organization.name}
              </p>
              {[...lines(draft.headerHi), ...lines(draft.headerEn)].map((line, i) => (
                <p key={i} className="text-xs text-neutral-600">
                  {line}
                </p>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function LogoCard({ profile }: { profile: Profile }) {
  const t = useTranslations("center");
  const tc = useTranslations("common");
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["center"] });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("logo", file);
      // Multipart goes through plain fetch; the typed client speaks JSON.
      const response = await fetch("/api/center/logo", { method: "POST", body: form });
      if (!response.ok) {
        throw new Error(errorMessage(await response.json().catch(() => null), tc("somethingWentWrong")));
      }
    },
    onSuccess: () => {
      toast.success(t("logoSaved"));
      refresh();
    },
    onError: (error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await api.DELETE("/api/center/logo");
      if (error) throw new Error(errorMessage(error, tc("somethingWentWrong")));
    },
    onSuccess: () => {
      toast.success(t("logoRemoved"));
      refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("logo")}</CardTitle>
        <CardDescription>{t("logoHint")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex h-32 items-center justify-center rounded-md border bg-white">
          {profile.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- the logo is private (session cookie); next/image's optimizer can't send it
            <img src={profile.logoUrl} alt={t("logo")} className="max-h-28 max-w-full object-contain" />
          ) : (
            <span className="text-sm text-neutral-500">{t("noLogo")}</span>
          )}
        </div>
        <input
          ref={input}
          type="file"
          accept={LOGO_TYPES.join(",")}
          className="hidden"
          aria-label={t("uploadLogo")}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) upload.mutate(file);
            event.target.value = "";
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={upload.isPending} onClick={() => input.current?.click()}>
            <ImageUp data-icon="inline-start" />
            {upload.isPending ? t("uploading") : profile.logoUrl ? t("replaceLogo") : t("uploadLogo")}
          </Button>
          {profile.logoUrl && (
            <Button variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate()}>
              <Trash2 data-icon="inline-start" />
              {t("removeLogo")}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function AiPolicyCard({ profile }: { profile: Profile }) {
  const t = useTranslations("center");
  const tc = useTranslations("common");
  const queryClient = useQueryClient();
  const [policy, setPolicy] = useState<AiPolicy>(profile.aiPolicy);
  const sourcingId = useId();

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await api.PUT("/api/center/ai-policy", { body: policy });
      if (error) throw new Error(errorMessage(error, tc("somethingWentWrong")));
    },
    onSuccess: () => {
      toast.success(t("saved"));
      void queryClient.invalidateQueries({ queryKey: ["center"] });
    },
    onError: (error) => toast.error(error.message),
  });
  const toggleModel = (id: string, on: boolean) =>
    setPolicy((p) => ({
      ...p,
      allowedModelIds: on ? [...p.allowedModelIds, id] : p.allowedModelIds.filter((m) => m !== id),
    }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("aiPolicy")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t("models")}</legend>
          {profile.selectableModels.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("noModels")}</p>
          )}
          {profile.selectableModels.map((model) => (
            <label key={model.id} className="flex items-center gap-3 text-sm">
              <Checkbox
                checked={policy.allowedModelIds.includes(model.id)}
                onCheckedChange={(on) => toggleModel(model.id, on === true)}
              />
              <span>{model.displayName}</span>
              <span className="text-xs text-muted-foreground">{t(`providers.${model.provider}`)}</span>
            </label>
          ))}
          <p className="text-xs text-muted-foreground">{t("modelsHint")}</p>
        </fieldset>

        <label className="flex items-start gap-3">
          <Switch
            className="mt-0.5"
            checked={policy.requireCrossProviderCheck}
            onCheckedChange={(on) => setPolicy({ ...policy, requireCrossProviderCheck: on })}
          />
          <span className="space-y-1">
            <span className="block text-sm font-medium">{t("crossCheck")}</span>
            <span className="block text-xs text-muted-foreground">{t("crossCheckHint")}</span>
          </span>
        </label>

        <div className="space-y-2">
          <Label htmlFor={sourcingId}>{t("sourcing")}</Label>
          <Select
            value={policy.defaultSourcing}
            onValueChange={(value) =>
              setPolicy({ ...policy, defaultSourcing: value as AiPolicy["defaultSourcing"] })
            }
          >
            <SelectTrigger id={sourcingId} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Sourcing.options.map((option) => (
                <SelectItem key={option} value={option}>
                  {t(`sourcingOptions.${option}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? t("saving") : t("save")}
        </Button>
      </CardContent>
    </Card>
  );
}

function Pair({ hint, children }: { hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: (id: string) => React.ReactNode }) {
  const id = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children(id)}
    </div>
  );
}

"use client";

import { ContentLanguage, type CurrentUser, type MemberSettings, type MySettings } from "@vidyam/contracts";
import { Badge } from "@vidyam/ui/components/badge";
import { Button } from "@vidyam/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@vidyam/ui/components/card";
import { Input } from "@vidyam/ui/components/input";
import { Label } from "@vidyam/ui/components/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@vidyam/ui/components/select";
import { Skeleton } from "@vidyam/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { usePathname, useRouter } from "@vidyam/app-shell/i18n/navigation";
import { api } from "@vidyam/app-shell/client/api";
import { authClient } from "@vidyam/app-shell/client/auth";
import { errorMessage } from "@vidyam/app-shell/client/errors";
import { roleKey } from "@vidyam/app-shell/roles";

const NONE = "__none__";

export function SettingsPage({ user }: { user: CurrentUser }) {
  const tc = useTranslations("common");
  const mine = useQuery({
    queryKey: ["my-settings"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/me/settings");
      if (error || !data) throw new Error(errorMessage(error, tc("somethingWentWrong")));
      return data;
    },
  });
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <div className="space-y-6">
        <ProfileCard user={user} />
        <PasswordCard />
      </div>
      <div className="space-y-6">
        {mine.data ? (
          <DefaultsCard key={JSON.stringify(mine.data.settings)} mine={mine.data} />
        ) : (
          <Skeleton className="h-80 w-full rounded-xl" />
        )}
        {mine.data && <SubjectsCard mine={mine.data} />}
      </div>
    </div>
  );
}

function ProfileCard({ user }: { user: CurrentUser }) {
  const t = useTranslations("settings");
  const tr = useTranslations("roles");
  const tc = useTranslations("common");
  const router = useRouter();
  const ids = { name: useId(), email: useId() };
  const [name, setName] = useState(user.name);
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await api.PUT("/api/me/profile", { body: { name } });
      if (error) throw new Error(errorMessage(error, tc("somethingWentWrong")));
    },
    onSuccess: () => {
      toast.success(t("saved"));
      router.refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("profile")}</CardTitle>
        <CardDescription>
          {t("role")}: {tr(roleKey(user))}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={ids.name}>{t("name")}</Label>
            <Input
              id={ids.name}
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={ids.email}>{t("email")}</Label>
            <Input id={ids.email} value={user.email} readOnly disabled />
            <p className="text-xs text-muted-foreground">{t("emailHint")}</p>
          </div>
          <Button type="submit" disabled={save.isPending || name.trim() === "" || name === user.name}>
            {save.isPending ? t("saving") : t("save")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function PasswordCard() {
  const t = useTranslations("settings");
  const ids = { current: useId(), next: useId(), again: useId() };
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const change = useMutation({
    mutationFn: async () => {
      if (next !== again) throw new Error(t("mismatch"));
      const { error } = await authClient.changePassword({
        currentPassword: current,
        newPassword: next,
        revokeOtherSessions: true,
      });
      if (error)
        throw new Error(
          error.code === "INVALID_PASSWORD" ? t("wrongPassword") : (error.message ?? t("wrongPassword")),
        );
    },
    onSuccess: () => {
      toast.success(t("passwordChanged"));
      setCurrent("");
      setNext("");
      setAgain("");
    },
    onError: (error) => toast.error(error.message),
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    change.mutate();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("password")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={ids.current}>{t("currentPassword")}</Label>
            <Input
              id={ids.current}
              type="password"
              autoComplete="current-password"
              required
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={ids.next}>{t("newPassword")}</Label>
            <Input
              id={ids.next}
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              maxLength={128}
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={ids.again}>{t("confirmPassword")}</Label>
            <Input
              id={ids.again}
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              maxLength={128}
              value={again}
              onChange={(e) => setAgain(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={change.isPending}>
            {change.isPending ? t("saving") : t("changePassword")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function DefaultsCard({ mine }: { mine: MySettings }) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const ids = { ui: useId(), content: useId(), model: useId(), exam: useId() };
  const [settings, setSettings] = useState<MemberSettings>(mine.settings);
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await api.PUT("/api/me/settings", { body: settings });
      if (error) throw new Error(errorMessage(error, tc("somethingWentWrong")));
    },
    onSuccess: () => {
      toast.success(t("saved"));
      void queryClient.invalidateQueries({ queryKey: ["my-settings"] });
      // The app follows the chosen language right away.
      if (settings.uiLocale !== locale) router.replace(pathname, { locale: settings.uiLocale });
    },
    onError: (error) => toast.error(error.message),
  });
  const name = (item: { nameEn: string; nameHi: string | null }) =>
    (locale === "hi" && item.nameHi) || item.nameEn;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("defaults")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={ids.ui}>{t("uiLocale")}</Label>
            <Select
              value={settings.uiLocale}
              onValueChange={(uiLocale) =>
                setSettings({ ...settings, uiLocale: uiLocale as MemberSettings["uiLocale"] })
              }
            >
              <SelectTrigger id={ids.ui} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["en", "hi"] as const).map((l) => (
                  <SelectItem key={l} value={l}>
                    {t(`locales.${l}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={ids.content}>{t("contentLanguage")}</Label>
            <Select
              value={settings.contentLanguage}
              onValueChange={(value) =>
                setSettings({ ...settings, contentLanguage: value as ContentLanguage })
              }
            >
              <SelectTrigger id={ids.content} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ContentLanguage.options.map((l) => (
                  <SelectItem key={l} value={l}>
                    {t(`contentLanguages.${l}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor={ids.model}>{t("defaultModel")}</Label>
          <Select
            value={settings.defaultModelId ?? NONE}
            onValueChange={(value) =>
              setSettings({ ...settings, defaultModelId: value === NONE ? null : value })
            }
          >
            <SelectTrigger id={ids.model} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t("centerDefault")}</SelectItem>
              {mine.models.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor={ids.exam}>{t("defaultExam")}</Label>
          <Select
            value={settings.defaultExamId ?? NONE}
            onValueChange={(value) =>
              setSettings({ ...settings, defaultExamId: value === NONE ? null : value })
            }
          >
            <SelectTrigger id={ids.exam} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t("noExam")}</SelectItem>
              {mine.exams.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {name(e)}
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

function SubjectsCard({ mine }: { mine: MySettings }) {
  const t = useTranslations("settings");
  const locale = useLocale();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("subjects")}</CardTitle>
        <CardDescription>{t("subjectsHint")}</CardDescription>
      </CardHeader>
      <CardContent>
        {mine.subjects.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noSubjects")}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {mine.subjects.map((s) => (
              <Badge key={s.nodeId} variant="outline">
                {s.isHead && <Star className="fill-current" aria-label={t("head")} />}
                {(locale === "hi" && s.nameHi) || s.nameEn}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

"use client";

import { Button } from "@vidyam/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@vidyam/ui/components/card";
import { Input } from "@vidyam/ui/components/input";
import { Label } from "@vidyam/ui/components/label";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Link } from "@/i18n/navigation";
import { authClient } from "@/lib/client/auth";

export function ResetPasswordForm() {
  const t = useTranslations("auth");
  const params = useSearchParams();
  const token = params.get("token");
  const [state, setState] = useState<"idle" | "pending" | "done" | "error">(
    token && !params.get("error") ? "idle" : "error",
  );

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("pending");
    const { error } = await authClient.resetPassword({
      newPassword: String(new FormData(event.currentTarget).get("password")),
      token: token!,
    });
    setState(error ? "error" : "done");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("resetTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {state === "done" && <p role="status">{t("passwordUpdated")}</p>}
        {state === "error" && (
          <p role="alert" className="text-sm text-destructive">
            {t("invalidResetLink")}
          </p>
        )}
        {(state === "idle" || state === "pending") && (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">{t("newPassword")}</Label>
              <Input
                id="password"
                name="password"
                type="password"
                minLength={10}
                autoComplete="new-password"
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={state === "pending"}>
              {t("setPassword")}
            </Button>
          </form>
        )}
        <Link href="/login" className="block text-center text-sm text-muted-foreground hover:underline">
          {t("backToSignIn")}
        </Link>
      </CardContent>
    </Card>
  );
}

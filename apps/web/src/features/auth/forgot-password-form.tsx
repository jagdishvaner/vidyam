"use client";

import { Button } from "@vidyam/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@vidyam/ui/components/card";
import { Input } from "@vidyam/ui/components/input";
import { Label } from "@vidyam/ui/components/label";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import { Link } from "@/i18n/navigation";
import { authClient } from "@/lib/client/auth";

export function ForgotPasswordForm() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    await authClient.requestPasswordReset({
      email: String(new FormData(event.currentTarget).get("email")),
      redirectTo: `${window.location.origin}/${locale}/reset-password`,
    });
    // Same message whether or not the account exists, so emails can't be probed.
    setPending(false);
    setSent(true);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("forgotTitle")}</CardTitle>
        <CardDescription>{t("forgotSubtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {sent ? (
          <p role="status" className="text-sm">
            {t("resetLinkSent")}
          </p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t("email")}</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <Button type="submit" className="w-full" disabled={pending}>
              {t("sendResetLink")}
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

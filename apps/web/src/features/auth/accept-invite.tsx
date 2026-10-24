"use client";

import { Button } from "@vidyam/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@vidyam/ui/components/card";
import { Input } from "@vidyam/ui/components/input";
import { Label } from "@vidyam/ui/components/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@vidyam/ui/components/tabs";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/client/auth";

/** Sign in or create an account, then join the inviting organization and make it active. */
export function AcceptInvite({ invitationId }: { invitationId: string }) {
  const t = useTranslations("auth");
  const router = useRouter();
  const session = authClient.useSession();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setPending(true);
    setError(null);
    const { data, error: acceptError } = await authClient.organization.acceptInvitation({ invitationId });
    if (acceptError || !data) {
      setPending(false);
      setError(t("inviteFailed"));
      return;
    }
    await authClient.organization.setActive({ organizationId: data.invitation.organizationId });
    toast.success(t("inviteAccepted"));
    router.replace("/");
    router.refresh();
  }

  async function authenticate(event: FormEvent<HTMLFormElement>, mode: "sign-in" | "sign-up") {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    setPending(true);
    setError(null);
    const result =
      mode === "sign-in"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name: String(form.get("name")) });
    if (result.error) {
      setPending(false);
      setError(result.error.message ?? t("inviteFailed"));
      return;
    }
    await accept();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("inviteTitle")}</CardTitle>
        <CardDescription>{t("inviteSubtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {session.data ? (
          <Button className="w-full" disabled={pending} onClick={accept}>
            {pending ? t("accepting") : t("acceptInvite")}
          </Button>
        ) : (
          <Tabs defaultValue="sign-up">
            <TabsList className="w-full">
              <TabsTrigger value="sign-up">{t("createAccount")}</TabsTrigger>
              <TabsTrigger value="sign-in">{t("haveAccount")}</TabsTrigger>
            </TabsList>
            {(["sign-up", "sign-in"] as const).map((mode) => (
              <TabsContent key={mode} value={mode}>
                <form onSubmit={(e) => authenticate(e, mode)} className="space-y-4 pt-2">
                  {mode === "sign-up" && (
                    <div className="space-y-2">
                      <Label htmlFor={`${mode}-name`}>{t("name")}</Label>
                      <Input id={`${mode}-name`} name="name" autoComplete="name" required />
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor={`${mode}-email`}>{t("email")}</Label>
                    <Input id={`${mode}-email`} name="email" type="email" autoComplete="email" required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`${mode}-password`}>{t("password")}</Label>
                    <Input
                      id={`${mode}-password`}
                      name="password"
                      type="password"
                      minLength={10}
                      autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
                      required
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={pending}>
                    {pending ? t("accepting") : mode === "sign-up" ? t("createAccount") : t("signIn")}
                  </Button>
                </form>
              </TabsContent>
            ))}
          </Tabs>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

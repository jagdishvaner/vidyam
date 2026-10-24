"use client";

import { Badge } from "@vidyam/ui/components/badge";
import { Button } from "@vidyam/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@vidyam/ui/components/card";
import { Input } from "@vidyam/ui/components/input";
import { Label } from "@vidyam/ui/components/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@vidyam/ui/components/select";
import { Skeleton } from "@vidyam/ui/components/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@vidyam/ui/components/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/client/auth";

const INVITABLE_ROLES = ["teacher", "reviewer", "content_operator", "admin"] as const;
type InvitableRole = (typeof INVITABLE_ROLES)[number];
// The client is not typed with our custom access-control roles; the server validates them.
type RoleArg = Parameters<typeof authClient.organization.inviteMember>[0]["role"];

export function MembersManager() {
  const t = useTranslations();
  const format = useFormatter();
  const queryClient = useQueryClient();
  const [role, setRole] = useState<InvitableRole>("teacher");

  const organization = useQuery({
    queryKey: ["organization", "full"],
    queryFn: async () => (await authClient.organization.getFullOrganization()).data ?? null,
  });

  const invite = useMutation({
    mutationFn: async (email: string) => {
      const { error } = await authClient.organization.inviteMember({
        email,
        role: role as unknown as RoleArg,
      });
      if (error) throw new Error(error.message ?? t("common.somethingWentWrong"));
      return email;
    },
    onSuccess: (email) => {
      toast.success(t("members.inviteSent", { email }));
      void queryClient.invalidateQueries({ queryKey: ["organization", "full"] });
    },
    onError: (error) => toast.error(error.message),
  });

  const cancel = useMutation({
    mutationFn: async (invitationId: string) => {
      const { error } = await authClient.organization.cancelInvitation({ invitationId });
      if (error) throw new Error(error.message ?? t("common.somethingWentWrong"));
    },
    onSuccess: () => {
      toast.success(t("members.cancelled"));
      void queryClient.invalidateQueries({ queryKey: ["organization", "full"] });
    },
    onError: (error) => toast.error(error.message),
  });

  function onInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    invite.mutate(String(new FormData(form).get("email")), { onSuccess: () => form.reset() });
  }

  const pending = organization.data?.invitations.filter((i) => i.status === "pending") ?? [];

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle>{t("members.inviteTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onInvite} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invite-email">{t("members.emailLabel")}</Label>
              <Input id="invite-email" name="email" type="email" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-role">{t("members.roleLabel")}</Label>
              <Select value={role} onValueChange={(value) => setRole(value as InvitableRole)}>
                <SelectTrigger id="invite-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INVITABLE_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {t(`roles.${r}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" className="w-full" disabled={invite.isPending}>
              {invite.isPending ? t("members.sending") : t("members.sendInvite")}
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-6 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("members.people")}</CardTitle>
          </CardHeader>
          <CardContent>
            {organization.isPending ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("members.nameColumn")}</TableHead>
                    <TableHead>{t("members.emailColumn")}</TableHead>
                    <TableHead>{t("members.roleColumn")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {organization.data?.members.map((member) => (
                    <TableRow key={member.id}>
                      <TableCell className="font-medium">{member.user.name}</TableCell>
                      <TableCell>{member.user.email}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {t.has(`roles.${member.role}`) ? t(`roles.${member.role}`) : member.role}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("members.pendingInvitations")}</CardTitle>
            {pending.length === 0 && <CardDescription>{t("members.noInvitations")}</CardDescription>}
          </CardHeader>
          {pending.length > 0 && (
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("members.emailColumn")}</TableHead>
                    <TableHead>{t("members.roleColumn")}</TableHead>
                    <TableHead>{t("members.expiresColumn")}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pending.map((invitation) => (
                    <TableRow key={invitation.id}>
                      <TableCell>{invitation.email}</TableCell>
                      <TableCell>{invitation.role ? t(`roles.${invitation.role}`) : ""}</TableCell>
                      <TableCell>
                        {format.dateTime(new Date(invitation.expiresAt), { dateStyle: "medium" })}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={cancel.isPending}
                          onClick={() => cancel.mutate(invitation.id)}
                        >
                          {t("members.cancel")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  );
}

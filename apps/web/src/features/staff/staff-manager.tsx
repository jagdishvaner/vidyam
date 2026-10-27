"use client";

import type { OrgRole, StaffDirectory, StaffMember } from "@vidyam/contracts";
import { Badge } from "@vidyam/ui/components/badge";
import { Button } from "@vidyam/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@vidyam/ui/components/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@vidyam/ui/components/dropdown-menu";
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
import { Skeleton } from "@vidyam/ui/components/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@vidyam/ui/components/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ellipsis, KeyRound, Pencil, Star, UserMinus, UserPlus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { api } from "@/lib/client/api";

import { EditStaffDialog } from "./edit-staff-dialog";
import { errorMessage, ROLES } from "./shared";

/** No look-alike characters (0/O, 1/l/I), so a password read out over the phone survives. */
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
function generatePassword(length = 12): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

interface Login {
  name: string;
  email: string;
  password: string;
}

interface Target {
  userId: string;
  name: string;
  email: string;
}

/** Admin → Staff: logins (add, reset password, remove) and each person's role, subjects and AI budget. */
export function StaffManager({ currentUserId }: { currentUserId: string }) {
  const t = useTranslations();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [role, setRole] = useState<OrgRole>("teacher");
  const [password, setPassword] = useState("");
  const [shared, setShared] = useState<Login | null>(null);
  const [resetting, setResetting] = useState<Target | null>(null);
  const [removing, setRemoving] = useState<Target | null>(null);
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [adding, setAdding] = useState(false);

  const staff = useQuery({
    queryKey: ["staff"],
    queryFn: async (): Promise<StaffDirectory> => {
      const { data, error } = await api.GET("/api/staff");
      if (error || !data) throw new Error(errorMessage(error, t("common.somethingWentWrong")));
      return data;
    },
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["staff"] });

  const add = useMutation({
    mutationFn: async (login: Login) => {
      const { error } = await api.POST("/api/members", { body: { ...login, role } });
      if (error) throw new Error(errorMessage(error, t("common.somethingWentWrong")));
      return login;
    },
    onSuccess: (login) => {
      toast.success(t("members.added", { name: login.name }));
      setShared(login);
      setPassword("");
      refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  function onAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    add.mutate(
      {
        name: String(data.get("name")),
        email: String(data.get("email")),
        password: password || generatePassword(),
      },
      {
        onSuccess: () => {
          form.reset();
          setAdding(false);
        },
      },
    );
  }

  return (
    <div className="space-y-6">
      {shared && <LoginDetails login={shared} onDismiss={() => setShared(null)} />}

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <form onSubmit={onAdd} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{t("members.addTitle")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="member-name">{t("members.nameLabel")}</Label>
              <Input id="member-name" name="name" autoComplete="off" required maxLength={120} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="member-email">{t("members.emailLabel")}</Label>
              <Input id="member-email" name="email" type="email" autoComplete="off" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="member-role">{t("members.roleLabel")}</Label>
              <Select value={role} onValueChange={(value) => setRole(value as OrgRole)}>
                <SelectTrigger id="member-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {t(`roles.${r}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <PasswordField id="member-password" value={password} onChange={setPassword} />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
                {t("members.cancel")}
              </Button>
              <Button type="submit" disabled={add.isPending}>
                {add.isPending ? t("members.adding") : t("members.add")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle>{t("members.people")}</CardTitle>
          <Button onClick={() => setAdding(true)}>
            <UserPlus data-icon="inline-start" />
            {t("members.add")}
          </Button>
        </CardHeader>
        <CardContent>
          {staff.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("members.nameColumn")}</TableHead>
                  <TableHead>{t("members.roleColumn")}</TableHead>
                  <TableHead>{t("members.subjectsColumn")}</TableHead>
                  <TableHead>{t("members.budgetColumn")}</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {staff.data?.members.map((member) => {
                  const target = { userId: member.userId, name: member.name, email: member.email };
                  return (
                    <TableRow key={member.userId}>
                      <TableCell className="whitespace-normal">
                        <p className="font-medium">{member.name}</p>
                        <p className="text-xs break-all text-muted-foreground">{member.email}</p>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{t(`roles.${member.role}`)}</Badge>
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        <div className="flex flex-wrap gap-1">
                          {member.subjects.length === 0 && <span className="text-muted-foreground">—</span>}
                          {member.subjects.map((subject) => {
                            const name = (locale === "hi" && subject.nameHi) || subject.nameEn;
                            return (
                              <Badge key={subject.nodeId} variant="outline">
                                {subject.isHead && (
                                  <Star
                                    className="fill-current"
                                    aria-label={t("members.headOf", { subject: name })}
                                  />
                                )}
                                {name}
                              </Badge>
                            );
                          })}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap tabular-nums">
                        <p>${member.spentThisMonthUsd.toFixed(2)}</p>
                        <p className="text-xs text-muted-foreground">
                          {member.monthlyBudgetUsd === null
                            ? t("members.centerBudget")
                            : t("members.ofLimit", { limit: member.monthlyBudgetUsd.toFixed(2) })}
                        </p>
                      </TableCell>
                      <TableCell className="w-10 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={t("members.actionsFor", { name: member.name })}
                            >
                              <Ellipsis />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="min-w-52">
                            <DropdownMenuItem onClick={() => setEditing(member)}>
                              <Pencil /> {t("members.edit")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setResetting(target)}>
                              <KeyRound /> {t("members.resetPassword")}
                            </DropdownMenuItem>
                            {/* Admins can't remove themselves (the API refuses too), so a center keeps its admin. */}
                            {member.userId !== currentUserId && (
                              <DropdownMenuItem variant="destructive" onClick={() => setRemoving(target)}>
                                <UserMinus /> {t("members.remove")}
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <EditStaffDialog
        member={editing}
        subjects={staff.data?.subjects ?? []}
        isSelf={editing?.userId === currentUserId}
        onClose={() => setEditing(null)}
        onDone={() => {
          setEditing(null);
          refresh();
        }}
      />
      <ResetPasswordDialog
        member={resetting}
        onClose={() => setResetting(null)}
        onDone={(login) => {
          setResetting(null);
          setShared(login);
        }}
      />
      <RemoveMemberDialog
        member={removing}
        onClose={() => setRemoving(null)}
        onDone={() => {
          setRemoving(null);
          refresh();
        }}
      />
    </div>
  );
}

function PasswordField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useTranslations("members");
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{t("passwordLabel")}</Label>
      <div className="flex gap-2">
        {/* Plain text on purpose: the admin reads it out or copies it to the member. */}
        <Input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          minLength={10}
          maxLength={128}
          className="font-mono"
        />
        <Button type="button" variant="outline" onClick={() => onChange(generatePassword())}>
          {t("generate")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t("passwordHint")}</p>
    </div>
  );
}

/** Shown once after a login is created or its password changes, so the admin can pass it on. */
function LoginDetails({ login, onDismiss }: { login: Login; onDismiss: () => void }) {
  const t = useTranslations();
  const locale = useLocale();
  const text = [
    `${t("members.signInPage")}: ${window.location.origin}/${locale}/login`,
    `${t("auth.email")}: ${login.email}`,
    `${t("auth.password")}: ${login.password}`,
  ].join("\n");

  return (
    <Card className="border-primary/40">
      <CardHeader>
        <CardTitle>{t("members.credentialsTitle", { name: login.name })}</CardTitle>
        <CardDescription>{t("members.credentialsBody")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <pre className="rounded-md bg-muted p-3 text-sm break-all whitespace-pre-wrap">{text}</pre>
        <div className="flex gap-2">
          <Button
            type="button"
            onClick={() =>
              void navigator.clipboard.writeText(text).then(() => toast.success(t("members.copied")))
            }
          >
            {t("members.copy")}
          </Button>
          <Button type="button" variant="ghost" onClick={onDismiss}>
            {t("members.dismiss")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ResetPasswordDialog({
  member,
  onClose,
  onDone,
}: {
  member: Target | null;
  onClose: () => void;
  onDone: (login: Login) => void;
}) {
  const t = useTranslations();
  const [password, setPassword] = useState("");

  const reset = useMutation({
    mutationFn: async (target: Target) => {
      const newPassword = password || generatePassword();
      const { error } = await api.PUT("/api/members/{userId}/password", {
        params: { path: { userId: target.userId } },
        body: { password: newPassword },
      });
      if (error) throw new Error(errorMessage(error, t("common.somethingWentWrong")));
      return { name: target.name, email: target.email, password: newPassword };
    },
    onSuccess: (login) => {
      toast.success(t("members.passwordSet", { name: login.name }));
      setPassword("");
      onDone(login);
    },
    onError: (error) => toast.error(error.message),
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (member) reset.mutate(member);
  }

  return (
    <Dialog
      open={member !== null}
      onOpenChange={(open) => {
        if (!open) {
          setPassword("");
          onClose();
        }
      }}
    >
      <DialogContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t("members.resetTitle", { name: member?.name ?? "" })}</DialogTitle>
            <DialogDescription>{t("members.resetBody")}</DialogDescription>
          </DialogHeader>
          <PasswordField id="reset-password" value={password} onChange={setPassword} />
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setPassword("");
                onClose();
              }}
            >
              {t("members.cancel")}
            </Button>
            <Button type="submit" disabled={reset.isPending}>
              {reset.isPending ? t("members.saving") : t("members.setPassword")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RemoveMemberDialog({
  member,
  onClose,
  onDone,
}: {
  member: Target | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations();

  const remove = useMutation({
    mutationFn: async (target: Target) => {
      const { error } = await api.DELETE("/api/members/{userId}", {
        params: { path: { userId: target.userId } },
      });
      if (error) throw new Error(errorMessage(error, t("common.somethingWentWrong")));
      return target;
    },
    onSuccess: (target) => {
      toast.success(t("members.removed", { name: target.name }));
      onDone();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <Dialog open={member !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("members.removeTitle", { name: member?.name ?? "" })}</DialogTitle>
          <DialogDescription>{t("members.removeBody")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("members.cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => member && remove.mutate(member)}
          >
            {remove.isPending ? t("members.removing") : t("members.remove")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

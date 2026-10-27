"use client";

import type { OrgRole, StaffMember, SubjectRef } from "@vidyam/contracts";
import { Button } from "@vidyam/ui/components/button";
import { Checkbox } from "@vidyam/ui/components/checkbox";
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
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { api } from "@/lib/client/api";

import { errorMessage, ROLES } from "./shared";

interface Props {
  member: StaffMember | null;
  subjects: SubjectRef[];
  /** An admin can't change their own role (the API refuses too), but can set their own subjects. */
  isSelf: boolean;
  onClose: () => void;
  onDone: () => void;
}

/** Role, subjects (with head of department) and personal AI budget, saved together. */
export function EditStaffDialog({ member, ...props }: Props) {
  return (
    <Dialog open={member !== null} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="sm:max-w-lg">
        {/* Keyed by member, so the form starts from that person's values each time it opens. */}
        {member && <EditStaffForm key={member.userId} member={member} {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function EditStaffForm({ member, subjects, isSelf, onClose, onDone }: Props & { member: StaffMember }) {
  const t = useTranslations();
  const locale = useLocale();
  const [role, setRole] = useState<OrgRole>(member.role);
  const [assigned, setAssigned] = useState(
    () => new Map(member.subjects.map((subject) => [subject.nodeId, subject.isHead])),
  );
  const [budget, setBudget] = useState(member.monthlyBudgetUsd?.toString() ?? "");

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await api.PUT("/api/staff/{userId}", {
        params: { path: { userId: member.userId } },
        body: {
          role,
          subjects: [...assigned].map(([nodeId, isHead]) => ({ nodeId, isHead })),
          monthlyBudgetUsd: budget.trim() === "" ? null : Number(budget),
        },
      });
      if (error) throw new Error(errorMessage(error, t("common.somethingWentWrong")));
    },
    onSuccess: () => {
      toast.success(t("members.saved", { name: member.name }));
      onDone();
    },
    onError: (error) => toast.error(error.message),
  });

  function toggle(nodeId: string, on: boolean) {
    setAssigned((current) => {
      const next = new Map(current);
      if (on) next.set(nodeId, false);
      else next.delete(nodeId);
      return next;
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <DialogHeader>
        <DialogTitle>{t("members.editTitle", { name: member.name })}</DialogTitle>
        <DialogDescription>{t("members.editBody")}</DialogDescription>
      </DialogHeader>

      <div className="space-y-2">
        <Label htmlFor="staff-role">{t("members.roleLabel")}</Label>
        <Select value={role} onValueChange={(value) => setRole(value as OrgRole)} disabled={isSelf}>
          <SelectTrigger id="staff-role" className="w-full">
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
        {isSelf && <p className="text-xs text-muted-foreground">{t("members.ownRole")}</p>}
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t("members.subjectsLabel")}</legend>
        {subjects.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("members.noSubjectsYet")}</p>
        ) : (
          <ul className="max-h-64 divide-y overflow-y-auto rounded-md border">
            {subjects.map((subject) => {
              const name = (locale === "hi" && subject.nameHi) || subject.nameEn;
              const checked = assigned.has(subject.nodeId);
              const id = `subject-${subject.nodeId}`;
              return (
                <li key={subject.nodeId} className="flex items-center gap-3 px-3 py-2">
                  <Checkbox
                    id={id}
                    checked={checked}
                    onCheckedChange={(on) => toggle(subject.nodeId, on === true)}
                  />
                  <Label htmlFor={id} className="flex-1 font-normal">
                    {name}
                  </Label>
                  {checked && (
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      {t("members.head")}
                      <Switch
                        size="sm"
                        checked={assigned.get(subject.nodeId) ?? false}
                        onCheckedChange={(isHead) =>
                          setAssigned((current) => new Map(current).set(subject.nodeId, isHead))
                        }
                        aria-label={t("members.headOf", { subject: name })}
                      />
                    </label>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">{t("members.headHint")}</p>
      </fieldset>

      <div className="space-y-2">
        <Label htmlFor="staff-budget">{t("members.budgetLabel")}</Label>
        <Input
          id="staff-budget"
          type="number"
          inputMode="decimal"
          min={0}
          max={100000}
          step="0.01"
          value={budget}
          onChange={(event) => setBudget(event.target.value)}
          className="w-40 tabular-nums"
        />
        <p className="text-xs text-muted-foreground">{t("members.budgetHint")}</p>
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t("members.cancel")}
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? t("members.saving") : t("members.save")}
        </Button>
      </DialogFooter>
    </form>
  );
}

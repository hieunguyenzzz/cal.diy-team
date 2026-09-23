"use client";

import { Dialog } from "@calcom/features/components/controlled-dialog";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { trpc } from "@calcom/trpc/react";
import { Button } from "@calcom/ui/components/button";
import { DialogContent, DialogFooter } from "@calcom/ui/components/dialog";
import { EmailField, Form, Label, Select } from "@calcom/ui/components/form";
import { showToast } from "@calcom/ui/components/toast";
import Link from "next/link";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import type { TeamMemberRole } from "../lib/teamMemberPermissions";

type FormValues = { email: string; role: TeamMemberRole };
type ServerError = { message: string; isUnknownUser: boolean };
type Props = { teamId: number; open: boolean; onOpenChange: (open: boolean) => void };

const ROLES: TeamMemberRole[] = ["MEMBER", "ADMIN", "OWNER"];

// Only rendered for the instance admin: adding people to teams is their job alone (product decision).
export function AddTeamMemberDialog({ teamId, open, onOpenChange }: Props) {
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const [serverError, setServerError] = useState<ServerError | null>(null);
  const form = useForm<FormValues>({ defaultValues: { email: "", role: "MEMBER" } });

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      form.reset();
      setServerError(null);
    }
    onOpenChange(nextOpen);
  };

  const addMember = trpc.viewer.teams.addMember.useMutation({
    onSuccess: async () => {
      showToast(t("team_member_added"), "success");
      await utils.viewer.teams.listMembers.invalidate({ teamId });
      handleOpenChange(false);
    },
    // There is no invitation flow, so an unknown email means the user must be created first.
    onError: (err) => setServerError({ message: err.message, isUnknownUser: err.data?.code === "NOT_FOUND" }),
  });

  const roleOption = (role: TeamMemberRole) => ({ value: role, label: t(role.toLowerCase()) });

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent type="creation" title={t("add_team_member")}>
        <Form
          form={form}
          className="stack-y-4"
          handleSubmit={(values) => {
            setServerError(null);
            addMember.mutate({ teamId, email: values.email, role: values.role });
          }}>
          {serverError && (
            <div role="alert" className="text-error text-sm">
              <p>{serverError.message}</p>
              {serverError.isUnknownUser && (
                <Link href="/settings/admin/users/add" className="font-medium underline">
                  {t("add_new_user")}
                </Link>
              )}
            </div>
          )}
          <EmailField label={t("email_address")} required {...form.register("email")} />
          <Controller
            control={form.control}
            name="role"
            render={({ field: { value, onChange } }) => (
              <div>
                <Label htmlFor="add-team-member-role">{t("role")}</Label>
                <Select
                  inputId="add-team-member-role"
                  isSearchable={false}
                  options={ROLES.map(roleOption)}
                  value={roleOption(value)}
                  onChange={(option) => {
                    if (option) onChange(option.value);
                  }}
                />
              </div>
            )}
          />
          <DialogFooter showDivider>
            <Button type="button" color="secondary" onClick={() => handleOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" loading={addMember.isPending}>
              {t("add")}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

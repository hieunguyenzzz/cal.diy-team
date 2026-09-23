"use client";

import { Dialog } from "@calcom/features/components/controlled-dialog";
import { getUserAvatarUrl } from "@calcom/lib/getAvatarUrl";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import type { RouterOutputs } from "@calcom/trpc/react";
import { trpc } from "@calcom/trpc/react";
import { Avatar } from "@calcom/ui/components/avatar";
import { Badge } from "@calcom/ui/components/badge";
import { Button } from "@calcom/ui/components/button";
import { ConfirmationDialogContent } from "@calcom/ui/components/dialog";
import { Select } from "@calcom/ui/components/form";
import { showToast } from "@calcom/ui/components/toast";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  canChangeRole,
  canLeave,
  canRemove,
  roleOptionsFor,
  type TeamMemberActor,
  type TeamMemberRole,
} from "../lib/teamMemberPermissions";

type Member = RouterOutputs["viewer"]["teams"]["listMembers"][number];
type Props = { teamId: number; member: Member; actor: TeamMemberActor };

export function TeamMemberRow({ teamId, member, actor }: Props) {
  const { t } = useLocale();
  const router = useRouter();
  const utils = trpc.useUtils();
  const [confirming, setConfirming] = useState<"remove" | "leave" | null>(null);
  const isSelf = member.userId === actor.userId;
  const showError = (err: { message: string }) => showToast(err.message, "error");

  const changeRole = trpc.viewer.teams.changeMemberRole.useMutation({
    onSuccess: async () => {
      showToast(t("role_updated_successfully"), "success");
      // The caller's own role may have changed, so refresh the team (which carries it) as well as the list.
      await Promise.all([
        utils.viewer.teams.listMembers.invalidate({ teamId }),
        utils.viewer.teams.get.invalidate({ teamId }),
      ]);
    },
    onError: showError,
  });
  const removeMember = trpc.viewer.teams.removeMember.useMutation({
    onSuccess: async () => {
      setConfirming(null);
      if (isSelf) {
        showToast(t("left_team_successfully"), "success");
        await utils.viewer.teams.list.invalidate();
        router.push("/settings/teams");
        return;
      }
      showToast(t("member_removed"), "success");
      await utils.viewer.teams.listMembers.invalidate({ teamId });
    },
    onError: showError,
  });

  const roleOption = (role: TeamMemberRole) => ({ value: role, label: t(role.toLowerCase()) });

  return (
    <li className="flex items-center justify-between gap-4 border-subtle border-b px-5 py-4 last:border-b-0">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar size="md" alt={member.name ?? member.username ?? ""} imageSrc={getUserAvatarUrl(member)} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate font-semibold text-emphasis text-sm">{member.name ?? member.username}</p>
            {isSelf && <Badge variant="gray">{t("you")}</Badge>}
            {!member.accepted && <Badge variant="orange">{t("pending")}</Badge>}
          </div>
          <p className="truncate text-subtle text-xs">
            {member.username && `@${member.username}`}
            {member.email && <span className="ms-2">{member.email}</span>}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {canChangeRole(actor, member) ? (
          <div className="w-32">
            <Select
              aria-label={t("role")}
              isSearchable={false}
              isDisabled={changeRole.isPending}
              options={roleOptionsFor(actor).map(roleOption)}
              value={roleOption(member.role)}
              onChange={(option) => {
                if (option && option.value !== member.role) {
                  changeRole.mutate({ teamId, userId: member.userId, role: option.value });
                }
              }}
            />
          </div>
        ) : (
          <Badge variant="gray">{t(member.role.toLowerCase())}</Badge>
        )}
        {canRemove(actor, member) && (
          <Button
            color="destructive"
            variant="icon"
            StartIcon="trash"
            onClick={() => setConfirming("remove")}>
            {t("remove")}
          </Button>
        )}
        {canLeave(actor, member) && (
          <Button color="secondary" size="sm" onClick={() => setConfirming("leave")}>
            {t("leave")}
          </Button>
        )}
      </div>
      <Dialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <ConfirmationDialogContent
          variety="danger"
          title={t(confirming === "leave" ? "leave_team" : "remove_member")}
          confirmBtnText={t(confirming === "leave" ? "leave_team" : "remove_member")}
          isPending={removeMember.isPending}
          onConfirm={() => removeMember.mutate({ teamId, userId: member.userId })}>
          {t(
            confirming === "leave" ? "leave_team_confirmation_message" : "remove_member_confirmation_message"
          )}
        </ConfirmationDialogContent>
      </Dialog>
    </li>
  );
}

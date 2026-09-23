"use client";

import SettingsHeader from "@calcom/features/settings/appDir/SettingsHeader";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { trpc } from "@calcom/trpc/react";
import { Button } from "@calcom/ui/components/button";
import { EmptyScreen } from "@calcom/ui/components/empty-screen";
import { SkeletonText } from "@calcom/ui/components/skeleton";
import { useState } from "react";
import { AddTeamMemberDialog } from "../components/AddTeamMemberDialog";
import { TeamMemberRow } from "../components/TeamMemberRow";

type Props = { teamId: number; currentUserId: number; isInstanceAdmin: boolean };

export default function TeamMembersView({ teamId, currentUserId, isInstanceAdmin }: Props) {
  const { t } = useLocale();
  const [isAddOpen, setIsAddOpen] = useState(false);
  // teams.get answers access (FORBIDDEN/NOT_FOUND) and carries the caller's role; both are final, so no retry.
  const team = trpc.viewer.teams.get.useQuery({ teamId }, { retry: false });
  const members = trpc.viewer.teams.listMembers.useQuery({ teamId }, { enabled: !!team.data, retry: false });
  const error = team.error ?? members.error;

  const addButton = isInstanceAdmin ? (
    <Button color="secondary" StartIcon="plus" size="sm" onClick={() => setIsAddOpen(true)}>
      {t("add_team_member")}
    </Button>
  ) : null;

  return (
    <SettingsHeader
      title={t("team_members")}
      description={team.data?.name ?? ""}
      CTA={error ? null : addButton}
      borderInShellHeader>
      {error ? (
        <EmptyScreen
          Icon={error.data?.code === "NOT_FOUND" ? "users" : "lock"}
          headline={t(error.data?.code === "NOT_FOUND" ? "team_not_found" : "dont_have_access_this_page")}
          className="rounded-t-none rounded-b-lg border-t-0"
          buttonRaw={
            <Button color="secondary" href="/settings/teams">
              {t("all_teams")}
            </Button>
          }
        />
      ) : !team.data || !members.data ? (
        <SkeletonText className="h-40 w-full" />
      ) : (
        <ul className="rounded-b-lg border border-subtle border-t-0">
          {members.data.map((member) => (
            <TeamMemberRow
              key={member.userId}
              teamId={teamId}
              member={member}
              actor={{ userId: currentUserId, role: team.data.role, isInstanceAdmin }}
            />
          ))}
        </ul>
      )}
      {isInstanceAdmin && (
        <AddTeamMemberDialog teamId={teamId} open={isAddOpen} onOpenChange={setIsAddOpen} />
      )}
    </SettingsHeader>
  );
}

"use client";

import SettingsHeader from "@calcom/features/settings/appDir/SettingsHeader";
import { getPlaceholderAvatar } from "@calcom/lib/defaultAvatarImage";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { trpc } from "@calcom/trpc/react";
import { Avatar } from "@calcom/ui/components/avatar";
import { Badge } from "@calcom/ui/components/badge";
import { Button } from "@calcom/ui/components/button";
import { EmptyScreen } from "@calcom/ui/components/empty-screen";
import { SkeletonText } from "@calcom/ui/components/skeleton";
import { useState } from "react";
import { CreateTeamDialog } from "../components/CreateTeamDialog";
import { canManageTeam, type ListedTeam } from "../lib/canManageTeam";

function TeamRow({ team, isInstanceAdmin }: { team: ListedTeam; isInstanceAdmin: boolean }) {
  const { t } = useLocale();

  return (
    <li className="flex items-center justify-between gap-4 border-subtle border-b px-5 py-4 last:border-b-0">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar size="md" alt={team.name} imageSrc={getPlaceholderAvatar(team.logoUrl, team.name)} />
        <div className="min-w-0">
          <p className="truncate font-semibold text-emphasis text-sm">{team.name}</p>
          <p className="truncate text-subtle text-xs">/team/{team.slug}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {team.role !== null && <Badge variant="gray">{t(team.role.toLowerCase())}</Badge>}
        {team.memberCount !== null && (
          <Badge variant="gray">{t("number_member", { count: team.memberCount })}</Badge>
        )}
        {canManageTeam(team, isInstanceAdmin) && (
          <>
            <Button color="secondary" size="sm" href={`/settings/teams/${team.id}/members`}>
              {t("members")}
            </Button>
            <Button color="secondary" size="sm" href={`/settings/teams/${team.id}/profile`}>
              {t("edit")}
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

export default function TeamsListView({ isInstanceAdmin }: { isInstanceAdmin: boolean }) {
  const { t } = useLocale();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const { data: teams, isPending } = trpc.viewer.teams.list.useQuery();

  const createButton = isInstanceAdmin ? (
    <Button color="secondary" StartIcon="plus" size="sm" onClick={() => setIsCreateOpen(true)}>
      {t("create_team")}
    </Button>
  ) : null;

  return (
    <SettingsHeader
      title={t("teams")}
      description={t("create_manage_teams_collaborative")}
      CTA={createButton}
      borderInShellHeader>
      {isPending ? (
        <SkeletonText className="h-20 w-full" />
      ) : teams?.length ? (
        <ul className="rounded-b-lg border border-subtle border-t-0">
          {teams.map((team) => (
            <TeamRow key={team.id} team={team} isInstanceAdmin={isInstanceAdmin} />
          ))}
        </ul>
      ) : (
        <EmptyScreen
          Icon="users"
          headline={t("no_teams")}
          description={t(isInstanceAdmin ? "create_team_to_get_started" : "teams_added_by_instance_admin")}
          className="rounded-t-none rounded-b-lg border-t-0"
          buttonRaw={createButton}
        />
      )}
      {isInstanceAdmin && <CreateTeamDialog open={isCreateOpen} onOpenChange={setIsCreateOpen} />}
    </SettingsHeader>
  );
}

"use client";

import { useLocale } from "@calcom/lib/hooks/useLocale";
import { trpc } from "@calcom/trpc/react";
import { Icon } from "@calcom/ui/components/icon";
import { VerticalTabItem } from "@calcom/ui/components/navigation";
import { canManageTeam } from "../lib/canManageTeam";

const linkClassName = "h-auto min-h-7 w-fit px-2! py-1!";

// Rendered apart from the static settings tabs because team names are user data: the tab list runs every
// name through t(), which would treat a name such as "Sales.EU" as a translation key.
export function TeamsSettingsNav({ isInstanceAdmin }: { isInstanceAdmin: boolean }) {
  const { t } = useLocale();
  const { data: teams = [] } = trpc.viewer.teams.list.useQuery();
  const manageableTeams = teams.filter((team) => canManageTeam(team, isInstanceAdmin));

  return (
    <div className="mb-3!">
      <div className="group flex h-7 w-full flex-row items-center rounded-md px-2 font-medium text-default text-sm leading-none">
        <Icon name="users" className="h-[16px] w-[16px] stroke-[2px] text-subtle md:mt-0 ltr:mr-3 rtl:ml-3" />
        <p className="truncate font-medium text-sm text-subtle leading-5">{t("teams")}</p>
      </div>
      <div className="flex flex-col space-y-1">
        <VerticalTabItem
          name={t("teams")}
          href="/settings/teams"
          textClassNames="text-emphasis font-medium text-sm"
          className={linkClassName}
          disableChevron
        />
        {manageableTeams.map((team) => (
          <div key={team.id} className="flex flex-col space-y-1">
            <p className="truncate px-2 pt-2 text-subtle text-xs">{team.name}</p>
            <VerticalTabItem
              name={t("profile")}
              href={`/settings/teams/${team.id}/profile`}
              textClassNames="text-emphasis font-medium text-sm"
              className={linkClassName}
              disableChevron
            />
            <VerticalTabItem
              name={t("members")}
              href={`/settings/teams/${team.id}/members`}
              textClassNames="text-emphasis font-medium text-sm"
              className={linkClassName}
              disableChevron
            />
          </div>
        ))}
      </div>
    </div>
  );
}

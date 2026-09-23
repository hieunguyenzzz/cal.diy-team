import type { RouterOutputs } from "@calcom/trpc/react";

type ListedTeam = RouterOutputs["viewer"]["teams"]["list"][number];

// The caller's own accepted ADMIN/OWNER membership; the list only carries accepted memberships.
export function isTeamAdminOrOwner(team: Pick<ListedTeam, "role">): boolean {
  return team.role === "ADMIN" || team.role === "OWNER";
}

// Mirrors TeamService: profile and member management need team ADMIN/OWNER, or the instance admin.
export function canManageTeam(team: Pick<ListedTeam, "role">, isInstanceAdmin: boolean): boolean {
  return isInstanceAdmin || isTeamAdminOrOwner(team);
}

export type { ListedTeam };

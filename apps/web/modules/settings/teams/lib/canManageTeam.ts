import type { RouterOutputs } from "@calcom/trpc/react";

type ListedTeam = RouterOutputs["viewer"]["teams"]["list"][number];

// Mirrors TeamService: profile and member management need team ADMIN/OWNER, or the instance admin.
export function canManageTeam(team: Pick<ListedTeam, "role">, isInstanceAdmin: boolean): boolean {
  return isInstanceAdmin || team.role === "ADMIN" || team.role === "OWNER";
}

export type { ListedTeam };

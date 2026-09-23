import { roleCanManageTeamEventType } from "@calcom/features/teams/services/TeamPermissionService";
import type { Membership, Team } from "@calcom/prisma/client";

type TeamMembershipWithTeam = Membership & {
  team: Team & {
    parent?: {
      id: number;
      name: string;
      slug: string | null;
      logoUrl: string | null;
      parentId: number | null;
      metadata: any;
    } | null;
  };
};

export class TeamAccessUseCase {
  async filterTeamsByEventTypeReadPermission(
    memberships: TeamMembershipWithTeam[],
    _userId: number
  ): Promise<TeamMembershipWithTeam[]> {
    // The memberships already belong to the user, so the role on each row is all the check needs.
    return memberships.filter(
      (membership) =>
        !membership.team.isOrganization &&
        membership.accepted &&
        roleCanManageTeamEventType(membership.role, "read")
    );
  }
}

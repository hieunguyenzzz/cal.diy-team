import { MembershipRepository } from "@calcom/features/membership/repositories/MembershipRepository";
import { TEAM_ADMIN_ROLES } from "@calcom/features/teams/lib/teamEventTypeRoles";
import { TeamPermissionService } from "@calcom/features/teams/services/TeamPermissionService";
import prisma from "@calcom/prisma";

// Team ADMIN/OWNERs may manage out-of-office entries for members of their teams.
export const isAdminForUser = async (adminUserId: number, memberUserId: number) => {
  const adminTeamIds = await new TeamPermissionService(new MembershipRepository(prisma)).getTeamIdsWithRole({
    userId: adminUserId,
    // Deliberately no instance-admin override: OOO is managed only by admins of the member's team.
    userRole: undefined,
    roles: TEAM_ADMIN_ROLES,
  });

  if (adminTeamIds.length === 0) {
    return false;
  }

  const member = await prisma.membership.findFirst({
    where: {
      userId: memberUserId,
      accepted: true,
      teamId: {
        in: adminTeamIds,
      },
    },
    select: {
      id: true,
    },
  });

  return !!member?.id;
};

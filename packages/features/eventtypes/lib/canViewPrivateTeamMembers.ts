import { MembershipRepository } from "@calcom/features/membership/repositories/MembershipRepository";
import { TeamPermissionService } from "@calcom/features/teams/services/TeamPermissionService";
import { UserRepository } from "@calcom/features/users/repositories/UserRepository";
import type { PrismaClient } from "@calcom/prisma";
import { MembershipRole } from "@calcom/prisma/enums";

// Only team admins see a private team's members; parent orgs grant nothing because this fork has no orgs.
export async function canViewPrivateTeamMembers({
  prisma,
  currentUserId,
  teamId,
}: {
  prisma: PrismaClient;
  currentUserId: number | undefined;
  teamId: number;
}): Promise<boolean> {
  if (!currentUserId) return false;

  const userRole = (await new UserRepository(prisma).findRoleById({ id: currentUserId }))?.role;
  return new TeamPermissionService(new MembershipRepository(prisma)).hasTeamRole({
    userId: currentUserId,
    userRole,
    teamId,
    roles: [MembershipRole.ADMIN, MembershipRole.OWNER],
  });
}

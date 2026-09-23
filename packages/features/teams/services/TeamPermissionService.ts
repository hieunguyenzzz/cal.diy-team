import type { MembershipRepository } from "@calcom/features/membership/repositories/MembershipRepository";
import {
  ALL_ROLES,
  EVENT_TYPE_ACTION_ROLES,
  roleAllowsTeamEventTypeAction,
  rolesForTeamPermission,
  TEAM_ADMIN_ROLES,
  type TeamEventTypeAction,
  toTeamEventTypeAction,
} from "@calcom/features/teams/lib/teamEventTypeRoles";
import type { MembershipRole } from "@calcom/prisma/enums";
import { UserPermissionRole } from "@calcom/prisma/enums";

type TeamPermissionCheck = {
  userId: number;
  userRole: UserPermissionRole | null | undefined;
  teamId: number;
};

export class TeamPermissionService {
  constructor(private readonly membershipRepository: MembershipRepository) {}

  async hasTeamRole({
    userId,
    userRole,
    teamId,
    roles,
  }: TeamPermissionCheck & { roles: readonly MembershipRole[] }): Promise<boolean> {
    if (userRole === UserPermissionRole.ADMIN) return true;

    const membership = await this.membershipRepository.findRoleAndAcceptedByUserIdAndTeamId({
      userId,
      teamId,
    });
    if (!membership?.accepted) return false;

    return roles.includes(membership.role);
  }

  async hasTeamRoleInAnyTeam({
    userId,
    userRole,
    teamIds,
    roles,
  }: Omit<TeamPermissionCheck, "teamId"> & {
    teamIds: number[];
    roles: readonly MembershipRole[];
  }): Promise<boolean> {
    if (teamIds.length === 0) return false;
    if (userRole === UserPermissionRole.ADMIN) return true;

    const membership = await this.membershipRepository.findFirstAcceptedByUserIdAndTeamIdsAndRoles({
      userId,
      teamIds,
      roles,
    });
    return !!membership;
  }

  async getTeamIdsWithRole({
    userId,
    userRole,
    roles,
  }: Omit<TeamPermissionCheck, "teamId"> & { roles: readonly MembershipRole[] }): Promise<number[]> {
    // The instance admin acts as an admin in every team they have an accepted membership in.
    const effectiveRoles = userRole === UserPermissionRole.ADMIN ? ALL_ROLES : roles;
    const memberships = await this.membershipRepository.findAcceptedTeamIdsByUserIdAndRoles({
      userId,
      roles: effectiveRoles,
    });
    return memberships.map((membership) => membership.teamId);
  }

  async getTeamIdsForEventTypeAction({
    action,
    ...check
  }: Omit<TeamPermissionCheck, "teamId"> & { action: TeamEventTypeAction }): Promise<number[]> {
    return this.getTeamIdsWithRole({ ...check, roles: EVENT_TYPE_ACTION_ROLES[action] });
  }

  async canPerformTeamEventTypeAction({
    action,
    ...check
  }: TeamPermissionCheck & { action: TeamEventTypeAction }): Promise<boolean> {
    return this.hasTeamRole({ ...check, roles: EVENT_TYPE_ACTION_ROLES[action] });
  }

  async hasEventTypePermission({
    permission,
    ...check
  }: TeamPermissionCheck & { permission: string }): Promise<boolean> {
    const action = toTeamEventTypeAction(permission);
    if (!action) return false;

    return this.canPerformTeamEventTypeAction({ ...check, action });
  }
}

// Re-exported so existing callers keep importing from the service.
export { roleAllowsTeamEventTypeAction, rolesForTeamPermission, TEAM_ADMIN_ROLES, toTeamEventTypeAction };
export type { TeamEventTypeAction };

import { roleAllowsTeamEventTypeAction } from "@calcom/features/teams/services/TeamPermissionService";
import { MembershipRole, UserPermissionRole } from "@calcom/prisma/enums";

export interface TeamPermissions {
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canRead: boolean;
}

export interface MembershipWithRole {
  teamId: number;
  membershipRole: MembershipRole;
}

const MEMBERSHIP_HIERARCHY: Record<MembershipRole, number> = {
  [MembershipRole.MEMBER]: 1,
  [MembershipRole.ADMIN]: 2,
  [MembershipRole.OWNER]: 3,
};

export function hasHigherPrivilege(role1: MembershipRole, role2: MembershipRole): boolean {
  return MEMBERSHIP_HIERARCHY[role1] > MEMBERSHIP_HIERARCHY[role2];
}

export function getEffectiveRole(
  orgMembership: MembershipRole | undefined,
  membershipRole: MembershipRole
): MembershipRole {
  return orgMembership && hasHigherPrivilege(orgMembership, membershipRole) ? orgMembership : membershipRole;
}

export function getTeamPermissions(
  effectiveRole: MembershipRole,
  userRole?: UserPermissionRole | null
): TeamPermissions {
  // Same rule as TeamPermissionService.hasTeamRole: the instance admin may do everything in any team.
  if (userRole === UserPermissionRole.ADMIN) {
    return { canRead: true, canCreate: true, canEdit: true, canDelete: true };
  }
  return {
    canRead: roleAllowsTeamEventTypeAction(effectiveRole, "read"),
    canCreate: roleAllowsTeamEventTypeAction(effectiveRole, "create"),
    canEdit: roleAllowsTeamEventTypeAction(effectiveRole, "update"),
    canDelete: roleAllowsTeamEventTypeAction(effectiveRole, "delete"),
  };
}

export function buildTeamPermissionsMap(
  memberships: Array<{ team: { id: number; parentId?: number | null }; role: MembershipRole }>,
  teamMemberships: MembershipWithRole[],
  userRole?: UserPermissionRole | null
): Map<number, TeamPermissions> {
  const roleByTeamId = new Map(teamMemberships.map((teamM) => [teamM.teamId, teamM.membershipRole]));

  return new Map(
    memberships.map((membership) => {
      const orgMembership =
        membership.team.parentId == null ? undefined : roleByTeamId.get(membership.team.parentId);
      const effectiveRole = getEffectiveRole(orgMembership, membership.role);

      return [membership.team.id, getTeamPermissions(effectiveRole, userRole)] as const;
    })
  );
}

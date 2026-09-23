import { roleCanManageTeamEventType } from "@calcom/features/teams/services/TeamPermissionService";
import { MembershipRole } from "@calcom/prisma/enums";

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

export function getTeamPermissions(effectiveRole: MembershipRole): TeamPermissions {
  return {
    canRead: roleCanManageTeamEventType(effectiveRole, "read"),
    canCreate: roleCanManageTeamEventType(effectiveRole, "create"),
    canEdit: roleCanManageTeamEventType(effectiveRole, "update"),
    canDelete: roleCanManageTeamEventType(effectiveRole, "delete"),
  };
}

export async function buildTeamPermissionsMap(
  memberships: Array<{ team: { id: number; parentId?: number | null }; role: MembershipRole }>,
  teamMemberships: MembershipWithRole[],
  _userId: number
): Promise<Map<number, TeamPermissions>> {
  const permissionPromises = memberships.map(async (membership) => {
    const orgMembership = teamMemberships.find(
      (teamM) => teamM.teamId === membership.team.parentId
    )?.membershipRole;

    const effectiveRole = getEffectiveRole(orgMembership, membership.role);
    const permissions = getTeamPermissions(effectiveRole);

    return [membership.team.id, permissions] as const;
  });

  const results = await Promise.all(permissionPromises);
  return new Map(results);
}

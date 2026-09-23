import type { MembershipRepository } from "@calcom/features/membership/repositories/MembershipRepository";
import { MembershipRole, UserPermissionRole } from "@calcom/prisma/enums";

type TeamEventTypeAction = "create" | "read" | "update" | "delete";

const TEAM_ADMIN_ROLES: readonly MembershipRole[] = [MembershipRole.ADMIN, MembershipRole.OWNER];

const ALL_ROLES: readonly MembershipRole[] = [
  MembershipRole.MEMBER,
  MembershipRole.ADMIN,
  MembershipRole.OWNER,
];

const EVENT_TYPE_ACTION_ROLES: Record<TeamEventTypeAction, readonly MembershipRole[]> = {
  create: ALL_ROLES,
  read: ALL_ROLES,
  update: ALL_ROLES,
  delete: TEAM_ADMIN_ROLES,
};

// A Map rather than an object literal so inherited keys like "constructor" can never resolve to an action.
const PERMISSION_TO_ACTION = new Map<string, TeamEventTypeAction>([
  ["eventType.create", "create"],
  ["eventType.read", "read"],
  ["eventType.update", "update"],
  ["eventType.delete", "delete"],
]);

// Team-scoped permissions checked by role alone (no event-type action); unknown permissions get no roles.
const PERMISSION_TEAM_ROLES = new Map<string, readonly MembershipRole[]>([
  ["webhook.create", TEAM_ADMIN_ROLES],
]);

type TeamPermissionCheck = {
  userId: number;
  userRole: UserPermissionRole | null | undefined;
  teamId: number;
};

export function toTeamEventTypeAction(permission: string): TeamEventTypeAction | null {
  return PERMISSION_TO_ACTION.get(permission) ?? null;
}

export function rolesForTeamPermission(permission: string): readonly MembershipRole[] {
  return PERMISSION_TEAM_ROLES.get(permission) ?? [];
}

export function roleAllowsTeamEventTypeAction(role: MembershipRole, action: TeamEventTypeAction): boolean {
  return EVENT_TYPE_ACTION_ROLES[action].includes(role);
}

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

export { TEAM_ADMIN_ROLES };
export type { TeamEventTypeAction };

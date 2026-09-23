import type { MembershipRepository } from "@calcom/features/membership/repositories/MembershipRepository";
import { MembershipRole, UserPermissionRole } from "@calcom/prisma/enums";

type TeamEventTypeAction = "create" | "read" | "update" | "delete";

const ALL_ROLES: readonly MembershipRole[] = [
  MembershipRole.MEMBER,
  MembershipRole.ADMIN,
  MembershipRole.OWNER,
];

const EVENT_TYPE_ACTION_ROLES: Record<TeamEventTypeAction, readonly MembershipRole[]> = {
  create: ALL_ROLES,
  read: ALL_ROLES,
  update: ALL_ROLES,
  delete: [MembershipRole.ADMIN, MembershipRole.OWNER],
};

// A Map rather than an object literal so inherited keys like "constructor" can never resolve to an action.
const PERMISSION_TO_ACTION = new Map<string, TeamEventTypeAction>([
  ["eventType.create", "create"],
  ["eventType.read", "read"],
  ["eventType.update", "update"],
  ["eventType.delete", "delete"],
]);

type TeamPermissionCheck = {
  userId: number;
  userRole: UserPermissionRole | null | undefined;
  teamId: number;
};

export function toTeamEventTypeAction(permission: string): TeamEventTypeAction | null {
  return PERMISSION_TO_ACTION.get(permission) ?? null;
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

export type { TeamEventTypeAction };

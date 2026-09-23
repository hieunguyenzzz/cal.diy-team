import type { UserPermissionRole } from "@calcom/prisma/enums";
import { MembershipRole } from "@calcom/prisma/enums";

// Pure role tables with no repository imports, so the server and the web client share one rule.
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

export function toTeamEventTypeAction(permission: string): TeamEventTypeAction | null {
  return PERMISSION_TO_ACTION.get(permission) ?? null;
}

export function rolesForTeamPermission(permission: string): readonly MembershipRole[] {
  return PERMISSION_TEAM_ROLES.get(permission) ?? [];
}

export function roleAllowsTeamEventTypeAction(role: MembershipRole, action: TeamEventTypeAction): boolean {
  return EVENT_TYPE_ACTION_ROLES[action].includes(role);
}

export { ALL_ROLES, EVENT_TYPE_ACTION_ROLES, TEAM_ADMIN_ROLES };
// The role a session user can carry; INACTIVE_ADMIN is an admin who has not re-verified yet.
type SessionUserRole = UserPermissionRole | "INACTIVE_ADMIN";

export type { SessionUserRole, TeamEventTypeAction };

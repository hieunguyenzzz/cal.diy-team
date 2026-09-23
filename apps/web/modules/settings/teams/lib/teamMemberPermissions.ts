import { TEAM_ADMIN_ROLES, TEAM_OWNER_ROLES } from "@calcom/features/teams/lib/teamEventTypeRoles";
import { MembershipRole } from "@calcom/prisma/enums";

type Role = MembershipRole;
type Actor = { userId: number; role: Role | null; isInstanceAdmin: boolean };
type Member = { userId: number; role: Role; accepted: boolean };

// These mirror TeamService's rules so the UI only offers actions the server will accept; the server
// still enforces them, including the last-owner guard, which needs the full member count.
const isTeamManager = (actor: Actor) =>
  actor.isInstanceAdmin || (actor.role !== null && TEAM_ADMIN_ROLES.includes(actor.role));
const canTouchOwners = (actor: Actor) =>
  actor.isInstanceAdmin || (actor.role !== null && TEAM_OWNER_ROLES.includes(actor.role));

export function roleOptionsFor(actor: Actor): Role[] {
  return canTouchOwners(actor)
    ? [MembershipRole.MEMBER, MembershipRole.ADMIN, MembershipRole.OWNER]
    : [MembershipRole.MEMBER, MembershipRole.ADMIN];
}

export function canChangeRole(actor: Actor, member: Member): boolean {
  return isTeamManager(actor) && (member.role !== MembershipRole.OWNER || canTouchOwners(actor));
}

export function canRemove(actor: Actor, member: Member): boolean {
  if (member.userId === actor.userId) return false;
  return isTeamManager(actor) && (member.role !== MembershipRole.OWNER || canTouchOwners(actor));
}

export function canLeave(actor: Actor, member: Member): boolean {
  return member.userId === actor.userId && member.accepted;
}

export type { Actor as TeamMemberActor, Role as TeamMemberRole };

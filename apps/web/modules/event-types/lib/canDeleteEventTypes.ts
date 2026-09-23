import {
  roleAllowsTeamEventTypeAction,
  type SessionUserRole,
} from "@calcom/features/teams/lib/teamEventTypeRoles";
import type { MembershipRole } from "@calcom/prisma/enums";
import { UserPermissionRole } from "@calcom/prisma/enums";

type ProfileDeletePermission = {
  teamId?: number | null;
  canDeleteEventTypes?: boolean;
};

// Mirrors the server rule so a MEMBER is not offered Delete on team event types it would reject.
export function canDeleteEventTypesInGroup(
  profiles: ProfileDeletePermission[],
  teamId: number | null | undefined
): boolean {
  if (!teamId) return true;
  return profiles.find((profile) => profile.teamId === teamId)?.canDeleteEventTypes === true;
}

// Same rule for the single event-type page, which has the viewer's membership but no profiles list.
// Without a userRole (platform atoms pass none) only the membership decides.
export function canDeleteEventType({
  teamId,
  currentUserMembership,
  userRole,
}: {
  teamId: number | null | undefined;
  currentUserMembership: { role: MembershipRole; accepted: boolean } | null | undefined;
  userRole: SessionUserRole | null | undefined;
}): boolean {
  if (!teamId) return true;
  if (userRole === UserPermissionRole.ADMIN) return true;
  if (!currentUserMembership?.accepted) return false;
  return roleAllowsTeamEventTypeAction(currentUserMembership.role, "delete");
}

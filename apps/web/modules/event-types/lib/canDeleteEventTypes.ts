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

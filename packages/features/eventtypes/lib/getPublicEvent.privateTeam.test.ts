import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";

import type { PrismaClient } from "@calcom/prisma";
import { MembershipRole, UserPermissionRole } from "@calcom/prisma/enums";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPublicEvent } from "./getPublicEvent";

vi.mock("@calcom/prisma", () => ({
  default: prismaMock,
}));

type Result<T extends (...args: never[]) => unknown> = Awaited<ReturnType<T>>;

const hostUser = {
  id: 7,
  username: "host",
  name: "Hidden Host",
  avatarUrl: null,
  weekStart: "Monday",
  brandColor: null,
  darkBrandColor: null,
  theme: null,
  metadata: {},
  defaultScheduleId: null,
};

const privateTeamEvent = {
  id: 1,
  title: "Private team event",
  slug: "intro",
  length: 30,
  description: null,
  metadata: {},
  locations: [],
  bookingFields: [],
  customInputs: [],
  recurringEvent: null,
  isInstantEvent: false,
  instantMeetingSchedule: null,
  instantMeetingParameters: [],
  schedule: { id: 3, timeZone: "Europe/London" },
  // Team events can still carry an owner (e.g. the creator); it is a member identity like hosts.
  owner: { ...hostUser, id: 8, username: "owner", name: "Hidden Owner" },
  parent: null,
  teamId: 10,
  team: {
    id: 10,
    name: "Private team",
    slug: "private-team",
    isPrivate: true,
    metadata: {},
    logoUrl: null,
    parent: null,
    parentId: null,
    brandColor: null,
    darkBrandColor: null,
    theme: null,
    hideTeamProfileLink: false,
  },
  hosts: [{ user: hostUser }],
  users: [],
  assignAllTeamMembers: false,
  disableCancelling: false,
  disableRescheduling: false,
  allowReschedulingCancelledBookings: false,
  interfaceLanguage: null,
};

const loadAsViewer = (currentUserId: number | undefined) =>
  getPublicEvent(
    "private-team",
    "intro",
    true,
    null,
    prismaMock as unknown as PrismaClient,
    false,
    currentUserId,
    true
  );

const givenViewer = (
  userRole: UserPermissionRole,
  membership: { role: MembershipRole; accepted: boolean } | null
) => {
  prismaMock.user.findUnique.mockResolvedValue({ role: userRole } as Result<
    typeof prismaMock.user.findUnique
  >);
  prismaMock.membership.findUnique.mockResolvedValue(
    membership as Result<typeof prismaMock.membership.findUnique>
  );
};

describe("getPublicEvent on a private team", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.eventType.findFirst.mockResolvedValue(
      privateTeamEvent as unknown as Result<typeof prismaMock.eventType.findFirst>
    );
    // enrichUsersWithTheirProfiles looks up profiles; none exist in this fixture.
    prismaMock.profile.findMany.mockResolvedValue([]);
  });

  it.each([
    ["an anonymous visitor", undefined, null],
    ["a MEMBER", 5, { role: MembershipRole.MEMBER, accepted: true }],
  ])("hides users, subsetOfHosts and hosts from %s", async (_label, currentUserId, membership) => {
    givenViewer(UserPermissionRole.USER, membership);

    const event = await loadAsViewer(currentUserId);

    expect(event?.subsetOfUsers).toEqual([]);
    expect(event?.users).toEqual([]);
    expect(event?.subsetOfHosts).toEqual([]);
    expect(event?.hosts).toEqual([]);
    expect(event?.owner).toBeNull();
    expect(JSON.stringify(event)).not.toContain("Hidden Host");
    expect(JSON.stringify(event)).not.toContain("Hidden Owner");
    expect(event?.profile).toMatchObject({ name: "Private team" });
  });

  it("shows them to an accepted team ADMIN", async () => {
    givenViewer(UserPermissionRole.USER, { role: MembershipRole.ADMIN, accepted: true });

    const event = await loadAsViewer(5);

    expect(event?.subsetOfHosts).toHaveLength(1);
    expect(event?.hosts).toHaveLength(1);
    expect(event?.owner).toMatchObject({ username: "owner" });
    expect(event?.subsetOfUsers).toEqual([expect.objectContaining({ username: "host" })]);
  });
});

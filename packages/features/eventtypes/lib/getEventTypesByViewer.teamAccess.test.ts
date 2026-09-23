import { MembershipRole, SchedulingType } from "@calcom/prisma/enums";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getEventTypesByViewer } from "./getEventTypesByViewer";

const { mockFindAllByUpIdIncludeTeamWithMembersAndEventTypes, mockFindAcceptedTeamIdsByUserIdAndRoles } =
  vi.hoisted(() => ({
    mockFindAllByUpIdIncludeTeamWithMembersAndEventTypes: vi.fn(),
    mockFindAcceptedTeamIdsByUserIdAndRoles: vi.fn(),
  }));

vi.mock("@calcom/prisma", () => ({ default: {}, prisma: {} }));
vi.mock("@calcom/features/profile/repositories/ProfileRepository", () => ({
  ProfileRepository: {
    findByUpIdWithAuth: vi.fn().mockResolvedValue({
      username: "me",
      name: "Me",
      avatarUrl: null,
      organizationId: null,
      organization: null,
    }),
  },
}));
vi.mock("@calcom/features/membership/repositories/MembershipRepository", () => ({
  MembershipRepository: class {
    static findAllByUpIdIncludeTeamWithMembersAndEventTypes =
      mockFindAllByUpIdIncludeTeamWithMembersAndEventTypes;
    findAcceptedTeamIdsByUserIdAndRoles = mockFindAcceptedTeamIdsByUserIdAndRoles;
  },
}));
vi.mock("@calcom/features/eventtypes/repositories/eventTypeRepository", () => ({
  EventTypeRepository: class {
    findAllByUpId = vi.fn().mockResolvedValue([]);
  },
}));
vi.mock("@calcom/features/users/repositories/UserRepository", () => ({
  UserRepository: class {
    enrichUsersWithTheirProfiles = vi.fn(async (users: unknown[]) => users);
  },
}));

const teamEventType = (id: number, schedulingType: SchedulingType) => ({
  id,
  userId: null,
  schedulingType,
  description: null,
  metadata: null,
  hosts: [],
  users: [],
  children: [],
});

const loadGroups = () => getEventTypesByViewer({ id: 1, profile: { upId: "usr-1" } });

describe("getEventTypesByViewer team access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindAllByUpIdIncludeTeamWithMembersAndEventTypes.mockResolvedValue([
      {
        role: MembershipRole.MEMBER,
        team: {
          id: 10,
          name: "Team",
          slug: "team",
          logoUrl: null,
          parentId: null,
          parent: null,
          isOrganization: false,
          metadata: {},
          members: [{ userId: 1 }],
          eventTypes: [
            teamEventType(1, SchedulingType.ROUND_ROBIN),
            teamEventType(2, SchedulingType.MANAGED),
          ],
        },
      },
    ]);
  });

  it("shows a MEMBER's team group as writable, managed event types included", async () => {
    mockFindAcceptedTeamIdsByUserIdAndRoles.mockResolvedValue([{ teamId: 10 }]);

    const { eventTypeGroups } = await loadGroups();
    const teamGroup = eventTypeGroups.find((group) => group.teamId === 10);

    expect(teamGroup?.metadata.readOnly).toBe(false);
    expect(teamGroup?.eventTypes.map((eventType) => eventType.id)).toEqual([1, 2]);
    expect(mockFindAcceptedTeamIdsByUserIdAndRoles).toHaveBeenCalledWith({
      userId: 1,
      roles: [MembershipRole.MEMBER, MembershipRole.ADMIN, MembershipRole.OWNER],
    });
  });

  it("keeps a team read-only and hides managed event types without the permission", async () => {
    mockFindAcceptedTeamIdsByUserIdAndRoles.mockResolvedValue([]);

    const { eventTypeGroups } = await loadGroups();
    const teamGroup = eventTypeGroups.find((group) => group.teamId === 10);

    expect(teamGroup?.metadata.readOnly).toBe(true);
    expect(teamGroup?.eventTypes.map((eventType) => eventType.id)).toEqual([1]);
  });
});

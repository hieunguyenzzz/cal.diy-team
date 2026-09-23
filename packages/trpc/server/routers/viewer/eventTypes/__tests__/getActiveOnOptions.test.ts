import type { PrismaClient } from "@calcom/prisma";
import { MembershipRole, SchedulingType, UserPermissionRole } from "@calcom/prisma/enums";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getActiveOnOptions } from "../getActiveOnOptions.handler";

const { mockFindAllByUpIdIncludeMinimalEventTypes, mockFindAcceptedTeamIdsByUserIdAndRoles } = vi.hoisted(
  () => ({
    mockFindAllByUpIdIncludeMinimalEventTypes: vi.fn(),
    mockFindAcceptedTeamIdsByUserIdAndRoles: vi.fn(),
  })
);

vi.mock("@calcom/lib/checkRateLimitAndThrowError", () => ({ checkRateLimitAndThrowError: vi.fn() }));
vi.mock("@calcom/features/profile/repositories/ProfileRepository", () => ({
  ProfileRepository: {
    findByUpIdWithAuth: vi.fn().mockResolvedValue({ username: "me", name: "Me", organization: null }),
  },
}));
vi.mock("@calcom/features/membership/repositories/MembershipRepository", () => ({
  MembershipRepository: class {
    static findAllByUpIdIncludeMinimalEventTypes = mockFindAllByUpIdIncludeMinimalEventTypes;
    findAcceptedTeamIdsByUserIdAndRoles = mockFindAcceptedTeamIdsByUserIdAndRoles;
  },
}));

type Ctx = Parameters<typeof getActiveOnOptions>[0]["ctx"];

const ctx = {
  user: { id: 1, role: UserPermissionRole.USER, profile: { upId: "usr-1" } },
  prisma: {} as PrismaClient,
} as unknown as Ctx;

const teamEventType = (id: number, schedulingType: SchedulingType) => ({
  id,
  title: `Event ${id}`,
  userId: null,
  schedulingType,
  metadata: {},
  children: [],
});

describe("getActiveOnOptions team event types", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindAllByUpIdIncludeMinimalEventTypes.mockResolvedValue([
      {
        role: MembershipRole.MEMBER,
        team: {
          id: 10,
          name: "Team",
          slug: "team",
          isOrganization: false,
          parentId: null,
          metadata: {},
          eventTypes: [
            teamEventType(1, SchedulingType.ROUND_ROBIN),
            teamEventType(2, SchedulingType.MANAGED),
          ],
        },
      },
    ]);
  });

  it("lists managed team event types for any accepted member (event-type update rule)", async () => {
    mockFindAcceptedTeamIdsByUserIdAndRoles.mockResolvedValue([{ teamId: 10 }]);

    const { eventTypeOptions } = await getActiveOnOptions({ ctx, input: { teamId: 10 } });

    expect(eventTypeOptions.map((option) => option.value)).toEqual(["1", "2"]);
    expect(mockFindAcceptedTeamIdsByUserIdAndRoles).toHaveBeenCalledWith({
      userId: 1,
      roles: [MembershipRole.MEMBER, MembershipRole.ADMIN, MembershipRole.OWNER],
    });
  });

  it("hides managed event types for a team the user cannot update", async () => {
    mockFindAcceptedTeamIdsByUserIdAndRoles.mockResolvedValue([]);

    const { eventTypeOptions } = await getActiveOnOptions({ ctx, input: { teamId: 10 } });

    expect(eventTypeOptions.map((option) => option.value)).toEqual(["1"]);
  });
});

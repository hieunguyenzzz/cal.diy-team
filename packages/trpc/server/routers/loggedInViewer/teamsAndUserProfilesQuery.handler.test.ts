import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";
import type { PrismaClient } from "@calcom/prisma";
import { MembershipRole, UserPermissionRole } from "@calcom/prisma/enums";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { teamsAndUserProfilesQuery } from "./teamsAndUserProfilesQuery.handler";

vi.mock("@calcom/prisma", () => ({
  default: prismaMock,
  prisma: prismaMock,
}));

type Options = Parameters<typeof teamsAndUserProfilesQuery>[0];
type Result<T extends (...args: never[]) => unknown> = Awaited<ReturnType<T>>;

const membership = (teamId: number, role: MembershipRole) => ({
  role,
  team: {
    id: teamId,
    isOrganization: false,
    logoUrl: null,
    name: `Team ${teamId}`,
    slug: `team-${teamId}`,
    metadata: {},
    parentId: null,
    parent: null,
    members: [],
  },
});

const run = (input: Options["input"], role: UserPermissionRole = UserPermissionRole.USER) =>
  teamsAndUserProfilesQuery({
    ctx: {
      user: { id: 1, role } as unknown as Options["ctx"]["user"],
      prisma: prismaMock as unknown as PrismaClient,
    },
    input,
  });

const teamIds = (result: Awaited<ReturnType<typeof run>>) =>
  result.filter((profile) => profile.teamId !== null).map((profile) => profile.teamId);

describe("teamsAndUserProfilesQuery withPermission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.findUnique.mockResolvedValue({
      avatarUrl: null,
      id: 1,
      username: "me",
      name: "Me",
      teams: [
        membership(10, MembershipRole.MEMBER),
        membership(20, MembershipRole.ADMIN),
        membership(30, MembershipRole.OWNER),
      ],
    } as unknown as Result<typeof prismaMock.user.findUnique>);
  });

  it("lists only ADMIN/OWNER teams for webhook.create", async () => {
    const result = await run({ withPermission: { permission: "webhook.create" } });

    expect(teamIds(result)).toEqual([20, 30]);
    expect(result.every((profile) => profile.readOnly === false)).toBe(true);
  });

  it("lists no teams for an unknown permission", async () => {
    const result = await run({ withPermission: { permission: "team.delete" } });

    expect(teamIds(result)).toEqual([]);
  });

  it("lists every team for the instance admin", async () => {
    const result = await run({ withPermission: { permission: "webhook.create" } }, UserPermissionRole.ADMIN);

    expect(teamIds(result)).toEqual([10, 20, 30]);
  });

  it("keeps the role-based readOnly flag when no permission is requested", async () => {
    const result = await run(undefined);

    expect(result.map((profile) => [profile.teamId, profile.readOnly])).toEqual([
      [null, false],
      [10, true],
      [20, false],
      [30, false],
    ]);
  });
});

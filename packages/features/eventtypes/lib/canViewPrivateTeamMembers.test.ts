import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";
import type { PrismaClient } from "@calcom/prisma";
import { MembershipRole, UserPermissionRole } from "@calcom/prisma/enums";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { canViewPrivateTeamMembers } from "./canViewPrivateTeamMembers";

vi.mock("@calcom/prisma", () => ({
  default: prismaMock,
}));

type Result<T extends (...args: never[]) => unknown> = Awaited<ReturnType<T>>;

const prisma = prismaMock as unknown as PrismaClient;

const givenCaller = (
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

describe("canViewPrivateTeamMembers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["a non-member", null],
    ["a MEMBER", { role: MembershipRole.MEMBER, accepted: true }],
    ["an un-accepted ADMIN", { role: MembershipRole.ADMIN, accepted: false }],
  ])("hides private members from %s", async (_label, membership) => {
    givenCaller(UserPermissionRole.USER, membership);

    await expect(canViewPrivateTeamMembers({ prisma, currentUserId: 1, teamId: 10 })).resolves.toBe(false);
    expect(prismaMock.membership.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId_teamId: { userId: 1, teamId: 10 } } })
    );
  });

  it.each([
    MembershipRole.ADMIN,
    MembershipRole.OWNER,
  ])("shows private members to an accepted %s", async (role) => {
    givenCaller(UserPermissionRole.USER, { role, accepted: true });

    await expect(canViewPrivateTeamMembers({ prisma, currentUserId: 1, teamId: 10 })).resolves.toBe(true);
  });

  it("shows private members to the instance admin", async () => {
    givenCaller(UserPermissionRole.ADMIN, null);

    await expect(canViewPrivateTeamMembers({ prisma, currentUserId: 1, teamId: 10 })).resolves.toBe(true);
  });

  it("hides private members from anonymous visitors without querying", async () => {
    await expect(canViewPrivateTeamMembers({ prisma, currentUserId: undefined, teamId: 10 })).resolves.toBe(
      false
    );
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.membership.findUnique).not.toHaveBeenCalled();
  });
});

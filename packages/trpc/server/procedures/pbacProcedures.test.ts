import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";
import { MembershipRole, UserPermissionRole } from "@calcom/prisma/enums";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTeamPbacProcedure } from "./pbacProcedures";

vi.mock("@calcom/prisma", () => ({
  default: prismaMock,
  prisma: prismaMock,
}));

type Result<T extends (...args: never[]) => unknown> = Awaited<ReturnType<T>>;

const mockNext = vi.fn().mockResolvedValue({ ok: true });

const run = (roles: MembershipRole[], userRole: UserPermissionRole = UserPermissionRole.USER) => {
  const procedure = createTeamPbacProcedure("booking.readTeamBookings", roles);
  const middleware = procedure._def.middlewares[procedure._def.middlewares.length - 1];
  return middleware({
    ctx: { user: { id: 1, role: userRole }, prisma: prismaMock },
    input: { teamId: 10 },
    next: mockNext,
    path: "test",
    type: "query",
    getRawInput: async () => ({ teamId: 10 }),
    meta: undefined,
  } as unknown as Parameters<typeof middleware>[0]);
};

const givenMembership = (membership: { role: MembershipRole; accepted: boolean } | null) => {
  prismaMock.membership.findUnique.mockResolvedValue(
    membership as Result<typeof prismaMock.membership.findUnique>
  );
};

describe("createTeamPbacProcedure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["a non-member", null],
    ["an un-accepted OWNER", { role: MembershipRole.OWNER, accepted: false }],
  ])("forbids %s", async (_label, membership) => {
    givenMembership(membership);

    await expect(
      run([MembershipRole.ADMIN, MembershipRole.OWNER, MembershipRole.MEMBER])
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it("forbids a role outside the procedure's roles", async () => {
    givenMembership({ role: MembershipRole.MEMBER, accepted: true });

    await expect(run([MembershipRole.ADMIN, MembershipRole.OWNER])).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("allows an accepted member whose role is listed", async () => {
    givenMembership({ role: MembershipRole.MEMBER, accepted: true });

    await run([MembershipRole.ADMIN, MembershipRole.OWNER, MembershipRole.MEMBER]);
    expect(mockNext).toHaveBeenCalledTimes(1);
    expect(prismaMock.membership.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId_teamId: { userId: 1, teamId: 10 } } })
    );
  });

  it("allows the instance admin", async () => {
    givenMembership(null);

    await run([MembershipRole.OWNER], UserPermissionRole.ADMIN);
    expect(mockNext).toHaveBeenCalledTimes(1);
  });
});

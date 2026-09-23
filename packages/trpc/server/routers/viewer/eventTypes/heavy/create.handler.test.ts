import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";
import type { PrismaClient } from "@calcom/prisma";
import { MembershipRole, SchedulingType, UserPermissionRole } from "@calcom/prisma/enums";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHandler } from "./create.handler";

vi.mock("@calcom/prisma", () => ({
  default: prismaMock,
}));
vi.mock("@calcom/features/eventtypes/repositories/eventTypeRepository");
vi.mock("@calcom/app-store/_utils/getDefaultLocations", () => ({
  getDefaultLocations: vi.fn().mockResolvedValue([]),
}));

type CreateOptions = Parameters<typeof createHandler>[0];

const mockCreate = vi.fn();

const buildCtx = (
  role: UserPermissionRole = UserPermissionRole.USER,
  isOrgAdmin = false
): CreateOptions["ctx"] => ({
  user: {
    id: 1,
    role,
    organizationId: null,
    organization: { isOrgAdmin },
    profile: { id: null },
    metadata: {},
    email: "user@example.com",
  },
  prisma: prismaMock as unknown as PrismaClient,
});

const teamInput = {
  title: "Team event",
  slug: "team-event",
  length: 30,
  teamId: 10,
  schedulingType: SchedulingType.ROUND_ROBIN,
} as CreateOptions["input"];

const mockMembership = (membership: { role: MembershipRole; accepted: boolean } | null) => {
  prismaMock.membership.findUnique.mockResolvedValue(
    membership as Awaited<ReturnType<typeof prismaMock.membership.findUnique>>
  );
};

describe("createHandler team permissions", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue({ id: 99 });
    const { EventTypeRepository } = await import(
      "@calcom/features/eventtypes/repositories/eventTypeRepository"
    );
    vi.mocked(EventTypeRepository).mockImplementation(function () {
      return { create: mockCreate } as unknown as InstanceType<typeof EventTypeRepository>;
    });
  });

  it("rejects a non-member creating a team event type", async () => {
    mockMembership(null);

    await expect(createHandler({ ctx: buildCtx(), input: teamInput })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects an un-accepted membership", async () => {
    mockMembership({ role: MembershipRole.ADMIN, accepted: false });

    await expect(createHandler({ ctx: buildCtx(), input: teamInput })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it.each([
    MembershipRole.MEMBER,
    MembershipRole.ADMIN,
    MembershipRole.OWNER,
  ])("lets an accepted %s create a team event type", async (role) => {
    mockMembership({ role, accepted: true });

    await createHandler({ ctx: buildCtx(), input: teamInput });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ team: { connect: { id: 10 } }, schedulingType: SchedulingType.ROUND_ROBIN })
    );
  });

  it("does not let the session org-admin flag bypass the team check", async () => {
    mockMembership(null);

    await expect(
      createHandler({ ctx: buildCtx(UserPermissionRole.USER, true), input: teamInput })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("lets the instance admin create a team event type without membership", async () => {
    mockMembership(null);

    await createHandler({ ctx: buildCtx(UserPermissionRole.ADMIN), input: teamInput });

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ team: { connect: { id: 10 } } }));
  });

  it("creates personal event types without a membership lookup", async () => {
    const personalInput = { title: "Mine", slug: "mine", length: 15 } as CreateOptions["input"];

    await createHandler({ ctx: buildCtx(), input: personalInput });

    expect(prismaMock.membership.findUnique).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ owner: { connect: { id: 1 } }, users: { connect: { id: 1 } } })
    );
  });
});

import type { PrismaClient } from "@calcom/prisma";
import { MembershipRole } from "@calcom/prisma/enums";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MembershipRepository } from "./MembershipRepository";

vi.mock("@calcom/prisma", () => ({ default: {}, prisma: {} }));

describe("MembershipRepository team management", () => {
  const prisma = {
    membership: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
  };
  const repository = new MembershipRepository(prisma as unknown as PrismaClient);
  const byUserAndTeam = { userId_teamId: { userId: 5, teamId: 10 } };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates an accepted membership", async () => {
    await repository.createAccepted({ teamId: 10, userId: 5, role: MembershipRole.ADMIN });

    expect(prisma.membership.create).toHaveBeenCalledWith({
      data: { teamId: 10, userId: 5, role: MembershipRole.ADMIN, accepted: true },
      select: { id: true, role: true, accepted: true },
    });
  });

  it("updates a role", async () => {
    await repository.updateRole({ teamId: 10, userId: 5, role: MembershipRole.OWNER });

    expect(prisma.membership.update).toHaveBeenCalledWith({
      where: byUserAndTeam,
      data: { role: MembershipRole.OWNER },
      select: { id: true, role: true, accepted: true },
    });
  });

  it("deletes by user and team", async () => {
    await repository.deleteByUserIdAndTeamId({ teamId: 10, userId: 5 });

    expect(prisma.membership.delete).toHaveBeenCalledWith({ where: byUserAndTeam, select: { id: true } });
  });

  it("counts only accepted owners", async () => {
    prisma.membership.count.mockResolvedValue(2);

    await expect(repository.countAcceptedOwners({ teamId: 10 })).resolves.toBe(2);
    expect(prisma.membership.count).toHaveBeenCalledWith({
      where: { teamId: 10, role: MembershipRole.OWNER, accepted: true },
    });
  });

  it("lists a team's members with safe user fields", async () => {
    await repository.findByTeamIdIncludeUser({ teamId: 10 });

    expect(prisma.membership.findMany).toHaveBeenCalledWith({
      where: { teamId: 10 },
      orderBy: { id: "asc" },
      select: {
        role: true,
        accepted: true,
        user: { select: { id: true, name: true, username: true, email: true, avatarUrl: true } },
      },
    });
  });
});

import type { PrismaClient } from "@calcom/prisma";
import { MembershipRole } from "@calcom/prisma/enums";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TeamRepository } from "./TeamRepository";

const teamSelect = { id: true, name: true, slug: true, bio: true, timeZone: true, logoUrl: true };
const standalone = { parentId: null, isOrganization: false };

describe("TeamRepository team management", () => {
  const prisma = {
    team: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    avatar: { deleteMany: vi.fn() },
    booking: { count: vi.fn() },
  };
  const repository = new TeamRepository(prisma as unknown as PrismaClient);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a standalone team with its creator as an accepted OWNER", async () => {
    await repository.createWithOwner({
      name: "Sales",
      slug: "sales",
      bio: null,
      timeZone: "Asia/Dubai",
      ownerUserId: 1,
    });

    expect(prisma.team.create).toHaveBeenCalledWith({
      data: {
        name: "Sales",
        slug: "sales",
        bio: null,
        timeZone: "Asia/Dubai",
        ...standalone,
        members: { create: { userId: 1, role: MembershipRole.OWNER, accepted: true } },
      },
      select: teamSelect,
    });
  });

  it("updates only the given profile fields", async () => {
    await repository.update({ id: 10, data: { name: "New", logoUrl: null } });

    expect(prisma.team.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { name: "New", logoUrl: null },
      select: teamSelect,
    });
  });

  it("deletes by id", async () => {
    await repository.delete({ id: 10 });

    expect(prisma.team.delete).toHaveBeenCalledWith({ where: { id: 10 }, select: { id: true } });
  });

  it("finds only standalone teams by id", async () => {
    await repository.findStandaloneById({ id: 10 });

    expect(prisma.team.findFirst).toHaveBeenCalledWith({
      where: { id: 10, ...standalone },
      select: teamSelect,
    });
  });

  it("looks a slug up among all top-level teams, organisations included", async () => {
    await repository.findIdBySlugAmongTopLevelTeams({ slug: "sales" });

    expect(prisma.team.findFirst).toHaveBeenCalledWith({
      where: { slug: "sales", parentId: null },
      select: { id: true },
    });
  });

  it("lists the standalone teams a user is an accepted member of, with their role", async () => {
    await repository.listByMemberUserIdIncludeRole({ userId: 7 });

    expect(prisma.team.findMany).toHaveBeenCalledWith({
      where: { ...standalone, members: { some: { userId: 7, accepted: true } } },
      orderBy: { name: "asc" },
      select: { ...teamSelect, members: { where: { userId: 7 }, select: { role: true } } },
    });
  });

  it("lists every standalone team with a count of accepted members only", async () => {
    await repository.listStandaloneIncludeMemberCount();

    expect(prisma.team.findMany).toHaveBeenCalledWith({
      where: standalone,
      orderBy: { name: "asc" },
      select: { ...teamSelect, _count: { select: { members: { where: { accepted: true } } } } },
    });
  });

  it("deletes only the team's logo rows, never user avatars", async () => {
    await repository.deleteLogos({ teamId: 10 });

    expect(prisma.avatar.deleteMany).toHaveBeenCalledWith({ where: { teamId: 10, userId: 0 } });
  });

  it("counts accepted upcoming bookings on the team's event types and their managed children", async () => {
    const now = new Date("2026-09-23T12:00:00Z");
    prisma.booking.count.mockResolvedValue(4);

    await expect(repository.countUpcomingBookings({ teamId: 10, now })).resolves.toBe(4);
    expect(prisma.booking.count).toHaveBeenCalledWith({
      where: {
        status: "ACCEPTED",
        startTime: { gt: now },
        eventType: { OR: [{ teamId: 10 }, { parent: { teamId: 10 } }] },
      },
    });
  });
});

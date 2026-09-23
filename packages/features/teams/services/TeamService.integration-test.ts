import { MembershipRepository } from "@calcom/features/membership/repositories/MembershipRepository";
import { TeamRepository } from "@calcom/features/teams/repositories/TeamRepository";
import { UserRepository } from "@calcom/features/users/repositories/UserRepository";
import { ErrorCode } from "@calcom/lib/errorCodes";
import prisma from "@calcom/prisma";
import { MembershipRole, UserPermissionRole } from "@calcom/prisma/enums";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TeamPermissionService } from "./TeamPermissionService";
import { TeamService } from "./TeamService";

// Runs the real service and repositories against the dev database, cleaning up only its own rows.
describe("TeamService (DB)", () => {
  const suffix = `sbs578-team-${Date.now()}`;
  const userIds: number[] = [];
  const bookingIds: number[] = [];
  let teamId: number | undefined;
  let admin: { id: number };
  let member: { id: number; email: string };

  const membershipRepository = new MembershipRepository(prisma);
  const service = new TeamService({
    teamRepository: new TeamRepository(prisma),
    membershipRepository,
    userRepository: new UserRepository(prisma),
    teamPermissionService: new TeamPermissionService(membershipRepository),
    uploadLogo: async () => "/api/avatar/unused.png",
  });

  const createUser = async (name: string, role: UserPermissionRole) => {
    const user = await prisma.user.create({
      data: { email: `${suffix}-${name}@example.com`, username: `${suffix}-${name}`, role },
      select: { id: true, email: true },
    });
    userIds.push(user.id);
    return user;
  };

  beforeAll(async () => {
    admin = await createUser("admin", UserPermissionRole.ADMIN);
    member = await createUser("member", UserPermissionRole.USER);
  });

  afterAll(async () => {
    if (bookingIds.length > 0) {
      await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    }
    await prisma.avatar.deleteMany({ where: { objectKey: `${suffix}-logo` } });
    if (teamId !== undefined) {
      await prisma.eventType.deleteMany({ where: { teamId } });
      await prisma.membership.deleteMany({ where: { teamId } });
      await prisma.team.deleteMany({ where: { id: teamId } });
    }
    if (userIds.length > 0) {
      await prisma.membership.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
  });

  const asAdmin = () => ({ userId: admin.id, userRole: UserPermissionRole.ADMIN });
  const roleOf = async (userId: number) =>
    (await prisma.membership.findUnique({ where: { userId_teamId: { userId, teamId: teamId as number } } }))
      ?.role;

  it("creates a team, manages members, guards the last owner and deletes the team and its logo", async () => {
    const team = await service.createTeam(asAdmin(), { name: `Team ${suffix}` });
    teamId = team.id;
    expect(team.slug).toBe(`team-${suffix}`);
    expect(await roleOf(admin.id)).toBe(MembershipRole.OWNER);

    await expect(service.createTeam(asAdmin(), { name: `Team ${suffix}` })).rejects.toMatchObject({
      code: ErrorCode.BadRequest,
    });

    await service.addMemberByEmail(asAdmin(), team.id, { email: member.email, role: MembershipRole.MEMBER });
    expect(
      await prisma.membership.findUnique({
        where: { userId_teamId: { userId: member.id, teamId: team.id } },
        select: { role: true, accepted: true },
      })
    ).toEqual({ role: MembershipRole.MEMBER, accepted: true });

    await service.changeMemberRole(asAdmin(), team.id, member.id, MembershipRole.OWNER);
    await service.changeMemberRole(asAdmin(), team.id, member.id, MembershipRole.ADMIN);
    expect(await roleOf(member.id)).toBe(MembershipRole.ADMIN);

    await service.removeMember({ userId: member.id, userRole: UserPermissionRole.USER }, team.id, member.id);
    expect(await roleOf(member.id)).toBeUndefined();

    await expect(
      service.changeMemberRole(asAdmin(), team.id, admin.id, MembershipRole.MEMBER)
    ).rejects.toMatchObject({ code: ErrorCode.BadRequest });
    await expect(service.removeMember(asAdmin(), team.id, admin.id)).rejects.toMatchObject({
      code: ErrorCode.BadRequest,
    });
    expect(await roleOf(admin.id)).toBe(MembershipRole.OWNER);

    const eventType = await prisma.eventType.create({
      data: { title: "Intro", slug: `${suffix}-intro`, length: 30, teamId: team.id },
      select: { id: true },
    });
    const start = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const booking = await prisma.booking.create({
      data: {
        uid: `${suffix}-booking`,
        title: "Upcoming",
        startTime: start,
        endTime: new Date(start.getTime() + 30 * 60 * 1000),
        userId: admin.id,
        eventTypeId: eventType.id,
        status: "ACCEPTED",
      },
      select: { id: true },
    });
    bookingIds.push(booking.id);
    await prisma.avatar.create({
      data: { teamId: team.id, userId: 0, data: "x", objectKey: `${suffix}-logo` },
    });
    await expect(service.countUpcomingBookings(asAdmin(), team.id)).resolves.toBe(1);

    await service.deleteTeam(asAdmin(), team.id);
    expect(await prisma.team.findUnique({ where: { id: team.id }, select: { id: true } })).toBeNull();
    expect(await prisma.membership.count({ where: { teamId: team.id } })).toBe(0);
    expect(await prisma.eventType.count({ where: { id: eventType.id } })).toBe(0);
    expect(await prisma.avatar.count({ where: { teamId: team.id } })).toBe(0);
    // Bookings survive a team delete, detached from their event type.
    expect(
      await prisma.booking.findUnique({ where: { id: booking.id }, select: { eventTypeId: true } })
    ).toEqual({
      eventTypeId: null,
    });
    teamId = undefined;
  });
});

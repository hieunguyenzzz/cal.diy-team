import { EventTypeRepository } from "@calcom/features/eventtypes/repositories/eventTypeRepository";
import { MembershipRepository } from "@calcom/features/membership/repositories/MembershipRepository";
import { TeamRepository } from "@calcom/features/teams/repositories/TeamRepository";
import { TeamPermissionService } from "@calcom/features/teams/services/TeamPermissionService";
import { TeamService } from "@calcom/features/teams/services/TeamService";
import { UserRepository } from "@calcom/features/users/repositories/UserRepository";
import prisma from "@calcom/prisma";
import { MembershipRole, SchedulingType, UserPermissionRole } from "@calcom/prisma/enums";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { updateHandler } from "./update.handler";

type UpdateOptions = Parameters<typeof updateHandler>[0];

// Saves hosts through the real update handler against the dev database, cleaning up only its own rows.
describe("updateHandler hosts (DB)", () => {
  const suffix = `sbs578-hosts-${Date.now()}`;
  const userIds: number[] = [];
  let teamId: number | undefined;
  let eventTypeId: number | undefined;
  let owner: { id: number };
  let member: { id: number };
  let outsider: { id: number };

  const createUser = async (name: string) => {
    const user = await prisma.user.create({
      data: { email: `${suffix}-${name}@example.com`, username: `${suffix}-${name}` },
      select: { id: true },
    });
    userIds.push(user.id);
    return user;
  };

  beforeAll(async () => {
    owner = await createUser("owner");
    member = await createUser("member");
    outsider = await createUser("outsider");
    const team = await prisma.team.create({
      data: {
        name: `Team ${suffix}`,
        slug: `team-${suffix}`,
        members: {
          create: [
            { userId: owner.id, role: MembershipRole.OWNER, accepted: true },
            { userId: member.id, role: MembershipRole.MEMBER, accepted: true },
          ],
        },
      },
      select: { id: true },
    });
    teamId = team.id;
    const eventType = await prisma.eventType.create({
      data: {
        title: "Intro",
        slug: `${suffix}-intro`,
        length: 30,
        teamId: team.id,
        schedulingType: SchedulingType.ROUND_ROBIN,
      },
      select: { id: true },
    });
    eventTypeId = eventType.id;
  });

  afterAll(async () => {
    if (eventTypeId !== undefined) {
      await prisma.host.deleteMany({ where: { eventTypeId } });
      await prisma.eventType.deleteMany({ where: { id: eventTypeId } });
    }
    if (teamId !== undefined) {
      await prisma.membership.deleteMany({ where: { teamId } });
      await prisma.team.deleteMany({ where: { id: teamId } });
    }
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
  });

  const asOwner = (): UpdateOptions["ctx"] =>
    ({
      user: {
        id: owner.id,
        username: `${suffix}-owner`,
        profile: { id: null },
        userLevelSelectedCalendars: [],
        organizationId: null,
        email: `${suffix}-owner@example.com`,
        locale: "en",
      },
      prisma,
    }) as unknown as UpdateOptions["ctx"];

  const hostsInDb = () =>
    prisma.host.findMany({
      where: { eventTypeId },
      orderBy: { userId: "asc" },
      select: { userId: true, isFixed: true, priority: true, weight: true },
    });

  it("writes round-robin hosts, then makes them fixed for a collective event", async () => {
    await updateHandler({
      ctx: asOwner(),
      input: {
        id: eventTypeId as number,
        hosts: [
          { userId: owner.id, isFixed: false, priority: 2, weight: 100 },
          { userId: member.id, isFixed: false, priority: 2, weight: 100 },
        ],
      },
    });
    expect(await hostsInDb()).toEqual([
      { userId: owner.id, isFixed: false, priority: 2, weight: 100 },
      { userId: member.id, isFixed: false, priority: 2, weight: 100 },
    ]);

    await updateHandler({
      ctx: asOwner(),
      input: {
        id: eventTypeId as number,
        schedulingType: SchedulingType.COLLECTIVE,
        hosts: [
          { userId: owner.id, isFixed: false, priority: 2, weight: 100 },
          { userId: member.id, isFixed: false, priority: 2, weight: 100 },
        ],
      },
    });
    expect((await hostsInDb()).map((host) => host.isFixed)).toEqual([true, true]);
  });

  it("refuses a host who is not an accepted member of the team", async () => {
    await expect(
      updateHandler({
        ctx: asOwner(),
        input: {
          id: eventTypeId as number,
          hosts: [{ userId: outsider.id, isFixed: true, priority: 2, weight: 100 }],
        },
      })
    ).rejects.toThrow();
    expect((await hostsInDb()).map((host) => host.userId)).not.toContain(outsider.id);
  });

  // Before host rows followed membership, a removed host stayed in the form's hosts and saving was FORBIDDEN.
  it("saves the assignment after a host member is removed from the team", async () => {
    await updateHandler({
      ctx: asOwner(),
      input: {
        id: eventTypeId as number,
        hosts: [
          { userId: owner.id, isFixed: true, priority: 2, weight: 100 },
          { userId: member.id, isFixed: true, priority: 2, weight: 100 },
        ],
      },
    });
    const membershipRepository = new MembershipRepository(prisma);
    const teamService = new TeamService({
      teamRepository: new TeamRepository(prisma),
      membershipRepository,
      userRepository: new UserRepository(prisma),
      eventTypeRepository: new EventTypeRepository(prisma),
      teamPermissionService: new TeamPermissionService(membershipRepository),
      uploadLogo: async () => "/api/avatar/unused.png",
    });

    await teamService.removeMember(
      { userId: owner.id, userRole: UserPermissionRole.USER },
      teamId as number,
      member.id
    );

    const remainingHosts = await hostsInDb();
    expect(remainingHosts.map((host) => host.userId)).toEqual([owner.id]);
    await expect(
      updateHandler({ ctx: asOwner(), input: { id: eventTypeId as number, hosts: remainingHosts } })
    ).resolves.toBeDefined();
    await expect(
      updateHandler({
        ctx: asOwner(),
        input: {
          id: eventTypeId as number,
          hosts: [...remainingHosts, { userId: member.id, isFixed: true, priority: 2, weight: 100 }],
        },
      })
    ).rejects.toThrow();
  });
});

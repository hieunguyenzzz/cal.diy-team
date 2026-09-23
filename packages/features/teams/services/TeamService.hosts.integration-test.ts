import { EventTypeRepository } from "@calcom/features/eventtypes/repositories/eventTypeRepository";
import { MembershipRepository } from "@calcom/features/membership/repositories/MembershipRepository";
import { TeamRepository } from "@calcom/features/teams/repositories/TeamRepository";
import { UserRepository } from "@calcom/features/users/repositories/UserRepository";
import prisma from "@calcom/prisma";
import { MembershipRole, SchedulingType, UserPermissionRole } from "@calcom/prisma/enums";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TeamPermissionService } from "./TeamPermissionService";
import { TeamService } from "./TeamService";

// Host rows must follow team membership: added members join "add all" event types, removed members leave all.
describe("TeamService hosts follow membership (DB)", () => {
  const suffix = `sbs578-hostsync-${Date.now()}`;
  const userIds: number[] = [];
  const eventTypeIds: number[] = [];
  let teamId: number | undefined;
  let otherTeamId: number | undefined;
  let admin: { id: number; email: string };
  let joiner: { id: number; email: string };

  const membershipRepository = new MembershipRepository(prisma);
  const service = new TeamService({
    teamRepository: new TeamRepository(prisma),
    membershipRepository,
    userRepository: new UserRepository(prisma),
    eventTypeRepository: new EventTypeRepository(prisma),
    teamPermissionService: new TeamPermissionService(membershipRepository),
    uploadLogo: async () => "/api/avatar/unused.png",
  });
  const asAdmin = () => ({ userId: admin.id, userRole: UserPermissionRole.ADMIN });

  const createUser = async (name: string, role: UserPermissionRole) => {
    const user = await prisma.user.create({
      data: { email: `${suffix}-${name}@example.com`, username: `${suffix}-${name}`, role },
      select: { id: true, email: true },
    });
    userIds.push(user.id);
    return user;
  };
  const createEventType = async (
    slug: string,
    schedulingType: SchedulingType,
    assignAllTeamMembers: boolean,
    onTeamId = teamId
  ) => {
    const eventType = await prisma.eventType.create({
      data: {
        title: slug,
        slug: `${suffix}-${slug}`,
        length: 30,
        teamId: onTeamId,
        schedulingType,
        assignAllTeamMembers,
      },
      select: { id: true },
    });
    eventTypeIds.push(eventType.id);
    return eventType.id;
  };

  beforeAll(async () => {
    admin = await createUser("admin", UserPermissionRole.ADMIN);
    joiner = await createUser("joiner", UserPermissionRole.USER);
    const team = await prisma.team.create({
      data: {
        name: `Team ${suffix}`,
        slug: `team-${suffix}`,
        members: { create: { userId: admin.id, role: MembershipRole.OWNER, accepted: true } },
      },
      select: { id: true },
    });
    teamId = team.id;
    // A second team the joiner already belongs to, whose Host rows must be left alone.
    const otherTeam = await prisma.team.create({
      data: {
        name: `Other ${suffix}`,
        slug: `other-${suffix}`,
        members: { create: { userId: joiner.id, role: MembershipRole.MEMBER, accepted: true } },
      },
      select: { id: true },
    });
    otherTeamId = otherTeam.id;
  });

  afterAll(async () => {
    if (eventTypeIds.length > 0) {
      await prisma.host.deleteMany({ where: { eventTypeId: { in: eventTypeIds } } });
      await prisma.eventType.deleteMany({ where: { id: { in: eventTypeIds } } });
    }
    for (const id of [teamId, otherTeamId]) {
      if (id === undefined) continue;
      await prisma.membership.deleteMany({ where: { teamId: id } });
      await prisma.team.deleteMany({ where: { id } });
    }
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
  });

  const joinerHosts = () =>
    prisma.host.findMany({
      where: { userId: joiner.id, eventTypeId: { in: eventTypeIds } },
      orderBy: { eventTypeId: "asc" },
      select: { eventTypeId: true, isFixed: true, priority: true, weight: true, scheduleId: true },
    });

  it("adds a new member to assign-all event types only, fixed for collective, and removes only this team's hosts on leave", async () => {
    const collectiveAll = await createEventType("collective-all", SchedulingType.COLLECTIVE, true);
    const roundRobinAll = await createEventType("rr-all", SchedulingType.ROUND_ROBIN, true);
    const roundRobinPicked = await createEventType("rr-picked", SchedulingType.ROUND_ROBIN, false);
    const otherTeamEvent = await createEventType(
      "other-team",
      SchedulingType.ROUND_ROBIN,
      false,
      otherTeamId
    );
    await prisma.host.create({ data: { userId: joiner.id, eventTypeId: otherTeamEvent, isFixed: false } });

    await service.addMemberByEmail(asAdmin(), teamId as number, {
      email: joiner.email,
      role: MembershipRole.MEMBER,
    });

    const ownTeamHosts = async () =>
      (await joinerHosts()).filter((host) => host.eventTypeId !== otherTeamEvent);
    expect(await ownTeamHosts()).toEqual([
      { eventTypeId: collectiveAll, isFixed: true, priority: 2, weight: 100, scheduleId: null },
      { eventTypeId: roundRobinAll, isFixed: false, priority: 2, weight: 100, scheduleId: null },
    ]);
    // A host picked by hand on a non-assign-all event type must go too when they leave.
    await prisma.host.create({ data: { userId: joiner.id, eventTypeId: roundRobinPicked, isFixed: false } });

    await service.removeMember(
      { userId: joiner.id, userRole: UserPermissionRole.USER },
      teamId as number,
      joiner.id
    );

    expect((await joinerHosts()).map((host) => host.eventTypeId)).toEqual([otherTeamEvent]);
    expect(
      await prisma.membership.findUnique({
        where: { userId_teamId: { userId: joiner.id, teamId: teamId as number } },
      })
    ).toBeNull();
  });
});

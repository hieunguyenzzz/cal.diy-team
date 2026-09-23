import type { PrismaClient } from "@calcom/prisma";
import type { Prisma } from "@calcom/prisma/client";
import { BookingStatus, MembershipRole, SchedulingType } from "@calcom/prisma/enums";
import { baseEventTypeSelect } from "@calcom/prisma/selects/event-types";

const publicUserSelect = {
  id: true,
  name: true,
  username: true,
  avatarUrl: true,
} satisfies Prisma.UserSelect;

// Only standalone teams: Cal.diy has no organizations, so sub-teams and orgs stay unreachable.
const standaloneTeamWhere = (slug: string) =>
  ({ slug, parentId: null, isOrganization: false }) satisfies Prisma.TeamWhereInput;

const STANDALONE_TEAM = { parentId: null, isOrganization: false } satisfies Prisma.TeamWhereInput;

const teamProfileSelect = {
  id: true,
  name: true,
  slug: true,
  bio: true,
  timeZone: true,
  logoUrl: true,
} satisfies Prisma.TeamSelect;

export type TeamProfileUpdate = {
  name?: string;
  slug?: string;
  bio?: string | null;
  timeZone?: string;
  logoUrl?: string | null;
};

export class TeamRepository {
  constructor(private prismaClient: PrismaClient) {}

  async create({
    name,
    slug,
    bio,
    timeZone,
    ownerUserId,
  }: {
    name: string;
    slug: string;
    bio?: string | null;
    timeZone?: string;
    ownerUserId: number;
  }) {
    return this.prismaClient.team.create({
      data: {
        name,
        slug,
        bio,
        timeZone,
        ...STANDALONE_TEAM,
        members: { create: { userId: ownerUserId, role: MembershipRole.OWNER, accepted: true } },
      },
      select: teamProfileSelect,
    });
  }

  async update({ id, data }: { id: number; data: TeamProfileUpdate }) {
    return this.prismaClient.team.update({ where: { id }, data, select: teamProfileSelect });
  }

  async delete({ id }: { id: number }) {
    return this.prismaClient.team.delete({ where: { id }, select: { id: true } });
  }

  // Avatar has no FK to Team, so a team's logo rows would outlive it; userId 0 marks a team logo.
  async deleteLogos({ teamId }: { teamId: number }) {
    return this.prismaClient.avatar.deleteMany({ where: { teamId, userId: 0 } });
  }

  async countUpcomingBookings({ teamId, now }: { teamId: number; now: Date }) {
    return this.prismaClient.booking.count({
      where: {
        status: BookingStatus.ACCEPTED,
        startTime: { gt: now },
        eventType: { OR: [{ teamId }, { parent: { teamId } }] },
      },
    });
  }

  async findById({ id }: { id: number }) {
    return this.prismaClient.team.findFirst({ where: { id, ...STANDALONE_TEAM }, select: teamProfileSelect });
  }

  async findIdBySlugAmongTopLevelTeams({ slug }: { slug: string }) {
    return this.prismaClient.team.findFirst({ where: { slug, parentId: null }, select: { id: true } });
  }

  async listByMemberUserId({ userId }: { userId: number }) {
    return this.prismaClient.team.findMany({
      where: { ...STANDALONE_TEAM, members: { some: { userId, accepted: true } } },
      orderBy: { name: "asc" },
      select: { ...teamProfileSelect, members: { where: { userId }, select: { role: true } } },
    });
  }

  async listStandalone() {
    return this.prismaClient.team.findMany({
      where: STANDALONE_TEAM,
      orderBy: { name: "asc" },
      select: { ...teamProfileSelect, _count: { select: { members: true } } },
    });
  }

  async findBySlugIncludeEventTypesAndMembers({ slug }: { slug: string }) {
    // (slug, parentId) is unique, but Postgres treats NULL parentIds as distinct, so pin the order
    return this.prismaClient.team.findFirst({
      where: standaloneTeamWhere(slug),
      orderBy: { id: "asc" },
      select: {
        id: true,
        slug: true,
        name: true,
        bio: true,
        theme: true,
        isPrivate: true,
        hideBookATeamMember: true,
        logoUrl: true,
        brandColor: true,
        darkBrandColor: true,
        eventTypes: {
          where: {
            hidden: false,
            OR: [{ schedulingType: null }, { schedulingType: { not: SchedulingType.MANAGED } }],
          },
          orderBy: [{ position: "desc" }, { id: "asc" }],
          select: {
            ...baseEventTypeSelect,
            metadata: true,
            hosts: { select: { user: { select: publicUserSelect } } },
          },
        },
        members: {
          where: { accepted: true },
          select: { user: { select: { ...publicUserSelect, bio: true } } },
        },
      },
    });
  }

  async findBySlugIncludeEventType({ slug, eventTypeSlug }: { slug: string; eventTypeSlug: string }) {
    return this.prismaClient.team.findFirst({
      where: standaloneTeamWhere(slug),
      orderBy: { id: "asc" },
      select: {
        id: true,
        slug: true,
        name: true,
        logoUrl: true,
        isPrivate: true,
        hideBranding: true,
        brandColor: true,
        darkBrandColor: true,
        theme: true,
        eventTypes: {
          where: { slug: eventTypeSlug },
          select: {
            id: true,
            title: true,
            schedulingType: true,
            metadata: true,
            length: true,
            hidden: true,
            disableRescheduling: true,
            allowReschedulingCancelledBookings: true,
            interfaceLanguage: true,
            hosts: {
              take: 3,
              orderBy: [{ priority: "desc" }, { userId: "asc" }],
              select: { user: { select: { name: true, username: true } } },
            },
            users: { take: 1, select: { name: true, username: true } },
          },
        },
      },
    });
  }
}

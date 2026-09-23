import type { PrismaClient } from "@calcom/prisma";
import type { Prisma } from "@calcom/prisma/client";
import { SchedulingType } from "@calcom/prisma/enums";
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

export class TeamRepository {
  constructor(private prismaClient: PrismaClient) {}

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

import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";
import type { IEventTypesRepository } from "@calcom/features/eventtypes/eventtypes.repository.interface";
import type { IUsersRepository } from "@calcom/features/users/users.repository.interface";
import type { PrismaClient } from "@calcom/prisma";
import { MembershipRole, UserPermissionRole } from "@calcom/prisma/enums";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebhookRepository } from "./WebhookRepository";

vi.mock("@calcom/prisma", () => ({
  default: prismaMock,
  prisma: prismaMock,
}));

type Result<T extends (...args: never[]) => unknown> = Awaited<ReturnType<T>>;

const findUserTeams = vi.fn();
const repository = new WebhookRepository(
  prismaMock as unknown as PrismaClient,
  { findParentEventTypeId: vi.fn() } as unknown as IEventTypesRepository,
  { findUserTeams } as unknown as IUsersRepository
);

const webhook = (id: string, teamId: number | null) => ({
  id,
  subscriberUrl: "https://example.com/hook",
  payloadTemplate: null,
  appId: null,
  secret: null,
  active: true,
  eventTriggers: [],
  eventTypeId: null,
  teamId,
  userId: teamId ? null : 1,
  time: null,
  timeUnit: null,
  version: "2021-10-20",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  platform: false,
  platformOAuthClientId: null,
});

const teamMembership = (teamId: number, role: MembershipRole) => ({
  role,
  team: {
    id: teamId,
    name: `Team ${teamId}`,
    slug: `team-${teamId}`,
    logoUrl: null,
    webhooks: [webhook(`t${teamId}`, teamId)],
  },
});

describe("WebhookRepository team access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.webhook.findMany.mockResolvedValue([]);
  });

  describe("getFilteredWebhooksForUser", () => {
    beforeEach(() => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 1,
        username: "me",
        name: "Me",
        avatarUrl: null,
        webhooks: [webhook("mine", null)],
        teams: [
          teamMembership(10, MembershipRole.MEMBER),
          teamMembership(20, MembershipRole.ADMIN),
          teamMembership(30, MembershipRole.OWNER),
        ],
      } as unknown as Result<typeof prismaMock.user.findUnique>);
    });

    it("shows every accepted team's webhooks but lets only ADMIN/OWNER modify or delete", async () => {
      const { webhookGroups } = await repository.getFilteredWebhooksForUser({ userId: 1 });

      const flagsByTeam = Object.fromEntries(
        webhookGroups.map((group) => [String(group.teamId), group.metadata])
      );
      expect(flagsByTeam).toEqual({
        null: { canModify: true, canDelete: true },
        10: { canModify: false, canDelete: false },
        20: { canModify: true, canDelete: true },
        30: { canModify: true, canDelete: true },
      });
    });

    it("lets the instance admin modify and delete every team's webhooks", async () => {
      const { webhookGroups } = await repository.getFilteredWebhooksForUser({
        userId: 1,
        userRole: UserPermissionRole.ADMIN,
      });

      expect(webhookGroups.find((group) => group.teamId === 10)?.metadata).toEqual({
        canModify: true,
        canDelete: true,
      });
    });
  });

  describe("listWebhooks", () => {
    const listWhere = () => prismaMock.webhook.findMany.mock.calls[0][0]?.where;

    it("includes only teams where the caller is an accepted ADMIN/OWNER", async () => {
      findUserTeams.mockResolvedValue({ teams: [{ teamId: 10 }, { teamId: 20 }] });
      prismaMock.membership.findMany.mockResolvedValue([{ teamId: 20 }] as unknown as Result<
        typeof prismaMock.membership.findMany
      >);

      await repository.listWebhooks({ userId: 1 });

      expect(prismaMock.membership.findMany).toHaveBeenCalledWith({
        where: { userId: 1, accepted: true, role: { in: [MembershipRole.ADMIN, MembershipRole.OWNER] } },
        select: { teamId: true },
      });
      expect(listWhere()).toEqual({
        AND: [{ appId: null }, { OR: [{ userId: 1 }, { teamId: { in: [20] } }] }],
      });
    });

    it("includes no team webhooks for a plain member", async () => {
      findUserTeams.mockResolvedValue({ teams: [{ teamId: 10 }] });
      prismaMock.membership.findMany.mockResolvedValue([]);

      await repository.listWebhooks({ userId: 1 });

      expect(listWhere()).toEqual({ AND: [{ appId: null }, { OR: [{ userId: 1 }] }] });
    });

    it("includes all of the instance admin's teams", async () => {
      findUserTeams.mockResolvedValue({ teams: [{ teamId: 10 }, { teamId: 20 }] });

      await repository.listWebhooks({ userId: 1, userRole: UserPermissionRole.ADMIN });

      expect(prismaMock.membership.findMany).not.toHaveBeenCalled();
      expect(listWhere()).toEqual({
        AND: [{ appId: null }, { OR: [{ userId: 1 }, { teamId: { in: [10, 20] } }] }],
      });
    });
  });
});

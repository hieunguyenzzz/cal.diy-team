import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";
import type { IEventTypesRepository } from "@calcom/features/eventtypes/eventtypes.repository.interface";
import type { IUsersRepository } from "@calcom/features/users/users.repository.interface";
import type { PrismaClient } from "@calcom/prisma";
import { MembershipRole } from "@calcom/prisma/enums";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebhookRepository } from "./WebhookRepository";

vi.mock("@calcom/prisma", () => ({
  default: prismaMock,
  prisma: prismaMock,
}));

type Result<T extends (...args: never[]) => unknown> = Awaited<ReturnType<T>>;

const eventTypeRepository = { findParentEventTypeId: vi.fn() } as unknown as IEventTypesRepository;
const repository = new WebhookRepository(
  prismaMock as unknown as PrismaClient,
  eventTypeRepository,
  {} as unknown as IUsersRepository
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

// Access policy lives in TeamPermissionService; the repository only filters by the team ids it is given.
describe("WebhookRepository team filtering", () => {
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

    it("builds team groups only for the given team ids, all modifiable and deletable", async () => {
      const { webhookGroups, profiles } = await repository.getFilteredWebhooksForUser({
        userId: 1,
        teamIds: [20, 30],
        includePlatformWebhooks: false,
      });

      const flagsByTeam = Object.fromEntries(
        webhookGroups.map((group) => [String(group.teamId), group.metadata])
      );
      expect(flagsByTeam).toEqual({
        null: { canModify: true, canDelete: true },
        20: { canModify: true, canDelete: true },
        30: { canModify: true, canDelete: true },
      });
      expect(profiles.map((profile) => profile.teamId)).toEqual([null, 20, 30]);
      const webhookIds = webhookGroups.flatMap((group) => group.webhooks.map((hook) => hook.id));
      expect(webhookIds).not.toContain("t10");
      expect(webhookIds).toEqual(["mine", "t20", "t30"]);
      expect(prismaMock.webhook.findMany).not.toHaveBeenCalled();
    });

    it("adds the platform group only when asked to", async () => {
      prismaMock.webhook.findMany.mockResolvedValue([
        { ...webhook("platform-hook", null), userId: null, platform: true },
      ] as unknown as Result<typeof prismaMock.webhook.findMany>);

      const { webhookGroups } = await repository.getFilteredWebhooksForUser({
        userId: 1,
        teamIds: [],
        includePlatformWebhooks: true,
      });

      expect(prismaMock.webhook.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { platform: true } })
      );
      expect(webhookGroups.map((group) => group.profile.name)).toEqual(["Me", "Platform"]);
    });
  });

  describe("listWebhooks", () => {
    const listWhere = () => prismaMock.webhook.findMany.mock.calls[0][0]?.where;

    it("returns a managed child's inherited parent webhooks without their secret", async () => {
      vi.mocked(eventTypeRepository.findParentEventTypeId).mockResolvedValue(500);
      prismaMock.webhook.findMany.mockResolvedValue([
        { ...webhook("child", null), eventTypeId: 42, secret: "child-secret" },
        { ...webhook("parent", null), eventTypeId: 500, secret: "parent-secret" },
      ] as unknown as Result<typeof prismaMock.webhook.findMany>);

      const webhooks = await repository.listWebhooks({ userId: 1, teamIds: [], eventTypeId: 42 });

      expect(webhooks.map((hook) => [hook.id, hook.secret])).toEqual([
        ["child", "child-secret"],
        ["parent", null],
      ]);
    });

    it("puts the given team ids into the where", async () => {
      await repository.listWebhooks({ userId: 1, teamIds: [20, 30] });

      expect(listWhere()).toEqual({
        AND: [{ appId: null }, { OR: [{ userId: 1 }, { teamId: { in: [20, 30] } }] }],
      });
      expect(prismaMock.membership.findMany).not.toHaveBeenCalled();
    });

    it("keeps only the user's own webhooks when no team ids are given", async () => {
      await repository.listWebhooks({ userId: 1, teamIds: [] });

      expect(listWhere()).toEqual({ AND: [{ appId: null }, { OR: [{ userId: 1 }] }] });
    });
  });
});

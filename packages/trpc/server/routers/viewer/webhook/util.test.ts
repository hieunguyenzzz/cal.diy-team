import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";
import { MembershipRole, UserPermissionRole } from "@calcom/prisma/enums";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWebhookProcedure } from "./util";

vi.mock("@calcom/prisma", () => ({
  default: prismaMock,
  prisma: prismaMock,
}));

type Result<T extends (...args: never[]) => unknown> = Awaited<ReturnType<T>>;
type WebhookInput = { id?: string; webhookId?: string; eventTypeId?: number; teamId?: number };

const mockNext = vi.fn().mockResolvedValue({ ok: true });

const runProcedure = (input: WebhookInput, userRole: UserPermissionRole = UserPermissionRole.USER) => {
  const procedure = createWebhookProcedure();
  const middleware = procedure._def.middlewares[procedure._def.middlewares.length - 1];
  return middleware({
    ctx: { user: { id: 1, role: userRole }, prisma: prismaMock },
    input,
    next: mockNext,
    path: "test",
    type: "mutation",
    getRawInput: async () => input,
    meta: undefined,
  } as unknown as Parameters<typeof middleware>[0]);
};

const givenWebhook = (webhook: {
  userId: number | null;
  eventTypeId: number | null;
  teamId: number | null;
  platform?: boolean;
}) => {
  prismaMock.webhook.findUnique.mockResolvedValue({ id: "wh-1", platform: false, ...webhook } as Result<
    typeof prismaMock.webhook.findUnique
  >);
};

const givenMembership = (membership: { role: MembershipRole; accepted: boolean } | null) => {
  prismaMock.membership.findUnique.mockResolvedValue(
    membership as Result<typeof prismaMock.membership.findUnique>
  );
};

describe("webhookProcedure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    givenMembership(null);
  });

  describe("existing team webhook (edit, delete, get, testTrigger by id)", () => {
    beforeEach(() => {
      givenWebhook({ userId: null, eventTypeId: null, teamId: 10 });
    });

    it.each([
      ["a non-member", null],
      ["a MEMBER", { role: MembershipRole.MEMBER, accepted: true }],
      ["an un-accepted ADMIN", { role: MembershipRole.ADMIN, accepted: false }],
    ])("forbids %s", async (_label, membership) => {
      givenMembership(membership);

      await expect(runProcedure({ id: "wh-1" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(mockNext).not.toHaveBeenCalled();
      expect(prismaMock.membership.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId_teamId: { userId: 1, teamId: 10 } } })
      );
    });

    it.each([MembershipRole.ADMIN, MembershipRole.OWNER])("allows an accepted %s", async (role) => {
      givenMembership({ role, accepted: true });

      await runProcedure({ webhookId: "wh-1" });
      expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it("allows the instance admin without a membership", async () => {
      await runProcedure({ id: "wh-1" }, UserPermissionRole.ADMIN);
      expect(mockNext).toHaveBeenCalledTimes(1);
    });
  });

  describe("teamId on input (create, delete)", () => {
    it("forbids creating a webhook for a team the caller does not administer", async () => {
      givenMembership({ role: MembershipRole.MEMBER, accepted: true });

      await expect(runProcedure({ teamId: 20 })).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it("allows a team ADMIN to create a team webhook", async () => {
      givenMembership({ role: MembershipRole.ADMIN, accepted: true });

      await runProcedure({ teamId: 20 });
      expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it("forbids naming a team the caller does not administer alongside their own webhook", async () => {
      givenWebhook({ userId: 1, eventTypeId: null, teamId: null });

      await expect(runProcedure({ id: "wh-1", teamId: 20 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("platform webhooks (get, testTrigger and the rest by id)", () => {
    beforeEach(() => {
      givenWebhook({ userId: null, eventTypeId: null, teamId: null, platform: true });
    });

    it("rejects a non-admin, as edit.handler does", async () => {
      await expect(runProcedure({ id: "wh-1" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it("allows the instance admin", async () => {
      await runProcedure({ id: "wh-1" }, UserPermissionRole.ADMIN);
      expect(mockNext).toHaveBeenCalledTimes(1);
    });
  });

  describe("personal webhooks are unchanged", () => {
    it("allows the owner", async () => {
      givenWebhook({ userId: 1, eventTypeId: null, teamId: null });

      await runProcedure({ id: "wh-1" });
      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(prismaMock.membership.findUnique).not.toHaveBeenCalled();
    });

    it("forbids another user", async () => {
      givenWebhook({ userId: 2, eventTypeId: null, teamId: null });

      await expect(runProcedure({ id: "wh-1" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });
});

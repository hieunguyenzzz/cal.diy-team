import { EventTypeRepository } from "@calcom/features/eventtypes/repositories/eventTypeRepository";
import type { PrismaClient } from "@calcom/prisma";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@calcom/prisma", () => {
  // findById resolves the caller's team ids through the default client first.
  const client = { membership: { findMany: vi.fn().mockResolvedValue([]) } };
  return { default: client, prisma: client, readonlyPrisma: client };
});

// eventTypes.get spreads findById into its response, and since SBS-578 team MEMBERs can read team events.
describe("EventTypeRepository webhook selects", () => {
  const findFirst = vi.fn().mockResolvedValue(null);
  const repository = new EventTypeRepository({ eventType: { findFirst } } as unknown as PrismaClient);

  const selectedWebhookFields = () => {
    const { select } = findFirst.mock.calls[0][0];
    return Object.keys(select.webhooks.select);
  };

  beforeEach(() => {
    findFirst.mockClear();
  });

  it("findById never selects webhook secrets", async () => {
    await repository.findById({ id: 1, userId: 2 });

    expect(selectedWebhookFields()).not.toContain("secret");
    expect(selectedWebhookFields()).toEqual(expect.arrayContaining(["id", "active"]));
  });

  it("findByIdForOrgAdmin never selects webhook secrets", async () => {
    await repository.findByIdForOrgAdmin({ id: 1, organizationId: 3 });

    expect(selectedWebhookFields()).not.toContain("secret");
  });
});

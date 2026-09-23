import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { editHandler } from "./edit.handler";

vi.mock("@calcom/prisma", () => ({
  default: prismaMock,
  prisma: prismaMock,
}));
vi.mock("@calcom/features/webhooks/lib/scheduleTrigger", () => ({
  updateTriggerForExistingBookings: vi.fn(),
  deleteWebhookScheduledTriggers: vi.fn(),
  cancelNoShowTasksForBooking: vi.fn(),
}));

type EditOptions = Parameters<typeof editHandler>[0];
type Result<T extends (...args: never[]) => unknown> = Awaited<ReturnType<T>>;

const ctx = { user: { id: 1, role: "USER" } } as unknown as EditOptions["ctx"];

const givenWebhook = (teamId: number | null) => {
  prismaMock.webhook.findUnique.mockResolvedValue({
    id: "wh-1",
    subscriberUrl: "https://example.com/hook",
    teamId,
    userId: teamId ? null : 1,
    eventTypeId: null,
    platform: false,
    active: true,
    eventTriggers: [],
  } as unknown as Result<typeof prismaMock.webhook.findUnique>);
};

const edit = (input: Partial<EditOptions["input"]>) =>
  editHandler({
    ctx,
    input: { id: "wh-1", payloadTemplate: null, active: true, ...input } as EditOptions["input"],
  });

describe("editHandler teamId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.webhook.update.mockResolvedValue({ eventTriggers: [] } as unknown as Result<
      typeof prismaMock.webhook.update
    >);
  });

  it("refuses to move a team webhook to another team", async () => {
    givenWebhook(10);

    await expect(edit({ teamId: 20 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(prismaMock.webhook.update).not.toHaveBeenCalled();
  });

  it("refuses to move a personal webhook into a team", async () => {
    givenWebhook(null);

    await expect(edit({ teamId: 20 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(prismaMock.webhook.update).not.toHaveBeenCalled();
  });

  it("never writes teamId, even when it matches", async () => {
    givenWebhook(10);

    await edit({ teamId: 10, active: false });

    expect(prismaMock.webhook.update.mock.calls[0][0].data).not.toHaveProperty("teamId");
    expect(prismaMock.webhook.update.mock.calls[0][0].data).toMatchObject({ active: false });
  });
});

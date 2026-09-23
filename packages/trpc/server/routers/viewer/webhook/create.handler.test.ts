import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHandler } from "./create.handler";

vi.mock("@calcom/prisma", () => ({
  default: prismaMock,
  prisma: prismaMock,
}));
vi.mock("@calcom/features/webhooks/lib/scheduleTrigger", () => ({
  updateTriggerForExistingBookings: vi.fn(),
}));

type CreateOptions = Parameters<typeof createHandler>[0];
type Result<T extends (...args: never[]) => unknown> = Awaited<ReturnType<T>>;

const ctx = { user: { id: 1, role: "USER" } } as unknown as CreateOptions["ctx"];

describe("createHandler webhook id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.webhook.create.mockResolvedValue({ id: "created", eventTriggers: [] } as unknown as Result<
      typeof prismaMock.webhook.create
    >);
  });

  it("always generates the id, ignoring a caller-supplied one", async () => {
    await createHandler({
      ctx,
      input: {
        id: "existing-webhook-id",
        subscriberUrl: "https://example.com/hook",
        eventTriggers: ["BOOKING_CREATED"],
        active: true,
        payloadTemplate: null,
      },
    });

    const { id } = prismaMock.webhook.create.mock.calls[0][0].data;
    expect(id).not.toBe("existing-webhook-id");
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

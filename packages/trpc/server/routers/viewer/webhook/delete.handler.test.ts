import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteHandler } from "./delete.handler";

vi.mock("@calcom/prisma", () => ({
  default: prismaMock,
  prisma: prismaMock,
}));
vi.mock("@calcom/features/webhooks/lib/scheduleTrigger", () => ({
  updateTriggerForExistingBookings: vi.fn(),
}));

type DeleteOptions = Parameters<typeof deleteHandler>[0];
type Result<T extends (...args: never[]) => unknown> = Awaited<ReturnType<T>>;

const ctx = { user: { id: 1, role: "USER" } } as unknown as DeleteOptions["ctx"];

describe("deleteHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.webhook.findFirst.mockResolvedValue({ id: "wh-1", eventTriggers: [] } as unknown as Result<
      typeof prismaMock.webhook.findFirst
    >);
  });

  // webhookProcedure has already checked that the caller is an ADMIN/OWNER of input.teamId.
  it("scopes a team webhook deletion to the given team", async () => {
    await deleteHandler({ ctx, input: { id: "wh-1", teamId: 10 } });

    expect(prismaMock.webhook.findFirst).toHaveBeenCalledWith({
      where: { AND: [{ id: "wh-1" }, { teamId: 10 }] },
    });
    expect(prismaMock.webhook.delete).toHaveBeenCalledWith({ where: { id: "wh-1" } });
  });

  it("still scopes a personal webhook deletion to the caller", async () => {
    await deleteHandler({ ctx, input: { id: "wh-1" } });

    expect(prismaMock.webhook.findFirst).toHaveBeenCalledWith({
      where: { AND: [{ id: "wh-1" }, { userId: 1 }] },
    });
  });
});

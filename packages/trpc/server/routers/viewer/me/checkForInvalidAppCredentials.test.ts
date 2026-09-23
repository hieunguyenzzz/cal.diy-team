import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkInvalidAppCredentials } from "./checkForInvalidAppCredentials";

vi.mock("@calcom/prisma", () => ({
  default: prismaMock,
  prisma: prismaMock,
}));
vi.mock("@calcom/app-store/utils", () => ({
  getAppFromSlug: vi.fn(() => ({ name: "Google Calendar" })),
}));

type Ctx = Parameters<typeof checkInvalidAppCredentials>[0]["ctx"];
type Result<T extends (...args: never[]) => unknown> = Awaited<ReturnType<T>>;

const ctx = { user: { id: 1, role: "USER" } } as unknown as Ctx;

describe("checkInvalidAppCredentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.credential.findMany.mockResolvedValue([]);
  });

  it("includes invalid credentials of teams the user is an accepted ADMIN/OWNER of", async () => {
    prismaMock.membership.findMany.mockResolvedValue([{ teamId: 10 }] as unknown as Result<
      typeof prismaMock.membership.findMany
    >);
    prismaMock.credential.findMany.mockResolvedValue([{ appId: "google-calendar" }] as unknown as Result<
      typeof prismaMock.credential.findMany
    >);

    await expect(checkInvalidAppCredentials({ ctx })).resolves.toEqual([
      { slug: "google-calendar", name: "Google Calendar" },
    ]);
    expect(prismaMock.membership.findMany).toHaveBeenCalledWith({
      where: { userId: 1, accepted: true, role: { in: ["ADMIN", "OWNER"] } },
      select: { teamId: true },
    });
    expect(prismaMock.credential.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { OR: [{ userId: 1 }, { teamId: { in: [10] } }], invalid: true } })
    );
  });
});

import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isAdminForUser } from "./outOfOffice.utils";

vi.mock("@calcom/prisma", () => ({
  default: prismaMock,
  prisma: prismaMock,
}));

type Result<T extends (...args: never[]) => unknown> = Awaited<ReturnType<T>>;

describe("isAdminForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is true when the member belongs to a team the caller is an accepted ADMIN/OWNER of", async () => {
    prismaMock.membership.findMany.mockResolvedValue([{ teamId: 10 }] as unknown as Result<
      typeof prismaMock.membership.findMany
    >);
    prismaMock.membership.findFirst.mockResolvedValue({ id: 5 } as unknown as Result<
      typeof prismaMock.membership.findFirst
    >);

    await expect(isAdminForUser(1, 2)).resolves.toBe(true);
    expect(prismaMock.membership.findMany).toHaveBeenCalledWith({
      where: { userId: 1, accepted: true, role: { in: ["ADMIN", "OWNER"] } },
      select: { teamId: true },
    });
    expect(prismaMock.membership.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 2, accepted: true, teamId: { in: [10] } } })
    );
  });

  it("is false when the caller administers no team", async () => {
    prismaMock.membership.findMany.mockResolvedValue([]);

    await expect(isAdminForUser(1, 2)).resolves.toBe(false);
    expect(prismaMock.membership.findFirst).not.toHaveBeenCalled();
  });

  it("is false when the member is in none of the caller's administered teams", async () => {
    prismaMock.membership.findMany.mockResolvedValue([{ teamId: 10 }] as unknown as Result<
      typeof prismaMock.membership.findMany
    >);
    prismaMock.membership.findFirst.mockResolvedValue(null);

    await expect(isAdminForUser(1, 2)).resolves.toBe(false);
  });
});

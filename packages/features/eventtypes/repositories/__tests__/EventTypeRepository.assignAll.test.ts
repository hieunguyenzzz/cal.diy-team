import { EventTypeRepository } from "@calcom/features/eventtypes/repositories/eventTypeRepository";
import type { PrismaClient } from "@calcom/prisma";
import { describe, expect, it, vi } from "vitest";

vi.mock("@calcom/prisma", () => ({ default: {}, prisma: {}, readonlyPrisma: {} }));

describe("EventTypeRepository.findManyByTeamIdWithAssignAllTeamMembers", () => {
  it("returns only the team's assign-all event types with their scheduling type", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 3, schedulingType: "COLLECTIVE" }]);
    const repository = new EventTypeRepository({ eventType: { findMany } } as unknown as PrismaClient);

    await expect(repository.findManyByTeamIdWithAssignAllTeamMembers({ teamId: 10 })).resolves.toEqual([
      { id: 3, schedulingType: "COLLECTIVE" },
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: { teamId: 10, assignAllTeamMembers: true },
      select: { id: true, schedulingType: true },
    });
  });
});

import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";
import type { PrismaClient } from "@calcom/prisma";
import { SchedulingType } from "@calcom/prisma/enums";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateHandler } from "./update.handler";

vi.mock("@calcom/prisma", () => ({
  default: prismaMock,
}));

type UpdateOptions = Parameters<typeof updateHandler>[0];

const ctx: UpdateOptions["ctx"] = {
  user: {
    id: 1,
    username: "owner",
    profile: { id: null },
    userLevelSelectedCalendars: [],
    organizationId: null,
    email: "owner@example.com",
    locale: "en",
  },
  prisma: prismaMock as unknown as PrismaClient,
};

const baseEventType = {
  title: "Event",
  locations: [],
  description: null,
  seatsPerTimeSlot: null,
  recurringEvent: null,
  maxActiveBookingsPerBooker: null,
  fieldTranslations: [],
  isRRWeightsEnabled: false,
  hosts: [],
  calVideoSettings: null,
  children: [],
  hostGroups: [],
};

const teamEventType = {
  ...baseEventType,
  team: {
    id: 10,
    name: "Team",
    slug: "team",
    parentId: null,
    rrTimestampBasis: null,
    parent: null,
    members: [],
  },
};

const mockEventType = (eventType: typeof baseEventType & { team: typeof teamEventType.team | null }) => {
  prismaMock.eventType.findUniqueOrThrow.mockResolvedValue(
    eventType as unknown as Awaited<ReturnType<typeof prismaMock.eventType.findUniqueOrThrow>>
  );
};

describe("updateHandler teamId handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.hashedLink.findMany.mockResolvedValue([]);
    prismaMock.eventType.update.mockResolvedValue({
      slug: "event",
      schedulingType: null,
    } as unknown as Awaited<ReturnType<typeof prismaMock.eventType.update>>);
  });

  it("rejects moving a personal event type into a team, even with that team's members as hosts", async () => {
    mockEventType({ ...baseEventType, team: null });
    prismaMock.membership.findMany.mockResolvedValue([{ userId: 2 }] as unknown as Awaited<
      ReturnType<typeof prismaMock.membership.findMany>
    >);

    await expect(
      updateHandler({
        ctx,
        input: {
          id: 1,
          teamId: 20,
          schedulingType: SchedulingType.ROUND_ROBIN,
          hosts: [{ userId: 2, isFixed: false }],
        } as UpdateOptions["input"],
      })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Event type cannot be moved to another team",
    });
    expect(prismaMock.eventType.update).not.toHaveBeenCalled();
  });

  it("rejects moving a team event type into a different team", async () => {
    mockEventType(teamEventType);

    await expect(
      updateHandler({ ctx, input: { id: 1, teamId: 20 } as UpdateOptions["input"] })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Event type cannot be moved to another team",
    });
    expect(prismaMock.eventType.update).not.toHaveBeenCalled();
  });

  it("never writes teamId into the update data", async () => {
    mockEventType(teamEventType);

    await updateHandler({ ctx, input: { id: 1, teamId: 10, title: "Renamed" } as UpdateOptions["input"] });

    expect(prismaMock.eventType.update).toHaveBeenCalledTimes(1);
    const { data } = prismaMock.eventType.update.mock.calls[0][0];
    expect(data).not.toHaveProperty("teamId");
    expect(data).toMatchObject({ title: "Renamed" });
  });

  it("allows updating a personal event type with a null teamId", async () => {
    mockEventType({ ...baseEventType, team: null });

    await updateHandler({ ctx, input: { id: 1, teamId: null, title: "Mine" } as UpdateOptions["input"] });

    const { data } = prismaMock.eventType.update.mock.calls[0][0];
    expect(data).not.toHaveProperty("teamId");
  });
});

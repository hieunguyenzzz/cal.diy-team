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

describe("updateHandler ownership of referenced records", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.hashedLink.findMany.mockResolvedValue([]);
    prismaMock.eventType.update.mockResolvedValue({
      slug: "event",
      schedulingType: null,
    } as unknown as Awaited<ReturnType<typeof prismaMock.eventType.update>>);
    mockEventType({ ...baseEventType, team: null });
  });

  const updateData = () => prismaMock.eventType.update.mock.calls[0][0].data;

  it("does not connect an instant meeting schedule owned by someone else", async () => {
    prismaMock.schedule.findFirst.mockResolvedValue(null);

    await updateHandler({ ctx, input: { id: 1, instantMeetingSchedule: 77 } as UpdateOptions["input"] });

    expect(prismaMock.schedule.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 1, id: 77 } })
    );
    expect(updateData()).not.toHaveProperty("instantMeetingSchedule");
  });

  it("connects the caller's own instant meeting schedule", async () => {
    prismaMock.schedule.findFirst.mockResolvedValue({ id: 77 } as Awaited<
      ReturnType<typeof prismaMock.schedule.findFirst>
    >);

    await updateHandler({ ctx, input: { id: 1, instantMeetingSchedule: 77 } as UpdateOptions["input"] });

    expect(updateData()).toMatchObject({ instantMeetingSchedule: { connect: { id: 77 } } });
  });

  it("never writes the scalar instantMeetingScheduleId", async () => {
    prismaMock.schedule.findFirst.mockResolvedValue(null);

    await updateHandler({ ctx, input: { id: 1, instantMeetingScheduleId: 88 } as UpdateOptions["input"] });

    expect(updateData()).not.toHaveProperty("instantMeetingScheduleId");
    expect(updateData()).not.toHaveProperty("instantMeetingSchedule");
  });

  it("does not write a foreign scalar scheduleId", async () => {
    prismaMock.schedule.findFirst.mockResolvedValue(null);

    await updateHandler({ ctx, input: { id: 1, scheduleId: 66 } as UpdateOptions["input"] });

    expect(prismaMock.schedule.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 1, id: 66 } })
    );
    expect(updateData()).not.toHaveProperty("scheduleId");
    expect(updateData()).not.toHaveProperty("schedule");
  });

  it("connects the caller's own schedule when sent as a scalar scheduleId (API v2 sends this)", async () => {
    prismaMock.schedule.findFirst.mockResolvedValue({ id: 66 } as Awaited<
      ReturnType<typeof prismaMock.schedule.findFirst>
    >);

    await updateHandler({ ctx, input: { id: 1, scheduleId: 66 } as UpdateOptions["input"] });

    expect(updateData()).not.toHaveProperty("scheduleId");
    expect(updateData()).toMatchObject({ schedule: { connect: { id: 66 } } });
  });

  it("never writes parentId from input", async () => {
    await updateHandler({ ctx, input: { id: 1, parentId: 999, title: "Mine" } as UpdateOptions["input"] });

    expect(updateData()).not.toHaveProperty("parentId");
    expect(updateData()).toMatchObject({ title: "Mine" });
  });
});

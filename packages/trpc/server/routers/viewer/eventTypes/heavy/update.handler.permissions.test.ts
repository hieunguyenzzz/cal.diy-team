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

// Schedules are looked up by id; ownership is decided by comparing userId with the caller (user 1).
const givenScheduleOwner = (userId: number) => {
  prismaMock.schedule.findUnique.mockResolvedValue({ userId } as Awaited<
    ReturnType<typeof prismaMock.schedule.findUnique>
  >);
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
    givenScheduleOwner(2);

    await updateHandler({ ctx, input: { id: 1, instantMeetingSchedule: 77 } as UpdateOptions["input"] });

    expect(prismaMock.schedule.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 77 } })
    );
    expect(updateData()).not.toHaveProperty("instantMeetingSchedule");
  });

  it("connects the caller's own instant meeting schedule", async () => {
    givenScheduleOwner(1);

    await updateHandler({ ctx, input: { id: 1, instantMeetingSchedule: 77 } as UpdateOptions["input"] });

    expect(updateData()).toMatchObject({ instantMeetingSchedule: { connect: { id: 77 } } });
  });

  it("never writes the scalar instantMeetingScheduleId", async () => {
    givenScheduleOwner(2);

    await updateHandler({ ctx, input: { id: 1, instantMeetingScheduleId: 88 } as UpdateOptions["input"] });

    expect(updateData()).not.toHaveProperty("instantMeetingScheduleId");
    expect(updateData()).not.toHaveProperty("instantMeetingSchedule");
  });

  it("does not write a foreign scalar scheduleId", async () => {
    givenScheduleOwner(2);

    await updateHandler({ ctx, input: { id: 1, scheduleId: 66 } as UpdateOptions["input"] });

    expect(prismaMock.schedule.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 66 } })
    );
    expect(updateData()).not.toHaveProperty("scheduleId");
    expect(updateData()).not.toHaveProperty("schedule");
  });

  it("connects the caller's own schedule when sent as a scalar scheduleId (API v2 sends this)", async () => {
    givenScheduleOwner(1);

    await updateHandler({ ctx, input: { id: 1, scheduleId: 66 } as UpdateOptions["input"] });

    expect(updateData()).not.toHaveProperty("scheduleId");
    expect(updateData()).toMatchObject({ schedule: { connect: { id: 66 } } });
  });

  it("disconnects the schedule when the scalar scheduleId is null", async () => {
    await updateHandler({ ctx, input: { id: 1, scheduleId: null } as UpdateOptions["input"] });

    expect(updateData()).toMatchObject({ schedule: { disconnect: true } });
    expect(updateData()).not.toHaveProperty("scheduleId");
  });

  it("uses schedule over scheduleId when both are sent", async () => {
    givenScheduleOwner(1);

    await updateHandler({ ctx, input: { id: 1, schedule: 11, scheduleId: 66 } as UpdateOptions["input"] });

    expect(prismaMock.schedule.findUnique).toHaveBeenCalledTimes(1);
    expect(prismaMock.schedule.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 11 } })
    );
    expect(updateData()).toMatchObject({ schedule: { connect: { id: 11 } } });
  });

  it("never writes profileId from input", async () => {
    await updateHandler({ ctx, input: { id: 1, profileId: 555, title: "Mine" } as UpdateOptions["input"] });

    expect(updateData()).not.toHaveProperty("profileId");
    expect(updateData()).toMatchObject({ title: "Mine" });
  });

  it("never writes parentId from input", async () => {
    await updateHandler({ ctx, input: { id: 1, parentId: 999, title: "Mine" } as UpdateOptions["input"] });

    expect(updateData()).not.toHaveProperty("parentId");
    expect(updateData()).toMatchObject({ title: "Mine" });
  });
});

describe("updateHandler host assignments", () => {
  type Result<T extends (...args: never[]) => unknown> = Awaited<ReturnType<T>>;

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.hashedLink.findMany.mockResolvedValue([]);
    prismaMock.eventType.update.mockResolvedValue({
      slug: "event",
      schedulingType: null,
    } as unknown as Awaited<ReturnType<typeof prismaMock.eventType.update>>);
    mockEventType(teamEventType);
    // User 2 is an accepted member of team 10, so the existing membership check passes.
    prismaMock.membership.findMany.mockResolvedValue([{ userId: 2 }] as unknown as Result<
      typeof prismaMock.membership.findMany
    >);
    prismaMock.schedule.findMany.mockResolvedValue([]);
    prismaMock.credential.findMany.mockResolvedValue([]);
  });

  const updateHosts = (hosts: unknown[]) =>
    updateHandler({ ctx, input: { id: 1, teamId: 10, hosts } as UpdateOptions["input"] });
  const createdHosts = () =>
    (prismaMock.eventType.update.mock.calls[0][0].data.hosts as { create: Record<string, unknown>[] }).create;

  it("rejects a host schedule that belongs to someone else", async () => {
    prismaMock.schedule.findMany.mockResolvedValue([{ id: 5, userId: 3 }] as unknown as Result<
      typeof prismaMock.schedule.findMany
    >);

    await expect(updateHosts([{ userId: 2, isFixed: false, scheduleId: 5 }])).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(prismaMock.eventType.update).not.toHaveBeenCalled();
  });

  it("accepts the host's own schedule", async () => {
    prismaMock.schedule.findMany.mockResolvedValue([{ id: 5, userId: 2 }] as unknown as Result<
      typeof prismaMock.schedule.findMany
    >);

    await updateHosts([{ userId: 2, isFixed: false, scheduleId: 5 }]);
    expect(createdHosts()[0]).toMatchObject({ userId: 2, scheduleId: 5 });
    expect(prismaMock.schedule.findMany).toHaveBeenCalledWith({
      where: { id: { in: [5] } },
      select: { id: true, userId: true },
    });
  });

  it("rejects a host location credential owned by another user and not by the team", async () => {
    prismaMock.credential.findMany.mockResolvedValue([
      { id: 7, userId: 3, teamId: null },
    ] as unknown as Result<typeof prismaMock.credential.findMany>);

    await expect(
      updateHosts([{ userId: 2, isFixed: false, location: { type: "integrations:zoom", credentialId: 7 } }])
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(prismaMock.eventType.update).not.toHaveBeenCalled();
  });

  it.each([
    ["the host", { id: 7, userId: 2, teamId: null }],
    ["the event's team", { id: 7, userId: null, teamId: 10 }],
  ])("accepts a host location credential owned by %s", async (_label, credential) => {
    prismaMock.credential.findMany.mockResolvedValue([credential] as unknown as Result<
      typeof prismaMock.credential.findMany
    >);

    await updateHosts([
      { userId: 2, isFixed: false, location: { type: "integrations:zoom", credentialId: 7 } },
    ]);
    expect(createdHosts()[0]).toMatchObject({ location: { create: { credentialId: 7 } } });
    expect(prismaMock.credential.findMany).toHaveBeenCalledWith({
      where: { id: { in: [7] } },
      select: { id: true, userId: true, teamId: true },
    });
  });

  it("never writes a host profileId from input", async () => {
    await updateHosts([{ userId: 2, isFixed: false, profileId: 99 }]);

    expect(createdHosts()[0]).not.toHaveProperty("profileId");
  });
});

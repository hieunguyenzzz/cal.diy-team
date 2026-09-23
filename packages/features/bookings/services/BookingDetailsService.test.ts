import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";
import type { PrismaClient } from "@calcom/prisma";
import { MembershipRole, UserPermissionRole } from "@calcom/prisma/enums";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookingDetailsService } from "./BookingDetailsService";

vi.mock("@calcom/prisma", () => ({
  default: prismaMock,
}));

type FindUniqueResult<T extends (...args: never[]) => unknown> = Awaited<ReturnType<T>>;

// Exercises the real BookingAccessService, repositories and TeamPermissionService against a mocked Prisma.
describe("BookingDetailsService.getBookingDetails team access", () => {
  const service = new BookingDetailsService(prismaMock as unknown as PrismaClient);
  const teamBooking = {
    uid: "booking-uid",
    userId: 456,
    user: { id: 456, email: "organizer@example.com" },
    attendees: [],
    eventType: { teamId: 100, parent: null, hosts: [], users: [] },
    rescheduled: false,
    fromReschedule: null,
    tracking: null,
  };

  const givenCaller = (
    userRole: UserPermissionRole,
    membership: { role: MembershipRole; accepted: boolean } | null
  ) => {
    prismaMock.user.findUnique.mockResolvedValue({ role: userRole } as FindUniqueResult<
      typeof prismaMock.user.findUnique
    >);
    prismaMock.membership.findUnique.mockResolvedValue(
      membership as FindUniqueResult<typeof prismaMock.membership.findUnique>
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.booking.findUnique.mockResolvedValue(
      teamBooking as unknown as FindUniqueResult<typeof prismaMock.booking.findUnique>
    );
  });

  it.each([
    ["a non-member", null],
    ["a MEMBER", { role: MembershipRole.MEMBER, accepted: true }],
    ["an un-accepted OWNER", { role: MembershipRole.OWNER, accepted: false }],
  ])("forbids %s from reading a team booking", async (_label, membership) => {
    givenCaller(UserPermissionRole.USER, membership);

    await expect(service.getBookingDetails({ userId: 123, bookingUid: "booking-uid" })).rejects.toThrow(
      "You do not have permission to view this booking"
    );
    expect(prismaMock.membership.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId_teamId: { userId: 123, teamId: 100 } } })
    );
  });

  it("returns details to an accepted team ADMIN", async () => {
    givenCaller(UserPermissionRole.USER, { role: MembershipRole.ADMIN, accepted: true });

    await expect(service.getBookingDetails({ userId: 123, bookingUid: "booking-uid" })).resolves.toEqual({
      rescheduledToBooking: null,
      previousBooking: null,
      tracking: null,
    });
  });

  it("returns details to the instance admin without a membership", async () => {
    givenCaller(UserPermissionRole.ADMIN, null);

    await expect(
      service.getBookingDetails({ userId: 123, bookingUid: "booking-uid" })
    ).resolves.toMatchObject({ tracking: null });
  });
});

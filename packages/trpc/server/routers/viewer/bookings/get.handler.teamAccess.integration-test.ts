import kysely from "@calcom/kysely";
import prisma from "@calcom/prisma";
import { BookingStatus, MembershipRole } from "@calcom/prisma/enums";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getBookings } from "./get.handler";

// A team admin sees accepted members' bookings, never those of someone who has only been invited.
describe("getBookings team admin scope (DB)", () => {
  const suffix = `sbs578-bk-${Date.now()}`;
  const userIds: number[] = [];
  const bookingIds: number[] = [];
  let teamId: number | undefined;
  let admin: { id: number; email: string };
  let member: { id: number };
  let invitee: { id: number; email: string };
  let memberBookingId: number;
  let inviteeBookingId: number;
  let inviteeAsAttendeeBookingId: number;

  const createUser = async (name: string) => {
    const user = await prisma.user.create({
      data: { email: `${suffix}-${name}@example.com`, username: `${suffix}-${name}` },
      select: { id: true, email: true },
    });
    userIds.push(user.id);
    return user;
  };

  const createBooking = async (ownerId: number, attendeeEmail: string, dayOffset: number) => {
    const start = new Date(Date.now() + dayOffset * 24 * 60 * 60 * 1000);
    const booking = await prisma.booking.create({
      data: {
        uid: `${suffix}-${dayOffset}`,
        title: `Booking ${dayOffset}`,
        startTime: start,
        endTime: new Date(start.getTime() + 30 * 60 * 1000),
        userId: ownerId,
        status: BookingStatus.ACCEPTED,
        attendees: { create: { email: attendeeEmail, name: "Attendee", timeZone: "UTC" } },
      },
      select: { id: true },
    });
    bookingIds.push(booking.id);
    return booking.id;
  };

  beforeAll(async () => {
    admin = await createUser("admin");
    member = await createUser("member");
    invitee = await createUser("invitee");
    const outsider = await createUser("outsider");

    const team = await prisma.team.create({ data: { name: suffix, slug: suffix }, select: { id: true } });
    teamId = team.id;
    await prisma.membership.createMany({
      data: [
        { userId: admin.id, teamId, role: MembershipRole.ADMIN, accepted: true },
        { userId: member.id, teamId, role: MembershipRole.MEMBER, accepted: true },
        { userId: invitee.id, teamId, role: MembershipRole.MEMBER, accepted: false },
      ],
    });

    memberBookingId = await createBooking(member.id, `${suffix}-external1@example.com`, 7);
    inviteeBookingId = await createBooking(invitee.id, `${suffix}-external2@example.com`, 8);
    inviteeAsAttendeeBookingId = await createBooking(outsider.id, invitee.email, 9);
  });

  afterAll(async () => {
    if (bookingIds.length > 0) {
      await prisma.attendee.deleteMany({ where: { bookingId: { in: bookingIds } } });
      await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    }
    if (teamId !== undefined) {
      await prisma.membership.deleteMany({ where: { teamId } });
      await prisma.team.delete({ where: { id: teamId } });
    }
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
  });

  const listAsAdmin = (filters: { userIds?: number[] } = {}) =>
    getBookings({
      user: { id: admin.id, email: admin.email, orgId: null },
      prisma,
      kysely,
      bookingListingByStatus: ["upcoming"],
      filters,
      take: 50,
      skip: 0,
    });

  it("includes accepted members' bookings but not an invitee's, as owner or attendee", async () => {
    const ids = (await listAsAdmin()).bookings.map((booking) => booking.id);

    expect(ids).toContain(memberBookingId);
    expect(ids).not.toContain(inviteeBookingId);
    expect(ids).not.toContain(inviteeAsAttendeeBookingId);
  });

  it("allows filtering by an accepted member", async () => {
    const ids = (await listAsAdmin({ userIds: [member.id] })).bookings.map((booking) => booking.id);

    expect(ids).toContain(memberBookingId);
  });

  it("forbids filtering by an invitee who has not accepted", async () => {
    await expect(listAsAdmin({ userIds: [invitee.id] })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

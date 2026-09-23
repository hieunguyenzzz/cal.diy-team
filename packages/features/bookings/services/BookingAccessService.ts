import { MembershipRepository } from "@calcom/features/membership/repositories/MembershipRepository";
import { TeamPermissionService } from "@calcom/features/teams/services/TeamPermissionService";
import { UserRepository } from "@calcom/features/users/repositories/UserRepository";
import type { PrismaClient } from "@calcom/prisma";
import { MembershipRole } from "@calcom/prisma/enums";
import { BookingRepository } from "../repositories/BookingRepository";

const TEAM_BOOKING_READER_ROLES = [MembershipRole.ADMIN, MembershipRole.OWNER];

type BookingForAccessCheck = NonNullable<Awaited<ReturnType<BookingRepository["findByUidIncludeEventType"]>>>;

export class BookingAccessService {
  constructor(private prismaClient: PrismaClient) {}

  private isUserAHost(userId: number, booking: BookingForAccessCheck): boolean {
    const hostMap = new Map<number, { id: number; email: string }>();

    const addHost = (id: number, email: string) => {
      if (!hostMap.has(id)) {
        hostMap.set(id, { id, email });
      }
    };

    booking?.eventType?.hosts?.forEach((host: { userId: number; user: { email: string } }) =>
      addHost(host.userId, host.user.email)
    );
    booking?.eventType?.users?.forEach((user: { id: number; email: string }) => addHost(user.id, user.email));

    if (booking?.user?.id && booking?.user?.email) {
      addHost(booking.user.id, booking.user.email);
    }

    const attendeeEmails = new Set(booking.attendees?.map((attendee: { email: string }) => attendee.email));
    const filteredHosts = Array.from(hostMap.values()).filter(
      (host) => attendeeEmails.has(host.email) || host.id === booking.user?.id
    );

    return filteredHosts.some((host) => host.id === userId);
  }

  /**
   * Determines if a user has access to a booking based on:
   * 1. Being the booking organizer
   * 2. Being one of the hosts in a multi-host booking
   * 3. Being an accepted ADMIN/OWNER of the event type's team (or of its parent team for managed events)
   * 4. Organisation admins get no access: this fork has standalone teams only
   * 5. Being an accepted ADMIN/OWNER of any team the booking organizer belongs to (personal bookings)
   * The instance admin passes every team check in 3 and 5.
   */
  async doesUserIdHaveAccessToBooking({
    userId,
    bookingUid,
    bookingId,
  }: {
    userId: number;
    bookingUid?: string;
    bookingId?: number;
  }): Promise<boolean> {
    const bookingRepo = new BookingRepository(this.prismaClient);
    const userRepo = new UserRepository(this.prismaClient);

    // Fetch booking by UID or ID
    const booking = bookingUid
      ? await bookingRepo.findByUidIncludeEventType({ bookingUid })
      : bookingId
        ? await bookingRepo.findByIdIncludeEventType({ bookingId })
        : null;

    if (!booking) return false;

    // Case 1: User is the booking organizer
    if (userId === booking.userId) return true;

    // Case 2: User is one of the hosts
    if (this.isUserAHost(userId, booking)) return true;

    const teamPermissionService = new TeamPermissionService(new MembershipRepository(this.prismaClient));
    const userRole = (await userRepo.findRoleById({ id: userId }))?.role;
    const isTeamAdmin = (teamId: number) =>
      teamPermissionService.hasTeamRole({ userId, userRole, teamId, roles: TEAM_BOOKING_READER_ROLES });

    // Case 3: team event type, or the parent team of a managed (child) event type
    const bookingTeamId = booking.eventType?.teamId ?? booking.eventType?.parent?.teamId;
    if (bookingTeamId) return isTeamAdmin(bookingTeamId);

    if (!booking.userId) return false;

    const bookingOwner = await userRepo.getUserOrganizationAndTeams({ userId: booking.userId });

    if (!bookingOwner) return false;

    // Case 5: Check if user is admin of any team the booking organizer belongs to
    for (const membership of bookingOwner.teams) {
      if (await isTeamAdmin(membership.teamId)) return true;
    }

    return false;
  }
}

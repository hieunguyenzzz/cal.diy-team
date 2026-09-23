import { MembershipRepository } from "@calcom/features/membership/repositories/MembershipRepository";
import {
  TEAM_ADMIN_ROLES,
  TeamPermissionService,
} from "@calcom/features/teams/services/TeamPermissionService";
import { UserRepository } from "@calcom/features/users/repositories/UserRepository";
import type { PrismaClient } from "@calcom/prisma";
import type { UserPermissionRole } from "@calcom/prisma/enums";
import { BookingRepository } from "../repositories/BookingRepository";

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
   * Grants access to a booking when the user is:
   * - the booking organizer
   * - one of the hosts in a multi-host booking
   * - an accepted ADMIN/OWNER of the event type's team (or of its parent team for managed events)
   * - an accepted ADMIN/OWNER of any team the booking organizer belongs to (personal bookings)
   * The instance admin passes both team checks. Organisation roles grant nothing: this fork has
   * standalone teams only.
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
    // Only fetched once a team check is actually reached, and at most once.
    let userRolePromise: Promise<UserPermissionRole | undefined> | undefined;
    const getUserRole = () => {
      userRolePromise ??= userRepo.findRoleById({ id: userId }).then((user) => user?.role);
      return userRolePromise;
    };

    // Case 3: team event type, or the parent team of a managed (child) event type
    const bookingTeamId = booking.eventType?.teamId ?? booking.eventType?.parent?.teamId;
    if (bookingTeamId) {
      return teamPermissionService.hasTeamRole({
        userId,
        userRole: await getUserRole(),
        teamId: bookingTeamId,
        roles: TEAM_ADMIN_ROLES,
      });
    }

    if (!booking.userId) return false;

    const bookingOwner = await userRepo.getUserOrganizationAndTeams({ userId: booking.userId });

    if (!bookingOwner) return false;

    // Case 5: Check if user is admin of any team the booking organizer belongs to
    const ownerTeamIds = bookingOwner.teams.map((membership) => membership.teamId);
    if (ownerTeamIds.length === 0) return false;

    return teamPermissionService.hasTeamRoleInAnyTeam({
      userId,
      userRole: await getUserRole(),
      teamIds: ownerTeamIds,
      roles: TEAM_ADMIN_ROLES,
    });
  }
}

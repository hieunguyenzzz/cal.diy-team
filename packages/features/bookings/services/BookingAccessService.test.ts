import { MembershipRepository } from "@calcom/features/membership/repositories/MembershipRepository";
import { UserRepository } from "@calcom/features/users/repositories/UserRepository";
import type { PrismaClient } from "@calcom/prisma";
import { MembershipRole, UserPermissionRole } from "@calcom/prisma/enums";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookingRepository } from "../repositories/BookingRepository";
import { BookingAccessService } from "./BookingAccessService";

vi.mock("../repositories/BookingRepository");
vi.mock("@calcom/features/users/repositories/UserRepository");
vi.mock("@calcom/features/membership/repositories/MembershipRepository");

vi.mock("@calcom/prisma", () => ({
  default: {},
  prisma: {},
}));

describe("BookingAccessService", () => {
  let service: BookingAccessService;
  let mockPrismaClient: PrismaClient;
  let mockBookingRepo: {
    findByUidIncludeEventType: ReturnType<typeof vi.fn>;
  };
  let mockUserRepo: {
    getUserOrganizationAndTeams: ReturnType<typeof vi.fn>;
    findRoleById: ReturnType<typeof vi.fn>;
  };
  let mockMembershipRepo: {
    findRoleAndAcceptedByUserIdAndTeamId: ReturnType<typeof vi.fn>;
  };

  // Memberships of the requesting user (123), keyed by teamId.
  const givenMemberships = (memberships: Record<number, { role: MembershipRole; accepted: boolean }>) => {
    mockMembershipRepo.findRoleAndAcceptedByUserIdAndTeamId.mockImplementation(
      async ({ teamId }: { teamId: number }) => memberships[teamId] ?? null
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockPrismaClient = {} as PrismaClient;

    mockBookingRepo = {
      findByUidIncludeEventType: vi.fn(),
    };

    mockUserRepo = {
      getUserOrganizationAndTeams: vi.fn(),
      findRoleById: vi.fn().mockResolvedValue({ role: UserPermissionRole.USER }),
    };

    mockMembershipRepo = {
      findRoleAndAcceptedByUserIdAndTeamId: vi.fn().mockResolvedValue(null),
    };

    vi.mocked(BookingRepository).mockImplementation(function () {
      return mockBookingRepo as any;
    });
    vi.mocked(UserRepository).mockImplementation(function () {
      return mockUserRepo as any;
    });
    vi.mocked(MembershipRepository).mockImplementation(function () {
      return mockMembershipRepo as unknown as MembershipRepository;
    });

    service = new BookingAccessService(mockPrismaClient);
  });

  describe("doesUserIdHaveAccessToBooking", () => {
    describe("Case 1: Booking Organizer", () => {
      it("should return true when user is the booking organizer", async () => {
        const mockBooking = {
          userId: 123,
          eventType: null,
          attendees: [],
        };

        mockBookingRepo.findByUidIncludeEventType.mockResolvedValue(mockBooking);

        const result = await service.doesUserIdHaveAccessToBooking({
          userId: 123,
          bookingUid: "test-booking-uid",
        });

        expect(result).toBe(true);
        expect(mockBookingRepo.findByUidIncludeEventType).toHaveBeenCalledWith({
          bookingUid: "test-booking-uid",
        });
      });

      it("should return false when user is not the organizer and booking has no team", async () => {
        const mockBooking = {
          userId: 456,
          eventType: null,
          attendees: [],
        };

        mockBookingRepo.findByUidIncludeEventType.mockResolvedValue(mockBooking);
        mockUserRepo.getUserOrganizationAndTeams.mockResolvedValue(null);

        const result = await service.doesUserIdHaveAccessToBooking({
          userId: 123,
          bookingUid: "test-booking-uid",
        });

        expect(result).toBe(false);
      });
    });

    describe("Case 2: Booking Host", () => {
      it("should return true when user is a host in eventType.hosts", async () => {
        const mockBooking = {
          userId: 456,
          user: { id: 456, email: "organizer@example.com" },
          eventType: {
            hosts: [
              { userId: 123, user: { email: "host@example.com" } },
              { userId: 789, user: { email: "other-host@example.com" } },
            ],
            users: [],
          },
          attendees: [{ email: "host@example.com" }],
        };

        mockBookingRepo.findByUidIncludeEventType.mockResolvedValue(mockBooking);

        const result = await service.doesUserIdHaveAccessToBooking({
          userId: 123,
          bookingUid: "test-booking-uid",
        });

        expect(result).toBe(true);
      });

      it("should return true when user is in eventType.users", async () => {
        const mockBooking = {
          userId: 456,
          user: { id: 456, email: "organizer@example.com" },
          eventType: {
            hosts: [],
            users: [
              { id: 123, email: "user@example.com" },
              { id: 789, email: "other-user@example.com" },
            ],
          },
          attendees: [{ email: "user@example.com" }],
        };

        mockBookingRepo.findByUidIncludeEventType.mockResolvedValue(mockBooking);

        const result = await service.doesUserIdHaveAccessToBooking({
          userId: 123,
          bookingUid: "test-booking-uid",
        });

        expect(result).toBe(true);
      });

      it("should return false when user is not a host", async () => {
        const mockBooking = {
          userId: 456,
          user: { id: 456, email: "organizer@example.com" },
          eventType: {
            hosts: [{ userId: 789, user: { email: "host@example.com" } }],
            users: [],
          },
          attendees: [{ email: "host@example.com" }],
        };

        mockBookingRepo.findByUidIncludeEventType.mockResolvedValue(mockBooking);
        mockUserRepo.getUserOrganizationAndTeams.mockResolvedValue(null);

        const result = await service.doesUserIdHaveAccessToBooking({
          userId: 123,
          bookingUid: "test-booking-uid",
        });

        expect(result).toBe(false);
      });
    });

    const hasAccess = () =>
      service.doesUserIdHaveAccessToBooking({ userId: 123, bookingUid: "test-booking-uid" });

    describe("Case 3: Team Event Access", () => {
      const teamBooking = { userId: 456, eventType: { teamId: 100 }, attendees: [] };

      beforeEach(() => {
        mockBookingRepo.findByUidIncludeEventType.mockResolvedValue(teamBooking);
      });

      it("denies a non-member", async () => {
        givenMemberships({});

        await expect(hasAccess()).resolves.toBe(false);
        expect(mockMembershipRepo.findRoleAndAcceptedByUserIdAndTeamId).toHaveBeenCalledWith({
          userId: 123,
          teamId: 100,
        });
      });

      it("denies a MEMBER", async () => {
        givenMemberships({ 100: { role: MembershipRole.MEMBER, accepted: true } });

        await expect(hasAccess()).resolves.toBe(false);
      });

      it("denies an ADMIN whose invite is not accepted", async () => {
        givenMemberships({ 100: { role: MembershipRole.ADMIN, accepted: false } });

        await expect(hasAccess()).resolves.toBe(false);
      });

      it.each([MembershipRole.ADMIN, MembershipRole.OWNER])("allows an accepted %s", async (role) => {
        givenMemberships({ 100: { role, accepted: true } });

        await expect(hasAccess()).resolves.toBe(true);
      });

      it("allows the instance admin without a membership", async () => {
        givenMemberships({});
        mockUserRepo.findRoleById.mockResolvedValue({ role: UserPermissionRole.ADMIN });

        await expect(hasAccess()).resolves.toBe(true);
        expect(mockUserRepo.findRoleById).toHaveBeenCalledWith({ id: 123 });
      });
    });

    describe("Managed event (child of a team event type)", () => {
      const managedBooking = {
        userId: 456,
        eventType: { teamId: null, parent: { teamId: 100 } },
        attendees: [],
      };

      beforeEach(() => {
        mockBookingRepo.findByUidIncludeEventType.mockResolvedValue(managedBooking);
      });

      it("denies a MEMBER and an un-accepted ADMIN of the parent team", async () => {
        givenMemberships({ 100: { role: MembershipRole.MEMBER, accepted: true } });
        await expect(hasAccess()).resolves.toBe(false);

        givenMemberships({ 100: { role: MembershipRole.ADMIN, accepted: false } });
        await expect(hasAccess()).resolves.toBe(false);
      });

      it("allows an accepted ADMIN of the parent team", async () => {
        givenMemberships({ 100: { role: MembershipRole.ADMIN, accepted: true } });

        await expect(hasAccess()).resolves.toBe(true);
      });
    });

    describe("Case 4: Organisation of the booking owner", () => {
      it("denies even an OWNER of the owner's organisation, because there are no orgs", async () => {
        mockBookingRepo.findByUidIncludeEventType.mockResolvedValue({
          userId: 456,
          eventType: null,
          attendees: [],
        });
        mockUserRepo.getUserOrganizationAndTeams.mockResolvedValue({ organizationId: 200, teams: [] });
        givenMemberships({ 200: { role: MembershipRole.OWNER, accepted: true } });

        await expect(hasAccess()).resolves.toBe(false);
      });
    });

    describe("Case 5: Team Admin Access (Personal Bookings)", () => {
      const personalBooking = { userId: 456, eventType: null, attendees: [] };

      beforeEach(() => {
        mockBookingRepo.findByUidIncludeEventType.mockResolvedValue(personalBooking);
        mockUserRepo.getUserOrganizationAndTeams.mockResolvedValue({
          organizationId: null,
          teams: [{ teamId: 300 }, { teamId: 400 }],
        });
      });

      it("denies a non-member of every team the owner belongs to", async () => {
        givenMemberships({});

        await expect(hasAccess()).resolves.toBe(false);
        expect(mockMembershipRepo.findRoleAndAcceptedByUserIdAndTeamId).toHaveBeenCalledTimes(2);
      });

      it("denies a MEMBER of the owner's teams", async () => {
        givenMemberships({
          300: { role: MembershipRole.MEMBER, accepted: true },
          400: { role: MembershipRole.MEMBER, accepted: true },
        });

        await expect(hasAccess()).resolves.toBe(false);
      });

      it.each([
        MembershipRole.ADMIN,
        MembershipRole.OWNER,
      ])("allows an accepted %s of any one of the owner's teams", async (role) => {
        givenMemberships({
          300: { role: MembershipRole.MEMBER, accepted: true },
          400: { role, accepted: true },
        });

        await expect(hasAccess()).resolves.toBe(true);
      });

      it("allows the instance admin", async () => {
        givenMemberships({});
        mockUserRepo.findRoleById.mockResolvedValue({ role: UserPermissionRole.ADMIN });

        await expect(hasAccess()).resolves.toBe(true);
      });

      it("denies the instance admin when the owner belongs to no team", async () => {
        mockUserRepo.getUserOrganizationAndTeams.mockResolvedValue({ organizationId: null, teams: [] });
        mockUserRepo.findRoleById.mockResolvedValue({ role: UserPermissionRole.ADMIN });

        await expect(hasAccess()).resolves.toBe(false);
      });
    });

    it("does not look up team roles when the caller is the organizer", async () => {
      mockBookingRepo.findByUidIncludeEventType.mockResolvedValue({
        userId: 123,
        eventType: { teamId: 100 },
        attendees: [],
      });

      await expect(hasAccess()).resolves.toBe(true);
      expect(mockMembershipRepo.findRoleAndAcceptedByUserIdAndTeamId).not.toHaveBeenCalled();
      expect(mockUserRepo.findRoleById).not.toHaveBeenCalled();
    });
  });
});

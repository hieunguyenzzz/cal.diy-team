import type { MembershipRepository } from "@calcom/features/membership/repositories/MembershipRepository";
import type { TeamRepository } from "@calcom/features/teams/repositories/TeamRepository";
import type { UserRepository } from "@calcom/features/users/repositories/UserRepository";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { MembershipRole, UserPermissionRole } from "@calcom/prisma/enums";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TeamPermissionService } from "./TeamPermissionService";
import { TeamService } from "./TeamService";

const instanceAdmin = { userId: 1, userRole: UserPermissionRole.ADMIN };
const actor = { userId: 2, userRole: UserPermissionRole.USER };

const team = { id: 10, name: "Sales", slug: "sales", bio: null, timeZone: "Europe/London", logoUrl: null };

const teamRepository = {
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  findById: vi.fn(),
  findIdBySlugAmongTopLevelTeams: vi.fn(),
  deleteLogos: vi.fn(),
  countUpcomingBookings: vi.fn(),
};
const membershipRepository = {
  findRoleAndAcceptedByUserIdAndTeamId: vi.fn(),
  createAccepted: vi.fn(),
  updateRole: vi.fn(),
  deleteByUserIdAndTeamId: vi.fn(),
  countAcceptedOwners: vi.fn(),
};
const userRepository = { findByEmail: vi.fn() };
const uploadLogo = vi.fn();

const service = new TeamService({
  teamRepository: teamRepository as unknown as TeamRepository,
  membershipRepository: membershipRepository as unknown as MembershipRepository,
  userRepository: userRepository as unknown as UserRepository,
  teamPermissionService: new TeamPermissionService(membershipRepository as unknown as MembershipRepository),
  uploadLogo,
});

// Memberships by userId in team 10; the actor's own row decides what they may do.
const givenMemberships = (rows: Record<number, { role: MembershipRole; accepted?: boolean }>) => {
  const lookup = async ({ userId }: { userId: number }) => {
    const row = rows[userId];
    return row ? { role: row.role, accepted: row.accepted ?? true } : null;
  };
  membershipRepository.findRoleAndAcceptedByUserIdAndTeamId.mockImplementation(lookup);
};

const expectError = async (promise: Promise<unknown>, code: ErrorCode, message?: RegExp) => {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  );
  expect(error).toMatchObject({ code });
  if (message) expect((error as Error).message).toMatch(message);
};

describe("TeamService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    teamRepository.findById.mockResolvedValue(team);
    teamRepository.findIdBySlugAmongTopLevelTeams.mockResolvedValue(null);
    teamRepository.create.mockResolvedValue(team);
    teamRepository.update.mockResolvedValue(team);
    membershipRepository.countAcceptedOwners.mockResolvedValue(2);
    givenMemberships({});
  });

  describe("createTeam", () => {
    it("only lets the instance admin create teams", async () => {
      await expectError(service.createTeam(actor, { name: "Sales" }), ErrorCode.Forbidden);
      expect(teamRepository.create).not.toHaveBeenCalled();
    });

    it("slugifies the slug, checks it among top-level teams and makes the creator an accepted OWNER", async () => {
      await service.createTeam(instanceAdmin, { name: "Sales Team", slug: "Sales Team!", bio: "Hi" });

      expect(teamRepository.findIdBySlugAmongTopLevelTeams).toHaveBeenCalledWith({ slug: "sales-team" });
      expect(teamRepository.create).toHaveBeenCalledWith({
        name: "Sales Team",
        slug: "sales-team",
        bio: "Hi",
        timeZone: undefined,
        ownerUserId: 1,
      });
    });

    it("derives the slug from the name when none is given", async () => {
      await service.createTeam(instanceAdmin, { name: "Customer Success" });

      expect(teamRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ slug: "customer-success" })
      );
    });

    it("rejects a slug already used by another top-level team", async () => {
      teamRepository.findIdBySlugAmongTopLevelTeams.mockResolvedValue({ id: 99 });

      await expectError(service.createTeam(instanceAdmin, { name: "Sales" }), ErrorCode.BadRequest, /slug/i);
      expect(teamRepository.create).not.toHaveBeenCalled();
    });

    it("rejects a name that slugifies to nothing", async () => {
      await expectError(service.createTeam(instanceAdmin, { name: "!!!" }), ErrorCode.BadRequest);
    });
  });

  describe("updateTeam", () => {
    it.each([
      ["a non-member", {}],
      ["a MEMBER", { 2: { role: MembershipRole.MEMBER } }],
      ["an un-accepted ADMIN", { 2: { role: MembershipRole.ADMIN, accepted: false } }],
    ])("forbids %s", async (_label, rows) => {
      givenMemberships(rows);

      await expectError(service.updateTeam(actor, 10, { name: "New" }), ErrorCode.Forbidden);
      expect(teamRepository.update).not.toHaveBeenCalled();
    });

    it.each([
      MembershipRole.ADMIN,
      MembershipRole.OWNER,
    ])("lets an accepted %s update the profile", async (role) => {
      givenMemberships({ 2: { role } });

      await service.updateTeam(actor, 10, { name: "New", bio: "Bio", timeZone: "Asia/Dubai" });

      expect(teamRepository.update).toHaveBeenCalledWith({
        id: 10,
        data: { name: "New", bio: "Bio", timeZone: "Asia/Dubai" },
      });
    });

    it("lets the instance admin update without a membership", async () => {
      await service.updateTeam(instanceAdmin, 10, { name: "New" });

      expect(teamRepository.update).toHaveBeenCalled();
    });

    it("checks a changed slug for uniqueness, ignoring the team itself", async () => {
      givenMemberships({ 2: { role: MembershipRole.ADMIN } });
      teamRepository.findIdBySlugAmongTopLevelTeams.mockResolvedValue({ id: 10 });

      await service.updateTeam(actor, 10, { slug: "Sales" });
      expect(teamRepository.update).toHaveBeenCalledWith({ id: 10, data: { slug: "sales" } });

      teamRepository.findIdBySlugAmongTopLevelTeams.mockResolvedValue({ id: 99 });
      await expectError(service.updateTeam(actor, 10, { slug: "taken" }), ErrorCode.BadRequest, /slug/i);
    });

    it("uploads a new logo and stores its URL, and clears it on null", async () => {
      givenMemberships({ 2: { role: MembershipRole.OWNER } });
      uploadLogo.mockResolvedValue("/api/avatar/abc.png");

      await service.updateTeam(actor, 10, { logo: "data:image/png;base64,AAA" });
      expect(uploadLogo).toHaveBeenCalledWith({ teamId: 10, logo: "data:image/png;base64,AAA" });
      expect(teamRepository.update).toHaveBeenLastCalledWith({
        id: 10,
        data: { logoUrl: "/api/avatar/abc.png" },
      });

      await service.updateTeam(actor, 10, { logo: null });
      expect(teamRepository.update).toHaveBeenLastCalledWith({ id: 10, data: { logoUrl: null } });
    });

    it("returns NotFound for a team that does not exist", async () => {
      teamRepository.findById.mockResolvedValue(null);

      await expectError(service.updateTeam(instanceAdmin, 10, { name: "New" }), ErrorCode.NotFound);
    });
  });

  describe("deleteTeam", () => {
    it("only lets the instance admin delete, not even the team OWNER", async () => {
      givenMemberships({ 2: { role: MembershipRole.OWNER } });

      await expectError(service.deleteTeam(actor, 10), ErrorCode.Forbidden);
      expect(teamRepository.delete).not.toHaveBeenCalled();
    });

    it("deletes as the instance admin, removing the team's stored logo too", async () => {
      await service.deleteTeam(instanceAdmin, 10);

      expect(teamRepository.delete).toHaveBeenCalledWith({ id: 10 });
      expect(teamRepository.deleteLogos).toHaveBeenCalledWith({ teamId: 10 });
    });

    it("leaves the logo alone when the delete is refused", async () => {
      await expectError(service.deleteTeam(actor, 10), ErrorCode.Forbidden);

      expect(teamRepository.deleteLogos).not.toHaveBeenCalled();
    });

    it("returns NotFound for a team that does not exist", async () => {
      teamRepository.findById.mockResolvedValue(null);

      await expectError(service.deleteTeam(instanceAdmin, 10), ErrorCode.NotFound);
    });
  });

  describe("countUpcomingBookings", () => {
    it("lets only the instance admin count a team's upcoming bookings", async () => {
      givenMemberships({ 2: { role: MembershipRole.OWNER } });
      await expectError(service.countUpcomingBookings(actor, 10), ErrorCode.Forbidden);
      expect(teamRepository.countUpcomingBookings).not.toHaveBeenCalled();

      teamRepository.countUpcomingBookings.mockResolvedValue(3);
      await expect(service.countUpcomingBookings(instanceAdmin, 10)).resolves.toBe(3);
      expect(teamRepository.countUpcomingBookings).toHaveBeenCalledWith({
        teamId: 10,
        now: expect.any(Date),
      });
    });

    it("returns NotFound for a team that does not exist", async () => {
      teamRepository.findById.mockResolvedValue(null);

      await expectError(service.countUpcomingBookings(instanceAdmin, 10), ErrorCode.NotFound);
    });
  });

  describe("addMemberByEmail", () => {
    beforeEach(() => {
      userRepository.findByEmail.mockResolvedValue({ id: 5 });
    });

    it("forbids a MEMBER", async () => {
      givenMemberships({ 2: { role: MembershipRole.MEMBER } });

      await expectError(
        service.addMemberByEmail(actor, 10, { email: "new@example.com", role: MembershipRole.MEMBER }),
        ErrorCode.Forbidden
      );
    });

    it("adds an existing user as an accepted member", async () => {
      givenMemberships({ 2: { role: MembershipRole.ADMIN } });

      await service.addMemberByEmail(actor, 10, { email: "New@Example.com", role: MembershipRole.MEMBER });

      expect(userRepository.findByEmail).toHaveBeenCalledWith({ email: "New@Example.com" });
      expect(membershipRepository.createAccepted).toHaveBeenCalledWith({
        teamId: 10,
        userId: 5,
        role: MembershipRole.MEMBER,
      });
    });

    it("points an unknown email to the admin add-user page", async () => {
      givenMemberships({ 2: { role: MembershipRole.ADMIN } });
      userRepository.findByEmail.mockResolvedValue(null);

      await expectError(
        service.addMemberByEmail(actor, 10, { email: "nobody@example.com", role: MembershipRole.MEMBER }),
        ErrorCode.NotFound,
        /\/settings\/admin\/users\/add/
      );
      expect(membershipRepository.createAccepted).not.toHaveBeenCalled();
    });

    it("rejects a user who is already a member", async () => {
      givenMemberships({ 2: { role: MembershipRole.ADMIN }, 5: { role: MembershipRole.MEMBER } });

      await expectError(
        service.addMemberByEmail(actor, 10, { email: "new@example.com", role: MembershipRole.MEMBER }),
        ErrorCode.BadRequest,
        /already/i
      );
    });

    it("lets only an OWNER or the instance admin add an OWNER", async () => {
      givenMemberships({ 2: { role: MembershipRole.ADMIN } });
      await expectError(
        service.addMemberByEmail(actor, 10, { email: "new@example.com", role: MembershipRole.OWNER }),
        ErrorCode.Forbidden
      );

      givenMemberships({ 2: { role: MembershipRole.OWNER } });
      await service.addMemberByEmail(actor, 10, { email: "new@example.com", role: MembershipRole.OWNER });
      expect(membershipRepository.createAccepted).toHaveBeenCalledTimes(1);

      givenMemberships({});
      await service.addMemberByEmail(instanceAdmin, 10, {
        email: "new@example.com",
        role: MembershipRole.OWNER,
      });
      expect(membershipRepository.createAccepted).toHaveBeenCalledTimes(2);
    });
  });

  describe("changeMemberRole", () => {
    it("forbids a MEMBER", async () => {
      givenMemberships({ 2: { role: MembershipRole.MEMBER }, 5: { role: MembershipRole.MEMBER } });

      await expectError(service.changeMemberRole(actor, 10, 5, MembershipRole.ADMIN), ErrorCode.Forbidden);
    });

    it("lets an ADMIN change a MEMBER to ADMIN", async () => {
      givenMemberships({ 2: { role: MembershipRole.ADMIN }, 5: { role: MembershipRole.MEMBER } });

      await service.changeMemberRole(actor, 10, 5, MembershipRole.ADMIN);

      expect(membershipRepository.updateRole).toHaveBeenCalledWith({
        teamId: 10,
        userId: 5,
        role: MembershipRole.ADMIN,
      });
    });

    it("lets only an OWNER or the instance admin grant OWNER", async () => {
      givenMemberships({ 2: { role: MembershipRole.ADMIN }, 5: { role: MembershipRole.MEMBER } });
      await expectError(service.changeMemberRole(actor, 10, 5, MembershipRole.OWNER), ErrorCode.Forbidden);

      givenMemberships({ 2: { role: MembershipRole.OWNER }, 5: { role: MembershipRole.MEMBER } });
      await service.changeMemberRole(actor, 10, 5, MembershipRole.OWNER);

      await service.changeMemberRole(instanceAdmin, 10, 5, MembershipRole.OWNER);
      expect(membershipRepository.updateRole).toHaveBeenCalledTimes(2);
    });

    it("lets only an OWNER or the instance admin revoke OWNER", async () => {
      givenMemberships({ 2: { role: MembershipRole.ADMIN }, 5: { role: MembershipRole.OWNER } });

      await expectError(service.changeMemberRole(actor, 10, 5, MembershipRole.MEMBER), ErrorCode.Forbidden);
    });

    it("blocks demoting the last OWNER, including yourself", async () => {
      givenMemberships({ 2: { role: MembershipRole.OWNER } });
      membershipRepository.countAcceptedOwners.mockResolvedValue(1);

      await expectError(
        service.changeMemberRole(actor, 10, 2, MembershipRole.ADMIN),
        ErrorCode.BadRequest,
        /last owner/i
      );
      expect(membershipRepository.updateRole).not.toHaveBeenCalled();
    });

    it("allows demoting an OWNER when another OWNER remains", async () => {
      givenMemberships({ 2: { role: MembershipRole.OWNER }, 5: { role: MembershipRole.OWNER } });
      membershipRepository.countAcceptedOwners.mockResolvedValue(2);

      await service.changeMemberRole(actor, 10, 5, MembershipRole.ADMIN);

      expect(membershipRepository.updateRole).toHaveBeenCalled();
    });

    it("returns NotFound for a user who is not in the team", async () => {
      givenMemberships({ 2: { role: MembershipRole.OWNER } });

      await expectError(service.changeMemberRole(actor, 10, 5, MembershipRole.ADMIN), ErrorCode.NotFound);
    });
  });

  describe("removeMember", () => {
    it("forbids a MEMBER", async () => {
      givenMemberships({ 2: { role: MembershipRole.MEMBER }, 5: { role: MembershipRole.MEMBER } });

      await expectError(service.removeMember(actor, 10, 5), ErrorCode.Forbidden);
    });

    it("lets an ADMIN remove a MEMBER", async () => {
      givenMemberships({ 2: { role: MembershipRole.ADMIN }, 5: { role: MembershipRole.MEMBER } });

      await service.removeMember(actor, 10, 5);

      expect(membershipRepository.deleteByUserIdAndTeamId).toHaveBeenCalledWith({ teamId: 10, userId: 5 });
    });

    it("lets only an OWNER or the instance admin remove an OWNER", async () => {
      givenMemberships({ 2: { role: MembershipRole.ADMIN }, 5: { role: MembershipRole.OWNER } });

      await expectError(service.removeMember(actor, 10, 5), ErrorCode.Forbidden);
    });

    it("blocks removing the last OWNER, including yourself", async () => {
      givenMemberships({ 2: { role: MembershipRole.OWNER } });
      membershipRepository.countAcceptedOwners.mockResolvedValue(1);

      await expectError(service.removeMember(actor, 10, 2), ErrorCode.BadRequest, /last owner/i);
      await expectError(service.removeMember(instanceAdmin, 10, 2), ErrorCode.BadRequest, /last owner/i);
      expect(membershipRepository.deleteByUserIdAndTeamId).not.toHaveBeenCalled();
    });

    it("returns NotFound for a user who is not in the team", async () => {
      givenMemberships({ 2: { role: MembershipRole.OWNER } });

      await expectError(service.removeMember(actor, 10, 5), ErrorCode.NotFound);
    });

    it.each([
      MembershipRole.MEMBER,
      MembershipRole.ADMIN,
    ])("lets an accepted %s leave the team", async (role) => {
      givenMemberships({ 2: { role } });

      await service.removeMember(actor, 10, 2);

      expect(membershipRepository.deleteByUserIdAndTeamId).toHaveBeenCalledWith({ teamId: 10, userId: 2 });
    });

    it("lets an OWNER leave while another OWNER remains", async () => {
      givenMemberships({ 2: { role: MembershipRole.OWNER } });
      membershipRepository.countAcceptedOwners.mockResolvedValue(2);

      await service.removeMember(actor, 10, 2);

      expect(membershipRepository.deleteByUserIdAndTeamId).toHaveBeenCalledWith({ teamId: 10, userId: 2 });
    });

    it("does not let a pending invitee remove themselves without admin rights", async () => {
      givenMemberships({ 2: { role: MembershipRole.MEMBER, accepted: false } });

      await expectError(service.removeMember(actor, 10, 2), ErrorCode.Forbidden);
      expect(membershipRepository.deleteByUserIdAndTeamId).not.toHaveBeenCalled();
    });

    it("does not count a pending OWNER invite as the last owner", async () => {
      givenMemberships({
        2: { role: MembershipRole.OWNER },
        5: { role: MembershipRole.OWNER, accepted: false },
      });
      membershipRepository.countAcceptedOwners.mockResolvedValue(1);

      await service.removeMember(actor, 10, 5);

      expect(membershipRepository.deleteByUserIdAndTeamId).toHaveBeenCalledWith({ teamId: 10, userId: 5 });
    });
  });
});

import type { EventTypeRepository } from "@calcom/features/eventtypes/repositories/eventTypeRepository";
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
  createWithOwner: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  findStandaloneById: vi.fn(),
  findIdBySlugAmongTopLevelTeams: vi.fn(),
  deleteLogos: vi.fn(),
  countUpcomingBookings: vi.fn(),
  listByMemberUserIdIncludeRole: vi.fn(),
  listStandaloneIncludeMemberCount: vi.fn(),
};
const membershipRepository = {
  findRoleAndAcceptedByUserIdAndTeamId: vi.fn(),
  createAcceptedWithHosts: vi.fn(),
  updateRole: vi.fn(),
  deleteByUserIdAndTeamIdWithHosts: vi.fn(),
  countAcceptedOwners: vi.fn(),
  findByTeamIdIncludeUser: vi.fn(),
};
const userRepository = { findByEmailIncludeLocked: vi.fn() };
const eventTypeRepository = { findManyAssignAllByTeamId: vi.fn() };
const uploadLogo = vi.fn();

const service = new TeamService({
  teamRepository: teamRepository as unknown as TeamRepository,
  membershipRepository: membershipRepository as unknown as MembershipRepository,
  userRepository: userRepository as unknown as UserRepository,
  eventTypeRepository: eventTypeRepository as unknown as EventTypeRepository,
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
    teamRepository.findStandaloneById.mockResolvedValue(team);
    teamRepository.findIdBySlugAmongTopLevelTeams.mockResolvedValue(null);
    teamRepository.createWithOwner.mockResolvedValue(team);
    teamRepository.update.mockResolvedValue(team);
    membershipRepository.countAcceptedOwners.mockResolvedValue(2);
    eventTypeRepository.findManyAssignAllByTeamId.mockResolvedValue([]);
    givenMemberships({});
  });

  describe("listTeams", () => {
    it("lists the caller's accepted teams with their role", async () => {
      teamRepository.listByMemberUserIdIncludeRole.mockResolvedValue([
        { ...team, members: [{ role: MembershipRole.ADMIN }] },
      ]);

      await expect(service.listTeams(actor)).resolves.toEqual([
        { ...team, role: MembershipRole.ADMIN, memberCount: null },
      ]);
      expect(teamRepository.listByMemberUserIdIncludeRole).toHaveBeenCalledWith({ userId: 2 });
      expect(teamRepository.listStandaloneIncludeMemberCount).not.toHaveBeenCalled();
    });

    it("lists every standalone team with member counts for the instance admin", async () => {
      teamRepository.listStandaloneIncludeMemberCount.mockResolvedValue([
        { ...team, _count: { members: 3 } },
      ]);

      await expect(service.listTeams(instanceAdmin)).resolves.toEqual([
        { ...team, role: null, memberCount: 3 },
      ]);
      expect(teamRepository.listByMemberUserIdIncludeRole).not.toHaveBeenCalled();
    });
  });

  describe("getTeam", () => {
    it.each([
      MembershipRole.MEMBER,
      MembershipRole.ADMIN,
      MembershipRole.OWNER,
    ])("returns the profile with the caller's role to an accepted %s", async (role) => {
      givenMemberships({ 2: { role } });

      await expect(service.getTeam(actor, 10)).resolves.toEqual({ ...team, role });
      expect(teamRepository.findStandaloneById).toHaveBeenCalledWith({ id: 10 });
    });

    it("returns the profile with a null role to the instance admin without a membership", async () => {
      await expect(service.getTeam(instanceAdmin, 10)).resolves.toEqual({ ...team, role: null });
    });

    it("returns the instance admin's own role when they are a member", async () => {
      givenMemberships({ 1: { role: MembershipRole.OWNER } });

      await expect(service.getTeam(instanceAdmin, 10)).resolves.toEqual({
        ...team,
        role: MembershipRole.OWNER,
      });
    });

    it("looks up the caller's membership once", async () => {
      givenMemberships({ 2: { role: MembershipRole.MEMBER } });

      await service.getTeam(actor, 10);

      expect(membershipRepository.findRoleAndAcceptedByUserIdAndTeamId).toHaveBeenCalledTimes(1);
    });

    it("refuses non-members and pending invitees", async () => {
      await expectError(service.getTeam(actor, 10), ErrorCode.Forbidden);

      givenMemberships({ 2: { role: MembershipRole.ADMIN, accepted: false } });
      await expectError(service.getTeam(actor, 10), ErrorCode.Forbidden);
      expect(teamRepository.findStandaloneById).not.toHaveBeenCalled();
    });

    it("reports a missing or non-standalone team as not found", async () => {
      teamRepository.findStandaloneById.mockResolvedValue(null);

      await expectError(service.getTeam(instanceAdmin, 10), ErrorCode.NotFound);
    });
  });

  describe("createTeam", () => {
    it("only lets the instance admin create teams", async () => {
      await expectError(service.createTeam(actor, { name: "Sales" }), ErrorCode.Forbidden);
      expect(teamRepository.createWithOwner).not.toHaveBeenCalled();
    });

    it("slugifies the slug, checks it among top-level teams and makes the creator an accepted OWNER", async () => {
      await service.createTeam(instanceAdmin, { name: "Sales Team", slug: "Sales Team!", bio: "Hi" });

      expect(teamRepository.findIdBySlugAmongTopLevelTeams).toHaveBeenCalledWith({ slug: "sales-team" });
      expect(teamRepository.createWithOwner).toHaveBeenCalledWith({
        name: "Sales Team",
        slug: "sales-team",
        bio: "Hi",
        timeZone: undefined,
        ownerUserId: 1,
      });
    });

    it("derives the slug from the name when none is given", async () => {
      await service.createTeam(instanceAdmin, { name: "Customer Success" });

      expect(teamRepository.createWithOwner).toHaveBeenCalledWith(
        expect.objectContaining({ slug: "customer-success" })
      );
    });

    it("rejects a slug already used by another top-level team", async () => {
      teamRepository.findIdBySlugAmongTopLevelTeams.mockResolvedValue({ id: 99 });

      await expectError(service.createTeam(instanceAdmin, { name: "Sales" }), ErrorCode.BadRequest, /slug/i);
      expect(teamRepository.createWithOwner).not.toHaveBeenCalled();
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
      teamRepository.findStandaloneById.mockResolvedValue(null);

      await expectError(service.updateTeam(instanceAdmin, 10, { name: "New" }), ErrorCode.NotFound);
    });

    it("rejects an invalid logo before uploading or saving anything", async () => {
      await expectError(
        service.updateTeam(instanceAdmin, 10, { logo: "data:image/bmp;base64,AAAA" }),
        ErrorCode.BadRequest,
        /logo/i
      );
      expect(uploadLogo).not.toHaveBeenCalled();
      expect(teamRepository.update).not.toHaveBeenCalled();
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
      teamRepository.findStandaloneById.mockResolvedValue(null);

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
      teamRepository.findStandaloneById.mockResolvedValue(null);

      await expectError(service.countUpcomingBookings(instanceAdmin, 10), ErrorCode.NotFound);
    });
  });

  describe("listMembers", () => {
    const rows = [
      {
        role: MembershipRole.OWNER,
        accepted: true,
        user: { id: 2, name: "Ann", username: "ann", email: "ann@example.com", avatarUrl: null },
      },
      {
        role: MembershipRole.MEMBER,
        accepted: false,
        user: { id: 3, name: "Bo", username: "bo", email: "bo@example.com", avatarUrl: "/a.png" },
      },
    ];
    const withEmails = [
      {
        userId: 2,
        name: "Ann",
        username: "ann",
        email: "ann@example.com",
        avatarUrl: null,
        role: MembershipRole.OWNER,
        accepted: true,
      },
      {
        userId: 3,
        name: "Bo",
        username: "bo",
        email: "bo@example.com",
        avatarUrl: "/a.png",
        role: MembershipRole.MEMBER,
        accepted: false,
      },
    ];

    beforeEach(() => {
      membershipRepository.findByTeamIdIncludeUser.mockResolvedValue(rows);
    });

    it("hides emails from a plain member", async () => {
      givenMemberships({ 2: { role: MembershipRole.MEMBER } });

      await expect(service.listMembers(actor, 10)).resolves.toEqual(
        withEmails.map((member) => ({ ...member, email: null }))
      );
      expect(membershipRepository.findByTeamIdIncludeUser).toHaveBeenCalledWith({ teamId: 10 });
    });

    it.each([MembershipRole.ADMIN, MembershipRole.OWNER])("shows emails to a team %s", async (role) => {
      givenMemberships({ 2: { role } });

      await expect(service.listMembers(actor, 10)).resolves.toEqual(withEmails);
    });

    it("shows emails to the instance admin", async () => {
      await expect(service.listMembers(instanceAdmin, 10)).resolves.toEqual(withEmails);
    });

    it("looks up the caller's membership once", async () => {
      givenMemberships({ 2: { role: MembershipRole.ADMIN } });

      await service.listMembers(actor, 10);

      expect(membershipRepository.findRoleAndAcceptedByUserIdAndTeamId).toHaveBeenCalledTimes(1);
      expect(membershipRepository.findRoleAndAcceptedByUserIdAndTeamId).toHaveBeenCalledWith({
        userId: 2,
        teamId: 10,
      });
    });

    it("needs no membership lookup for the instance admin", async () => {
      await service.listMembers(instanceAdmin, 10);

      expect(membershipRepository.findRoleAndAcceptedByUserIdAndTeamId).not.toHaveBeenCalled();
    });

    it("refuses non-members and pending invitees", async () => {
      await expectError(service.listMembers(actor, 10), ErrorCode.Forbidden);

      givenMemberships({ 2: { role: MembershipRole.OWNER, accepted: false } });
      await expectError(service.listMembers(actor, 10), ErrorCode.Forbidden);
      expect(membershipRepository.findByTeamIdIncludeUser).not.toHaveBeenCalled();
    });

    it("reports a missing or non-standalone team as not found", async () => {
      teamRepository.findStandaloneById.mockResolvedValue(null);

      await expectError(service.listMembers(instanceAdmin, 10), ErrorCode.NotFound);
    });
  });

  describe("addMemberByEmail", () => {
    beforeEach(() => {
      userRepository.findByEmailIncludeLocked.mockResolvedValue({ id: 5, locked: false });
    });

    // "Add all team members, including future members" lives in Host rows, so a new member must join them.
    it("makes the new member a host on every assign-all event type of the team", async () => {
      eventTypeRepository.findManyAssignAllByTeamId.mockResolvedValue([
        { id: 3, schedulingType: "COLLECTIVE" },
        { id: 4, schedulingType: "ROUND_ROBIN" },
      ]);

      await service.addMemberByEmail(instanceAdmin, 10, {
        email: "new@example.com",
        role: MembershipRole.MEMBER,
      });

      expect(eventTypeRepository.findManyAssignAllByTeamId).toHaveBeenCalledWith({
        teamId: 10,
      });
      expect(membershipRepository.createAcceptedWithHosts).toHaveBeenCalledWith({
        teamId: 10,
        userId: 5,
        role: MembershipRole.MEMBER,
        hosts: [
          { eventTypeId: 3, isFixed: true, priority: 2, weight: 100 },
          { eventTypeId: 4, isFixed: false, priority: 2, weight: 100 },
        ],
      });
    });

    it("rejects a locked user", async () => {
      userRepository.findByEmailIncludeLocked.mockResolvedValue({ id: 5, locked: true });

      await expectError(
        service.addMemberByEmail(instanceAdmin, 10, {
          email: "locked@example.com",
          role: MembershipRole.MEMBER,
        }),
        ErrorCode.BadRequest,
        /locked/i
      );
      expect(membershipRepository.createAcceptedWithHosts).not.toHaveBeenCalled();
    });

    it.each([
      MembershipRole.MEMBER,
      MembershipRole.ADMIN,
      MembershipRole.OWNER,
    ])("forbids a team %s: only instance admins add people to teams", async (role) => {
      givenMemberships({ 2: { role } });

      await expectError(
        service.addMemberByEmail(actor, 10, { email: "new@example.com", role: MembershipRole.MEMBER }),
        ErrorCode.Forbidden
      );
      expect(userRepository.findByEmailIncludeLocked).not.toHaveBeenCalled();
      expect(membershipRepository.createAcceptedWithHosts).not.toHaveBeenCalled();
    });

    it.each([
      MembershipRole.MEMBER,
      MembershipRole.ADMIN,
      MembershipRole.OWNER,
    ])("lets the instance admin add an existing user as an accepted %s", async (role) => {
      await service.addMemberByEmail(instanceAdmin, 10, { email: "New@Example.com", role });

      expect(userRepository.findByEmailIncludeLocked).toHaveBeenCalledWith({ email: "New@Example.com" });
      expect(membershipRepository.createAcceptedWithHosts).toHaveBeenCalledWith({
        teamId: 10,
        userId: 5,
        role,
        hosts: [],
      });
    });

    it("tells the admin to create the user first for an unknown email", async () => {
      userRepository.findByEmailIncludeLocked.mockResolvedValue(null);

      await expectError(
        service.addMemberByEmail(instanceAdmin, 10, {
          email: "nobody@example.com",
          role: MembershipRole.MEMBER,
        }),
        ErrorCode.NotFound,
        /Create the user first\.$/
      );
      expect(membershipRepository.createAcceptedWithHosts).not.toHaveBeenCalled();
    });

    it("rejects a user who is already a member", async () => {
      givenMemberships({ 5: { role: MembershipRole.MEMBER } });

      await expectError(
        service.addMemberByEmail(instanceAdmin, 10, {
          email: "new@example.com",
          role: MembershipRole.MEMBER,
        }),
        ErrorCode.BadRequest,
        /already/i
      );
    });

    it("returns NotFound for a team that does not exist", async () => {
      teamRepository.findStandaloneById.mockResolvedValue(null);

      await expectError(
        service.addMemberByEmail(instanceAdmin, 10, {
          email: "new@example.com",
          role: MembershipRole.MEMBER,
        }),
        ErrorCode.NotFound
      );
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

    it("returns NotFound for an organisation or child team, which findStandaloneById does not return", async () => {
      givenMemberships({ 2: { role: MembershipRole.OWNER }, 5: { role: MembershipRole.MEMBER } });
      teamRepository.findStandaloneById.mockResolvedValue(null);

      await expectError(service.changeMemberRole(actor, 10, 5, MembershipRole.ADMIN), ErrorCode.NotFound);
      expect(teamRepository.findStandaloneById).toHaveBeenCalledWith({ id: 10 });
      expect(membershipRepository.updateRole).not.toHaveBeenCalled();
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

      expect(membershipRepository.deleteByUserIdAndTeamIdWithHosts).toHaveBeenCalledWith({
        teamId: 10,
        userId: 5,
      });
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
      expect(membershipRepository.deleteByUserIdAndTeamIdWithHosts).not.toHaveBeenCalled();
    });

    it("returns NotFound for a user who is not in the team", async () => {
      givenMemberships({ 2: { role: MembershipRole.OWNER } });

      await expectError(service.removeMember(actor, 10, 5), ErrorCode.NotFound);
    });

    it.each([
      ["an admin removing someone", 5],
      ["a member leaving", 2],
    ])("returns NotFound on an organisation or child team for %s", async (_label, userId) => {
      givenMemberships({ 2: { role: MembershipRole.OWNER }, 5: { role: MembershipRole.MEMBER } });
      teamRepository.findStandaloneById.mockResolvedValue(null);

      await expectError(service.removeMember(actor, 10, userId), ErrorCode.NotFound);
      expect(teamRepository.findStandaloneById).toHaveBeenCalledWith({ id: 10 });
      expect(membershipRepository.deleteByUserIdAndTeamIdWithHosts).not.toHaveBeenCalled();
    });

    it.each([
      MembershipRole.MEMBER,
      MembershipRole.ADMIN,
    ])("lets an accepted %s leave the team", async (role) => {
      givenMemberships({ 2: { role } });

      await service.removeMember(actor, 10, 2);

      expect(membershipRepository.deleteByUserIdAndTeamIdWithHosts).toHaveBeenCalledWith({
        teamId: 10,
        userId: 2,
      });
    });

    it("lets an OWNER leave while another OWNER remains", async () => {
      givenMemberships({ 2: { role: MembershipRole.OWNER } });
      membershipRepository.countAcceptedOwners.mockResolvedValue(2);

      await service.removeMember(actor, 10, 2);

      expect(membershipRepository.deleteByUserIdAndTeamIdWithHosts).toHaveBeenCalledWith({
        teamId: 10,
        userId: 2,
      });
    });

    it("does not let a pending invitee remove themselves without admin rights", async () => {
      givenMemberships({ 2: { role: MembershipRole.MEMBER, accepted: false } });

      await expectError(service.removeMember(actor, 10, 2), ErrorCode.Forbidden);
      expect(membershipRepository.deleteByUserIdAndTeamIdWithHosts).not.toHaveBeenCalled();
    });

    it("does not count a pending OWNER invite as the last owner", async () => {
      givenMemberships({
        2: { role: MembershipRole.OWNER },
        5: { role: MembershipRole.OWNER, accepted: false },
      });
      membershipRepository.countAcceptedOwners.mockResolvedValue(1);

      await service.removeMember(actor, 10, 5);

      expect(membershipRepository.deleteByUserIdAndTeamIdWithHosts).toHaveBeenCalledWith({
        teamId: 10,
        userId: 5,
      });
    });
  });
});

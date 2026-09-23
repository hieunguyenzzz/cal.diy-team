import type { MembershipRepository } from "@calcom/features/membership/repositories/MembershipRepository";
import type { TeamRepository } from "@calcom/features/teams/repositories/TeamRepository";
import { TeamPermissionService } from "@calcom/features/teams/services/TeamPermissionService";
import { TeamService } from "@calcom/features/teams/services/TeamService";
import type { UserRepository } from "@calcom/features/users/repositories/UserRepository";
import { MembershipRole, UserPermissionRole } from "@calcom/prisma/enums";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TRPCContextInner } from "../../../createContext";
import { createCallerFactory } from "../../../trpc";
import { teamsRouter } from "./_router";

const teamRepository = {
  createWithOwner: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  deleteLogos: vi.fn(),
  countUpcomingBookings: vi.fn(),
  findStandaloneById: vi.fn(),
  findIdBySlugAmongTopLevelTeams: vi.fn(),
  listByMemberUserIdIncludeRole: vi.fn(),
  listStandaloneIncludeMemberCount: vi.fn(),
};
const membershipRepository = { findRoleAndAcceptedByUserIdAndTeamId: vi.fn() };
const uploadLogo = vi.fn();

// The real service with fake repositories, so each test exercises zod, the permission rules and the
// ErrorWithCode -> TRPCError conversion together.
const teamService = new TeamService({
  teamRepository: teamRepository as unknown as TeamRepository,
  membershipRepository: membershipRepository as unknown as MembershipRepository,
  userRepository: { findByEmail: vi.fn() } as unknown as UserRepository,
  teamPermissionService: new TeamPermissionService(membershipRepository as unknown as MembershipRepository),
  uploadLogo,
});

const { session } = vi.hoisted(() => ({
  session: { user: { id: 2, role: "USER" as string } },
}));
vi.mock("@calcom/features/auth/lib/userFromSessionUtils", () => ({
  getUserSession: async () => ({ user: session.user, session: { user: session.user } }),
}));
vi.mock("@calcom/features/teams/di/TeamService.container", () => ({
  getTeamService: () => teamService,
}));

const team = { id: 10, name: "Sales", slug: "sales", bio: null, timeZone: "Europe/London", logoUrl: null };
const caller = createCallerFactory(teamsRouter)({} as unknown as TRPCContextInner);

const signInAs = (role: UserPermissionRole, teamRole?: MembershipRole) => {
  session.user = { id: 2, role };
  membershipRepository.findRoleAndAcceptedByUserIdAndTeamId.mockResolvedValue(
    teamRole ? { role: teamRole, accepted: true } : null
  );
};

const expectCode = async (promise: Promise<unknown>, code: string) => {
  await expect(promise).rejects.toMatchObject({ code });
};

describe("viewer.teams router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    teamRepository.findStandaloneById.mockResolvedValue(team);
    teamRepository.findIdBySlugAmongTopLevelTeams.mockResolvedValue(null);
    teamRepository.createWithOwner.mockResolvedValue(team);
    teamRepository.update.mockResolvedValue(team);
    signInAs(UserPermissionRole.USER);
  });

  describe("list", () => {
    it("returns the caller's teams with their role", async () => {
      teamRepository.listByMemberUserIdIncludeRole.mockResolvedValue([
        { ...team, members: [{ role: MembershipRole.MEMBER }] },
      ]);

      await expect(caller.list()).resolves.toEqual([
        { ...team, role: MembershipRole.MEMBER, memberCount: null },
      ]);
    });

    it("returns every standalone team with member counts to the instance admin", async () => {
      signInAs(UserPermissionRole.ADMIN);
      teamRepository.listStandaloneIncludeMemberCount.mockResolvedValue([
        { ...team, _count: { members: 4 } },
      ]);

      await expect(caller.list()).resolves.toEqual([{ ...team, role: null, memberCount: 4 }]);
    });
  });

  describe("get", () => {
    it("returns the team to an accepted member", async () => {
      signInAs(UserPermissionRole.USER, MembershipRole.MEMBER);

      await expect(caller.get({ teamId: 10 })).resolves.toEqual(team);
    });

    it("is forbidden to non-members", async () => {
      await expectCode(caller.get({ teamId: 10 }), "FORBIDDEN");
    });

    it("maps a missing team to NOT_FOUND", async () => {
      signInAs(UserPermissionRole.ADMIN);
      teamRepository.findStandaloneById.mockResolvedValue(null);

      await expectCode(caller.get({ teamId: 10 }), "NOT_FOUND");
    });
  });

  describe("create", () => {
    it("is forbidden to anyone but the instance admin", async () => {
      signInAs(UserPermissionRole.USER, MembershipRole.OWNER);

      await expectCode(caller.create({ name: "Sales" }), "FORBIDDEN");
      expect(teamRepository.createWithOwner).not.toHaveBeenCalled();
    });

    it("creates the team for the instance admin with a trimmed name", async () => {
      signInAs(UserPermissionRole.ADMIN);

      await caller.create({ name: "  Sales  ", bio: "Hi", timeZone: "Europe/London" });

      expect(teamRepository.createWithOwner).toHaveBeenCalledWith({
        name: "Sales",
        slug: "sales",
        bio: "Hi",
        timeZone: "Europe/London",
        ownerUserId: 2,
      });
    });

    it.each([
      ["a blank name", { name: "   " }],
      ["a name over 100 characters", { name: "a".repeat(101) }],
      ["a slug over 100 characters", { name: "Sales", slug: "a".repeat(101) }],
      ["a bio over 1000 characters", { name: "Sales", bio: "a".repeat(1001) }],
      ["an unknown time zone", { name: "Sales", timeZone: "Mars/Olympus" }],
      ["a parentId", { name: "Sales", parentId: 1 }],
      ["isOrganization", { name: "Sales", isOrganization: true }],
    ])("rejects %s", async (_label, input) => {
      signInAs(UserPermissionRole.ADMIN);

      await expectCode(caller.create(input as { name: string }), "BAD_REQUEST");
      expect(teamRepository.createWithOwner).not.toHaveBeenCalled();
    });
  });

  describe("update", () => {
    it("is forbidden to a plain member", async () => {
      signInAs(UserPermissionRole.USER, MembershipRole.MEMBER);

      await expectCode(caller.update({ teamId: 10, name: "New" }), "FORBIDDEN");
      expect(teamRepository.update).not.toHaveBeenCalled();
    });

    it("lets a team admin update the profile and clear the logo", async () => {
      signInAs(UserPermissionRole.USER, MembershipRole.ADMIN);

      await caller.update({ teamId: 10, name: "New", bio: null, timeZone: "Asia/Dubai", logo: null });

      expect(teamRepository.update).toHaveBeenCalledWith({
        id: 10,
        data: { name: "New", bio: null, timeZone: "Asia/Dubai", logoUrl: null },
      });
    });

    it.each([
      ["a blank name", { teamId: 10, name: "" }],
      ["an unknown time zone", { teamId: 10, timeZone: "Not/AZone" }],
      ["a parentId", { teamId: 10, parentId: 3 }],
      ["isOrganization", { teamId: 10, isOrganization: true }],
    ])("rejects %s", async (_label, input) => {
      signInAs(UserPermissionRole.ADMIN);

      await expectCode(caller.update(input as { teamId: number }), "BAD_REQUEST");
      expect(teamRepository.update).not.toHaveBeenCalled();
    });
  });

  describe("delete", () => {
    it("is forbidden to a team owner who is not the instance admin", async () => {
      signInAs(UserPermissionRole.USER, MembershipRole.OWNER);

      await expectCode(caller.delete({ teamId: 10 }), "FORBIDDEN");
      expect(teamRepository.delete).not.toHaveBeenCalled();
    });

    it("deletes the team for the instance admin", async () => {
      signInAs(UserPermissionRole.ADMIN);

      await caller.delete({ teamId: 10 });

      expect(teamRepository.delete).toHaveBeenCalledWith({ id: 10 });
    });
  });

  describe("countUpcomingBookings", () => {
    it("is forbidden to a team owner who is not the instance admin", async () => {
      signInAs(UserPermissionRole.USER, MembershipRole.OWNER);

      await expectCode(caller.countUpcomingBookings({ teamId: 10 }), "FORBIDDEN");
    });

    it("returns the count to the instance admin", async () => {
      signInAs(UserPermissionRole.ADMIN);
      teamRepository.countUpcomingBookings.mockResolvedValue(7);

      await expect(caller.countUpcomingBookings({ teamId: 10 })).resolves.toBe(7);
    });
  });
});

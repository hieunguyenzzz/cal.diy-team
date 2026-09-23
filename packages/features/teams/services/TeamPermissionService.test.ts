import type { MembershipRepository } from "@calcom/features/membership/repositories/MembershipRepository";
import { MembershipRole, UserPermissionRole } from "@calcom/prisma/enums";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  roleAllowsTeamEventTypeAction,
  type TeamEventTypeAction,
  TeamPermissionService,
  toTeamEventTypeAction,
} from "./TeamPermissionService";

const mockFindRoleAndAcceptedByUserIdAndTeamId = vi.fn();
const membershipRepository = {
  findRoleAndAcceptedByUserIdAndTeamId: mockFindRoleAndAcceptedByUserIdAndTeamId,
} as unknown as MembershipRepository;

const service = new TeamPermissionService(membershipRepository);

const expectedByRole: Record<MembershipRole, Record<TeamEventTypeAction, boolean>> = {
  [MembershipRole.MEMBER]: { create: true, read: true, update: true, delete: false },
  [MembershipRole.ADMIN]: { create: true, read: true, update: true, delete: true },
  [MembershipRole.OWNER]: { create: true, read: true, update: true, delete: true },
};

const cases = Object.entries(expectedByRole).flatMap(([role, actions]) =>
  Object.entries(actions).map(([action, allowed]) => ({
    role: role as MembershipRole,
    action: action as TeamEventTypeAction,
    allowed,
  }))
);

describe("TeamPermissionService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("roleAllowsTeamEventTypeAction", () => {
    it.each(cases)("$role -> $action = $allowed", ({ role, action, allowed }) => {
      expect(roleAllowsTeamEventTypeAction(role, action)).toBe(allowed);
    });
  });

  describe("canPerformTeamEventTypeAction", () => {
    it.each(cases)("accepted $role -> $action = $allowed", async ({ role, action, allowed }) => {
      mockFindRoleAndAcceptedByUserIdAndTeamId.mockResolvedValue({ role, accepted: true });

      await expect(
        service.canPerformTeamEventTypeAction({
          userId: 1,
          userRole: UserPermissionRole.USER,
          teamId: 10,
          action,
        })
      ).resolves.toBe(allowed);
      expect(mockFindRoleAndAcceptedByUserIdAndTeamId).toHaveBeenCalledWith({ userId: 1, teamId: 10 });
    });

    it.each(["create", "read", "update", "delete"] as const)("denies non-member for %s", async (action) => {
      mockFindRoleAndAcceptedByUserIdAndTeamId.mockResolvedValue(null);

      await expect(
        service.canPerformTeamEventTypeAction({
          userId: 1,
          userRole: UserPermissionRole.USER,
          teamId: 10,
          action,
        })
      ).resolves.toBe(false);
    });

    it.each([
      "create",
      "read",
      "update",
      "delete",
    ] as const)("denies un-accepted OWNER membership for %s", async (action) => {
      mockFindRoleAndAcceptedByUserIdAndTeamId.mockResolvedValue({
        role: MembershipRole.OWNER,
        accepted: false,
      });

      await expect(
        service.canPerformTeamEventTypeAction({
          userId: 1,
          userRole: UserPermissionRole.USER,
          teamId: 10,
          action,
        })
      ).resolves.toBe(false);
    });

    it.each([
      "create",
      "read",
      "update",
      "delete",
    ] as const)("allows instance admin without membership for %s", async (action) => {
      mockFindRoleAndAcceptedByUserIdAndTeamId.mockResolvedValue(null);

      await expect(
        service.canPerformTeamEventTypeAction({
          userId: 1,
          userRole: UserPermissionRole.ADMIN,
          teamId: 10,
          action,
        })
      ).resolves.toBe(true);
      expect(mockFindRoleAndAcceptedByUserIdAndTeamId).not.toHaveBeenCalled();
    });

    it("treats a missing user role as a regular user", async () => {
      mockFindRoleAndAcceptedByUserIdAndTeamId.mockResolvedValue(null);

      await expect(
        service.canPerformTeamEventTypeAction({ userId: 1, userRole: undefined, teamId: 10, action: "read" })
      ).resolves.toBe(false);
    });
  });

  describe("toTeamEventTypeAction", () => {
    it.each([
      ["eventType.create", "create"],
      ["eventType.read", "read"],
      ["eventType.update", "update"],
      ["eventType.delete", "delete"],
    ])("maps %s to %s", (permission, action) => {
      expect(toTeamEventTypeAction(permission)).toBe(action);
    });

    it.each([
      "eventType.manage",
      "webhook.create",
      "",
      "constructor",
      "toString",
      "__proto__",
    ])("returns null for unknown permission %j", (permission) => {
      expect(toTeamEventTypeAction(permission)).toBeNull();
    });
  });

  describe("hasEventTypePermission", () => {
    it("delegates a known permission to the matching action", async () => {
      mockFindRoleAndAcceptedByUserIdAndTeamId.mockResolvedValue({
        role: MembershipRole.MEMBER,
        accepted: true,
      });

      await expect(
        service.hasEventTypePermission({
          userId: 1,
          userRole: UserPermissionRole.USER,
          teamId: 10,
          permission: "eventType.update",
        })
      ).resolves.toBe(true);
      await expect(
        service.hasEventTypePermission({
          userId: 1,
          userRole: UserPermissionRole.USER,
          teamId: 10,
          permission: "eventType.delete",
        })
      ).resolves.toBe(false);
    });

    it("denies unknown permissions, even for OWNER and instance admin", async () => {
      mockFindRoleAndAcceptedByUserIdAndTeamId.mockResolvedValue({
        role: MembershipRole.OWNER,
        accepted: true,
      });

      await expect(
        service.hasEventTypePermission({
          userId: 1,
          userRole: UserPermissionRole.USER,
          teamId: 10,
          permission: "eventType.manage",
        })
      ).resolves.toBe(false);
      await expect(
        service.hasEventTypePermission({
          userId: 1,
          userRole: UserPermissionRole.ADMIN,
          teamId: 10,
          permission: "team.delete",
        })
      ).resolves.toBe(false);
      expect(mockFindRoleAndAcceptedByUserIdAndTeamId).not.toHaveBeenCalled();
    });
  });
});

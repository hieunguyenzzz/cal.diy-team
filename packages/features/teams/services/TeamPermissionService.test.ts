import type { MembershipRepository } from "@calcom/features/membership/repositories/MembershipRepository";
import { MembershipRole, UserPermissionRole } from "@calcom/prisma/enums";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  roleCanManageTeamEventType,
  type TeamEventTypeAction,
  TeamPermissionService,
  toTeamEventTypeAction,
} from "./TeamPermissionService";

const mockFindRoleByUserIdAndTeamId = vi.fn();
const membershipRepository = {
  findRoleByUserIdAndTeamId: mockFindRoleByUserIdAndTeamId,
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

  describe("roleCanManageTeamEventType", () => {
    it.each(cases)("$role -> $action = $allowed", ({ role, action, allowed }) => {
      expect(roleCanManageTeamEventType(role, action)).toBe(allowed);
    });
  });

  describe("canManageTeamEventType", () => {
    it.each(cases)("accepted $role -> $action = $allowed", async ({ role, action, allowed }) => {
      mockFindRoleByUserIdAndTeamId.mockResolvedValue({ role, accepted: true });

      await expect(
        service.canManageTeamEventType({ userId: 1, userRole: UserPermissionRole.USER, teamId: 10, action })
      ).resolves.toBe(allowed);
      expect(mockFindRoleByUserIdAndTeamId).toHaveBeenCalledWith({ userId: 1, teamId: 10 });
    });

    it.each(["create", "read", "update", "delete"] as const)("denies non-member for %s", async (action) => {
      mockFindRoleByUserIdAndTeamId.mockResolvedValue(null);

      await expect(
        service.canManageTeamEventType({ userId: 1, userRole: UserPermissionRole.USER, teamId: 10, action })
      ).resolves.toBe(false);
    });

    it.each([
      "create",
      "read",
      "update",
      "delete",
    ] as const)("denies un-accepted OWNER membership for %s", async (action) => {
      mockFindRoleByUserIdAndTeamId.mockResolvedValue({ role: MembershipRole.OWNER, accepted: false });

      await expect(
        service.canManageTeamEventType({ userId: 1, userRole: UserPermissionRole.USER, teamId: 10, action })
      ).resolves.toBe(false);
    });

    it.each([
      "create",
      "read",
      "update",
      "delete",
    ] as const)("allows instance admin without membership for %s", async (action) => {
      mockFindRoleByUserIdAndTeamId.mockResolvedValue(null);

      await expect(
        service.canManageTeamEventType({ userId: 1, userRole: UserPermissionRole.ADMIN, teamId: 10, action })
      ).resolves.toBe(true);
      expect(mockFindRoleByUserIdAndTeamId).not.toHaveBeenCalled();
    });

    it("treats a missing user role as a regular user", async () => {
      mockFindRoleByUserIdAndTeamId.mockResolvedValue(null);

      await expect(
        service.canManageTeamEventType({ userId: 1, userRole: undefined, teamId: 10, action: "read" })
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
      mockFindRoleByUserIdAndTeamId.mockResolvedValue({ role: MembershipRole.MEMBER, accepted: true });

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
      mockFindRoleByUserIdAndTeamId.mockResolvedValue({ role: MembershipRole.OWNER, accepted: true });

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
      expect(mockFindRoleByUserIdAndTeamId).not.toHaveBeenCalled();
    });
  });
});

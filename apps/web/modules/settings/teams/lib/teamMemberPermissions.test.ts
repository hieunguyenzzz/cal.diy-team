import { describe, expect, it } from "vitest";
import { canChangeRole, canLeave, canRemove, roleOptionsFor } from "./teamMemberPermissions";

const actor = (role: "MEMBER" | "ADMIN" | "OWNER" | null, isInstanceAdmin = false) => ({
  userId: 1,
  role,
  isInstanceAdmin,
});
const member = (userId: number, role: "MEMBER" | "ADMIN" | "OWNER", accepted = true) => ({
  userId,
  role,
  accepted,
});

describe("teamMemberPermissions", () => {
  it("offers OWNER as a role only to owners and the instance admin", () => {
    expect(roleOptionsFor(actor("ADMIN"))).toEqual(["MEMBER", "ADMIN"]);
    expect(roleOptionsFor(actor("OWNER"))).toEqual(["MEMBER", "ADMIN", "OWNER"]);
    expect(roleOptionsFor(actor(null, true))).toEqual(["MEMBER", "ADMIN", "OWNER"]);
  });

  it("lets team admins and owners change roles, but only owners touch an OWNER row", () => {
    expect(canChangeRole(actor("MEMBER"), member(2, "MEMBER"))).toBe(false);
    expect(canChangeRole(actor("ADMIN"), member(2, "MEMBER"))).toBe(true);
    expect(canChangeRole(actor("ADMIN"), member(2, "OWNER"))).toBe(false);
    expect(canChangeRole(actor("OWNER"), member(2, "OWNER"))).toBe(true);
    expect(canChangeRole(actor(null, true), member(2, "OWNER"))).toBe(true);
  });

  it("lets team admins remove others, but only owners remove an owner, and nobody removes themselves", () => {
    expect(canRemove(actor("MEMBER"), member(2, "MEMBER"))).toBe(false);
    expect(canRemove(actor("ADMIN"), member(2, "MEMBER"))).toBe(true);
    expect(canRemove(actor("ADMIN"), member(2, "OWNER"))).toBe(false);
    expect(canRemove(actor("OWNER"), member(2, "OWNER"))).toBe(true);
    expect(canRemove(actor(null, true), member(2, "OWNER"))).toBe(true);
    expect(canRemove(actor("OWNER"), member(1, "OWNER"))).toBe(false);
  });

  it("lets any accepted member leave from their own row only", () => {
    expect(canLeave(actor("MEMBER"), member(1, "MEMBER"))).toBe(true);
    expect(canLeave(actor("OWNER"), member(1, "OWNER"))).toBe(true);
    expect(canLeave(actor("MEMBER"), member(2, "MEMBER"))).toBe(false);
    expect(canLeave(actor("MEMBER"), member(1, "MEMBER", false))).toBe(false);
  });
});

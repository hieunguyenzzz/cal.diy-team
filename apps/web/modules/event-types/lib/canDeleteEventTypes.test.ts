import { describe, expect, it } from "vitest";
import { canDeleteEventType, canDeleteEventTypesInGroup } from "./canDeleteEventTypes";

const profiles = [
  { teamId: null, canDeleteEventTypes: undefined },
  { teamId: 10, canDeleteEventTypes: false },
  { teamId: 20, canDeleteEventTypes: true },
];

describe("canDeleteEventTypesInGroup", () => {
  it("allows deleting personal event types", () => {
    expect(canDeleteEventTypesInGroup(profiles, null)).toBe(true);
  });

  it("follows the team profile's canDeleteEventTypes flag", () => {
    expect(canDeleteEventTypesInGroup(profiles, 10)).toBe(false);
    expect(canDeleteEventTypesInGroup(profiles, 20)).toBe(true);
  });

  it("hides Delete for a team the viewer has no profile for", () => {
    expect(canDeleteEventTypesInGroup(profiles, 30)).toBe(false);
  });
});

describe("canDeleteEventType (single event-type page)", () => {
  it("allows deleting a personal event type", () => {
    expect(canDeleteEventType({ teamId: null, currentUserMembership: null, userRole: "USER" })).toBe(true);
  });

  it.each([
    ["an accepted MEMBER", { role: "MEMBER", accepted: true }, false],
    ["an accepted ADMIN", { role: "ADMIN", accepted: true }, true],
    ["an accepted OWNER", { role: "OWNER", accepted: true }, true],
    ["an un-accepted OWNER", { role: "OWNER", accepted: false }, false],
    ["a non-member", null, false],
  ] as const)("on a team event type, %s -> %s", (_label, currentUserMembership, allowed) => {
    expect(canDeleteEventType({ teamId: 10, currentUserMembership, userRole: "USER" })).toBe(allowed);
  });

  it("lets the instance admin delete even as a MEMBER", () => {
    expect(
      canDeleteEventType({
        teamId: 10,
        currentUserMembership: { role: "MEMBER", accepted: true },
        userRole: "ADMIN",
      })
    ).toBe(true);
  });

  it.each([
    undefined,
    "INACTIVE_ADMIN",
  ] as const)("falls back to membership only when the role is %s (platform atoms pass none)", (userRole) => {
    expect(
      canDeleteEventType({ teamId: 10, currentUserMembership: { role: "MEMBER", accepted: true }, userRole })
    ).toBe(false);
    expect(
      canDeleteEventType({ teamId: 10, currentUserMembership: { role: "ADMIN", accepted: true }, userRole })
    ).toBe(true);
  });
});

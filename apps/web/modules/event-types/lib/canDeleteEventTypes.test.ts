import { describe, expect, it } from "vitest";
import { canDeleteEventTypesInGroup } from "./canDeleteEventTypes";

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

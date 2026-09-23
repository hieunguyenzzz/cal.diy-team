import { describe, expect, it } from "vitest";
import { checkForEmptyAssignment } from "./checkForEmptyAssignment";

const host = {
  userId: 1,
  isFixed: false,
  priority: 2,
  weight: 100,
  scheduleId: null,
  groupId: null,
  user: { timeZone: "UTC" },
};

describe("checkForEmptyAssignment", () => {
  it("flags a team event with no hosts", () => {
    expect(
      checkForEmptyAssignment({
        assignedUsers: [],
        hosts: [],
        isManagedEventType: false,
        assignAllTeamMembers: false,
      })
    ).toBe(true);
  });

  it("is satisfied by at least one host", () => {
    expect(
      checkForEmptyAssignment({
        assignedUsers: [],
        hosts: [host],
        isManagedEventType: false,
        assignAllTeamMembers: false,
      })
    ).toBe(false);
  });

  it("is satisfied by assigning all team members, even before hosts are saved", () => {
    expect(
      checkForEmptyAssignment({
        assignedUsers: [],
        hosts: [],
        isManagedEventType: false,
        assignAllTeamMembers: true,
      })
    ).toBe(false);
  });
});

import { MembershipRole } from "@calcom/prisma/enums";
import { describe, expect, it } from "vitest";
import { TeamAccessUseCase } from "../teamAccessUseCase";

type Memberships = Parameters<TeamAccessUseCase["filterTeamsByEventTypeReadPermission"]>[0];

const buildMembership = (
  teamId: number,
  overrides: { role?: MembershipRole; accepted?: boolean; isOrganization?: boolean } = {}
) =>
  ({
    teamId,
    userId: 1,
    role: overrides.role ?? MembershipRole.MEMBER,
    accepted: overrides.accepted ?? true,
    team: { id: teamId, isOrganization: overrides.isOrganization ?? false },
  }) as unknown as Memberships[number];

describe("TeamAccessUseCase.filterTeamsByEventTypeReadPermission", () => {
  const useCase = new TeamAccessUseCase();

  it("excludes organisation memberships", async () => {
    const result = await useCase.filterTeamsByEventTypeReadPermission([
      buildMembership(1, { role: MembershipRole.OWNER, isOrganization: true }),
    ]);

    expect(result).toEqual([]);
  });

  it("excludes memberships that are not accepted", async () => {
    const result = await useCase.filterTeamsByEventTypeReadPermission([
      buildMembership(2, { role: MembershipRole.OWNER, accepted: false }),
    ]);

    expect(result).toEqual([]);
  });

  it("keeps accepted MEMBER, ADMIN and OWNER memberships", async () => {
    const memberships = [
      buildMembership(3, { role: MembershipRole.MEMBER }),
      buildMembership(4, { role: MembershipRole.ADMIN }),
      buildMembership(5, { role: MembershipRole.OWNER }),
    ];

    const result = await useCase.filterTeamsByEventTypeReadPermission(memberships);

    expect(result.map((membership) => membership.teamId)).toEqual([3, 4, 5]);
  });
});

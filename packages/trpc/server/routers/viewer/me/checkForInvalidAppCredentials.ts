import { getAppFromSlug } from "@calcom/app-store/utils";
import { MembershipRepository } from "@calcom/features/membership/repositories/MembershipRepository";
import { TEAM_ADMIN_ROLES } from "@calcom/features/teams/lib/teamEventTypeRoles";
import { TeamPermissionService } from "@calcom/features/teams/services/TeamPermissionService";
import type { InvalidAppCredentialBannerProps } from "@calcom/features/users/types/invalidAppCredentials";
import { prisma } from "@calcom/prisma";
import type { TrpcSessionUser } from "@calcom/trpc/server/types";

type checkInvalidAppCredentialsOptions = {
  ctx: {
    user: NonNullable<TrpcSessionUser>;
  };
};

export const checkInvalidAppCredentials = async ({ ctx }: checkInvalidAppCredentialsOptions) => {
  const userId = ctx.user.id;

  // Team credentials are only flagged to the team's ADMIN/OWNERs, who can fix them.
  const userTeamIds = await new TeamPermissionService(new MembershipRepository(prisma)).getTeamIdsWithRole({
    userId,
    userRole: ctx.user.role,
    roles: TEAM_ADMIN_ROLES,
  });

  const apps = await prisma.credential.findMany({
    where: {
      OR: [{ userId }, { teamId: { in: userTeamIds } }],
      invalid: true,
    },
    select: {
      appId: true,
    },
  });

  const appNamesAndSlugs: InvalidAppCredentialBannerProps[] = [];
  for (const app of apps) {
    if (app.appId) {
      const appId = app.appId;
      const appMeta = await getAppFromSlug(appId);
      const name = appMeta ? appMeta.name : appId;
      appNamesAndSlugs.push({ slug: appId, name });
    }
  }

  return appNamesAndSlugs;
};

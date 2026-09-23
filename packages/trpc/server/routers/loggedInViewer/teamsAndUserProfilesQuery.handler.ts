import { rolesForTeamPermission } from "@calcom/features/teams/services/TeamPermissionService";
import { getPlaceholderAvatar } from "@calcom/lib/defaultAvatarImage";
import { getUserAvatarUrl } from "@calcom/lib/getAvatarUrl";
import type { PrismaClient } from "@calcom/prisma";
import { MembershipRole, UserPermissionRole } from "@calcom/prisma/enums";
import { teamMetadataSchema } from "@calcom/prisma/zod-utils";
import type { TrpcSessionUser } from "@calcom/trpc/server/types";
import { TRPCError } from "@trpc/server";
import type { TTeamsAndUserProfilesQueryInputSchema } from "./teamsAndUserProfilesQuery.schema";

type TeamsAndUserProfileOptions = {
  ctx: {
    user: NonNullable<TrpcSessionUser>;
    prisma: PrismaClient;
  };
  input: TTeamsAndUserProfilesQueryInputSchema;
};

export const teamsAndUserProfilesQuery = async ({ ctx, input }: TeamsAndUserProfileOptions) => {
  const { prisma } = ctx;

  const user = await prisma.user.findUnique({
    where: {
      id: ctx.user.id,
    },
    select: {
      avatarUrl: true,
      id: true,
      username: true,
      name: true,
      teams: {
        where: {
          accepted: true,
        },
        select: {
          role: true,
          team: {
            select: {
              id: true,
              isOrganization: true,
              logoUrl: true,
              name: true,
              slug: true,
              metadata: true,
              parentId: true,
              parent: {
                select: {
                  logoUrl: true,
                  name: true,
                },
              },
              members: {
                select: {
                  userId: true,
                },
              },
            },
          },
        },
      },
    },
  });
  if (!user) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
  }

  let teamsData: typeof user.teams extends (infer T)[]
    ? (T & {
        team: T extends { team: infer U }
          ? U & { metadata: ReturnType<typeof teamMetadataSchema.parse> }
          : never;
      })[]
    : never;

  if (input?.includeOrg) {
    teamsData = user.teams
      .filter((membership) => membership.team.slug !== null)
      .map((membership) => ({
        ...membership,
        team: {
          ...membership.team,
          metadata: teamMetadataSchema.parse(membership.team.metadata),
        },
      }));
  } else {
    teamsData = user.teams
      .filter((membership) => !membership.team.isOrganization)
      .map((membership) => ({
        ...membership,
        team: {
          ...membership.team,
          metadata: teamMetadataSchema.parse(membership.team.metadata),
        },
      }));
  }

  // Filter teams based on permission if provided; unknown permissions keep no teams.
  if (input?.withPermission) {
    const allowedRoles = rolesForTeamPermission(input.withPermission.permission);
    const isInstanceAdmin = ctx.user.role === UserPermissionRole.ADMIN;
    teamsData = teamsData.filter((membership) => isInstanceAdmin || allowedRoles.includes(membership.role));
  }

  // Sort teams so organizations come first, followed by other teams
  teamsData.sort((a, b) => {
    if (a.team.isOrganization && !b.team.isOrganization) return -1;
    if (!a.team.isOrganization && b.team.isOrganization) return 1;
    return 0;
  });

  const rolesWithWriteAccess = [MembershipRole.ADMIN, MembershipRole.OWNER] as MembershipRole[];

  return [
    {
      teamId: null,
      name: user.name,
      slug: user.username,
      image: getUserAvatarUrl({
        avatarUrl: user.avatarUrl,
      }),
      readOnly: false,
    },
    ...teamsData.map((membership) => ({
      teamId: membership.team.id,
      name: membership.team.name,
      slug: membership.team.slug ? `team/${membership.team.slug}` : null,
      image: membership.team?.parent
        ? getPlaceholderAvatar(membership.team.parent.logoUrl, membership.team.parent.name)
        : getPlaceholderAvatar(membership.team.logoUrl, membership.team.name),
      role: membership.role,
      readOnly: input?.withPermission ? false : !rolesWithWriteAccess.includes(membership.role),
    })),
  ];
};

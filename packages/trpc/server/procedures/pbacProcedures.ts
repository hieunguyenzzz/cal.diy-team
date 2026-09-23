import { MembershipRepository } from "@calcom/features/membership/repositories/MembershipRepository";
import { TeamPermissionService } from "@calcom/features/teams/services/TeamPermissionService";
import { MembershipRole } from "@calcom/prisma/enums";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import authedProcedure from "./authedProcedure";

type PermissionString = string;

/**
 * Creates a procedure that requires an accepted membership with one of `roles` in input.teamId.
 * The instance admin always passes.
 *
 * @param permission - Named in the FORBIDDEN message (e.g., "booking.readTeamBookings")
 * @param roles - Team roles allowed through (defaults to ADMIN and OWNER)
 */
function createTeamPbacProcedure(
  permission: PermissionString,
  roles: MembershipRole[] = [MembershipRole.ADMIN, MembershipRole.OWNER]
): ReturnType<typeof authedProcedure.input> {
  return authedProcedure
    .input(
      z.object({
        teamId: z.number(),
      })
    )
    .use(async ({ ctx, input, next }) => {
      const teamPermissionService = new TeamPermissionService(new MembershipRepository(ctx.prisma));
      const hasPermission = await teamPermissionService.hasTeamRole({
        userId: ctx.user.id,
        userRole: ctx.user.role,
        teamId: input.teamId,
        roles,
      });

      if (!hasPermission) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Permission required: ${permission}`,
        });
      }

      return next();
    });
}

export { createTeamPbacProcedure };

import { MembershipRepository } from "@calcom/features/membership/repositories/MembershipRepository";
import { TeamPermissionService } from "@calcom/features/teams/services/TeamPermissionService";
import { MembershipRole } from "@calcom/prisma/enums";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import authedProcedure from "./authedProcedure";

type PermissionString = string;

/**
 * Creates a procedure that checks team-level PBAC permissions.
 * The teamId is expected to come from input.teamId.
 *
 * @param permission - Named in the FORBIDDEN message (e.g., "booking.readTeamBookings")
 * @param fallbackRoles - Accepted team roles that may pass (defaults to ["ADMIN", "OWNER"]); there is no PBAC
 * @returns A procedure that checks the specified permission for the team
 */
function createTeamPbacProcedure(
  permission: PermissionString,
  fallbackRoles: MembershipRole[] = [MembershipRole.ADMIN, MembershipRole.OWNER]
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
        roles: fallbackRoles,
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

import { getTeamService } from "@calcom/features/teams/di/TeamService.container";
import type { TrpcSessionUser } from "@calcom/trpc/server/types";
import type { TCreateTeamInputSchema, TTeamIdInputSchema, TUpdateTeamInputSchema } from "./teams.schema";

type Ctx = { user: NonNullable<TrpcSessionUser> };

const toActor = (user: Ctx["user"]) => ({ userId: user.id, userRole: user.role });

export const listTeamsHandler = ({ ctx }: { ctx: Ctx }) => getTeamService().listTeams(toActor(ctx.user));

export const getTeamHandler = ({ ctx, input }: { ctx: Ctx; input: TTeamIdInputSchema }) =>
  getTeamService().getTeam(toActor(ctx.user), input.teamId);

export const createTeamHandler = ({ ctx, input }: { ctx: Ctx; input: TCreateTeamInputSchema }) =>
  getTeamService().createTeam(toActor(ctx.user), input);

export const updateTeamHandler = ({ ctx, input }: { ctx: Ctx; input: TUpdateTeamInputSchema }) => {
  const { teamId, ...profile } = input;
  return getTeamService().updateTeam(toActor(ctx.user), teamId, profile);
};

export const deleteTeamHandler = ({ ctx, input }: { ctx: Ctx; input: TTeamIdInputSchema }) =>
  getTeamService().deleteTeam(toActor(ctx.user), input.teamId);

export const countUpcomingBookingsHandler = ({ ctx, input }: { ctx: Ctx; input: TTeamIdInputSchema }) =>
  getTeamService().countUpcomingBookings(toActor(ctx.user), input.teamId);

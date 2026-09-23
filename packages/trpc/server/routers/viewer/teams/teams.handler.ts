import { getTeamService } from "@calcom/features/teams/di/TeamService.container";
import type { TrpcSessionUser } from "@calcom/trpc/server/types";
import type {
  TAddMemberInputSchema,
  TChangeMemberRoleInputSchema,
  TCreateTeamInputSchema,
  TTeamIdInputSchema,
  TTeamMemberInputSchema,
  TUpdateTeamInputSchema,
} from "./teams.schema";

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

export const listMembersHandler = ({ ctx, input }: { ctx: Ctx; input: TTeamIdInputSchema }) =>
  getTeamService().listMembers(toActor(ctx.user), input.teamId);

export const addMemberHandler = ({ ctx, input }: { ctx: Ctx; input: TAddMemberInputSchema }) =>
  getTeamService().addMemberByEmail(toActor(ctx.user), input.teamId, {
    email: input.email,
    role: input.role,
  });

export const removeMemberHandler = ({ ctx, input }: { ctx: Ctx; input: TTeamMemberInputSchema }) =>
  getTeamService().removeMember(toActor(ctx.user), input.teamId, input.userId);

export const changeMemberRoleHandler = ({ ctx, input }: { ctx: Ctx; input: TChangeMemberRoleInputSchema }) =>
  getTeamService().changeMemberRole(toActor(ctx.user), input.teamId, input.userId, input.role);

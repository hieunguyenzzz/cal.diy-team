import authedProcedure from "../../../procedures/authedProcedure";
import { router } from "../../../trpc";
import {
  ZAddMemberInputSchema,
  ZChangeMemberRoleInputSchema,
  ZCreateTeamInputSchema,
  ZTeamIdInputSchema,
  ZTeamMemberInputSchema,
  ZUpdateTeamInputSchema,
} from "./teams.schema";

export const teamsRouter = router({
  list: authedProcedure.query(async ({ ctx }) => {
    const handler = (await import("./teams.handler")).listTeamsHandler;
    return handler({ ctx });
  }),
  get: authedProcedure.input(ZTeamIdInputSchema).query(async ({ ctx, input }) => {
    const handler = (await import("./teams.handler")).getTeamHandler;
    return handler({ ctx, input });
  }),
  create: authedProcedure.input(ZCreateTeamInputSchema).mutation(async ({ ctx, input }) => {
    const handler = (await import("./teams.handler")).createTeamHandler;
    return handler({ ctx, input });
  }),
  update: authedProcedure.input(ZUpdateTeamInputSchema).mutation(async ({ ctx, input }) => {
    const handler = (await import("./teams.handler")).updateTeamHandler;
    return handler({ ctx, input });
  }),
  delete: authedProcedure.input(ZTeamIdInputSchema).mutation(async ({ ctx, input }) => {
    const handler = (await import("./teams.handler")).deleteTeamHandler;
    return handler({ ctx, input });
  }),
  countUpcomingBookings: authedProcedure.input(ZTeamIdInputSchema).query(async ({ ctx, input }) => {
    const handler = (await import("./teams.handler")).countUpcomingBookingsHandler;
    return handler({ ctx, input });
  }),
  listMembers: authedProcedure.input(ZTeamIdInputSchema).query(async ({ ctx, input }) => {
    const handler = (await import("./teams.handler")).listMembersHandler;
    return handler({ ctx, input });
  }),
  addMember: authedProcedure.input(ZAddMemberInputSchema).mutation(async ({ ctx, input }) => {
    const handler = (await import("./teams.handler")).addMemberHandler;
    return handler({ ctx, input });
  }),
  removeMember: authedProcedure.input(ZTeamMemberInputSchema).mutation(async ({ ctx, input }) => {
    const handler = (await import("./teams.handler")).removeMemberHandler;
    return handler({ ctx, input });
  }),
  changeMemberRole: authedProcedure.input(ZChangeMemberRoleInputSchema).mutation(async ({ ctx, input }) => {
    const handler = (await import("./teams.handler")).changeMemberRoleHandler;
    return handler({ ctx, input });
  }),
});

import authedProcedure from "../../../procedures/authedProcedure";
import { router } from "../../../trpc";
import { ZCreateTeamInputSchema, ZTeamIdInputSchema, ZUpdateTeamInputSchema } from "./teams.schema";

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
});

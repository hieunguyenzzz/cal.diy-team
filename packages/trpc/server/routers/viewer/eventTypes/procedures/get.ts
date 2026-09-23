import { ZGetInputSchema } from "../get.schema";
import { createEventPbacProcedure } from "../util";

export const get = createEventPbacProcedure("eventType.read")
  .input(ZGetInputSchema)
  .query(async ({ ctx, input }) => {
    const handler = (await import("../get.handler")).getHandler;

    return handler({
      ctx,
      input,
    });
  });

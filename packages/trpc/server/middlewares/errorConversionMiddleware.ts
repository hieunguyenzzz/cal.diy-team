import { ErrorWithCode } from "@calcom/lib/errors";
import { convertErrorWithCodeToTRPCError } from "../lib/toTRPCError";
import { middleware } from "../trpc";

/**
 * Middleware that catches errors thrown by other layers and converts them to TRPCError.
 */
export const errorConversionMiddleware = middleware(async ({ next }) => {
  // tRPC catches errors from inner middlewares and resolvers and returns them as a failed result wrapped in
  // an INTERNAL_SERVER_ERROR, so `next()` never throws; the original error survives as `cause`. Only that
  // wrapper is converted: a handler's own TRPCError with an ErrorWithCode cause already has its chosen code.
  const result = await next();
  if (
    !result.ok &&
    result.error.code === "INTERNAL_SERVER_ERROR" &&
    result.error.cause instanceof ErrorWithCode
  ) {
    throw convertErrorWithCodeToTRPCError(result.error.cause);
  }
  return result;
});

import { ErrorWithCode } from "@calcom/lib/errors";
import { convertErrorWithCodeToTRPCError } from "../lib/toTRPCError";
import { middleware } from "../trpc";

/**
 * Middleware that inspects the failed result of the layers below it and re-throws an ErrorWithCode as a
 * TRPCError with the matching code.
 */
export const errorConversionMiddleware = middleware(async ({ next }) => {
  // tRPC catches errors from inner middlewares and resolvers and returns them as a failed result wrapped in
  // an INTERNAL_SERVER_ERROR, so `next()` never throws; the original error survives as `cause`. Only that
  // wrapper is converted: a handler's own TRPCError with an ErrorWithCode cause already has its chosen code.
  const result = await next();
  // Edge: a handler that deliberately throws INTERNAL_SERVER_ERROR with an ErrorWithCode cause is converted too.
  if (
    !result.ok &&
    result.error.code === "INTERNAL_SERVER_ERROR" &&
    result.error.cause instanceof ErrorWithCode
  ) {
    throw convertErrorWithCodeToTRPCError(result.error.cause);
  }
  return result;
});

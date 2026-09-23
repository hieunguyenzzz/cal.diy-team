import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import type { TRPCContextInner } from "../createContext";
import publicProcedure from "../procedures/publicProcedure";
import { createCallerFactory, router } from "../trpc";

const throwing = (error: Error) =>
  publicProcedure.query(() => {
    throw error;
  });

const errors = {
  forbidden: ErrorWithCode.Factory.Forbidden("No access to team 10"),
  notFound: ErrorWithCode.Factory.NotFound("Team 10 not found"),
  badRequest: ErrorWithCode.Factory.BadRequest("Slug taken"),
  domainCode: new ErrorWithCode(ErrorCode.BookingNotFound, "Booking 5 not found"),
  trpcError: new TRPCError({ code: "CONFLICT", message: "Already exists" }),
  plainError: new Error("boom"),
};

const testRouter = router({
  forbidden: throwing(errors.forbidden),
  notFound: throwing(errors.notFound),
  badRequest: throwing(errors.badRequest),
  domainCode: throwing(errors.domainCode),
  trpcError: throwing(errors.trpcError),
  plainError: throwing(errors.plainError),
});
const caller = createCallerFactory(testRouter)({} as unknown as TRPCContextInner);

describe("errorConversionMiddleware", () => {
  it.each([
    ["forbidden", "FORBIDDEN", "No access to team 10"],
    ["notFound", "NOT_FOUND", "Team 10 not found"],
    ["badRequest", "BAD_REQUEST", "Slug taken"],
    ["domainCode", "NOT_FOUND", "Booking 5 not found"],
  ] as const)("turns ErrorWithCode %s into %s and keeps the message", async (procedure, code, message) => {
    const error = await caller[procedure]().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TRPCError);
    expect(error).toMatchObject({ code, message });
    expect((error as TRPCError).cause).toBe(errors[procedure]);
  });

  it("passes a thrown TRPCError through unchanged", async () => {
    await expect(caller.trpcError()).rejects.toBe(errors.trpcError);
  });

  it("leaves other errors to tRPC's default INTERNAL_SERVER_ERROR", async () => {
    const error = await caller.plainError().catch((e: unknown) => e);

    expect(error).toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "boom" });
    expect((error as TRPCError).cause).toBe(errors.plainError);
  });
});

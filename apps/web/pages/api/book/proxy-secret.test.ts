import type { NextApiRequest, NextApiResponse } from "next";
import { createMocks } from "node-mocks-http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createBooking = vi.fn(async () => ({ id: 1 }));
const createRecurringBooking = vi.fn(async () => [{ id: 1 }]);
const checkCfTurnstileToken = vi.fn(async () => ({ success: true }));

vi.mock("@sentry/nextjs", () => ({
  wrapApiHandlerWithSentry: (f: unknown) => f,
  captureException: vi.fn(),
}));
vi.mock("@calcom/features/auth/lib/getServerSession", () => ({ getServerSession: async () => null }));
vi.mock("@calcom/features/bookings/di/RegularBookingService.container", () => ({
  getRegularBookingService: () => ({ createBooking }),
}));
vi.mock("@calcom/features/bookings/di/RecurringBookingService.container", () => ({
  getRecurringBookingService: () => ({ createBooking: createRecurringBooking }),
}));
vi.mock("@calcom/features/bot-detection", () => ({
  BotDetectionService: class {
    checkBotDetection = async () => undefined;
  },
}));
vi.mock("@calcom/features/eventtypes/repositories/eventTypeRepository", () => ({
  EventTypeRepository: class {},
}));
vi.mock("@calcom/features/flags/features.repository", () => ({ FeaturesRepository: class {} }));
vi.mock("@calcom/lib/checkRateLimitAndThrowError", () => ({
  checkRateLimitAndThrowError: async () => undefined,
}));
vi.mock("@calcom/lib/server/checkCfTurnstileToken", () => ({ checkCfTurnstileToken }));
vi.mock("@calcom/prisma", () => ({ prisma: {} }));

const SECRET = "test-proxy-secret-abcd";

async function post(route: "event" | "recurring-event", headers: Record<string, string>) {
  const { default: handler } =
    route === "event" ? await import("./event") : await import("./recurring-event");
  const body = route === "event" ? { eventTypeId: 1 } : [{ eventTypeId: 1 }];
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method: "POST", headers, body });
  await handler(req, res);
  return res;
}

describe.each(["event", "recurring-event"] as const)("/api/book/%s proxy secret", (route) => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_CLOUDFLARE_USE_TURNSTILE_IN_BOOKER", "1");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("passes through when BOOKING_PROXY_SECRET is unset", async () => {
    const res = await post(route, {});
    expect(res._getStatusCode()).toBe(200);
  });

  it("returns 403 without the header, before Turnstile or booking", async () => {
    vi.stubEnv("BOOKING_PROXY_SECRET", SECRET);
    const res = await post(route, {});
    expect(res._getStatusCode()).toBe(403);
    expect(res._getJSONData().message).toBe("forbidden");
    expect(checkCfTurnstileToken).not.toHaveBeenCalled();
    expect(createBooking).not.toHaveBeenCalled();
    expect(createRecurringBooking).not.toHaveBeenCalled();
  });

  it("returns 403 with a wrong secret", async () => {
    vi.stubEnv("BOOKING_PROXY_SECRET", SECRET);
    const res = await post(route, { "x-sbs-booking-secret": "wrong" });
    expect(res._getStatusCode()).toBe(403);
    expect(checkCfTurnstileToken).not.toHaveBeenCalled();
  });

  it("passes through to Turnstile and booking with the right secret", async () => {
    vi.stubEnv("BOOKING_PROXY_SECRET", SECRET);
    const res = await post(route, { "X-SBS-Booking-Secret": SECRET });
    expect(res._getStatusCode()).toBe(200);
    expect(checkCfTurnstileToken).toHaveBeenCalledOnce();
    expect(route === "event" ? createBooking : createRecurringBooking).toHaveBeenCalledOnce();
  });
});

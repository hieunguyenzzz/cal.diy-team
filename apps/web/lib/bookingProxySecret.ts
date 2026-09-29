import { createHash, timingSafeEqual } from "node:crypto";
import process from "node:process";
import { HttpError } from "@calcom/lib/http-error";
import logger from "@calcom/lib/logger";
import type { NextApiRequest } from "next";

const log = logger.getSubLogger({ prefix: ["bookingProxySecret"] });

const BOOKING_PROXY_SECRET_HEADER = "x-sbs-booking-secret";

// Hashing first gives equal-length buffers, so timingSafeEqual never leaks the secret's length.
function secretsMatch(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * When BOOKING_PROXY_SECRET is set, bookings must come through the storefront's n8n proxy,
 * which adds the shared secret header. Unset keeps upstream behaviour, so shipping this is a no-op.
 */
export function checkBookingProxySecret(req: NextApiRequest, traceId?: string): void {
  const expected = process.env.BOOKING_PROXY_SECRET;
  if (!expected) return;

  const provided = req.headers[BOOKING_PROXY_SECRET_HEADER];
  const hasHeader = typeof provided === "string" && provided !== "";
  if (hasHeader && secretsMatch(provided, expected)) return;

  const reason = hasHeader ? "header mismatch" : "missing header";
  log.warn("Rejected booking without valid proxy secret", { reason, url: req.url, traceId });
  throw new HttpError({ statusCode: 403, message: "forbidden" });
}

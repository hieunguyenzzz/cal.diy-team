import process from "node:process";
import type { NextApiRequest, NextApiResponse } from "next";

// An entry like "https://*.shopifypreview.com" matches exactly one extra DNS label,
// so a preview host matches but "evil.com.shopifypreview.com.attacker.io" never can.
function matchesEntry(origin: string, entry: string): boolean {
  if (!entry.includes("*.")) return origin === entry;
  const [scheme, suffix] = entry.split("*.");
  if (!origin.startsWith(scheme)) return false;
  const host = origin.slice(scheme.length);
  if (!host.endsWith(`.${suffix}`)) return false;
  const label = host.slice(0, -(suffix.length + 1));
  return /^[a-z0-9-]+$/i.test(label);
}

export function isStorefrontOriginAllowed(
  origin: string | undefined,
  allowlist: string | undefined
): boolean {
  if (!origin || !allowlist) return false;
  return allowlist
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .some((entry) => matchesEntry(origin, entry));
}

/**
 * The soundboxstore.com storefront reads slots straight from the browser, so only the public,
 * read-only slots.getSchedule query is opened cross-origin. A GET without custom headers is a
 * CORS "simple request", so no preflight handling is needed. No credentials are allowed.
 */
export function applyStorefrontCors(req: NextApiRequest, res: NextApiResponse): void {
  const allowlist = process.env.STOREFRONT_ALLOWED_ORIGINS;
  if (!allowlist) return;
  if (req.method !== "GET" || req.query.trpc !== "getSchedule") return;

  res.setHeader("Vary", "Origin");
  const origin = req.headers.origin;
  if (origin && isStorefrontOriginAllowed(origin, allowlist)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
}

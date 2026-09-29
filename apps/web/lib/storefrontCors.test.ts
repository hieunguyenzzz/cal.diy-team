import type { NextApiRequest, NextApiResponse } from "next";
import { createMocks } from "node-mocks-http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyStorefrontCors, isStorefrontOriginAllowed } from "./storefrontCors";

const ALLOWLIST =
  "https://soundboxstore.com, https://www.soundboxstore.com,https://thankyou-485.myshopify.com,https://*.shopifypreview.com";

function run({
  method = "GET",
  procedure = "getSchedule",
  origin,
}: {
  method?: string;
  procedure?: string;
  origin?: string;
}) {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
    method: method as "GET",
    query: { trpc: procedure },
    headers: origin ? { origin } : {},
  });
  applyStorefrontCors(req, res);
  return res;
}

describe("isStorefrontOriginAllowed", () => {
  it.each([
    "https://soundboxstore.com",
    "https://www.soundboxstore.com",
    "https://thankyou-485.myshopify.com",
    "https://abc123-def.shopifypreview.com",
  ])("allows %s", (origin) => {
    expect(isStorefrontOriginAllowed(origin, ALLOWLIST)).toBe(true);
  });

  it.each([
    "https://evil.com",
    "http://soundboxstore.com",
    "https://soundboxstore.com.evil.com",
    "https://evilsoundboxstore.com",
    "https://shopifypreview.com",
    "https://a.b.shopifypreview.com",
    "https://x.shopifypreview.com.evil.com",
    "https://x.shopifypreview.com:8443",
    "null",
  ])("rejects %s", (origin) => {
    expect(isStorefrontOriginAllowed(origin, ALLOWLIST)).toBe(false);
  });

  it("rejects everything when the allowlist is unset", () => {
    expect(isStorefrontOriginAllowed("https://soundboxstore.com", undefined)).toBe(false);
  });
});

describe("applyStorefrontCors", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("echoes an allowed origin on getSchedule, without credentials", () => {
    vi.stubEnv("STOREFRONT_ALLOWED_ORIGINS", ALLOWLIST);
    const res = run({ origin: "https://www.soundboxstore.com" });
    expect(res.getHeader("Access-Control-Allow-Origin")).toBe("https://www.soundboxstore.com");
    expect(res.getHeader("Vary")).toBe("Origin");
    expect(res.getHeader("Access-Control-Allow-Credentials")).toBeUndefined();
  });

  it("sets Vary but no ACAO for a disallowed origin", () => {
    vi.stubEnv("STOREFRONT_ALLOWED_ORIGINS", ALLOWLIST);
    const res = run({ origin: "https://evil.com" });
    expect(res.getHeader("Access-Control-Allow-Origin")).toBeUndefined();
    expect(res.getHeader("Vary")).toBe("Origin");
  });

  it.each([
    "reserveSlot",
    "isAvailable",
    "removeSelectedSlotMark",
    "getSchedule,reserveSlot",
  ])("never opens other slots procedures (%s)", (procedure) => {
    vi.stubEnv("STOREFRONT_ALLOWED_ORIGINS", ALLOWLIST);
    const res = run({ procedure, origin: "https://soundboxstore.com" });
    expect(res.getHeader("Access-Control-Allow-Origin")).toBeUndefined();
  });

  it("ignores non-GET requests", () => {
    vi.stubEnv("STOREFRONT_ALLOWED_ORIGINS", ALLOWLIST);
    const res = run({ method: "POST", origin: "https://soundboxstore.com" });
    expect(res.getHeader("Access-Control-Allow-Origin")).toBeUndefined();
  });

  it("does nothing when STOREFRONT_ALLOWED_ORIGINS is unset", () => {
    vi.stubEnv("STOREFRONT_ALLOWED_ORIGINS", "");
    const res = run({ origin: "https://soundboxstore.com" });
    expect(res.getHeader("Access-Control-Allow-Origin")).toBeUndefined();
    expect(res.getHeader("Vary")).toBeUndefined();
  });
});

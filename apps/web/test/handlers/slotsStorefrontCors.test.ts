import type { NextApiRequest, NextApiResponse } from "next";
import { createMocks } from "node-mocks-http";
import { afterEach, describe, expect, it, vi } from "vitest";

const trpcHandler = vi.fn(async (_req: NextApiRequest, res: NextApiResponse) => {
  res.status(200).json({ ok: true });
});

vi.mock("@calcom/trpc/server/createNextApiHandler", () => ({
  createNextApiHandler: () => trpcHandler,
}));
vi.mock("@calcom/trpc/server/routers/viewer/slots/_router", () => ({ slotsRouter: {} }));

describe("/api/trpc/slots/[trpc]", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    trpcHandler.mockClear();
  });

  it("adds CORS for an allowed storefront origin on getSchedule and still runs tRPC", async () => {
    vi.stubEnv("STOREFRONT_ALLOWED_ORIGINS", "https://soundboxstore.com");
    const { default: handler } = await import("../../pages/api/trpc/slots/[trpc]");
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "GET",
      query: { trpc: "getSchedule" },
      headers: { origin: "https://soundboxstore.com" },
    });
    await handler(req, res);
    expect(res.getHeader("Access-Control-Allow-Origin")).toBe("https://soundboxstore.com");
    expect(trpcHandler).toHaveBeenCalledOnce();
    expect(res._getStatusCode()).toBe(200);
  });

  it("does not add CORS for a disallowed origin", async () => {
    vi.stubEnv("STOREFRONT_ALLOWED_ORIGINS", "https://soundboxstore.com");
    const { default: handler } = await import("../../pages/api/trpc/slots/[trpc]");
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "GET",
      query: { trpc: "getSchedule" },
      headers: { origin: "https://evil.com" },
    });
    await handler(req, res);
    expect(res.getHeader("Access-Control-Allow-Origin")).toBeUndefined();
    expect(trpcHandler).toHaveBeenCalledOnce();
  });
});

import { ErrorCode } from "@calcom/lib/errorCodes";
import { describe, expect, it } from "vitest";
import { validateTeamLogo } from "./validateTeamLogo";

const base64Of = (bytes: number) => Buffer.alloc(bytes).toString("base64");

const expectRejected = (logo: string, message: RegExp) => {
  let error: unknown;
  try {
    validateTeamLogo(logo);
  } catch (e) {
    error = e;
  }
  expect(error).toMatchObject({ code: ErrorCode.BadRequest });
  expect((error as Error).message).toMatch(message);
};

describe("validateTeamLogo", () => {
  it.each([
    ["a plain string", "not-an-image"],
    ["a non-image data URL", "data:text/html;base64,PGh0bWw+"],
    ["an unlisted image type", "data:image/bmp;base64,AAAA"],
    // The avatar route only strips png/jpeg prefixes (SVG is converted to PNG on upload), so these would render broken.
    ["a WebP image", "data:image/webp;base64,AAAA"],
    ["a GIF image", "data:image/gif;base64,AAAA"],
    ["a data URL without base64", "data:image/png,AAAA"],
    ["base64 with characters outside the alphabet", "data:image/png;base64,AA*A"],
    ["base64 with more than two padding characters", "data:image/png;base64,AAAA==="],
    ["an empty base64 body", "data:image/png;base64,"],
    ["a body of padding only", "data:image/png;base64,=="],
  ])("rejects %s", (_label, logo) => {
    expectRejected(logo, /logo/i);
  });

  it.each(["png", "jpeg", "svg+xml"])("accepts a %s logo", (type) => {
    expect(() => validateTeamLogo(`data:image/${type};base64,AAAA`)).not.toThrow();
  });

  it("rejects a logo larger than 2 MB once decoded, and accepts exactly 2 MB", () => {
    expectRejected(`data:image/png;base64,${base64Of(2 * 1024 * 1024 + 1)}`, /2 MB/);
    expect(() => validateTeamLogo(`data:image/png;base64,${base64Of(2 * 1024 * 1024)}`)).not.toThrow();
  });

  it("cannot be bypassed by padding a large image with trailing '='", () => {
    const sixMegabytes = base64Of(6 * 1024 * 1024);

    expectRejected(`data:image/png;base64,${sixMegabytes}${"=".repeat(20 * 1024 * 1024)}`, /2 MB/);
    expectRejected(`data:image/png;base64,${sixMegabytes}==`, /2 MB/);
  });
});

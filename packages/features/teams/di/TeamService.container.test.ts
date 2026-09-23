import { createContainer } from "@calcom/features/di/di";
import { TeamService } from "@calcom/features/teams/services/TeamService";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { moduleLoader as teamLogoUploaderModuleLoader } from "./TeamLogoUploader.module";
import { getTeamService } from "./TeamService.container";
import { TEAM_DI_TOKENS } from "./tokens";

const { uploadLogo, resizeBase64Image } = vi.hoisted(() => ({
  uploadLogo: vi.fn(),
  resizeBase64Image: vi.fn(),
}));
vi.mock("@calcom/lib/server/avatar", () => ({ uploadLogo }));
vi.mock("@calcom/lib/server/resizeBase64Image", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@calcom/lib/server/resizeBase64Image")>()),
  resizeBase64Image,
}));

type UploadTeamLogo = (args: { teamId: number; logo: string }) => Promise<string>;

const resolveUploader = () => {
  const container = createContainer();
  teamLogoUploaderModuleLoader.loadModule(container);
  return container.get<UploadTeamLogo>(TEAM_DI_TOKENS.TEAM_LOGO_UPLOADER);
};

describe("getTeamService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uploadLogo.mockResolvedValue("/api/avatar/key.png");
    resizeBase64Image.mockResolvedValue("data:image/png;base64,small");
  });

  it("wires a TeamService from the container", () => {
    expect(getTeamService()).toBeInstanceOf(TeamService);
  });

  it("resizes a PNG or JPEG logo before storing it", async () => {
    const url = await resolveUploader()({ teamId: 10, logo: "data:image/png;base64,big" });

    expect(resizeBase64Image).toHaveBeenCalledWith("data:image/png;base64,big");
    expect(uploadLogo).toHaveBeenCalledWith({ teamId: 10, logo: "data:image/png;base64,small" });
    expect(url).toBe("/api/avatar/key.png");
  });

  it("passes an SVG logo straight to uploadLogo, which converts it to PNG", async () => {
    await resolveUploader()({ teamId: 10, logo: "data:image/svg+xml;base64,PHN2Zy8+" });

    expect(resizeBase64Image).not.toHaveBeenCalled();
    expect(uploadLogo).toHaveBeenCalledWith({ teamId: 10, logo: "data:image/svg+xml;base64,PHN2Zy8+" });
  });
});

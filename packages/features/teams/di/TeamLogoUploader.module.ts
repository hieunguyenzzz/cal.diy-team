import { createModule, type ModuleLoader } from "@calcom/features/di/di";
import { uploadLogo } from "@calcom/lib/server/avatar";
import { isBase64Image, resizeBase64Image } from "@calcom/lib/server/resizeBase64Image";
import { TEAM_DI_TOKENS } from "./tokens";

// resizeBase64Image can't parse "image/svg+xml", so only PNG/JPEG are resized; uploadLogo turns SVG into PNG.
const uploadTeamLogo = async ({ teamId, logo }: { teamId: number; logo: string }) =>
  uploadLogo({ teamId, logo: isBase64Image(logo) ? await resizeBase64Image(logo) : logo });

const thisModule = createModule();
const token = TEAM_DI_TOKENS.TEAM_LOGO_UPLOADER;
const moduleToken = TEAM_DI_TOKENS.TEAM_LOGO_UPLOADER_MODULE;
thisModule.bind(token).toValue(uploadTeamLogo);

export const moduleLoader: ModuleLoader = {
  token,
  loadModule: (container) => container.load(moduleToken, thisModule),
};

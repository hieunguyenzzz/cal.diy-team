import { bindModuleToClassOnToken, createModule, type ModuleLoader } from "@calcom/features/di/di";
import { moduleLoader as userRepositoryModuleLoader } from "@calcom/features/di/modules/User";
import { TeamService } from "@calcom/features/teams/services/TeamService";
import { moduleLoader as membershipRepositoryModuleLoader } from "@calcom/features/users/di/MembershipRepository.module";
import { uploadLogo } from "@calcom/lib/server/avatar";
import { isBase64Image, resizeBase64Image } from "@calcom/lib/server/resizeBase64Image";
import { moduleLoader as teamPermissionServiceModuleLoader } from "./TeamPermissionService.module";
import { moduleLoader as teamRepositoryModuleLoader } from "./TeamRepository.module";
import { TEAM_DI_TOKENS } from "./tokens";

// resizeBase64Image can't parse "image/svg+xml", so only PNG/JPEG are resized; uploadLogo turns SVG into PNG.
const uploadTeamLogo = async ({ teamId, logo }: { teamId: number; logo: string }) =>
  uploadLogo({ teamId, logo: isBase64Image(logo) ? await resizeBase64Image(logo) : logo });

const teamLogoUploaderModule = createModule();
teamLogoUploaderModule.bind(TEAM_DI_TOKENS.TEAM_LOGO_UPLOADER).toValue(uploadTeamLogo);

const teamLogoUploaderModuleLoader: ModuleLoader = {
  token: TEAM_DI_TOKENS.TEAM_LOGO_UPLOADER,
  loadModule: (container) => container.load(TEAM_DI_TOKENS.TEAM_LOGO_UPLOADER_MODULE, teamLogoUploaderModule),
};

const thisModule = createModule();
const token = TEAM_DI_TOKENS.TEAM_SERVICE;
const moduleToken = TEAM_DI_TOKENS.TEAM_SERVICE_MODULE;

const loadModule = bindModuleToClassOnToken({
  module: thisModule,
  moduleToken,
  token,
  classs: TeamService,
  depsMap: {
    teamRepository: teamRepositoryModuleLoader,
    membershipRepository: membershipRepositoryModuleLoader,
    userRepository: userRepositoryModuleLoader,
    teamPermissionService: teamPermissionServiceModuleLoader,
    uploadLogo: teamLogoUploaderModuleLoader,
  },
});

const moduleLoader: ModuleLoader = {
  token,
  loadModule,
};

export { moduleLoader, teamLogoUploaderModuleLoader };
export type { TeamService };

import { bindModuleToClassOnToken, createModule, type ModuleLoader } from "@calcom/features/di/di";
import { moduleLoader as userRepositoryModuleLoader } from "@calcom/features/di/modules/User";
import { TeamService } from "@calcom/features/teams/services/TeamService";
import { moduleLoader as membershipRepositoryModuleLoader } from "@calcom/features/users/di/MembershipRepository.module";
import { moduleLoader as teamLogoUploaderModuleLoader } from "./TeamLogoUploader.module";
import { moduleLoader as teamPermissionServiceModuleLoader } from "./TeamPermissionService.module";
import { moduleLoader as teamRepositoryModuleLoader } from "./TeamRepository.module";
import { TEAM_DI_TOKENS } from "./tokens";

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

export { moduleLoader };
export type { TeamService };

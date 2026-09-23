import { bindModuleToClassOnToken, createModule, type ModuleLoader } from "@calcom/features/di/di";
import { TeamPermissionService } from "@calcom/features/teams/services/TeamPermissionService";
import { moduleLoader as membershipRepositoryModuleLoader } from "@calcom/features/users/di/MembershipRepository.module";
import { TEAM_DI_TOKENS } from "./tokens";

const thisModule = createModule();
const token = TEAM_DI_TOKENS.TEAM_PERMISSION_SERVICE;
const moduleToken = TEAM_DI_TOKENS.TEAM_PERMISSION_SERVICE_MODULE;

const loadModule = bindModuleToClassOnToken({
  module: thisModule,
  moduleToken,
  token,
  classs: TeamPermissionService,
  dep: membershipRepositoryModuleLoader,
});

export const moduleLoader: ModuleLoader = {
  token,
  loadModule,
};

export type { TeamPermissionService };

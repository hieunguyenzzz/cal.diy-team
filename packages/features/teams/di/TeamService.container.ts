import { createContainer } from "@calcom/features/di/di";
import { type TeamService, moduleLoader as teamServiceModuleLoader } from "./TeamService.module";

const teamServiceContainer = createContainer();

export function getTeamService(): TeamService {
  teamServiceModuleLoader.loadModule(teamServiceContainer);
  return teamServiceContainer.get<TeamService>(teamServiceModuleLoader.token);
}

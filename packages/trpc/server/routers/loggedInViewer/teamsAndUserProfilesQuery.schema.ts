import { z } from "zod";

export const ZTeamsAndUserProfilesQueryInputSchema = z
  .object({
    includeOrg: z.boolean().optional(),
    withPermission: z
      .object({
        permission: z.string(),
      })
      .optional(),
  })
  .optional();

export type TTeamsAndUserProfilesQueryInputSchema = z.infer<typeof ZTeamsAndUserProfilesQueryInputSchema>;

import { timeZoneSchema } from "@calcom/lib/dayjs/timeZone.schema";
import { MembershipRole } from "@calcom/prisma/enums";
import { z } from "zod";

// Strict objects: TeamService spreads the profile into the update, so parentId or isOrganization must never
// get through.
const teamId = z.number().int().positive();
const userId = z.number().int().positive();
const name = z.string().trim().min(1).max(100);
const slug = z.string().max(100);
const bio = z.string().max(1000);

export const ZTeamIdInputSchema = z.object({ teamId }).strict();

export const ZCreateTeamInputSchema = z
  .object({
    name,
    slug: slug.optional(),
    bio: bio.optional(),
    timeZone: timeZoneSchema.optional(),
  })
  .strict();

export const ZUpdateTeamInputSchema = z
  .object({
    teamId,
    name: name.optional(),
    slug: slug.optional(),
    bio: bio.nullable().optional(),
    timeZone: timeZoneSchema.optional(),
    // A data URL uploads a new logo (TeamService validates it); null removes the current one.
    logo: z.string().nullable().optional(),
  })
  .strict();

export const ZAddMemberInputSchema = z
  .object({
    teamId,
    email: z.string().trim().email(),
    role: z.nativeEnum(MembershipRole),
  })
  .strict();

export const ZTeamMemberInputSchema = z.object({ teamId, userId }).strict();

export const ZChangeMemberRoleInputSchema = ZTeamMemberInputSchema.extend({
  role: z.nativeEnum(MembershipRole),
}).strict();

export type TTeamIdInputSchema = z.infer<typeof ZTeamIdInputSchema>;
export type TCreateTeamInputSchema = z.infer<typeof ZCreateTeamInputSchema>;
export type TUpdateTeamInputSchema = z.infer<typeof ZUpdateTeamInputSchema>;
export type TAddMemberInputSchema = z.infer<typeof ZAddMemberInputSchema>;
export type TTeamMemberInputSchema = z.infer<typeof ZTeamMemberInputSchema>;
export type TChangeMemberRoleInputSchema = z.infer<typeof ZChangeMemberRoleInputSchema>;

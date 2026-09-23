import { getWebhookFeature } from "@calcom/features/di/webhooks/containers/webhook";
import { MembershipRepository } from "@calcom/features/membership/repositories/MembershipRepository";
import {
  TEAM_ADMIN_ROLES,
  TeamPermissionService,
} from "@calcom/features/teams/services/TeamPermissionService";
import type { Webhook } from "@calcom/features/webhooks/lib/dto/types";
import { prisma } from "@calcom/prisma";
import type { TrpcSessionUser } from "@calcom/trpc/server/types";
import type { TListInputSchema } from "./list.schema";

type ListOptions = {
  ctx: {
    user: NonNullable<TrpcSessionUser>;
  };
  input: TListInputSchema;
};

export const listHandler = async ({ ctx, input }: ListOptions): Promise<Webhook[]> => {
  const { repository } = getWebhookFeature();
  const teamIds = await new TeamPermissionService(new MembershipRepository(prisma)).getTeamIdsWithRole({
    userId: ctx.user.id,
    userRole: ctx.user.role,
    roles: TEAM_ADMIN_ROLES,
  });

  return repository.listWebhooks({
    userId: ctx.user.id,
    teamIds,
    appId: input?.appId,
    eventTypeId: input?.eventTypeId,
    eventTriggers: input?.eventTriggers,
  });
};

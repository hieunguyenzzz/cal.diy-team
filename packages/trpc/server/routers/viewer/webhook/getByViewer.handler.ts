import { getWebhookFeature } from "@calcom/features/di/webhooks/containers/webhook";
import { MembershipRepository } from "@calcom/features/membership/repositories/MembershipRepository";
import {
  TEAM_ADMIN_ROLES,
  TeamPermissionService,
} from "@calcom/features/teams/services/TeamPermissionService";
import type { WebhookGroup } from "@calcom/features/webhooks/lib/dto/types";
import { prisma } from "@calcom/prisma";
import { UserPermissionRole } from "@calcom/prisma/enums";
import type { TrpcSessionUser } from "@calcom/trpc/server/types";

type GetByViewerOptions = {
  ctx: {
    user: NonNullable<TrpcSessionUser>;
  };
};

export type WebhooksByViewer = {
  webhookGroups: WebhookGroup[];
  profiles: {
    readOnly?: boolean | undefined;
    slug: string | null;
    name: string | null;
    image?: string | undefined;
    teamId: number | null | undefined;
  }[];
};

export const getByViewerHandler = async ({ ctx }: GetByViewerOptions): Promise<WebhooksByViewer> => {
  // Use the singleton instance to avoid creating new instances repeatedly
  const { repository: webhookRepository } = getWebhookFeature();
  // Team webhooks, secrets included, are for team admins only.
  const teamIds = await new TeamPermissionService(new MembershipRepository(prisma)).getTeamIdsWithRole({
    userId: ctx.user.id,
    userRole: ctx.user.role,
    roles: TEAM_ADMIN_ROLES,
  });
  return await webhookRepository.getFilteredWebhooksForUser({
    userId: ctx.user.id,
    teamIds,
    includePlatformWebhooks: ctx.user.role === UserPermissionRole.ADMIN,
  });
};

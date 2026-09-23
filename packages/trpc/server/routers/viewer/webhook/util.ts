import { MembershipRepository } from "@calcom/features/membership/repositories/MembershipRepository";
import {
  TEAM_ADMIN_ROLES,
  TeamPermissionService,
} from "@calcom/features/teams/services/TeamPermissionService";
import { prisma } from "@calcom/prisma";

import { TRPCError } from "@trpc/server";

import authedProcedure from "../../../procedures/authedProcedure";
import { webhookIdAndEventTypeIdSchema } from "./types";

export const createWebhookProcedure = () => {
  return authedProcedure.input(webhookIdAndEventTypeIdSchema.optional()).use(async ({ ctx, input, next }) => {
    if (!input) return next();

    const { id, webhookId, eventTypeId, teamId } = input;
    const lookupId = id || webhookId;

    const assertTeamAdmin = async (webhookTeamId: number) => {
      const isTeamAdmin = await new TeamPermissionService(new MembershipRepository(prisma)).hasTeamRole({
        userId: ctx.user.id,
        userRole: ctx.user.role,
        teamId: webhookTeamId,
        roles: TEAM_ADMIN_ROLES,
      });
      if (!isTeamAdmin) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
    };

    // Covers create and any call naming a team: only that team's admins may act for it.
    if (teamId) {
      await assertTeamAdmin(teamId);
    }

    if (lookupId) {
      // Check if user is authorized to edit webhook
      const webhook = await prisma.webhook.findUnique({
        where: { id: lookupId },
        select: {
          id: true,
          userId: true,
          eventTypeId: true,
          teamId: true,
          platform: true,
        },
      });

      if (!webhook) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      // Same rule as edit.handler, applied here so get and testTrigger are covered too.
      if (webhook.platform && ctx.user.role !== "ADMIN") {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      if (eventTypeId && eventTypeId !== webhook.eventTypeId) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      if (webhook.eventTypeId) {
        const eventType = await prisma.eventType.findUnique({
          where: { id: webhook.eventTypeId },
          select: { id: true, userId: true },
        });

        if (!eventType) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }

        if (eventType.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
      } else if (webhook.teamId) {
        await assertTeamAdmin(webhook.teamId);
      } else if (webhook.userId && webhook.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
    } else if (eventTypeId) {
      const eventType = await prisma.eventType.findUnique({
        where: { id: eventTypeId },
        select: { id: true, userId: true },
      });

      if (!eventType) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      if (eventType.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
    }

    return next();
  });
};

export const webhookProcedure = createWebhookProcedure();

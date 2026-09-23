import prisma from "@calcom/prisma";
import type { TrpcSessionUser } from "@calcom/trpc/server/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHandler } from "./create.handler";

// Runs the real handler against the dev database: Prisma must accept a team webhook without a user link.
describe("createHandler (DB)", () => {
  const suffix = `sbs578-${Date.now()}`;
  let userId: number;
  let teamId: number;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `${suffix}@example.com`, username: suffix },
      select: { id: true },
    });
    const team = await prisma.team.create({
      data: { name: `Team ${suffix}`, slug: suffix },
      select: { id: true },
    });
    userId = user.id;
    teamId = team.id;
  });

  afterAll(async () => {
    await prisma.webhook.deleteMany({ where: { OR: [{ teamId }, { userId }] } });
    await prisma.team.delete({ where: { id: teamId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  const ctx = () => ({ user: { id: userId, role: "USER" } as unknown as NonNullable<TrpcSessionUser> });

  it("creates a team webhook owned by the team and not linked to the creating user", async () => {
    const webhook = await createHandler({
      ctx: ctx(),
      input: {
        subscriberUrl: "https://example.com/team-hook",
        eventTriggers: ["BOOKING_CREATED"],
        active: true,
        payloadTemplate: null,
        teamId,
      },
    });

    expect(webhook).toMatchObject({ teamId, userId: null, eventTypeId: null });
  });

  it("still creates a personal webhook linked to the user", async () => {
    const webhook = await createHandler({
      ctx: ctx(),
      input: {
        subscriberUrl: "https://example.com/personal-hook",
        eventTriggers: ["BOOKING_CREATED"],
        active: true,
        payloadTemplate: null,
      },
    });

    expect(webhook).toMatchObject({ teamId: null, userId });
  });
});

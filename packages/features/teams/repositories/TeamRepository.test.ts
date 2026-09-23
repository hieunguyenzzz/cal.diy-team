import type { PrismaClient } from "@calcom/prisma";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TeamRepository } from "./TeamRepository";

const SENSITIVE_FIELDS = ["email", "credentials", "password", "key", "inviteToken"];

function collectSelectedKeys(select: Record<string, unknown>, keys: string[] = []): string[] {
  for (const [key, value] of Object.entries(select)) {
    keys.push(key);
    if (value && typeof value === "object") {
      const nested = (value as { select?: Record<string, unknown> }).select;
      if (nested) collectSelectedKeys(nested, keys);
    }
  }
  return keys;
}

describe("TeamRepository", () => {
  let repository: TeamRepository;

  const mockPrisma = {
    team: {
      findFirst: vi.fn(),
    },
  } as unknown as PrismaClient;

  const findFirst = vi.mocked(mockPrisma.team.findFirst);

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new TeamRepository(mockPrisma);
  });

  describe("findBySlugIncludeEventTypesAndMembers", () => {
    it("only matches standalone teams, ordered deterministically", async () => {
      findFirst.mockResolvedValue(null);

      const result = await repository.findBySlugIncludeEventTypesAndMembers({ slug: "sales" });

      expect(result).toBeNull();
      const args = findFirst.mock.calls[0][0];
      expect(args?.where).toEqual({ slug: "sales", parentId: null, isOrganization: false });
      expect(args?.orderBy).toEqual({ id: "asc" });
    });

    it("lists only visible, non-managed event types and accepted members", async () => {
      findFirst.mockResolvedValue(null);

      await repository.findBySlugIncludeEventTypesAndMembers({ slug: "sales" });

      const select = findFirst.mock.calls[0][0]?.select;
      expect(select?.eventTypes).toMatchObject({
        where: {
          hidden: false,
          OR: [{ schedulingType: null }, { schedulingType: { not: "MANAGED" } }],
        },
      });
      expect(select?.members).toMatchObject({ where: { accepted: true } });
    });

    it("does not select emails or credentials", async () => {
      findFirst.mockResolvedValue(null);

      await repository.findBySlugIncludeEventTypesAndMembers({ slug: "sales" });

      const keys = collectSelectedKeys(findFirst.mock.calls[0][0]?.select as Record<string, unknown>);
      for (const field of SENSITIVE_FIELDS) {
        expect(keys).not.toContain(field);
      }
    });

    it("returns the team found by prisma", async () => {
      const team = { id: 1, slug: "sales" };
      findFirst.mockResolvedValue(team as never);

      await expect(repository.findBySlugIncludeEventTypesAndMembers({ slug: "sales" })).resolves.toBe(team);
    });
  });

  describe("findBySlugIncludeEventType", () => {
    it("only matches standalone teams and the requested event type", async () => {
      findFirst.mockResolvedValue(null);

      await repository.findBySlugIncludeEventType({ slug: "sales", eventTypeSlug: "demo" });

      const args = findFirst.mock.calls[0][0];
      expect(args?.where).toEqual({ slug: "sales", parentId: null, isOrganization: false });
      expect(args?.orderBy).toEqual({ id: "asc" });
      expect(args?.select?.eventTypes).toMatchObject({ where: { slug: "demo" } });
    });

    it("orders hosts deterministically and selects a fallback user", async () => {
      findFirst.mockResolvedValue(null);

      await repository.findBySlugIncludeEventType({ slug: "sales", eventTypeSlug: "demo" });

      const eventTypes = findFirst.mock.calls[0][0]?.select?.eventTypes as {
        select: Record<string, unknown>;
      };
      expect(eventTypes.select.hosts).toMatchObject({
        take: 3,
        orderBy: [{ priority: "desc" }, { userId: "asc" }],
      });
      expect(eventTypes.select.users).toEqual({ take: 1, select: { name: true, username: true } });
    });

    it("does not select emails or credentials", async () => {
      findFirst.mockResolvedValue(null);

      await repository.findBySlugIncludeEventType({ slug: "sales", eventTypeSlug: "demo" });

      const keys = collectSelectedKeys(findFirst.mock.calls[0][0]?.select as Record<string, unknown>);
      for (const field of SENSITIVE_FIELDS) {
        expect(keys).not.toContain(field);
      }
    });
  });
});

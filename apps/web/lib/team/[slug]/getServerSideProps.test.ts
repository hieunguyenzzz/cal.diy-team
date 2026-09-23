import type { GetServerSidePropsContext } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findBySlugIncludeEventTypesAndMembers } = vi.hoisted(() => ({
  findBySlugIncludeEventTypesAndMembers: vi.fn(),
}));

vi.mock("@calcom/prisma", () => ({ prisma: {} }));
vi.mock("@calcom/features/teams/repositories/TeamRepository", () => ({
  TeamRepository: vi.fn().mockImplementation(function () {
    return { findBySlugIncludeEventTypesAndMembers };
  }),
}));

import type { inferSSRProps } from "@lib/types/inferSSRProps";
import { getServerSideProps } from "./getServerSideProps";

type Props = inferSSRProps<typeof getServerSideProps>;

const getProps = async (context: GetServerSidePropsContext): Promise<Props> => {
  const result = await getServerSideProps(context);
  if (!("props" in result)) throw new Error("expected props");
  return result.props as Props;
};

const buildContext = (query: Record<string, unknown>) => ({ query }) as unknown as GetServerSidePropsContext;

const alex = { id: 2, name: "Alex", username: "alex", avatarUrl: null };

const buildTeam = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  slug: "sales",
  name: "Sales",
  bio: "**Hello** team",
  theme: null,
  isPrivate: false,
  hideBookATeamMember: false,
  logoUrl: null,
  brandColor: null,
  darkBrandColor: null,
  eventTypes: [
    {
      id: 10,
      title: "Demo",
      slug: "demo",
      description: "A *demo*",
      metadata: null,
      length: 15,
      hosts: [{ user: alex }],
    },
  ],
  members: [{ user: { ...alex, bio: "Sales lead" } }],
  ...overrides,
});

describe("team/[slug] getServerSideProps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns notFound without querying when the slug is missing", async () => {
    await expect(getServerSideProps(buildContext({}))).resolves.toEqual({ notFound: true });
    expect(findBySlugIncludeEventTypesAndMembers).not.toHaveBeenCalled();
  });

  it("returns notFound when the team does not exist", async () => {
    findBySlugIncludeEventTypesAndMembers.mockResolvedValue(null);

    await expect(getServerSideProps(buildContext({ slug: "Missing Team" }))).resolves.toEqual({
      notFound: true,
    });
    expect(findBySlugIncludeEventTypesAndMembers).toHaveBeenCalledWith({ slug: "missing-team" });
  });

  it("maps a public team's event types and members", async () => {
    findBySlugIncludeEventTypesAndMembers.mockResolvedValue(buildTeam());

    const { team, themeBasis, markdownStrippedBio } = await getProps(buildContext({ slug: "sales" }));
    expect(themeBasis).toBe("sales");
    expect(markdownStrippedBio).toBe("Hello team");
    expect(team.safeBio).toContain("<strong>Hello</strong>");

    const [eventType] = team.eventTypes;
    expect(eventType).not.toHaveProperty("hosts");
    expect(eventType).not.toHaveProperty("description");
    expect(eventType.descriptionAsSafeHTML).toContain("<em>demo</em>");
    expect(eventType.metadata).toEqual({});
    expect(eventType.users).toEqual([
      expect.objectContaining({
        name: "Alex",
        username: "alex",
        profile: expect.objectContaining({ upId: "usr-2" }),
      }),
    ]);

    expect(team.members).toEqual([
      expect.objectContaining({ id: 2, username: "alex", bio: "Sales lead", safeBio: expect.any(String) }),
    ]);
  });

  it("hides members and event type users for a private team", async () => {
    findBySlugIncludeEventTypesAndMembers.mockResolvedValue(buildTeam({ isPrivate: true }));

    const { team } = await getProps(buildContext({ slug: "sales" }));

    expect(team.members).toEqual([]);
    expect(team.eventTypes[0].users).toEqual([]);
  });
});

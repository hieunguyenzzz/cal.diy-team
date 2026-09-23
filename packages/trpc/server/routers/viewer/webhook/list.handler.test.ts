import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";
import { MembershipRole, UserPermissionRole } from "@calcom/prisma/enums";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getByViewerHandler } from "./getByViewer.handler";
import { listHandler } from "./list.handler";

vi.mock("@calcom/prisma", () => ({
  default: prismaMock,
  prisma: prismaMock,
}));

const { mockListWebhooks, mockGetFilteredWebhooksForUser } = vi.hoisted(() => ({
  mockListWebhooks: vi.fn(),
  mockGetFilteredWebhooksForUser: vi.fn(),
}));
vi.mock("@calcom/features/di/webhooks/containers/webhook", () => ({
  getWebhookFeature: () => ({
    repository: {
      listWebhooks: mockListWebhooks,
      getFilteredWebhooksForUser: mockGetFilteredWebhooksForUser,
    },
  }),
}));

type ListCtx = Parameters<typeof listHandler>[0]["ctx"];
type Result<T extends (...args: never[]) => unknown> = Awaited<ReturnType<T>>;

const ctxFor = (role: UserPermissionRole) => ({ user: { id: 1, role } }) as unknown as ListCtx;

describe("webhook list and getByViewer team scoping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.membership.findMany.mockResolvedValue([{ teamId: 20 }] as unknown as Result<
      typeof prismaMock.membership.findMany
    >);
  });

  const membershipRolesQueried = () => prismaMock.membership.findMany.mock.calls[0][0]?.where?.role;

  it("list passes the ids of teams the user administers", async () => {
    await listHandler({ ctx: ctxFor(UserPermissionRole.USER), input: { eventTypeId: undefined } });

    expect(membershipRolesQueried()).toEqual({ in: [MembershipRole.ADMIN, MembershipRole.OWNER] });
    expect(mockListWebhooks).toHaveBeenCalledWith(expect.objectContaining({ userId: 1, teamIds: [20] }));
  });

  it("list skips the team lookup when filtering by event type", async () => {
    await listHandler({ ctx: ctxFor(UserPermissionRole.USER), input: { eventTypeId: 42 } });

    expect(prismaMock.membership.findMany).not.toHaveBeenCalled();
    expect(mockListWebhooks).toHaveBeenCalledWith(expect.objectContaining({ eventTypeId: 42, teamIds: [] }));
  });

  it("list gives the instance admin all of their teams", async () => {
    await listHandler({ ctx: ctxFor(UserPermissionRole.ADMIN), input: undefined });

    expect(membershipRolesQueried()).toEqual({
      in: [MembershipRole.MEMBER, MembershipRole.ADMIN, MembershipRole.OWNER],
    });
  });

  it("getByViewer passes admin team ids and hides platform webhooks from normal users", async () => {
    await getByViewerHandler({ ctx: ctxFor(UserPermissionRole.USER) });

    expect(mockGetFilteredWebhooksForUser).toHaveBeenCalledWith({
      userId: 1,
      teamIds: [20],
      includePlatformWebhooks: false,
    });
  });

  it("getByViewer includes platform webhooks for the instance admin", async () => {
    await getByViewerHandler({ ctx: ctxFor(UserPermissionRole.ADMIN) });

    expect(mockGetFilteredWebhooksForUser).toHaveBeenCalledWith(
      expect.objectContaining({ includePlatformWebhooks: true })
    );
  });
});

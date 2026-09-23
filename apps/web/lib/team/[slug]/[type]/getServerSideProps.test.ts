import type { GetServerSidePropsContext } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findBySlugIncludeEventType, getBookingForReschedule, warn } = vi.hoisted(() => ({
  findBySlugIncludeEventType: vi.fn(),
  getBookingForReschedule: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@calcom/lib/logger", () => ({
  default: { getSubLogger: () => ({ warn, error: vi.fn() }) },
}));

vi.mock("@calcom/prisma", () => ({ prisma: {} }));
vi.mock("@calcom/features/teams/repositories/TeamRepository", () => ({
  TeamRepository: vi.fn().mockImplementation(function () {
    return { findBySlugIncludeEventType };
  }),
}));
vi.mock("@calcom/features/auth/lib/getServerSession", () => ({
  getServerSession: vi.fn().mockResolvedValue({ user: { id: 7 } }),
}));
vi.mock("@calcom/features/bookings/lib/get-booking", () => ({ getBookingForReschedule }));

import { getServerSideProps } from "./getServerSideProps";

const buildContext = (query: Record<string, string> = {}) =>
  ({
    req: {},
    params: { slug: "sales", type: "demo" },
    query,
  }) as unknown as GetServerSidePropsContext;

const buildEventType = (overrides: Record<string, unknown> = {}) => ({
  id: 10,
  title: "Demo",
  schedulingType: "COLLECTIVE",
  metadata: {},
  length: 15,
  hidden: false,
  disableRescheduling: false,
  allowReschedulingCancelledBookings: false,
  interfaceLanguage: null,
  hosts: [{ user: { name: "Alex", username: "alex" } }],
  users: [{ name: "Owner", username: "owner" }],
  ...overrides,
});

const buildTeam = (overrides: Record<string, unknown> = {}, eventTypeOverrides = {}) => ({
  id: 1,
  slug: "sales",
  name: "Sales",
  logoUrl: null,
  isPrivate: false,
  hideBranding: false,
  brandColor: null,
  darkBrandColor: null,
  theme: null,
  eventTypes: [buildEventType(eventTypeOverrides)],
  ...overrides,
});

describe("team/[slug]/[type] getServerSideProps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("looks the event up by team and event slug", async () => {
    findBySlugIncludeEventType.mockResolvedValue(buildTeam());

    await getServerSideProps(buildContext());

    expect(findBySlugIncludeEventType).toHaveBeenCalledWith({ slug: "sales", eventTypeSlug: "demo" });
  });

  it("returns notFound when the team does not exist", async () => {
    findBySlugIncludeEventType.mockResolvedValue(null);

    await expect(getServerSideProps(buildContext())).resolves.toEqual({ notFound: true });
    expect(warn).toHaveBeenCalledWith("Team not found", { slug: "sales", eventTypeSlug: "demo" });
  });

  it("returns notFound when the team has no such event type", async () => {
    findBySlugIncludeEventType.mockResolvedValue(buildTeam({ eventTypes: [] }));

    await expect(getServerSideProps(buildContext())).resolves.toEqual({ notFound: true });
    expect(warn).toHaveBeenCalledWith("Team event type not found", { slug: "sales", eventTypeSlug: "demo" });
  });

  it("returns notFound for managed event types", async () => {
    findBySlugIncludeEventType.mockResolvedValue(buildTeam({}, { schedulingType: "MANAGED" }));

    await expect(getServerSideProps(buildContext())).resolves.toEqual({ notFound: true });
    expect(warn).toHaveBeenCalledWith("Team event type not found", { slug: "sales", eventTypeSlug: "demo" });
  });

  it("does not warn when the event type is found", async () => {
    findBySlugIncludeEventType.mockResolvedValue(buildTeam());

    await getServerSideProps(buildContext());

    expect(warn).not.toHaveBeenCalled();
  });

  it("redirects to the booking when rescheduling is disabled", async () => {
    findBySlugIncludeEventType.mockResolvedValue(buildTeam({}, { disableRescheduling: true }));

    await expect(getServerSideProps(buildContext({ rescheduleUid: "abc" }))).resolves.toEqual({
      redirect: { destination: "/booking/abc", permanent: false },
    });
    expect(getBookingForReschedule).not.toHaveBeenCalled();
  });

  it("redirects to the plain event page when rescheduling a cancelled booking", async () => {
    findBySlugIncludeEventType.mockResolvedValue(buildTeam());
    getBookingForReschedule.mockResolvedValue({ status: "CANCELLED" });

    await expect(getServerSideProps(buildContext({ rescheduleUid: "abc" }))).resolves.toEqual({
      redirect: { permanent: false, destination: "/team/sales/demo" },
    });
    expect(getBookingForReschedule).toHaveBeenCalledWith("abc", 7);
  });

  it("passes the booking through when rescheduling an active booking", async () => {
    const booking = { uid: "abc", status: "ACCEPTED" };
    findBySlugIncludeEventType.mockResolvedValue(buildTeam());
    getBookingForReschedule.mockResolvedValue(booking);

    const result = await getServerSideProps(buildContext({ rescheduleUid: "abc" }));

    expect(result).toMatchObject({ props: { booking } });
  });

  it("returns host users and team entity for a public team", async () => {
    findBySlugIncludeEventType.mockResolvedValue(buildTeam());

    const result = await getServerSideProps(buildContext());

    expect(result).toMatchObject({
      props: {
        user: "sales",
        slug: "demo",
        booking: null,
        isBrandingHidden: false,
        eventData: {
          eventTypeId: 10,
          users: [{ name: "Alex", username: "alex" }],
          entity: { considerUnpublished: false, orgSlug: null, teamSlug: "sales", name: "Sales" },
        },
      },
    });
  });

  it("hides users for a private team", async () => {
    findBySlugIncludeEventType.mockResolvedValue(buildTeam({ isPrivate: true }));

    const result = await getServerSideProps(buildContext());

    expect(result).toMatchObject({ props: { eventData: { users: [] } } });
  });

  it("falls back to the event's first user when it has no hosts", async () => {
    findBySlugIncludeEventType.mockResolvedValue(buildTeam({}, { hosts: [] }));

    const result = await getServerSideProps(buildContext());

    expect(result).toMatchObject({ props: { eventData: { users: [{ name: "Owner", username: "owner" }] } } });
  });

  it("skips users without a username", async () => {
    findBySlugIncludeEventType.mockResolvedValue(
      buildTeam({}, { hosts: [{ user: { name: "Pending", username: null } }] })
    );

    const result = await getServerSideProps(buildContext());

    expect(result).toMatchObject({ props: { eventData: { users: [] } } });
  });
});

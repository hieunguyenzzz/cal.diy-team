import type { TFunction } from "i18next";
import { describe, it, expect } from "vitest";

import type { ChildrenEventType } from "@calcom/features/eventtypes/lib/childrenEventType";
import { stripChildrenForPayload } from "@calcom/features/eventtypes/lib/childrenEventType";
import { MembershipRole, SchedulingType } from "@calcom/prisma/enums";
import { buildEventTypeFormSchema } from "./useEventTypeForm";

describe("useEventTypeForm - children payload stripping", () => {
  it("should strip avatar, profile, username, and membership from children payload", () => {
    const children: ChildrenEventType[] = [
      {
        value: "1",
        label: "Alice",
        created: true,
        slug: "test-event",
        hidden: false,
        owner: {
          id: 1,
          name: "Alice",
          email: "alice@example.com",
          username: "alice",
          avatar: "data:image/png;base64," + "A".repeat(50000), // Large base64 avatar
          membership: MembershipRole.MEMBER,
          eventTypeSlugs: ["meeting", "consultation"],
          profile: {
            id: 1,
            username: "alice",
            upId: "usr_1",
            organizationId: null,
            organization: null,
          },
        },
      },
      {
        value: "2",
        label: "Bob",
        created: false,
        slug: "test-event",
        hidden: true,
        owner: {
          id: 2,
          name: "Bob",
          email: "bob@example.com",
          username: "bob",
          avatar: "https://example.com/avatars/bob.png",
          membership: MembershipRole.OWNER,
          eventTypeSlugs: [],
          profile: {
            id: 2,
            username: "bob",
            upId: "usr_2",
            organizationId: 10,
            organization: {
              id: 10,
              slug: "org",
              name: "Org",
              calVideoLogo: null,
              bannerUrl: "",
              isPlatform: false,
            },
          },
        },
      },
    ];

    const stripped = stripChildrenForPayload(children);

    // Should only contain server-needed fields
    expect(stripped).toEqual([
      {
        hidden: false,
        owner: {
          id: 1,
          name: "Alice",
          email: "alice@example.com",
          eventTypeSlugs: ["meeting", "consultation"],
        },
      },
      {
        hidden: true,
        owner: {
          id: 2,
          name: "Bob",
          email: "bob@example.com",
          eventTypeSlugs: [],
        },
      },
    ]);

    // Verify avatar is not present
    for (const child of stripped) {
      expect(child.owner).not.toHaveProperty("avatar");
      expect(child.owner).not.toHaveProperty("profile");
      expect(child.owner).not.toHaveProperty("username");
      expect(child.owner).not.toHaveProperty("membership");
    }
  });

  it("should significantly reduce payload size for large teams", () => {
    // Simulate 85 users with base64 avatars (~10KB each)
    const largeBase64Avatar = "data:image/png;base64," + "A".repeat(10000);

    const children: ChildrenEventType[] = Array.from({ length: 85 }, (_, i) => ({
      value: String(i + 1),
      label: `User ${i + 1}`,
      created: true,
      slug: "managed-event",
      hidden: false,
      owner: {
        id: i + 1,
        name: `User ${i + 1}`,
        email: `user${i + 1}@example.com`,
        username: `user${i + 1}`,
        avatar: largeBase64Avatar,
        membership: MembershipRole.MEMBER,
        eventTypeSlugs: ["event-a", "event-b"],
        profile: {
          id: i + 1,
          username: `user${i + 1}`,
          upId: `usr_${i + 1}`,
          organizationId: 1,
          organization: {
            id: 1,
            slug: "org",
            name: "Large Org",
            calVideoLogo: null,
            bannerUrl: "",
            isPlatform: false,
          },
        },
      },
    }));

    const fullPayloadSize = JSON.stringify(children).length;
    const strippedPayloadSize = JSON.stringify(stripChildrenForPayload(children)).length;

    // The stripped payload should be dramatically smaller
    expect(strippedPayloadSize).toBeLessThan(fullPayloadSize * 0.1);

    // Full payload with 85 users and 10KB avatars should be around 850KB+
    expect(fullPayloadSize).toBeGreaterThan(800000);

    // Stripped payload should be well under 1MB
    expect(strippedPayloadSize).toBeLessThan(100000);
  });

  it("should handle undefined children gracefully", () => {
    const children: ChildrenEventType[] = [];
    const stripped = stripChildrenForPayload(children);
    expect(stripped).toEqual([]);
  });
});

describe("useEventTypeForm - resolver schema: round-robin weights", () => {
  const schema = buildEventTypeFormSchema({
    t: ((key: string) => key) as unknown as TFunction,
    getBookingFields: () => [],
  });
  const base = { bookingFields: [], locations: [] };
  const zeroHosts = [
    { userId: 1, isFixed: true, priority: 2, weight: 100 },
    { userId: 2, isFixed: false, priority: 2, weight: 0 },
    { userId: 3, isFixed: false, priority: 2, weight: 0 },
  ];

  it("lets a personal event with no hosts save", () => {
    expect(schema.safeParse(base).success).toBe(true);
  });

  it("lets a collective event save with weights on and every weight at 0, since its hosts are all fixed", () => {
    const result = schema.safeParse({
      ...base,
      schedulingType: SchedulingType.COLLECTIVE,
      isRRWeightsEnabled: true,
      hosts: zeroHosts.map((host) => ({ ...host, weight: 0 })),
    });

    expect(result.success).toBe(true);
  });

  it("blocks a round-robin event with weights on and every round-robin host at 0", () => {
    const result = schema.safeParse({
      ...base,
      schedulingType: SchedulingType.ROUND_ROBIN,
      isRRWeightsEnabled: true,
      hosts: zeroHosts,
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ path: ["hosts"], message: "rr_weights_need_one_above_zero" }),
    ]);
  });

  it("lets the same round-robin event save with weights off", () => {
    const result = schema.safeParse({
      ...base,
      schedulingType: SchedulingType.ROUND_ROBIN,
      isRRWeightsEnabled: false,
      hosts: zeroHosts,
    });

    expect(result.success).toBe(true);
  });
});

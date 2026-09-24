import { describe, expect, it } from "vitest";
import { bookingUid, buildImportPlan, CalendlyImportError } from "./transform";
import type { CalendlyCache, CalendlyEvent, CalendlyInvitee, TargetCatalog } from "./types";

const TYPE_MATCHED = "https://api.calendly.com/event_types/type-matched";
const TYPE_ARCHIVED = "https://api.calendly.com/event_types/type-archived";
const TYPE_UNREADABLE = "https://api.calendly.com/event_types/type-unreadable";

const catalog: TargetCatalog = {
  teamSlug: "test-team",
  userEmails: ["alice@example.test", "bob@example.test"],
  eventTypeSlugs: ["showroom-visit", "clerkenwell-london"],
};

const eventUri = (id: string) => `https://api.calendly.com/scheduled_events/${id}`;

const event = (id: string, overrides: Partial<CalendlyEvent> = {}): CalendlyEvent => ({
  uri: eventUri(id),
  name: "Showroom Visit",
  status: "active",
  start_time: "2024-03-01T10:00:00.000000Z",
  end_time: "2024-03-01T11:00:00.000000Z",
  created_at: "2024-02-20T09:00:00.000000Z",
  event_type: TYPE_MATCHED,
  location: { type: "physical", location: "1 Test Street" },
  event_memberships: [{ user: "u1", user_email: "alice@calendly.test" }],
  event_guests: [],
  cancellation: null,
  ...overrides,
});

const invitee = (eventId: string, n: number, overrides: Partial<CalendlyInvitee> = {}): CalendlyInvitee => ({
  uri: `${eventUri(eventId)}/invitees/inv-${n}`,
  name: `Test Person ${n}`,
  email: `person${n}@customer.test`,
  status: "active",
  timezone: "Europe/Berlin",
  created_at: `2024-02-2${n % 10}T09:00:00.000000Z`,
  text_reminder_number: null,
  questions_and_answers: [],
  rescheduled: false,
  old_invitee: null,
  new_invitee: null,
  no_show: null,
  cancellation: null,
  ...overrides,
});

const cacheOf = (events: CalendlyEvent[], invitees: Record<string, CalendlyInvitee[]>): CalendlyCache => ({
  organization: "org",
  fetchedAt: "2024-04-01T00:00:00Z",
  eventTypes: [
    { uri: TYPE_MATCHED, slug: "showroom-visit", name: "Showroom Visit", duration: 60 },
    { uri: TYPE_ARCHIVED, slug: "old-tour", name: "Old Tour", duration: 30 },
  ],
  unresolvedEventTypeUris: [TYPE_UNREADABLE],
  events,
  inviteesByEventUuid: invitees,
});

const single = (e: CalendlyEvent, i: CalendlyInvitee[] = [invitee(e.uri.split("/").at(-1) ?? "", 1)]) =>
  buildImportPlan(cacheOf([e], { [e.uri.split("/").at(-1) ?? ""]: i }), catalog);

describe("buildImportPlan", () => {
  it("derives a deterministic uid from the Calendly event uuid", () => {
    const first = single(event("evt-1"));
    const second = single(event("evt-1"));
    expect(first.bookings[0].uid).toBe("calendly-evt-1");
    expect(second.bookings[0].uid).toBe(first.bookings[0].uid);
    expect(bookingUid(eventUri("evt-1"))).toBe("calendly-evt-1");
  });

  it("maps active to accepted and canceled to cancelled with reason and canceller", () => {
    const active = single(event("a"));
    expect(active.bookings[0]).toMatchObject({
      status: "accepted",
      cancellationReason: null,
      cancelledBy: null,
    });

    const byHost = single(
      event("c", {
        status: "canceled",
        cancellation: { canceled_by: "Alice", reason: "Closed", canceler_type: "host" },
      }),
      [invitee("c", 1, { status: "canceled" })]
    );
    expect(byHost.bookings[0]).toMatchObject({
      status: "cancelled",
      cancellationReason: "Closed",
      cancelledBy: null,
      cancelledByHost: true,
    });

    const byInvitee = single(
      event("d", {
        status: "canceled",
        cancellation: { canceled_by: "P", reason: null, canceler_type: "invitee" },
      }),
      [invitee("d", 1, { status: "canceled" })]
    );
    expect(byInvitee.bookings[0]).toMatchObject({
      cancelledBy: "person1@customer.test",
      cancelledByHost: false,
    });
  });

  it("maps hosts by email local-part and plans a locked user for unknown hosts", () => {
    const plan = single(
      event("h", {
        event_memberships: [
          { user: "u3", user_email: "carol.new@calendly.test" },
          { user: "u1", user_email: "Alice@calendly.test" },
          { user: "u2", user_email: "bob@calendly.test" },
        ],
      })
    );
    expect(plan.bookings[0].hostLocalPart).toBe("carol.new");
    expect(plan.usersToCreate).toEqual([
      { email: "carol.new@calendly.test", username: "carol.new", name: "Carol" },
    ]);
    const hostAttendees = plan.attendees.filter((a) => a.hostLocalPart).map((a) => a.hostLocalPart);
    expect(hostAttendees).toEqual(["alice", "bob"]);
    expect(JSON.stringify(plan.bookings)).not.toContain("@example.test");
    expect(plan.hostMappings.find((h) => h.localPart === "alice")?.currentEmail).toBe("alice@example.test");
  });

  it("keys hosts on local-part so a later email change on the target keeps the same mapping", () => {
    const renamed = { ...catalog, userEmails: ["alice@real.test", "bob@real.test"] };
    const cache = cacheOf([event("e")], { e: [invitee("e", 1)] });
    expect(buildImportPlan(cache, renamed).bookings).toEqual(buildImportPlan(cache, catalog).bookings);
  });

  it("fails when a host local-part matches more than one target user", () => {
    const cache = cacheOf([event("x")], { x: [invitee("x", 1)] });
    const ambiguous = { ...catalog, userEmails: ["alice@example.test", "alice@other.test"] };
    expect(() => buildImportPlan(cache, ambiguous)).toThrow(CalendlyImportError);
  });

  it("maps matching slugs and creates one hidden archive type per unmatched slug", () => {
    const events = [
      event("m"),
      event("o1", { event_type: TYPE_ARCHIVED }),
      event("o2", { event_type: TYPE_ARCHIVED }),
      event("u", { event_type: TYPE_UNREADABLE, name: "Gone Type", end_time: "2024-03-01T10:45:00.000000Z" }),
    ];
    const invitees = Object.fromEntries(["m", "o1", "o2", "u"].map((id) => [id, [invitee(id, 1)]]));
    const plan = buildImportPlan(cacheOf(events, invitees), catalog);
    expect(plan.bookings.map((b) => b.eventTypeSlug)).toEqual([
      "showroom-visit",
      "calendly-archive-old-tour",
      "calendly-archive-old-tour",
      "calendly-archive-gone-type",
    ]);
    expect(plan.archiveEventTypes).toEqual([
      { slug: "calendly-archive-old-tour", title: "Old Tour", length: 30 },
      { slug: "calendly-archive-gone-type", title: "Gone Type", length: 45 },
    ]);
    expect(plan.eventTypeMappings.find((m) => m.calendlyUri === TYPE_UNREADABLE)).toMatchObject({
      unresolved: true,
    });
  });

  it("maps the agreed Calendly aliases onto live types and flags them", () => {
    const aliasType = "https://api.calendly.com/event_types/type-alias";
    const cache = cacheOf([event("al", { event_type: aliasType })], { al: [invitee("al", 1)] });
    cache.eventTypes.push({ uri: aliasType, slug: "showroom-london", name: "Old London", duration: 60 });
    const plan = buildImportPlan(cache, catalog);
    expect(plan.bookings[0].eventTypeSlug).toBe("clerkenwell-london");
    expect(plan.eventTypeMappings[0]).toMatchObject({ aliased: true, archive: false });
    expect(plan.archiveEventTypes).toEqual([]);

    const withoutTarget = buildImportPlan(cache, { ...catalog, eventTypeSlugs: ["showroom-visit"] });
    expect(withoutTarget.bookings[0].eventTypeSlug).toBe("calendly-archive-showroom-london");
  });

  it("fails with the event-type uuid when an unreadable type's duration can't be derived", () => {
    for (const end_time of ["not-a-date", "2024-03-01T10:00:00.000000Z"]) {
      const bad = event("bad", { event_type: TYPE_UNREADABLE, end_time });
      expect(() => single(bad)).toThrow(/Event type type-unreadable: cannot derive a duration/);
    }
  });

  it("keeps every active invitee of a group event as an attendee and drops canceled ones", () => {
    const plan = single(event("g"), [
      invitee("g", 2),
      invitee("g", 1),
      invitee("g", 3, { status: "canceled" }),
    ]);
    const emails = plan.attendees.map((a) => a.email);
    expect(emails).toEqual(["person1@customer.test", "person2@customer.test"]);
    expect(plan.droppedCanceledInvitees).toBe(1);
    expect(plan.bookings[0].responses).toMatchObject({
      name: "Test Person 1",
      email: "person1@customer.test",
    });
    expect(plan.bookings[0].metadata.calendlyInviteeUris.split(" ")).toHaveLength(2);
  });

  it("builds responses with custom answers, phone, guests and records no-show", () => {
    const plan = single(
      event("r", { event_guests: [{ email: "guest@customer.test" }, { email: "alice@calendly.test" }] }),
      [
        invitee("r", 1, {
          text_reminder_number: "+44 0000 000000",
          no_show: { uri: "ns" },
          questions_and_answers: [
            { question: "Company name?", answer: "Test Ltd", position: 1 },
            { question: "Name", answer: "Dup", position: 0 },
          ],
        }),
      ]
    );
    expect(plan.bookings[0].responses).toEqual({
      name: "Test Person 1",
      email: "person1@customer.test",
      attendeePhoneNumber: "+44 0000 000000",
      guests: ["guest@customer.test"],
      "calendly-name": "Dup",
      "company-name": "Test Ltd",
    });
    expect(plan.bookings[0].description).toBe("Name: Dup\nCompany name?: Test Ltd");
    expect(single(event("no-answers")).bookings[0].description).toBeNull();
    expect(plan.attendees[0]).toMatchObject({
      noShow: true,
      phoneNumber: "+44 0000 000000",
      timeZone: "Europe/Berlin",
    });
    expect(plan.attendees[1]).toMatchObject({
      email: "guest@customer.test",
      name: "",
      timeZone: "Europe/Berlin",
    });
  });

  it("links reschedules and stores Calendly URIs as string metadata", () => {
    const events = [event("old", { status: "canceled" }), event("new")];
    const plan = buildImportPlan(
      cacheOf(events, {
        old: [
          invitee("old", 1, {
            status: "canceled",
            rescheduled: true,
            new_invitee: `${eventUri("new")}/invitees/inv-9`,
          }),
        ],
        new: [invitee("new", 9, { old_invitee: `${eventUri("old")}/invitees/inv-1` })],
      }),
      catalog
    );
    expect(plan.bookings[0]).toMatchObject({ rescheduled: true, fromReschedule: null });
    expect(plan.bookings[1]).toMatchObject({ rescheduled: null, fromReschedule: "calendly-old" });
    for (const value of Object.values(plan.bookings[1].metadata)) expect(typeof value).toBe("string");
    expect(plan.bookings[1].metadata).toMatchObject({
      calendlyEventUri: eventUri("new"),
      calendlyEventTypeUri: TYPE_MATCHED,
    });
  });

  it("fails loudly when an event's invitees were not fetched", () => {
    expect(() => buildImportPlan(cacheOf([event("missing")], {}), catalog)).toThrow(/no fetched invitees/);
  });
});

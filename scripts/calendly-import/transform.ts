import type {
  AttendeeRow,
  BookingRow,
  CalendlyCache,
  CalendlyCancellation,
  CalendlyEvent,
  CalendlyEventType,
  CalendlyInvitee,
  EventTypeMapping,
  HostMapping,
  ImportPlan,
  TargetCatalog,
} from "./types";

const ARCHIVE_SLUG_PREFIX = "calendly-archive-";
const MISSING_HOST_DOMAIN = "example.com";
// Calendly's timezone is optional; Attendee.timeZone is required and the business runs on UK time.
const FALLBACK_TIME_ZONE = "Europe/London";
const RESERVED_RESPONSE_KEYS = new Set([
  "name",
  "email",
  "guests",
  "notes",
  "location",
  "attendeePhoneNumber",
]);

// Calendly invitee URIs look like .../scheduled_events/<event uuid>/invitees/<invitee uuid>.
const eventUuidFromInviteeUri = (uri: string) => uri.match(/scheduled_events\/([^/]+)\//)?.[1] ?? null;

const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const localPartOf = (email: string) => email.toLowerCase().split("@")[0];

const displayNameFromLocalPart = (localPart: string) => {
  const first = localPart.split(/[._-]/)[0];
  return first.charAt(0).toUpperCase() + first.slice(1);
};

const toTimestamp = (iso: string) => new Date(iso).toISOString();

function resolveEventType(event: CalendlyEvent, byUri: Map<string, CalendlyEventType>) {
  const known = byUri.get(event.event_type);
  if (known?.slug) return { slug: known.slug, name: known.name, duration: known.duration, unresolved: false };
  const minutes = Math.round((Date.parse(event.end_time) - Date.parse(event.start_time)) / 60000);
  return {
    slug: slugify(known?.name ?? event.name),
    name: known?.name ?? event.name,
    duration: minutes,
    unresolved: true,
  };
}

function locationOf(event: CalendlyEvent) {
  const location = event.location;
  if (!location) return null;
  return location.join_url || location.location || null;
}

function responsesFor(booker: CalendlyInvitee, guests: string[]) {
  const responses: Record<string, unknown> = { name: booker.name, email: booker.email };
  if (booker.text_reminder_number) responses.attendeePhoneNumber = booker.text_reminder_number;
  if (guests.length) responses.guests = guests;
  const answers = [...booker.questions_and_answers].sort((a, b) => a.position - b.position);
  for (const { question, answer } of answers) {
    let base = slugify(question) || "question";
    if (RESERVED_RESPONSE_KEYS.has(base)) base = `calendly-${base}`;
    let key = base;
    for (let n = 2; key in responses; n++) key = `${base}-${n}`;
    responses[key] = answer;
  }
  return responses;
}

function cancellerEmail(
  cancellation: CalendlyCancellation | null,
  hostEmail: string,
  inviteeEmail: string | null
): string | null {
  if (cancellation?.canceler_type === "host") return hostEmail;
  if (cancellation?.canceler_type === "invitee") return inviteeEmail;
  return null;
}

function requireInvitees(event: CalendlyEvent, cache: CalendlyCache) {
  const uuid = uuidFromUri(event.uri);
  const invitees = cache.inviteesByEventUuid[uuid];
  if (!invitees?.length) throw new CalendlyImportError(`Event ${uuid} has no fetched invitees`);
  for (const invitee of invitees) {
    if (!invitee.email || !invitee.name) {
      throw new CalendlyImportError(
        `Invitee ${uuidFromUri(invitee.uri)} of event ${uuid} lacks name or email`
      );
    }
  }
  return [...invitees].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

function bookingFor(input: {
  event: CalendlyEvent;
  invitees: CalendlyInvitee[];
  guests: string[];
  hostEmail: string;
  targetSlug: string;
  eventUuids: Set<string>;
}): BookingRow {
  const { event, invitees, guests, hostEmail, targetSlug, eventUuids } = input;
  const booker = invitees[0];
  const cancelled = event.status === "canceled";
  const cancellation = event.cancellation ?? booker.cancellation ?? null;
  const rescheduledTo = invitees.find((invitee) => invitee.rescheduled && invitee.new_invitee)?.new_invitee;
  const oldEventUuid = booker.old_invitee ? eventUuidFromInviteeUri(booker.old_invitee) : null;

  const metadata: Record<string, string> = {
    calendlyEventUri: event.uri,
    calendlyEventTypeUri: event.event_type,
    calendlyInviteeUris: invitees.map((invitee) => invitee.uri).join(" "),
  };
  if (rescheduledTo) metadata.calendlyRescheduledTo = rescheduledTo;
  if (booker.old_invitee) metadata.calendlyRescheduledFrom = booker.old_invitee;

  return {
    uid: bookingUid(event.uri),
    hostEmail,
    eventTypeSlug: targetSlug,
    title: event.name,
    startTime: toTimestamp(event.start_time),
    endTime: toTimestamp(event.end_time),
    createdAt: toTimestamp(event.created_at),
    location: locationOf(event),
    status: cancelled ? "cancelled" : "accepted",
    cancellationReason: cancelled ? cancellation?.reason || null : null,
    cancelledBy: cancelled ? cancellerEmail(cancellation, hostEmail, booker.email) : null,
    rescheduled: rescheduledTo ? true : null,
    fromReschedule: oldEventUuid && eventUuids.has(oldEventUuid) ? `calendly-${oldEventUuid}` : null,
    metadata,
    responses: responsesFor(booker, guests),
  };
}

// Mirrors the app's createBooking: invitees, then guests, then the other collective hosts as attendees.
function attendeesFor(uid: string, invitees: CalendlyInvitee[], guests: string[], hostEmails: string[]) {
  const blank = { bookingUid: uid, hostEmail: null, phoneNumber: null, noShow: false };
  const bookerTimeZone = invitees[0].timezone || FALLBACK_TIME_ZONE;
  const rows: AttendeeRow[] = invitees.map((invitee) => ({
    ...blank,
    email: invitee.email,
    name: invitee.name,
    timeZone: invitee.timezone || FALLBACK_TIME_ZONE,
    phoneNumber: invitee.text_reminder_number,
    noShow: invitee.no_show !== null,
  }));
  for (const email of guests) rows.push({ ...blank, email, name: "", timeZone: bookerTimeZone });
  for (const hostEmail of new Set(hostEmails.slice(1))) {
    if (hostEmail === hostEmails[0]) continue;
    rows.push({ ...blank, hostEmail, email: null, name: null, timeZone: null });
  }
  return rows;
}

export class CalendlyImportError extends Error {}

export const uuidFromUri = (uri: string) => uri.split("/").filter(Boolean).at(-1) ?? uri;

export const bookingUid = (calendlyEventUri: string) => `calendly-${uuidFromUri(calendlyEventUri)}`;

export function buildImportPlan(cache: CalendlyCache, catalog: TargetCatalog): ImportPlan {
  const eventTypeByUri = new Map(cache.eventTypes.map((eventType) => [eventType.uri, eventType]));
  const targetSlugs = new Set(catalog.eventTypeSlugs);
  const eventUuids = new Set(cache.events.map((event) => uuidFromUri(event.uri)));

  const targetUsersByLocalPart = new Map<string, string[]>();
  for (const email of catalog.userEmails) {
    const localPart = localPartOf(email);
    targetUsersByLocalPart.set(localPart, [...(targetUsersByLocalPart.get(localPart) ?? []), email]);
  }

  const hostMappings = new Map<string, HostMapping>();
  const hostEmailFor = (calendlyEmail: string) => {
    const localPart = localPartOf(calendlyEmail);
    let mapping = hostMappings.get(localPart);
    if (!mapping) {
      const matches = targetUsersByLocalPart.get(localPart) ?? [];
      if (matches.length > 1) {
        throw new CalendlyImportError(`Host "${localPart}" matches ${matches.length} target users`);
      }
      const targetEmail = matches[0] ?? `${localPart}@${MISSING_HOST_DOMAIN}`;
      mapping = { localPart, targetEmail, create: matches.length === 0, events: 0 };
      hostMappings.set(localPart, mapping);
    }
    mapping.events++;
    return mapping.targetEmail;
  };

  const eventTypeMappings = new Map<string, EventTypeMapping>();
  const archiveEventTypes = new Map<string, ImportPlan["archiveEventTypes"][number]>();
  const bookings: BookingRow[] = [];
  const attendees: AttendeeRow[] = [];
  let droppedCanceledInvitees = 0;

  for (const event of cache.events) {
    const calendlyType = resolveEventType(event, eventTypeByUri);
    const archive = !targetSlugs.has(calendlyType.slug);
    const targetSlug = archive ? `${ARCHIVE_SLUG_PREFIX}${calendlyType.slug}` : calendlyType.slug;
    if (archive && !archiveEventTypes.has(targetSlug)) {
      archiveEventTypes.set(targetSlug, {
        slug: targetSlug,
        title: calendlyType.name,
        length: calendlyType.duration,
      });
    }
    const mapping = eventTypeMappings.get(event.event_type) ?? {
      calendlyUri: event.event_type,
      calendlySlug: calendlyType.slug,
      calendlyName: calendlyType.name,
      targetSlug,
      archive,
      unresolved: calendlyType.unresolved,
      bookings: 0,
    };
    mapping.bookings++;
    eventTypeMappings.set(event.event_type, mapping);

    if (!event.event_memberships.length) throw new CalendlyImportError(`Event ${event.uri} has no hosts`);
    const hostEmails = event.event_memberships.map((membership) => hostEmailFor(membership.user_email));
    const calendlyHostEmails = new Set(event.event_memberships.map((m) => m.user_email.toLowerCase()));

    const allInvitees = requireInvitees(event, cache);
    const invitees =
      event.status === "canceled"
        ? allInvitees
        : allInvitees.filter((invitee) => invitee.status === "active");
    droppedCanceledInvitees += allInvitees.length - invitees.length;
    if (!invitees.length) throw new CalendlyImportError(`Active event ${event.uri} has no active invitees`);
    const inviteeEmails = new Set(invitees.map((invitee) => invitee.email?.toLowerCase()));
    const guests = event.event_guests
      .map((guest) => guest.email)
      .filter(
        (email) => !calendlyHostEmails.has(email.toLowerCase()) && !inviteeEmails.has(email.toLowerCase())
      );

    const booking = bookingFor({ event, invitees, guests, hostEmail: hostEmails[0], targetSlug, eventUuids });
    bookings.push(booking);
    attendees.push(...attendeesFor(booking.uid, invitees, guests, hostEmails));
  }

  const hosts = [...hostMappings.values()];
  return {
    teamSlug: catalog.teamSlug,
    bookings,
    attendees,
    eventTypeMappings: [...eventTypeMappings.values()],
    archiveEventTypes: [...archiveEventTypes.values()],
    hostMappings: hosts,
    usersToCreate: hosts
      .filter((host) => host.create)
      .map((host) => ({
        email: host.targetEmail,
        username: host.localPart,
        name: displayNameFromLocalPart(host.localPart),
      })),
    droppedCanceledInvitees,
  };
}

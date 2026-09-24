// Only the Calendly API v2 fields the import reads.
export type CalendlyEventType = {
  uri: string;
  slug: string | null;
  name: string;
  duration: number;
};

export type CalendlyCancellation = {
  canceled_by: string;
  reason: string | null;
  canceler_type: "host" | "invitee" | string;
};

export type CalendlyEvent = {
  uri: string;
  name: string;
  status: "active" | "canceled";
  start_time: string;
  end_time: string;
  created_at: string;
  event_type: string;
  location: { type: string; location?: string | null; join_url?: string | null } | null;
  event_memberships: { user: string; user_email: string; user_name?: string }[];
  event_guests: { email: string }[];
  cancellation?: CalendlyCancellation | null;
};

export type CalendlyInvitee = {
  uri: string;
  name: string | null;
  email: string | null;
  status: "active" | "canceled";
  timezone: string | null;
  created_at: string;
  text_reminder_number: string | null;
  questions_and_answers: { question: string; answer: string; position: number }[];
  rescheduled: boolean;
  old_invitee: string | null;
  new_invitee: string | null;
  no_show: { uri: string } | null;
  cancellation?: CalendlyCancellation | null;
};

export type CalendlyCache = {
  organization: string;
  fetchedAt: string;
  eventTypes: CalendlyEventType[];
  // Event types the org token may not read (e.g. owned by departed users); resolved from the event itself.
  unresolvedEventTypeUris: string[];
  events: CalendlyEvent[];
  inviteesByEventUuid: Record<string, CalendlyInvitee[]>;
};

export type TargetCatalog = {
  teamSlug: string;
  userEmails: string[];
  eventTypeSlugs: string[];
};

// Bookings a previous run imported; changedInCalDiy means the app updated the row (updatedAt is set).
export type ExistingBooking = { uid: string; status: string; changedInCalDiy: boolean };

export type BookingRow = {
  uid: string;
  // Users are matched by email local-part at write time, so later email changes don't break the mapping.
  hostLocalPart: string;
  eventTypeSlug: string;
  title: string;
  // Calendly's answers as "Question: Answer" lines, which the app shows as "Additional notes".
  description: string | null;
  startTime: string;
  endTime: string;
  createdAt: string;
  location: string | null;
  status: "accepted" | "cancelled";
  cancellationReason: string | null;
  // Invitee email, or null when the host cancelled (cancelledByHost) and the SQL fills in the host's email.
  cancelledBy: string | null;
  cancelledByHost: boolean;
  rescheduled: boolean | null;
  fromReschedule: string | null;
  metadata: Record<string, string>;
  responses: Record<string, unknown>;
};

// Host attendees carry only hostLocalPart; email, name and time zone come from the target users table.
export type AttendeeRow = {
  bookingUid: string;
  hostLocalPart: string | null;
  email: string | null;
  name: string | null;
  timeZone: string | null;
  phoneNumber: string | null;
  noShow: boolean;
};

export type EventTypeMapping = {
  calendlyUri: string;
  calendlySlug: string;
  calendlyName: string;
  targetSlug: string;
  archive: boolean;
  aliased: boolean;
  unresolved: boolean;
  bookings: number;
};

// currentEmail is only for the report; null means the import creates the user.
export type HostMapping = { localPart: string; currentEmail: string | null; events: number };

export type ImportPlan = {
  teamSlug: string;
  bookings: BookingRow[];
  attendees: AttendeeRow[];
  eventTypeMappings: EventTypeMapping[];
  archiveEventTypes: { slug: string; title: string; length: number }[];
  hostMappings: HostMapping[];
  usersToCreate: { email: string; username: string; name: string }[];
  droppedCanceledInvitees: number;
};

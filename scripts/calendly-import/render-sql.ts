import type { ImportPlan } from "./types";

const ROWS_PER_INSERT = 200;

// Booking/Attendee timestamps are "timestamp without time zone" holding UTC.
const sqlTimestamp = (iso: string) => sqlLiteral(iso.replace("T", " ").replace("Z", ""));
const sqlJson = (value: unknown) => `${sqlLiteral(JSON.stringify(value))}::jsonb`;

function valuesInChunks(table: string, rows: string[][]): string {
  const statements: string[] = [];
  for (let i = 0; i < rows.length; i += ROWS_PER_INSERT) {
    const values = rows.slice(i, i + ROWS_PER_INSERT).map((row) => `  (${row.join(", ")})`);
    statements.push(`INSERT INTO ${table} VALUES\n${values.join(",\n")};`);
  }
  return statements.join("\n");
}

const guard = (condition: string, message: string) =>
  `DO $$ BEGIN IF ${condition} THEN RAISE EXCEPTION ${sqlLiteral(message)}; END IF; END $$;`;

export const sqlLiteral = (value: string | number | boolean | null): string => {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return `'${value.replaceAll(String.fromCharCode(0), "").replace(/'/g, "''")}'`;
};

export function catalogQuery(teamSlug: string, hostLocalParts: string[]): string {
  const team = sqlLiteral(teamSlug);
  const localParts = hostLocalParts.map(sqlLiteral).join(", ") || "NULL";
  return `\\set ON_ERROR_STOP on
\\set QUIET on
\\pset tuples_only on
\\pset format unaligned
SELECT json_build_object(
  'teamCount', (SELECT count(*) FROM "Team" WHERE slug = ${team}),
  'userEmails', (SELECT coalesce(json_agg(email ORDER BY email), '[]') FROM users
                 WHERE split_part(lower(email), '@', 1) IN (${localParts})),
  'eventTypeSlugs', (SELECT coalesce(json_agg(e.slug ORDER BY e.slug), '[]') FROM "EventType" e
                     JOIN "Team" t ON t.id = e."teamId" WHERE t.slug = ${team})
);
`;
}

export function renderImportSql(plan: ImportPlan): string {
  const team = sqlLiteral(plan.teamSlug);
  const teamId = `(SELECT id FROM "Team" WHERE slug = ${team})`;

  const users = plan.usersToCreate.map((user) => [
    sqlLiteral(user.email),
    sqlLiteral(user.username),
    sqlLiteral(user.name),
    "TRUE",
    "gen_random_uuid()",
  ]);
  const eventTypes = plan.archiveEventTypes.map((eventType) => [
    sqlLiteral(eventType.slug),
    sqlLiteral(eventType.title),
    sqlLiteral(eventType.length),
  ]);
  const bookings = plan.bookings.map((b) => [
    sqlLiteral(b.uid),
    sqlLiteral(b.hostEmail),
    sqlLiteral(b.eventTypeSlug),
    sqlLiteral(b.title),
    sqlTimestamp(b.startTime),
    sqlTimestamp(b.endTime),
    sqlTimestamp(b.createdAt),
    sqlLiteral(b.location),
    sqlLiteral(b.status),
    sqlLiteral(b.cancellationReason),
    sqlLiteral(b.cancelledBy),
    sqlLiteral(b.rescheduled),
    sqlLiteral(b.fromReschedule),
    sqlJson(b.metadata),
    sqlJson(b.responses),
  ]);
  const attendees = plan.attendees.map((a) => [
    sqlLiteral(a.bookingUid),
    sqlLiteral(a.hostEmail),
    sqlLiteral(a.email),
    sqlLiteral(a.name),
    sqlLiteral(a.timeZone),
    sqlLiteral(a.phoneNumber),
    sqlLiteral(a.noShow),
  ]);

  // ON_ERROR_STOP makes any failed guard or insert abort the whole transaction; "result:" rows are the run summary.
  return `-- Calendly booking import: idempotent, single transaction. Existing rows are never updated.
\\set ON_ERROR_STOP on
\\set QUIET on
\\pset tuples_only on
\\pset format unaligned
BEGIN;
SET LOCAL standard_conforming_strings = on;
${guard(`(SELECT count(*) FROM "Team" WHERE slug = ${team}) <> 1`, `Expected exactly one team with slug ${plan.teamSlug}`)}

CREATE TEMP TABLE ci_user (email text, username text, name text, locked boolean, uuid uuid) ON COMMIT DROP;
${valuesInChunks("ci_user", users)}
WITH ins AS (
  INSERT INTO users (email, username, name, locked, uuid) SELECT * FROM ci_user
  ON CONFLICT DO NOTHING RETURNING 1)
SELECT 'result: users inserted=' || count(*) FROM ins;

CREATE TEMP TABLE ci_event_type (slug text, title text, length int) ON COMMIT DROP;
${valuesInChunks("ci_event_type", eventTypes)}
WITH ins AS (
  INSERT INTO "EventType" ("teamId", slug, title, length, hidden, "schedulingType")
  SELECT ${teamId}, slug, title, length, TRUE, 'collective' FROM ci_event_type
  ON CONFLICT DO NOTHING RETURNING 1)
SELECT 'result: archive event types inserted=' || count(*) FROM ins;

CREATE TEMP TABLE ci_booking (
  uid text, host_email text, event_type_slug text, title text, start_time timestamp, end_time timestamp,
  created_at timestamp, location text, status "BookingStatus", cancellation_reason text, cancelled_by text,
  rescheduled boolean, from_reschedule text, metadata jsonb, responses jsonb) ON COMMIT DROP;
${valuesInChunks("ci_booking", bookings)}

CREATE TEMP TABLE ci_attendee (
  booking_uid text, host_email text, email text, name text, time_zone text, phone_number text, no_show boolean
) ON COMMIT DROP;
${valuesInChunks("ci_attendee", attendees)}

${guard(
  `EXISTS (SELECT 1 FROM ci_booking b LEFT JOIN users u ON u.email = b.host_email WHERE u.id IS NULL)
  OR EXISTS (SELECT 1 FROM ci_attendee a LEFT JOIN users u ON u.email = a.host_email
             WHERE a.host_email IS NOT NULL AND u.id IS NULL)`,
  "A Calendly host has no target user"
)}
${guard(
  `EXISTS (SELECT 1 FROM ci_booking b LEFT JOIN "EventType" e
           ON e.slug = b.event_type_slug AND e."teamId" = ${teamId} WHERE e.id IS NULL)`,
  "A mapped event type is missing on the target team"
)}

WITH ins AS (
  INSERT INTO "Booking" (uid, "userId", "userPrimaryEmail", "eventTypeId", title, "startTime", "endTime",
    "createdAt", location, status, "cancellationReason", "cancelledBy", rescheduled, "fromReschedule",
    metadata, responses)
  SELECT b.uid, u.id, u.email, e.id, b.title, b.start_time, b.end_time, b.created_at, b.location, b.status,
    b.cancellation_reason, b.cancelled_by, b.rescheduled, b.from_reschedule, b.metadata, b.responses
  FROM ci_booking b
  JOIN users u ON u.email = b.host_email
  JOIN "EventType" e ON e.slug = b.event_type_slug AND e."teamId" = ${teamId}
  ON CONFLICT (uid) DO NOTHING
  RETURNING id, uid),
att AS (
  INSERT INTO "Attendee" ("bookingId", email, name, "timeZone", "phoneNumber", "noShow")
  SELECT ins.id, coalesce(u.email, a.email), coalesce(u.name, a.name, ''), coalesce(u."timeZone", a.time_zone),
    a.phone_number, a.no_show
  FROM ci_attendee a
  JOIN ins ON ins.uid = a.booking_uid
  LEFT JOIN users u ON u.email = a.host_email
  RETURNING 1)
SELECT 'result: bookings inserted=' || (SELECT count(*) FROM ins)
  || ' skipped=' || ((SELECT count(*) FROM ci_booking) - (SELECT count(*) FROM ins))
  || ' attendees inserted=' || (SELECT count(*) FROM att);

COMMIT;
`;
}

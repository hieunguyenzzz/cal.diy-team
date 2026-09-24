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

const LOCAL_PART = "split_part(lower(email), '@', 1)";
const LOCAL_PART_OF = (alias: string) => `split_part(lower(${alias}.email), '@', 1)`;

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
                 WHERE ${LOCAL_PART} IN (${localParts})),
  'eventTypeSlugs', (SELECT coalesce(json_agg(e.slug ORDER BY e.slug), '[]') FROM "EventType" e
                     JOIN "Team" t ON t.id = e."teamId" WHERE t.slug = ${team}),
  'existingBookings', (SELECT coalesce(json_agg(json_build_object(
                         'uid', uid, 'status', status, 'rescheduled', rescheduled,
                         'changedInCalDiy', "updatedAt" IS NOT NULL)), '[]')
                       FROM "Booking" WHERE uid LIKE 'calendly-%')
);
`;
}

export function renderImportSql(plan: ImportPlan): string {
  const team = sqlLiteral(plan.teamSlug);
  const teamId = `(SELECT id FROM "Team" WHERE slug = ${team})`;

  const users = plan.usersToCreate.map((user) => [
    sqlLiteral(user.username),
    sqlLiteral(user.email),
    sqlLiteral(user.name),
  ]);
  const eventTypes = plan.archiveEventTypes.map((eventType) => [
    sqlLiteral(eventType.slug),
    sqlLiteral(eventType.title),
    sqlLiteral(eventType.length),
  ]);
  const bookings = plan.bookings.map((b) => [
    sqlLiteral(b.uid),
    sqlLiteral(b.hostLocalPart),
    sqlLiteral(b.eventTypeSlug),
    sqlLiteral(b.title),
    sqlLiteral(b.description),
    sqlTimestamp(b.startTime),
    sqlTimestamp(b.endTime),
    sqlTimestamp(b.createdAt),
    sqlLiteral(b.location),
    sqlLiteral(b.status),
    sqlLiteral(b.cancellationReason),
    sqlLiteral(b.cancelledBy),
    sqlLiteral(b.cancelledByHost),
    sqlLiteral(b.rescheduled),
    sqlLiteral(b.fromReschedule),
    sqlJson(b.metadata),
    sqlJson(b.responses),
  ]);
  const attendees = plan.attendees.map((a) => [
    sqlLiteral(a.bookingUid),
    sqlLiteral(a.hostLocalPart),
    sqlLiteral(a.email),
    sqlLiteral(a.name),
    sqlLiteral(a.timeZone),
    sqlLiteral(a.phoneNumber),
    sqlLiteral(a.noShow),
  ]);

  // ON_ERROR_STOP makes any failed guard or statement abort the whole transaction; "result:" rows are the run summary.
  // Hosts join on email local-part, never the full address, so staff email changes keep the same users.
  // A booking whose updatedAt is set was changed by the app (Prisma sets it; this script never does), so it is never touched.
  return `-- Calendly booking import: single transaction, safe to re-run as a delta sync.
-- Inserts new bookings. On imported (calendly-*) bookings that are still accepted and untouched by the app it
-- only sets rescheduled=true (rescheduled in Calendly since) and status/cancellationReason/cancelledBy
-- (cancelled in Calendly since). Nothing else is ever updated.
\\set ON_ERROR_STOP on
\\set QUIET on
\\pset tuples_only on
\\pset format unaligned
BEGIN;
SET LOCAL standard_conforming_strings = on;
${guard(`(SELECT count(*) FROM "Team" WHERE slug = ${team}) <> 1`, `Expected exactly one team with slug ${plan.teamSlug}`)}

CREATE TEMP TABLE ci_user (local_part text, email text, name text) ON COMMIT DROP;
${valuesInChunks("ci_user", users)}
WITH ins AS (
  INSERT INTO users (email, username, name, locked, uuid)
  SELECT c.email, c.local_part, c.name, TRUE, gen_random_uuid() FROM ci_user c
  WHERE NOT EXISTS (SELECT 1 FROM users u WHERE ${LOCAL_PART_OF("u")} = c.local_part)
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
  uid text, host_local_part text, event_type_slug text, title text, description text, start_time timestamp, end_time timestamp,
  created_at timestamp, location text, status "BookingStatus", cancellation_reason text, cancelled_by text,
  cancelled_by_host boolean, rescheduled boolean, from_reschedule text, metadata jsonb, responses jsonb
) ON COMMIT DROP;
${valuesInChunks("ci_booking", bookings)}

CREATE TEMP TABLE ci_attendee (
  booking_uid text, host_local_part text, email text, name text, time_zone text, phone_number text, no_show boolean
) ON COMMIT DROP;
${valuesInChunks("ci_attendee", attendees)}

CREATE TEMP TABLE ci_host ON COMMIT DROP AS
  SELECT ${LOCAL_PART_OF("u")} AS local_part, u.id, u.email, u.name, u."timeZone" FROM users u
  WHERE ${LOCAL_PART_OF("u")} IN (SELECT host_local_part FROM ci_booking
                                  UNION SELECT host_local_part FROM ci_attendee WHERE host_local_part IS NOT NULL);

${guard(
  "EXISTS (SELECT 1 FROM ci_host GROUP BY local_part HAVING count(*) > 1)",
  "A Calendly host local-part matches more than one target user"
)}
${guard(
  `EXISTS (SELECT 1 FROM ci_booking b WHERE b.host_local_part NOT IN (SELECT local_part FROM ci_host))
  OR EXISTS (SELECT 1 FROM ci_attendee a
             WHERE a.host_local_part IS NOT NULL AND a.host_local_part NOT IN (SELECT local_part FROM ci_host))`,
  "A Calendly host has no target user"
)}
${guard(
  `EXISTS (SELECT 1 FROM ci_booking b LEFT JOIN "EventType" e
           ON e.slug = b.event_type_slug AND e."teamId" = ${teamId} WHERE e.id IS NULL)`,
  "A mapped event type is missing on the target team"
)}

SELECT 'result: left-alone-changed-in-caldiy=' || count(*)
FROM "Booking" t JOIN ci_booking b ON b.uid = t.uid
WHERE t.uid LIKE 'calendly-%' AND t.status = 'accepted' AND t."updatedAt" IS NOT NULL
  AND (b.status = 'cancelled' OR (b.rescheduled AND t.rescheduled IS NOT TRUE));

-- Runs before the cancel update, so a booking rescheduled and cancelled since the last run gets both.
WITH upd AS (
  UPDATE "Booking" t SET rescheduled = TRUE
  FROM ci_booking b
  WHERE t.uid = b.uid AND t.uid LIKE 'calendly-%' AND b.rescheduled
    AND t.status = 'accepted' AND t.rescheduled IS NOT TRUE AND t."updatedAt" IS NULL
  RETURNING 1)
SELECT 'result: rescheduled-updated=' || count(*) FROM upd;

WITH upd AS (
  UPDATE "Booking" t
  SET status = 'cancelled', "cancellationReason" = b.cancellation_reason,
    "cancelledBy" = CASE WHEN b.cancelled_by_host THEN h.email ELSE b.cancelled_by END
  FROM ci_booking b JOIN ci_host h ON h.local_part = b.host_local_part
  WHERE t.uid = b.uid AND t.uid LIKE 'calendly-%' AND b.status = 'cancelled'
    AND t.status = 'accepted' AND t."updatedAt" IS NULL
  RETURNING 1)
SELECT 'result: cancelled-updated=' || count(*) FROM upd;

WITH ins AS (
  INSERT INTO "Booking" (uid, "userId", "userPrimaryEmail", "eventTypeId", title, description, "startTime", "endTime",
    "createdAt", location, status, "cancellationReason", "cancelledBy", rescheduled, "fromReschedule",
    metadata, responses)
  SELECT b.uid, h.id, h.email, e.id, b.title, b.description, b.start_time, b.end_time, b.created_at, b.location, b.status,
    b.cancellation_reason, CASE WHEN b.cancelled_by_host THEN h.email ELSE b.cancelled_by END,
    b.rescheduled, b.from_reschedule, b.metadata, b.responses
  FROM ci_booking b
  JOIN ci_host h ON h.local_part = b.host_local_part
  JOIN "EventType" e ON e.slug = b.event_type_slug AND e."teamId" = ${teamId}
  ON CONFLICT (uid) DO NOTHING
  RETURNING id, uid),
att AS (
  INSERT INTO "Attendee" ("bookingId", email, name, "timeZone", "phoneNumber", "noShow")
  SELECT ins.id, coalesce(h.email, a.email), coalesce(h.name, a.name, ''), coalesce(h."timeZone", a.time_zone),
    a.phone_number, a.no_show
  FROM ci_attendee a
  JOIN ins ON ins.uid = a.booking_uid
  LEFT JOIN ci_host h ON h.local_part = a.host_local_part
  RETURNING 1)
SELECT 'result: inserted=' || (SELECT count(*) FROM ins)
  || ' skipped=' || ((SELECT count(*) FROM ci_booking) - (SELECT count(*) FROM ins))
  || ' attendees-inserted=' || (SELECT count(*) FROM att);

COMMIT;
`;
}

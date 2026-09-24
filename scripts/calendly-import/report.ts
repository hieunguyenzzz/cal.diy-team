import type { ImportPlan } from "./types";

const countBy = <T>(items: T[], key: (item: T) => string) => {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
};

// Counts, slugs and staff mailboxes only: never customer names, emails or answers.
export function formatPlanReport(plan: ImportPlan): string {
  const lines: string[] = [];
  const attendeesPerBooking = countBy(
    plan.attendees.filter((a) => !a.hostEmail),
    (a) => a.bookingUid
  );
  const hostAttendees = plan.attendees.filter((a) => a.hostEmail).length;

  lines.push(`Team: ${plan.teamSlug}`, `Bookings: ${plan.bookings.length}`);
  for (const [status, count] of countBy(plan.bookings, (b) => b.status)) lines.push(`  ${status}: ${count}`);
  lines.push(
    `Attendees: ${plan.attendees.length} (${plan.attendees.length - hostAttendees} invitees/guests, ${hostAttendees} extra collective hosts)`,
    `Bookings by invitee+guest count: ${countBy(attendeesPerBooking, ([, n]) => String(n))
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([size, bookings]) => `${size}:${bookings}`)
      .join(" ")}`,
    `Canceled invitees dropped from active events: ${plan.droppedCanceledInvitees}`,
    `Rescheduled bookings: ${plan.bookings.filter((b) => b.rescheduled).length}, linked via fromReschedule: ${plan.bookings.filter((b) => b.fromReschedule).length}`,
    `Bookings marked no-show: ${new Set(plan.attendees.filter((a) => a.noShow).map((a) => a.bookingUid)).size}`,
    ""
  );

  lines.push("Bookings per target event type:");
  for (const [slug, count] of countBy(plan.bookings, (b) => b.eventTypeSlug))
    lines.push(`  ${String(count).padStart(5)}  ${slug}`);

  lines.push(
    "",
    "Event type mapping (calendly uuid | calendly slug | calendly name -> target slug | kind | bookings):"
  );
  for (const m of [...plan.eventTypeMappings].sort((a, b) => b.bookings - a.bookings)) {
    const kind = `${m.archive ? "ARCHIVE (new hidden)" : "matched"}${m.unresolved ? ", type unreadable in Calendly" : ""}`;
    lines.push(
      `  ${m.calendlyUri.split("/").at(-1)} | ${m.calendlySlug} | ${m.calendlyName} -> ${m.targetSlug} | ${kind} | ${m.bookings}`
    );
  }

  lines.push("", `Archive event types to create: ${plan.archiveEventTypes.length}`);
  for (const e of plan.archiveEventTypes) lines.push(`  ${e.slug} | ${e.title} | ${e.length} min`);

  lines.push("", "Host mapping (calendly local-part -> target user | host on events):");
  for (const h of [...plan.hostMappings].sort((a, b) => b.events - a.events)) {
    lines.push(
      `  ${h.localPart} -> ${h.targetEmail}${h.create ? " (NEW locked user, no team)" : ""} | ${h.events}`
    );
  }
  return lines.join("\n");
}

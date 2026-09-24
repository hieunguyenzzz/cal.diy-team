import type { BookingRow, ExistingBooking } from "./types";

export type DeltaSummary = {
  insert: number;
  // Calendly rescheduled it after the last run and it is still accepted and untouched: rescheduled=true is set.
  reschedule: number;
  // Imported earlier as accepted, since cancelled in Calendly, untouched in Cal.diy: status and cancellation get updated.
  cancel: number;
  // Same as cancel, but the app has changed the booking since, so the re-run leaves it alone.
  blockedChangedInCalDiy: number;
  // Status differs the other way (cancelled in Cal.diy, still active in Calendly): left alone.
  divergedLeftAlone: number;
  unchanged: number;
  // Imported earlier but no longer returned by Calendly: left alone.
  missingFromCalendly: number;
};

// Mirrors the rules the rendered SQL applies, so a dry run can say what a re-run would change.
export function planDelta(bookings: BookingRow[], existing: ExistingBooking[]): DeltaSummary {
  const existingByUid = new Map(existing.map((booking) => [booking.uid, booking]));
  const summary: DeltaSummary = {
    insert: 0,
    reschedule: 0,
    cancel: 0,
    blockedChangedInCalDiy: 0,
    divergedLeftAlone: 0,
    unchanged: 0,
    missingFromCalendly: 0,
  };

  for (const booking of bookings) {
    const current = existingByUid.get(booking.uid);
    if (!current) {
      summary.insert++;
      continue;
    }
    const untouched = !current.changedInCalDiy;
    if (booking.rescheduled && current.status === "accepted" && !current.rescheduled && untouched) {
      summary.reschedule++;
    }
    if (current.status === booking.status) summary.unchanged++;
    else if (current.status === "accepted" && booking.status === "cancelled") {
      if (!untouched) summary.blockedChangedInCalDiy++;
      else summary.cancel++;
    } else summary.divergedLeftAlone++;
  }

  const planned = new Set(bookings.map((booking) => booking.uid));
  summary.missingFromCalendly = existing.filter((booking) => !planned.has(booking.uid)).length;
  return summary;
}

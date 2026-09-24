import { describe, expect, it } from "vitest";
import { planDelta } from "./delta";
import type { BookingRow } from "./types";

const row = (uid: string, status: BookingRow["status"], rescheduled: boolean | null = null) =>
  ({ uid, status, rescheduled }) as BookingRow;

describe("planDelta", () => {
  it("inserts new uids and cancels only untouched bookings that Calendly cancelled", () => {
    const summary = planDelta(
      [
        row("new", "accepted"),
        row("same", "accepted"),
        row("cancel-me", "cancelled", true),
        row("edited-in-caldiy", "cancelled"),
        row("cancelled-in-caldiy", "accepted"),
      ],
      [
        { uid: "same", status: "accepted", rescheduled: null, changedInCalDiy: false },
        { uid: "cancel-me", status: "accepted", rescheduled: null, changedInCalDiy: false },
        { uid: "edited-in-caldiy", status: "accepted", rescheduled: null, changedInCalDiy: true },
        { uid: "cancelled-in-caldiy", status: "cancelled", rescheduled: null, changedInCalDiy: true },
        { uid: "gone-from-calendly", status: "accepted", rescheduled: null, changedInCalDiy: false },
      ]
    );
    expect(summary).toEqual({
      insert: 1,
      reschedule: 1,
      cancel: 1,
      blockedChangedInCalDiy: 1,
      divergedLeftAlone: 1,
      unchanged: 1,
      missingFromCalendly: 1,
    });
  });
});

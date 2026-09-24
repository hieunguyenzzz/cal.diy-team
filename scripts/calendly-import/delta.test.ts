import { describe, expect, it } from "vitest";
import { planDelta } from "./delta";
import type { BookingRow } from "./types";

const row = (uid: string, status: BookingRow["status"]) => ({ uid, status }) as BookingRow;

describe("planDelta", () => {
  it("inserts new uids and cancels only untouched bookings that Calendly cancelled", () => {
    const summary = planDelta(
      [
        row("new", "accepted"),
        row("same", "accepted"),
        row("cancel-me", "cancelled"),
        row("edited-in-caldiy", "cancelled"),
        row("cancelled-in-caldiy", "accepted"),
      ],
      [
        { uid: "same", status: "accepted", changedInCalDiy: false },
        { uid: "cancel-me", status: "accepted", changedInCalDiy: false },
        { uid: "edited-in-caldiy", status: "accepted", changedInCalDiy: true },
        { uid: "cancelled-in-caldiy", status: "cancelled", changedInCalDiy: true },
        { uid: "gone-from-calendly", status: "accepted", changedInCalDiy: false },
      ]
    );
    expect(summary).toEqual({
      insert: 1,
      cancel: 1,
      blockedChangedInCalDiy: 1,
      divergedLeftAlone: 1,
      unchanged: 1,
      missingFromCalendly: 1,
    });
  });
});

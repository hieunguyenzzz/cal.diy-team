import { describe, expect, it } from "vitest";
import { renderImportSql, sqlLiteral } from "./render-sql";
import type { ImportPlan } from "./types";

const plan: ImportPlan = {
  teamSlug: "test-team",
  bookings: [
    {
      uid: "calendly-evt-1",
      hostEmail: "alice@example.test",
      eventTypeSlug: "showroom-visit",
      title: "O'Brien's Tour",
      startTime: "2024-03-01T10:00:00.000Z",
      endTime: "2024-03-01T11:00:00.000Z",
      createdAt: "2024-02-20T09:00:00.000Z",
      location: null,
      status: "accepted",
      cancellationReason: null,
      cancelledBy: null,
      rescheduled: null,
      fromReschedule: null,
      metadata: { calendlyEventUri: "https://api.calendly.com/scheduled_events/evt-1" },
      responses: { name: "Test Person", email: "person@customer.test" },
    },
  ],
  attendees: [],
  eventTypeMappings: [],
  archiveEventTypes: [{ slug: "calendly-archive-old", title: "Old", length: 30 }],
  hostMappings: [],
  usersToCreate: [{ email: "new.host@example.com", username: "new.host", name: "New" }],
  droppedCanceledInvitees: 0,
};

describe("renderImportSql", () => {
  const sql = renderImportSql(plan);

  it("escapes quotes and writes UTC timestamps without a zone suffix", () => {
    expect(sql).toContain("'O''Brien''s Tour'");
    expect(sql).toContain("'2024-03-01 10:00:00.000'");
    expect(sqlLiteral(null)).toBe("NULL");
  });

  it("only inserts, inside one transaction that stops on the first error", () => {
    expect(sql).toContain("\\set ON_ERROR_STOP on");
    expect(sql.indexOf("BEGIN;")).toBeLessThan(sql.indexOf('INSERT INTO "Booking"'));
    expect(sql.trim().endsWith("COMMIT;")).toBe(true);
    expect(sql).toContain("ON CONFLICT (uid) DO NOTHING");
    expect(sql).not.toMatch(/\b(UPDATE|DELETE)\b/);
  });

  it("creates missing hosts locked and archive event types hidden", () => {
    expect(sql).toContain("('new.host@example.com', 'new.host', 'New', TRUE, gen_random_uuid())");
    expect(sql).toMatch(
      /SELECT \(SELECT id FROM "Team" WHERE slug = 'test-team'\), slug, title, length, TRUE, 'collective'/
    );
  });
});

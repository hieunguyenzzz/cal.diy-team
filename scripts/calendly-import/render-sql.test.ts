import { describe, expect, it } from "vitest";
import { renderImportSql, sqlLiteral } from "./render-sql";
import type { ImportPlan } from "./types";

const plan: ImportPlan = {
  teamSlug: "test-team",
  bookings: [
    {
      uid: "calendly-evt-1",
      hostLocalPart: "alice",
      eventTypeSlug: "showroom-visit",
      title: "O'Brien's Tour",
      startTime: "2024-03-01T10:00:00.000Z",
      endTime: "2024-03-01T11:00:00.000Z",
      createdAt: "2024-02-20T09:00:00.000Z",
      location: null,
      status: "accepted",
      cancellationReason: null,
      cancelledBy: null,
      cancelledByHost: false,
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

  it("runs in one transaction that stops on the first error and never deletes", () => {
    expect(sql).toContain("\\set ON_ERROR_STOP on");
    expect(sql.indexOf("BEGIN;")).toBeLessThan(sql.indexOf('INSERT INTO "Booking"'));
    expect(sql.trim().endsWith("COMMIT;")).toBe(true);
    expect(sql).toContain("ON CONFLICT (uid) DO NOTHING");
    expect(sql).not.toMatch(/\bDELETE\b/);
  });

  it("only updates status and cancellation fields of untouched bookings Calendly has cancelled", () => {
    const updates = sql.match(/UPDATE "Booking"[\s\S]*?RETURNING/g) ?? [];
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatch(
      /SET status = 'cancelled', "cancellationReason" = [^,]+,\s+"cancelledBy" = CASE/
    );
    expect(updates[0]).toContain(`t.status = 'accepted' AND t."updatedAt" IS NULL`);
    expect(sql.match(/\bUPDATE\b/g)).toHaveLength(1);
  });

  it("matches hosts by email local-part, never by full address", () => {
    expect(sql).not.toMatch(/u\.email = /);
    expect(sql).toContain("JOIN ci_host h ON h.local_part = b.host_local_part");
    expect(sql).toContain("('calendly-evt-1', 'alice', 'showroom-visit'");
  });

  it("creates missing hosts locked and archive event types hidden", () => {
    expect(sql).toContain("('new.host', 'new.host@example.com', 'New')");
    expect(sql).toMatch(
      /INSERT INTO users[\s\S]*WHERE NOT EXISTS \(SELECT 1 FROM users u WHERE split_part\(lower\(u\.email\), '@', 1\) = c\.local_part\)/
    );
    expect(sql).toMatch(
      /SELECT \(SELECT id FROM "Team" WHERE slug = 'test-team'\), slug, title, length, TRUE, 'collective'/
    );
  });
});

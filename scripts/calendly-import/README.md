# Calendly booking import

Copies every Calendly scheduled event (active and cancelled) into Cal.diy as a `Booking` with its `Attendee`
rows. It writes straight to Postgres through `psql`: no web app, no booking handlers, no emails.

## Pipeline

1. `fetch` (`fetch-calendly.ts`) lists the organisation's event types and scheduled events, then every event's
   invitees, backing off on HTTP 429. The result is cached as JSON. The cache holds customer PII, so keep it
   outside the repo (the script writes it with mode 600). Re-running `fetch` reuses invitees already cached.
2. `import` reads a small catalogue from the target (team, host users by email local-part, team event-type slugs),
   builds the plan (`transform.ts`, pure and unit-tested), prints the report (`report.ts`) and renders one SQL
   file (`render-sql.ts`). `--dry-run` stops there. `--apply` pipes the same SQL through `--psql`.

The SQL runs in one transaction with `ON_ERROR_STOP`. It aborts if the team, a host user or a mapped event type is
missing, or if a host local-part matches more than one user.

## Re-runs are a delta sync

Re-run `fetch` then `import` at cut-over to pick up what changed in Calendly since the last run:

- New Calendly events are inserted, with their attendees.
- An imported booking that is still `accepted` but that Calendly now shows as cancelled gets `status`,
  `cancellationReason` and `cancelledBy` updated. Nothing else on it changes. Its attendees don't change.
- A booking the app has changed since import is never touched. Imported rows are written without `updatedAt`,
  and Prisma sets it on every app update, so `updatedAt IS NOT NULL` means "changed in Cal.diy".
- Everything else is left alone. That covers bookings cancelled in Cal.diy that are still active in Calendly,
  bookings that are no longer in Calendly, and bookings not created by this import.

`--dry-run` reads the target's imported bookings and prints the same classification. `--apply` prints the counts
the SQL actually applied as `result:` lines.

## Mapping rules

- `uid` is `calendly-<Calendly event uuid>`. Calendly URIs go in `metadata` as flat strings (`calendlyEventUri`,
  `calendlyEventTypeUri`, `calendlyInviteeUris`, `calendlyRescheduledTo/From`). The app parses booking metadata
  as a string record, so nested objects there would break it.
- Event types map by Calendly slug to the team's event types. Unmatched slugs get a hidden collective team event
  type `calendly-archive-<slug>` with no hosts. Event types the token can't read (403) use the event's name and
  duration.
- Hosts map by email local-part, and the SQL also joins users by local-part, never by full address. That way
  switching staff emails from `@example.com` to real addresses keeps every `userId` right, and a re-run doesn't
  recreate a user whose address has since changed. The first Calendly host becomes `Booking.userId`. The other collective hosts
  become `Attendee` rows, as the app's own `createBooking` stores them. A host with no target user is created as a
  locked, passwordless user `<local-part>@example.com` that belongs to no team.
- `responses` are `name` and `email`, plus `attendeePhoneNumber` and `guests` where present, plus each Calendly
  question slugified as a key. Attendees are the event's invitees (cancelled invitees of active group events are
  dropped), then any guests. `Attendee.noShow` follows Calendly's no-show mark.

## Running

Run from the repo root. Paths should be absolute, because yarn runs the script from `packages/prisma`.

```bash
S=/path/outside/repo   # e.g. the session scratchpad
CALENDLY_TOKEN=... CALENDLY_ORGANIZATION=https://api.calendly.com/organizations/<uuid> \
  yarn workspace @calcom/prisma calendly-import fetch --cache $S/calendly_import_cache.json

# Local dev database (docker)
PSQL="docker exec -i caldiy-sbs572-postgres psql -U calcom -d calendso"
yarn workspace @calcom/prisma calendly-import import --cache $S/calendly_import_cache.json \
  --psql "$PSQL" --sql-out $S/calendly_import.sql --dry-run   # then --apply

# calendly-test (Postgres is only reachable inside the server's docker network)
PSQL="ssh debian@139.99.9.132 'sudo docker exec -i compose-quantify-multi-byte-alarm-rbvmef-postgres-1 psql -U calcom -d calcom'"
```

The `result:` lines at the end of `--apply` give the inserted and skipped counts. The rendered SQL can also be
reviewed first and piped by hand: `sh -c "$PSQL" < $S/calendly_import.sql`.

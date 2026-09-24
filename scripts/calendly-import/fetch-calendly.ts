import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { uuidFromUri } from "./transform";
import type { CalendlyCache, CalendlyEvent, CalendlyEventType, CalendlyInvitee } from "./types";

const API = "https://api.calendly.com";
// Calendly rejects default library user agents with 403.
const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) cal-diy-calendly-import";
const MAX_ATTEMPTS = 8;
const CONCURRENCY = 4;
const SAVE_EVERY = 100;

type Log = (message: string) => void;
type Page<T> = { collection: T[]; pagination: { next_page: string | null } };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Returns null on 403/404 so callers can decide; the token never appears in errors or logs.
async function getJson<T>(url: string, token: string, log: Log): Promise<T | null> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, "User-Agent": USER_AGENT },
    });
    if (response.ok) return (await response.json()) as T;
    if (response.status === 403 || response.status === 404) return null;
    if (response.status === 429 || response.status >= 500) {
      const waitSeconds = Number(
        response.headers.get("retry-after") ?? response.headers.get("x-ratelimit-reset") ?? 0
      );
      const waitMs = Math.max(waitSeconds * 1000, 1000 * 2 ** attempt);
      log(
        `HTTP ${response.status} on ${new URL(url).pathname}; retry ${attempt}/${MAX_ATTEMPTS} in ${waitMs} ms`
      );
      await sleep(waitMs);
      continue;
    }
    throw new Error(
      `Calendly HTTP ${response.status} for ${new URL(url).pathname}: ${await response.text()}`
    );
  }
  throw new Error(`Calendly gave up after ${MAX_ATTEMPTS} attempts for ${new URL(url).pathname}`);
}

async function getAllPages<T>(url: string, token: string, log: Log): Promise<T[]> {
  const items: T[] = [];
  for (let next: string | null = url; next; ) {
    const page: Page<T> | null = await getJson<Page<T>>(next, token, log);
    if (!page) throw new Error(`Calendly denied ${new URL(next).pathname}`);
    items.push(...page.collection);
    next = page.pagination.next_page;
  }
  return items;
}

function saveCache(path: string, cache: CalendlyCache) {
  writeFileSync(path, JSON.stringify(cache), { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function loadCache(path: string): CalendlyCache {
  return JSON.parse(readFileSync(path, "utf8")) as CalendlyCache;
}

export async function fetchCalendly(options: {
  token: string;
  organization: string;
  cachePath: string;
  log: Log;
}) {
  const { token, organization, cachePath, log } = options;
  const previous = existsSync(cachePath) ? loadCache(cachePath) : null;

  const org = encodeURIComponent(organization);
  const eventTypes = await getAllPages<CalendlyEventType>(
    `${API}/event_types?organization=${org}&count=100`,
    token,
    log
  );
  const events: CalendlyEvent[] = [];
  for (const status of ["active", "canceled"]) {
    const query = `organization=${org}&status=${status}&count=100&sort=start_time:asc`;
    const range = "min_start_time=2015-01-01T00:00:00Z&max_start_time=2035-01-01T00:00:00Z";
    events.push(
      ...(await getAllPages<CalendlyEvent>(`${API}/scheduled_events?${query}&${range}`, token, log))
    );
  }
  log(`listed ${events.length} scheduled events and ${eventTypes.length} organisation event types`);

  const knownTypes = new Set(eventTypes.map((eventType) => eventType.uri));
  const unresolvedEventTypeUris: string[] = [];
  for (const uri of new Set(events.map((event) => event.event_type))) {
    if (knownTypes.has(uri)) continue;
    const single = await getJson<{ resource: CalendlyEventType }>(uri, token, log);
    if (single) eventTypes.push(single.resource);
    else unresolvedEventTypeUris.push(uri);
  }

  const cache: CalendlyCache = {
    organization,
    fetchedAt: new Date().toISOString(),
    eventTypes,
    unresolvedEventTypeUris,
    events,
    inviteesByEventUuid: previous?.inviteesByEventUuid ?? {},
  };

  const pending = events
    .map((event) => uuidFromUri(event.uri))
    .filter((uuid) => !cache.inviteesByEventUuid[uuid]);
  log(`fetching invitees for ${pending.length} events (${events.length - pending.length} already cached)`);
  let done = 0;
  const worker = async () => {
    for (let uuid = pending.shift(); uuid; uuid = pending.shift()) {
      const url = `${API}/scheduled_events/${uuid}/invitees?count=100`;
      cache.inviteesByEventUuid[uuid] = await getAllPages<CalendlyInvitee>(url, token, log);
      if (++done % SAVE_EVERY === 0) {
        saveCache(cachePath, cache);
        log(`fetched invitees for ${done} events`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  saveCache(cachePath, cache);
  log(
    `cache written: ${events.length} events, ${Object.keys(cache.inviteesByEventUuid).length} with invitees`
  );
}

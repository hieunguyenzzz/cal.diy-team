import slugify from "@calcom/lib/slugify";
import { z } from "zod";

const emailSchema = z
  .string()
  .trim()
  .email()
  .transform((email) => email.toLowerCase());

const slugSchema = z
  .string()
  .min(1)
  .refine((slug) => slugify(slug) === slug, { message: "must be a lowercase URL slug (e.g. site-survey)" });

const timeZoneSchema = z.string().refine(
  (timeZone) => {
    try {
      new Intl.DateTimeFormat("en-GB", { timeZone });
      return true;
    } catch {
      return false;
    }
  },
  { message: "must be a valid IANA time zone (e.g. Europe/London)" }
);

// Mirrors Cal's DefaultEventLocationTypeEnum values (packages/app-store/locations.ts).
// Required: an event without a location falls back to Cal Video, which is disabled, and Cal then skips all
// confirmation emails.
const locationSchema = z.discriminatedUnion(
  "type",
  [
    z.object({ type: z.literal("inPerson"), address: z.string().trim().min(1) }).strict(),
    z.object({ type: z.literal("attendeeInPerson") }).strict(),
    z
      .object({
        type: z.literal("link"),
        link: z
          .string()
          .trim()
          .url()
          .refine((link) => link.startsWith("https://"), { message: "must be an https:// URL" }),
      })
      .strict(),
  ],
  { required_error: "is required (inPerson, attendeeInPerson or link)" }
);

const eventTypeSchema = z
  .object({
    slug: slugSchema,
    title: z.string().trim().min(1),
    length: z.number().int().positive(),
    schedulingType: z.enum(["COLLECTIVE", "ROUND_ROBIN"]),
    hosts: z.array(emailSchema).min(1),
    location: locationSchema,
  })
  .strict();

const teamSeedConfigSchema = z
  .object({
    team: z.object({ name: z.string().trim().min(1), slug: slugSchema, timeZone: timeZoneSchema }).strict(),
    members: z.array(emailSchema).min(1),
    users: z.array(emailSchema).default([]),
    eventTypes: z.array(eventTypeSchema),
  })
  .strict()
  .superRefine((config, ctx) => {
    const members = new Set<string>();
    config.members.forEach((email, index) => {
      if (members.has(email)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["members", index],
          message: `duplicate member ${email}`,
        });
      }
      members.add(email);
    });

    const users = new Set<string>();
    config.users.forEach((email, index) => {
      if (users.has(email) || members.has(email)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["users", index],
          message: `${email} is listed twice (users must not repeat or overlap with members)`,
        });
      }
      users.add(email);
    });

    const slugs = new Set<string>();
    config.eventTypes.forEach((eventType, index) => {
      if (slugs.has(eventType.slug)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["eventTypes", index, "slug"],
          message: `duplicate event type slug ${eventType.slug}`,
        });
      }
      slugs.add(eventType.slug);

      const hosts = new Set<string>();
      eventType.hosts.forEach((email, hostIndex) => {
        if (!members.has(email)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["eventTypes", index, "hosts", hostIndex],
            message: `host ${email} is not in members`,
          });
        }
        if (hosts.has(email)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["eventTypes", index, "hosts", hostIndex],
            message: `duplicate host ${email}`,
          });
        }
        hosts.add(email);
      });
    });
  });

type HostState = { userId: number; isFixed: boolean };

// The subset of Cal's LocationObject (packages/app-store/locations.ts) that the seed writes.
type SeededLocation = { type: string; address?: string; link?: string; displayLocationPublicly?: boolean };

// "_"-prefixed keys are comments in the JSON config; strip them so the strict schema can reject typos.
function stripCommentKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripCommentKeys);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !key.startsWith("_"))
      .map(([key, entry]) => [key, stripCommentKeys(entry)])
  );
}

// Bad usage or config: the message alone is the useful output, no stack needed.
export class TeamSeedInputError extends Error {}

export function parseTeamSeedConfig(raw: unknown): TeamSeedConfig {
  const result = teamSeedConfigSchema.safeParse(stripCommentKeys(raw));
  if (result.success) return result.data;
  const issues = result.error.issues.map(
    (issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`
  );
  throw new TeamSeedInputError(`Invalid team seed config:\n${issues.join("\n")}`);
}

// Postgres ILIKE treats "%" and "_" as wildcards and backslash as its default escape character.
export function toCaseInsensitiveEmailPattern(email: string): string {
  return email.replace(/[\\%_]/g, "\\$&");
}

export function usernameBaseFromEmail(email: string): string {
  const base = slugify(email.split("@")[0]);
  if (!base) throw new Error(`Cannot derive a username from ${email}`);
  return base;
}

export function pickUniqueUsername(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix++;
  return `${base}-${suffix}`;
}

export function displayNameFromEmail(email: string): string {
  return email
    .split("@")[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

// Same shapes the event-type Locations UI saves. Showroom addresses are public (Calendly showed them too);
// a meeting link stays private: the public event hides it, and booking resolves it from the stored event type.
export function toEventTypeLocations(location: TeamSeedEventType["location"]): SeededLocation[] {
  switch (location.type) {
    case "inPerson":
      return [{ type: "inPerson", address: location.address, displayLocationPublicly: true }];
    case "attendeeInPerson":
      return [{ type: "attendeeInPerson" }];
    case "link":
      return [{ type: "link", link: location.link, displayLocationPublicly: false }];
    default: {
      const unhandled: never = location;
      throw new Error(`Unhandled location type: ${JSON.stringify(unhandled)}`);
    }
  }
}

// Only host, port and database name: the URL's userinfo holds credentials and must never be logged.
export function describeTargetDatabase(databaseUrl: string | undefined): string {
  if (!databaseUrl)
    throw new TeamSeedInputError("DATABASE_URL is not set; refusing to run without a target database");
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new TeamSeedInputError("DATABASE_URL is not a valid URL");
  }
  // An unencoded "/", "#" or "?" in the password ends the authority early, so the username becomes the
  // hostname, part of the password the port, and the real host lands in the path, fragment or query.
  if (!url.hostname || url.hash || /[@;#?]/.test(url.pathname) || url.search.includes("@")) {
    throw new TeamSeedInputError(
      "DATABASE_URL looks malformed (percent-encode special characters in the password)"
    );
  }
  return `${url.hostname}:${url.port || "5432"}${url.pathname}`;
}

export function planHostChanges<T extends HostState>(existing: HostState[], desired: T[]) {
  const existingByUserId = new Map(existing.map((host) => [host.userId, host]));
  const desiredUserIds = new Set(desired.map((host) => host.userId));
  return {
    create: desired.filter((host) => !existingByUserId.has(host.userId)),
    update: desired.filter((host) => {
      const current = existingByUserId.get(host.userId);
      return current !== undefined && current.isFixed !== host.isFixed;
    }),
    removeUserIds: existing.filter((host) => !desiredUserIds.has(host.userId)).map((host) => host.userId),
  };
}

export type TeamSeedConfig = z.infer<typeof teamSeedConfigSchema>;
export type TeamSeedEventType = TeamSeedConfig["eventTypes"][number];

/**
 * Idempotently sets up a standalone team, its members and team event types from a JSON config.
 * There is no team admin UI in this fork, so this is how teams are provisioned.
 *
 * Usage: yarn workspace @calcom/prisma seed-team <path/to/config.json> [--dry-run]
 *   - Relative config paths resolve from the repo root.
 *   - --dry-run runs every step inside the transaction, prints the summary, then rolls back.
 *   - Keep real configs out of git: name them scripts/*.local.json (gitignored) or store them outside the repo.
 * See scripts/seed-team.example.json for the config shape.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { isDeepStrictEqual } from "node:util";
import { DEFAULT_SCHEDULE, getAvailabilityFromSchedule } from "@calcom/lib/availability";
import prisma from "@calcom/prisma";
import type { Prisma } from "@calcom/prisma/client";
import { MembershipRole } from "@calcom/prisma/enums";
import {
  describeTargetDatabase,
  displayNameFromEmail,
  parseTeamSeedConfig,
  pickUniqueUsername,
  planHostChanges,
  type TeamSeedConfig,
  type TeamSeedEventType,
  TeamSeedInputError,
  toCaseInsensitiveEmailPattern,
  toEventTypeLocations,
  usernameBaseFromEmail,
} from "./seed-team-config";

type Tx = Prisma.TransactionClient;

const runId = randomUUID().slice(0, 8);
const log = (message: string) => console.log(`[seed-team ${runId}] ${message}`);
const warn = (message: string) => console.warn(`[seed-team ${runId}] WARN ${message}`);

const summary = {
  team: "unchanged" as "created" | "updated" | "unchanged",
  usersCreated: 0,
  schedulesCreated: 0,
  membershipsCreated: 0,
  membershipsAccepted: 0,
  eventTypesCreated: 0,
  eventTypesUpdated: 0,
  hostsAdded: 0,
  hostsUpdated: 0,
  hostsRemoved: 0,
};

async function upsertTeam(tx: Tx, team: TeamSeedConfig["team"]) {
  const existing = await tx.team.findFirst({
    where: { slug: team.slug, parentId: null },
    select: { id: true, name: true, timeZone: true, isOrganization: true },
  });
  if (!existing) {
    const created = await tx.team.create({
      data: { name: team.name, slug: team.slug, timeZone: team.timeZone },
      select: { id: true },
    });
    summary.team = "created";
    log(`Created team '${team.slug}' (id=${created.id})`);
    return created.id;
  }
  if (existing.isOrganization) {
    throw new Error(`Slug '${team.slug}' belongs to an organization (id=${existing.id}), not a team`);
  }
  if (existing.name !== team.name || existing.timeZone !== team.timeZone) {
    await tx.team.update({
      where: { id: existing.id },
      data: { name: team.name, timeZone: team.timeZone },
      select: { id: true },
    });
    summary.team = "updated";
    log(`Updated team '${team.slug}' (id=${existing.id})`);
  } else {
    log(`Using existing team '${team.slug}' (id=${existing.id})`);
  }
  return existing.id;
}

async function createDefaultSchedule(tx: Tx, userId: number, timeZone: string) {
  const schedule = await tx.schedule.create({
    data: {
      name: "Working Hours",
      timeZone,
      userId,
      availability: { createMany: { data: getAvailabilityFromSchedule(DEFAULT_SCHEDULE) } },
    },
    select: { id: true },
  });
  await tx.user.update({
    where: { id: userId },
    data: { defaultScheduleId: schedule.id },
    select: { id: true },
  });
  summary.schedulesCreated++;
  return schedule.id;
}

// Naming `locked` in the where clause opts out of the excludeLockedUsers Prisma extension.
const includeLockedUsers = { OR: [{ locked: false }, { locked: true }] };

async function findOrCreateUser(tx: Tx, email: string, timeZone: string) {
  // users.email is unique case-sensitively, so match case-insensitively to avoid duplicating e.g. "Jane.Doe@...".
  // Prisma's insensitive `equals` compiles to an unescaped ILIKE, so escape wildcards and re-check exactly in JS.
  const candidates = await tx.user.findMany({
    where: {
      email: { equals: toCaseInsensitiveEmailPattern(email), mode: "insensitive" },
      ...includeLockedUsers,
    },
    select: { id: true, email: true, locked: true, _count: { select: { schedules: true } } },
  });
  const matches = candidates.filter((user) => user.email.toLowerCase() === email);
  if (matches.length > 1) {
    throw new Error(`Several users match ${email} case-insensitively; resolve the duplicates first`);
  }
  const existing = matches[0];
  if (existing?.locked) {
    throw new Error(`User ${existing.email} (id=${existing.id}) exists but is locked`);
  }
  if (existing) {
    if (existing._count.schedules === 0) {
      const scheduleId = await createDefaultSchedule(tx, existing.id, timeZone);
      log(`Created default schedule ${scheduleId} for existing user ${email}`);
    }
    return existing.id;
  }

  const base = usernameBaseFromEmail(email);
  const similar = await tx.user.findMany({
    where: { username: { startsWith: base }, organizationId: null, ...includeLockedUsers },
    select: { username: true },
  });
  const taken = new Set(similar.flatMap((user) => (user.username ? [user.username] : [])));
  const username = pickUniqueUsername(base, taken);
  if (username !== base) warn(`Username '${base}' is taken, using '${username}' for ${email}`);

  // No password on purpose: staff set one through the password reset flow.
  const created = await tx.user.create({
    data: {
      email,
      username,
      name: displayNameFromEmail(email),
      timeZone,
      emailVerified: new Date(),
      completedOnboarding: true,
      locale: "en",
    },
    select: { id: true },
  });
  const scheduleId = await createDefaultSchedule(tx, created.id, timeZone);
  summary.usersCreated++;
  log(`Created user ${email} (id=${created.id}, username=${username}, schedule=${scheduleId})`);
  return created.id;
}

async function upsertMembership(tx: Tx, teamId: number, userId: number, email: string, role: MembershipRole) {
  const existing = await tx.membership.findUnique({
    where: { userId_teamId: { userId, teamId } },
    select: { id: true, accepted: true, role: true },
  });
  if (!existing) {
    const created = await tx.membership.create({
      data: { teamId, userId, role, accepted: true },
      select: { id: true },
    });
    summary.membershipsCreated++;
    return created.id;
  }
  if (existing.role !== role) {
    warn(`Membership for ${email} has role ${existing.role} but the config implies ${role}; left as is`);
  }
  if (!existing.accepted) {
    await tx.membership.update({
      where: { id: existing.id },
      data: { accepted: true },
      select: { id: true },
    });
    summary.membershipsAccepted++;
  }
  return existing.id;
}

async function upsertEventType(
  tx: Tx,
  teamId: number,
  eventType: TeamSeedEventType,
  membersByEmail: Map<string, { userId: number; membershipId: number }>
) {
  const fields = {
    title: eventType.title,
    length: eventType.length,
    schedulingType: eventType.schedulingType,
    assignAllTeamMembers: false,
    locations: toEventTypeLocations(eventType.location),
  };
  const existing = await tx.eventType.findUnique({
    where: { teamId_slug: { teamId, slug: eventType.slug } },
    select: {
      id: true,
      title: true,
      length: true,
      schedulingType: true,
      assignAllTeamMembers: true,
      locations: true,
      hosts: { select: { userId: true, isFixed: true } },
    },
  });

  let eventTypeId: number;
  if (!existing) {
    const created = await tx.eventType.create({
      data: { teamId, slug: eventType.slug, ...fields },
      select: { id: true },
    });
    eventTypeId = created.id;
    summary.eventTypesCreated++;
    log(`Created event type '${eventType.slug}' (id=${eventTypeId})`);
  } else {
    eventTypeId = existing.id;
    const changed =
      existing.title !== fields.title ||
      existing.length !== fields.length ||
      existing.schedulingType !== fields.schedulingType ||
      existing.assignAllTeamMembers !== fields.assignAllTeamMembers ||
      !isDeepStrictEqual(existing.locations, fields.locations);
    if (changed) {
      await tx.eventType.update({ where: { id: eventTypeId }, data: fields, select: { id: true } });
      summary.eventTypesUpdated++;
      log(`Updated event type '${eventType.slug}' (id=${eventTypeId})`);
    }
  }

  const isFixed = eventType.schedulingType === "COLLECTIVE";
  const desired = eventType.hosts.map((email) => {
    const member = membersByEmail.get(email);
    if (!member) throw new Error(`Host ${email} of '${eventType.slug}' has no membership`);
    return { userId: member.userId, memberId: member.membershipId, isFixed };
  });
  const plan = planHostChanges(existing?.hosts ?? [], desired);

  if (plan.create.length) {
    await tx.host.createMany({ data: plan.create.map((host) => ({ ...host, eventTypeId })) });
  }
  for (const host of plan.update) {
    await tx.host.update({
      where: { userId_eventTypeId: { userId: host.userId, eventTypeId } },
      data: { isFixed: host.isFixed },
      select: { userId: true },
    });
  }
  if (plan.removeUserIds.length) {
    await tx.host.deleteMany({ where: { eventTypeId, userId: { in: plan.removeUserIds } } });
  }
  summary.hostsAdded += plan.create.length;
  summary.hostsUpdated += plan.update.length;
  summary.hostsRemoved += plan.removeUserIds.length;
}

async function warnAboutUnmanagedRows(tx: Tx, teamId: number, config: TeamSeedConfig) {
  const memberEmails = new Set(config.members);
  const memberships = await tx.membership.findMany({
    where: { teamId },
    select: { user: { select: { email: true } } },
  });
  for (const { user } of memberships) {
    if (!memberEmails.has(user.email.toLowerCase()))
      warn(`Membership for ${user.email} is not in the config; left as is`);
  }

  const eventTypeSlugs = new Set(config.eventTypes.map((eventType) => eventType.slug));
  const eventTypes = await tx.eventType.findMany({ where: { teamId }, select: { slug: true } });
  for (const { slug } of eventTypes) {
    if (!eventTypeSlugs.has(slug)) warn(`Event type '${slug}' is not in the config; left as is`);
  }
}

// Thrown only by the dry-run path to force a rollback; instanceof keeps any other error from matching.
class DryRunRollback extends Error {}

async function seedTeam(config: TeamSeedConfig, dryRun: boolean) {
  await prisma.$transaction(
    async (tx) => {
      const teamId = await upsertTeam(tx, config.team);

      const membersByEmail = new Map<string, { userId: number; membershipId: number }>();
      for (const email of config.members) {
        const userId = await findOrCreateUser(tx, email, config.team.timeZone);
        const role = email === config.members[0] ? MembershipRole.OWNER : MembershipRole.MEMBER;
        const membershipId = await upsertMembership(tx, teamId, userId, email, role);
        membersByEmail.set(email, { userId, membershipId });
      }
      for (const email of config.users) {
        await findOrCreateUser(tx, email, config.team.timeZone);
      }

      for (const eventType of config.eventTypes) {
        await upsertEventType(tx, teamId, eventType, membersByEmail);
      }

      await warnAboutUnmanagedRows(tx, teamId, config);
      if (dryRun) {
        log(`Dry run summary: ${JSON.stringify(summary)}`);
        throw new DryRunRollback();
      }
    },
    { timeout: 60_000 }
  );
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const unknownFlags = args.filter((arg) => arg.startsWith("--") && arg !== "--dry-run");
  const positional = args.filter((arg) => !arg.startsWith("--"));
  if (unknownFlags.length || positional.length !== 1) {
    throw new TeamSeedInputError("Usage: seed-team <path/to/config.json> [--dry-run]");
  }
  const configArg = positional[0];
  // yarn workspace scripts run inside packages/prisma, so resolve relative paths from the repo root instead.
  const configPath = path.resolve(process.env.PROJECT_CWD ?? process.cwd(), configArg);
  const config = parseTeamSeedConfig(JSON.parse(readFileSync(configPath, "utf8")));

  log(`Target DB ${describeTargetDatabase(process.env.DATABASE_URL)}`);
  log(`Seeding team '${config.team.slug}' from ${configPath}${dryRun ? " (dry run)" : ""}`);
  try {
    await seedTeam(config, dryRun);
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
    log("Dry run: no changes committed");
    return;
  }
  log(`Done: ${JSON.stringify(summary)}`);
  if (process.env.NEXT_PUBLIC_WEBAPP_URL) {
    log(`Team page: ${process.env.NEXT_PUBLIC_WEBAPP_URL}/team/${config.team.slug}`);
  }
}

main()
  .catch((error: unknown) => {
    if (error instanceof TeamSeedInputError) {
      console.error(`[seed-team ${runId}] FAILED ${error.message}`);
    } else {
      // Full object so the stack and Prisma's code/meta are visible.
      console.error(`[seed-team ${runId}] FAILED`, error);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

/**
 * Imports Calendly booking history into Cal.diy straight through psql (no web app, no emails).
 * See scripts/calendly-import/README.md for the full runbook.
 *
 *   fetch  --cache <file>                                    (env CALENDLY_TOKEN, CALENDLY_ORGANIZATION)
 *   import --cache <file> --psql "<cmd>" --sql-out <file> --dry-run|--apply [--team-slug <slug>]
 *
 * --psql is a shell command that runs psql against the target and reads SQL on stdin.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, writeFileSync } from "node:fs";
import process from "node:process";
import { fetchCalendly, loadCache } from "./fetch-calendly";
import { catalogQuery, renderImportSql } from "./render-sql";
import { formatPlanReport } from "./report";
import { buildImportPlan } from "./transform";

const runId = randomUUID().slice(0, 8);
const log = (message: string) => console.log(`[calendly-import ${runId}] ${message}`);

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing --${name} (or its env var); see scripts/calendly-import/index.ts`);
  return value;
}

function runPsql(command: string, sql: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("sh", ["-c", command], { stdio: ["pipe", "pipe", "inherit"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(stdout) : reject(new Error(`psql command exited with ${code}`))
    );
    child.stdin.end(sql);
  });
}

async function runImport() {
  const cachePath = required("cache", option("cache"));
  const psql = required("psql", option("psql"));
  const sqlOut = required("sql-out", option("sql-out"));
  const teamSlug = option("team-slug") ?? "quell-design-team";
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun === process.argv.includes("--apply"))
    throw new Error("Pass exactly one of --dry-run or --apply");
  if (!existsSync(cachePath)) throw new Error(`No cache at ${cachePath}; run the fetch step first`);

  const cache = loadCache(cachePath);
  log(`cache from ${cache.fetchedAt}: ${cache.events.length} events`);
  const hostLocalParts = [
    ...new Set(
      cache.events.flatMap((e) => e.event_memberships.map((m) => m.user_email.toLowerCase().split("@")[0]))
    ),
  ];
  const catalogLine = (await runPsql(psql, catalogQuery(teamSlug, hostLocalParts)))
    .split("\n")
    .find((line) => line.startsWith("{"));
  if (!catalogLine) throw new Error("Target catalog query returned no JSON");
  const catalog = JSON.parse(catalogLine) as {
    teamCount: number;
    userEmails: string[];
    eventTypeSlugs: string[];
  };
  if (catalog.teamCount !== 1)
    throw new Error(`Expected one team "${teamSlug}" on target, found ${catalog.teamCount}`);
  log(`target: ${catalog.userEmails.length} host users, ${catalog.eventTypeSlugs.length} team event types`);

  const plan = buildImportPlan(cache, { teamSlug, ...catalog });
  console.log(formatPlanReport(plan));

  // Holds customer PII, so it lives outside the repo with owner-only access.
  const sql = renderImportSql(plan);
  writeFileSync(sqlOut, sql, { mode: 0o600 });
  chmodSync(sqlOut, 0o600);
  log(`SQL written to ${sqlOut}`);
  if (dryRun) return log("dry run: nothing written to the target");

  const output = await runPsql(psql, sql);
  for (const line of output.split("\n").filter((l) => l.startsWith("result:"))) log(line);
}

async function main() {
  const [command] = process.argv.slice(2);
  if (command === "fetch") {
    await fetchCalendly({
      token: required("CALENDLY_TOKEN", process.env.CALENDLY_TOKEN),
      organization: required("CALENDLY_ORGANIZATION", process.env.CALENDLY_ORGANIZATION),
      cachePath: required("cache", option("cache")),
      log,
    });
  } else if (command === "import") {
    await runImport();
  } else {
    throw new Error(`Unknown command "${command ?? ""}"; use fetch or import`);
  }
}

main().catch((error: unknown) => {
  console.error(
    `[calendly-import ${runId}] FAILED ${error instanceof Error ? error.message : String(error)}`
  );
  process.exit(1);
});

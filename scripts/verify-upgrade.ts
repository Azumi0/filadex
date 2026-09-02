/**
 * Proves the migration cutover is safe.
 *
 *   npx tsx scripts/verify-upgrade.ts
 *
 * Builds two databases and compares them:
 *
 *   upgraded  a pre-drizzle installation (docker-entrypoint.sh's CREATE TABLE
 *             block plus the legacy migration scripts), filled with demo data,
 *             snapshotted, then run through scripts/migrate.ts
 *   fresh     an empty database run through scripts/migrate.ts
 *
 * Three things have to hold, and each is checked rather than assumed:
 *
 *   1. The upgrade preserves every row, exactly. The data snapshot taken before
 *      the upgrade must match the one taken after.
 *   2. An upgraded database ends up with the same schema as a fresh one -
 *      otherwise the two diverge and a later migration works on one but not the
 *      other.
 *   3. Both match shared/schema.ts, according to drizzle-kit itself.
 *
 * Requires Docker.
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { buildLegacyDatabase, describeSchema } from "./legacy-db";
import * as schema from "../shared/schema";

const require = createRequire(import.meta.url);
const { pushSchema } = require("drizzle-kit/api");

const TABLES = [
  "users", "filament_types", "filaments", "filament_usage_log", "manufacturers",
  "materials", "colors", "diameters", "storage_locations", "user_sharing",
  "email_settings", "catalog_requests", "custom_field_definitions",
  "community_filament_cache", "api_tokens",
];

/** Every row of every table, ordered, as diffable text. */
async function snapshotData(pool: pg.Pool): Promise<string> {
  const out: string[] = [];
  for (const table of TABLES) {
    const { rows } = await pool.query(`SELECT * FROM "${table}" ORDER BY 1`);
    out.push(`-- ${table} (${rows.length} rows)`);
    for (const row of rows) {
      const ordered = Object.keys(row).sort().map((k) => `${k}=${JSON.stringify(row[k])}`);
      out.push("  " + ordered.join(" "));
    }
  }
  return out.join("\n");
}

function run(script: string, url: string, label: string) {
  const result = spawnSync("npx", ["tsx", script], {
    env: { ...process.env, DATABASE_URL: url },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    console.error(`${label} failed:\n${result.stdout}\n${result.stderr}`);
    process.exit(1);
  }
  return result.stdout;
}

function check(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok && detail) console.log(detail);
  return ok;
}

const containers: Array<StartedPostgreSqlContainer> = [];
let allPassed = true;

try {
  // --- the upgrade path -----------------------------------------------------
  console.log("Building a pre-drizzle installation...");
  const legacy = await buildLegacyDatabase();
  containers.push(legacy.container);

  console.log("Seeding it...");
  run("scripts/seed-demo-data.ts", legacy.url, "seed");

  const dataBefore = await snapshotData(legacy.pool);
  const schemaBefore = await describeSchema(legacy.pool);
  writeFileSync("/tmp/upgrade-data-before.txt", dataBefore);
  writeFileSync("/tmp/upgrade-schema-before.txt", schemaBefore);
  console.log(`Snapshot taken: ${dataBefore.split("\n").length} lines of data.\n`);

  console.log("Upgrading:");
  const output = run("scripts/migrate.ts", legacy.url, "migrate");
  console.log(output.split("\n").filter((l) => l && !l.startsWith("  legacy:")).map((l) => "  " + l).join("\n"));

  const dataAfter = await snapshotData(legacy.pool);
  const schemaAfter = await describeSchema(legacy.pool);
  writeFileSync("/tmp/upgrade-data-after.txt", dataAfter);

  // --- a fresh install ------------------------------------------------------
  console.log("\nBuilding a fresh install for comparison...");
  const freshContainer = await new PostgreSqlContainer("postgres:15-alpine").start();
  containers.push(freshContainer);
  const freshPool = new pg.Pool({ connectionString: freshContainer.getConnectionUri() });
  run("scripts/migrate.ts", freshContainer.getConnectionUri(), "migrate (fresh)");
  const freshSchema = await describeSchema(freshPool);

  // --- the checks -----------------------------------------------------------
  console.log("");
  allPassed = check("upgrade preserved every row unchanged", dataBefore === dataAfter,
    dataBefore === dataAfter ? undefined
      : "  data differs; see /tmp/upgrade-data-before.txt and /tmp/upgrade-data-after.txt") && allPassed;

  allPassed = check("upgraded schema matches a fresh install", schemaAfter === freshSchema,
    schemaAfter === freshSchema ? undefined : diff(schemaAfter, freshSchema)) && allPassed;

  const upgradedDrift = await pushSchema(schema, drizzle(legacy.pool, { schema }));
  allPassed = check("upgraded schema matches shared/schema.ts",
    upgradedDrift.statementsToExecute.length === 0,
    "  " + upgradedDrift.statementsToExecute.join("\n  ")) && allPassed;

  const freshDrift = await pushSchema(schema, drizzle(freshPool, { schema }));
  allPassed = check("fresh schema matches shared/schema.ts",
    freshDrift.statementsToExecute.length === 0,
    "  " + freshDrift.statementsToExecute.join("\n  ")) && allPassed;

  // Re-running must be a no-op, since the entrypoint runs it on every start.
  run("scripts/migrate.ts", legacy.url, "migrate (again)");
  const dataAfterSecondRun = await snapshotData(legacy.pool);
  allPassed = check("running the migration again changes nothing", dataAfter === dataAfterSecondRun) && allPassed;

  await freshPool.end();
  await legacy.pool.end();
} finally {
  for (const container of containers) await container.stop();
}

console.log(allPassed ? "\nAll checks passed." : "\nSome checks failed.");
process.exit(allPassed ? 0 : 1);

function diff(a: string, b: string): string {
  const left = a.split("\n"), right = b.split("\n");
  const out: string[] = [];
  for (const line of left) if (!right.includes(line)) out.push("  upgraded only: " + line);
  for (const line of right) if (!left.includes(line)) out.push("  fresh only:    " + line);
  return out.slice(0, 30).join("\n");
}

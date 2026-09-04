/**
 * Proves the migration cutover is safe.
 *
 *   npx tsx scripts/verify-upgrade.ts
 *
 * Builds databases and compares them:
 *
 *   upgraded  a pre-drizzle installation (docker-entrypoint.sh's CREATE TABLE
 *             block plus the legacy migration scripts), filled with demo data,
 *             snapshotted, then run through scripts/migrate.ts
 *   fresh     an empty database run through scripts/migrate.ts
 *
 * Five things have to hold, and each is checked rather than assumed:
 *
 *   1. The upgrade preserves every row, exactly. The data snapshot taken before
 *      the upgrade must match the one taken after - column for column, except
 *      for columns a migration deliberately drops (INTENTIONALLY_DROPPED).
 *   2. An upgraded database ends up with the same schema as a fresh one -
 *      otherwise the two diverge and a later migration works on one but not the
 *      other.
 *   3. Both match shared/schema.ts, according to drizzle-kit itself.
 *   4. The one legacy step that *rewrites* data rather than adding to it - the
 *      filament_types backfill and the column drop that follows it - carries
 *      every spool across with its product identity intact.
 *   5. Every INTENTIONALLY_DROPPED entry is still true. Each one narrows check 1
 *      by a column, so an entry that outlives its migration is a blind spot over
 *      data that is still there.
 *
 * Check 1 deliberately does not cover check 4, and the difference is easy to
 * misread. Its window opens on a database the legacy chain has already been
 * through, because that is what an existing installation *is*: the old
 * entrypoint ran the whole chain on every boot, so any deployment reaching this
 * upgrade has run it many times. Within that window the chain is a no-op and
 * "no row changed" is the right thing to demand. The backfill therefore has to
 * be checked separately, against a database caught before the chain ever ran -
 * which is what verifyBackfill does, and why it seeds through raw SQL: the flat
 * `filaments` shape it needs is one shared/schema.ts no longer describes.
 *
 * Requires Docker.
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { buildLegacyDatabase, describeSchema } from "./legacy-db";
import * as schema from "../shared/schema";

const require = createRequire(import.meta.url);
const { pushSchema } = require("drizzle-kit/api");

// Columns a migration under test drops on purpose. Naming one here is the only
// way a DROP COLUMN passes check 1: the snapshot reads the columns the
// pre-upgrade database actually holds, so a column that vanishes without being
// listed here reads as destroyed data. The check keeps its meaning - "every
// column that existed still holds its value, unless we said otherwise".
//
// Check 5 reads the list the other way round, so that an entry can only ever
// narrow check 1 for as long as it is true: a column named here that the
// upgraded database still has is a stale entry, and a stale entry is a column
// quietly excluded from the row comparison forever.
const INTENTIONALLY_DROPPED: Record<string, readonly string[]> = {
  filaments: ["created_at", "updated_at"],
};

type TableShape = { name: string; columns: string[] };

/**
 * The tables and columns a database has right now, as the row snapshot will
 * read them. Taken against the pre-upgrade database and then reused for the
 * after-snapshot, so the comparison is "every row the upgrade started with, one
 * column at a time": a column a migration adds is absent here and so is never
 * compared, and a column a migration drops must be in INTENTIONALLY_DROPPED or
 * check 1 fails.
 *
 * A migration that drops a whole table is not handled here - the after-snapshot
 * throws rather than failing cleanly - because nothing in play does that.
 */
async function discoverShape(pool: pg.Pool): Promise<TableShape[]> {
  const { rows } = await pool.query<{ table_name: string; column_name: string }>(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position`);
  const byTable = new Map<string, string[]>();
  for (const { table_name, column_name } of rows) {
    if ((INTENTIONALLY_DROPPED[table_name] ?? []).includes(column_name)) continue;
    let columns = byTable.get(table_name);
    if (!columns) byTable.set(table_name, (columns = []));
    columns.push(column_name);
  }
  return [...byTable]
    .map(([name, columns]) => ({ name, columns }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Every row of every table in `shape`, ordered, as diffable text.
 *
 * `shape` is the pre-upgrade shape; a column in it that the database no longer
 * has is one the upgrade dropped without an INTENTIONALLY_DROPPED entry. That is
 * written into the snapshot as a line rather than SELECTed - so check 1 fails
 * with the column named, instead of this throwing on a missing column.
 */
async function snapshotData(pool: pg.Pool, shape: TableShape[]): Promise<string> {
  const live = await discoverShape(pool);
  const present = new Map(live.map((table) => [table.name, new Set(table.columns)]));

  const out: string[] = [];
  for (const table of shape) {
    const has = present.get(table.name) ?? new Set<string>();
    const missing = table.columns.filter((column) => !has.has(column));
    if (missing.length > 0) {
      out.push(`-- ${table.name}: dropped without an INTENTIONALLY_DROPPED entry: ${missing.join(", ")}`);
    }
    const usable = table.columns.filter((column) => has.has(column));
    const selection = usable.length > 0 ? usable.map((column) => `"${column}"`).join(", ") : "1";
    const { rows } = await pool.query(`SELECT ${selection} FROM "${table.name}" ORDER BY 1`);
    out.push(`-- ${table.name} (${rows.length} rows)`);
    for (const row of rows) {
      const ordered = Object.keys(row).sort().map((k) => `${k}=${JSON.stringify(row[k])}`);
      out.push("  " + ordered.join(" "));
    }
  }
  return out.join("\n");
}

/**
 * The INTENTIONALLY_DROPPED entries that are no longer true, checked against the
 * upgraded database. An entry excludes its column from check 1's comparison, so
 * one that outlives the migration it was written for - reverted, rewritten, or
 * never landed - turns into a permanent blind spot over a column that still
 * exists and still holds data.
 */
async function staleDropEntries(pool: pg.Pool): Promise<string[]> {
  const { rows } = await pool.query<{ table_name: string; column_name: string }>(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'`);
  const live = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));
  return Object.entries(INTENTIONALLY_DROPPED)
    .flatMap(([table, columns]) => columns.map((column) => `${table}.${column}`))
    .filter((qualified) => live.has(qualified))
    .sort();
}

/**
 * Throws rather than exiting, so the containers started above still get stopped
 * on the way out - process.exit skips finally blocks and leaks both of them.
 */
function run(script: string, url: string, label: string) {
  const result = spawnSync("npx", ["tsx", script], {
    env: { ...process.env, DATABASE_URL: url },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed:\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

function check(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok && detail) console.log(detail);
  return ok;
}

/**
 * The filament_types backfill, checked on the shape it was written for.
 *
 * `add_filament_types` copies each distinct product identity out of `filaments`
 * into its own row and links the spool to it; `drop_filament_type_columns` then
 * removes the originals. After that the evidence is gone - so this is the one
 * check that has to build its own database, seed it before the chain runs, and
 * compare across the transformation. A spool losing its manufacturer, or being
 * linked to another spool's type, is invisible to every other check here.
 */
async function verifyBackfill(containers: StartedPostgreSqlContainer[]): Promise<boolean> {
  console.log("Checking the filament_types backfill against a pre-chain database...");
  const legacy = await buildLegacyDatabase({ runChain: false });
  containers.push(legacy.container);

  await legacy.pool.query(`
    INSERT INTO users (id, username, password) VALUES
      (1, 'alice', 'x'), (2, 'bob', 'x');
    SELECT setval('users_id_seq', 2);

    INSERT INTO filaments
      (id, name, manufacturer, material, color_name, color_code, diameter, print_temp,
       total_weight, remaining_percentage, user_id) VALUES
      -- two spools of the same product: they must end up on one type
      (1, 'Jade White #1', 'Bambu Lab', 'PLA', 'Jade White', '#FFFFFF', 1.75, '220', 1000, 80, 1),
      (2, 'Jade White #2', 'Bambu Lab', 'PLA', 'Jade White', '#FFFFFF', 1.75, '220', 1000, 40, 1),
      -- same product, different owner: must not be merged with the two above
      (3, 'Jade White (bob)', 'Bambu Lab', 'PLA', 'Jade White', '#FFFFFF', 1.75, '220', 1000, 90, 2),
      -- nullable columns exercise the IS NOT DISTINCT FROM matching
      (4, 'Unbranded PETG', NULL, 'PETG', 'Orange', NULL, NULL, NULL, 750, 55, 1),
      -- differs from #4 only by material, so it is a separate type
      (5, 'Unbranded ABS', NULL, 'ABS', 'Orange', NULL, NULL, NULL, 750, 55, 1);
    SELECT setval('filaments_id_seq', 5);
  `);

  const { rows: before } = await legacy.pool.query(`
    SELECT id, name, manufacturer, material, color_name, color_code,
           diameter::text AS diameter, print_temp, user_id,
           total_weight::text AS total_weight, remaining_percentage::text AS remaining_percentage
    FROM filaments ORDER BY id`);

  await legacy.runChain();

  const { rows: after } = await legacy.pool.query(`
    SELECT f.id, f.name, f.user_id,
           f.total_weight::text AS total_weight,
           f.remaining_percentage::text AS remaining_percentage,
           f.filament_type_id,
           t.manufacturer, t.material, t.color_name, t.color_code,
           t.diameter::text AS diameter, t.print_temp
    FROM filaments f LEFT JOIN filament_types t ON t.id = f.filament_type_id
    ORDER BY f.id`);

  const problems: string[] = [];

  if (after.length !== before.length) {
    problems.push(`  ${before.length} spools went in, ${after.length} came out`);
  }

  for (const original of before) {
    const migrated = after.find((row) => row.id === original.id);
    if (!migrated) {
      problems.push(`  spool ${original.id} (${original.name}) did not survive the backfill`);
      continue;
    }
    if (migrated.filament_type_id === null) {
      problems.push(`  spool ${original.id} (${original.name}) has no filament_type_id`);
      continue;
    }
    for (const field of ["name", "user_id", "total_weight", "remaining_percentage",
                         "manufacturer", "material", "color_name", "color_code",
                         "diameter", "print_temp"]) {
      if (String(migrated[field]) !== String(original[field])) {
        problems.push(
          `  spool ${original.id} ${field}: ${JSON.stringify(original[field])} became ${JSON.stringify(migrated[field])}`);
      }
    }
  }

  // Spools 1 and 2 are the same product; 3 differs only by owner.
  const typeOf = (id: number) => after.find((row) => row.id === id)?.filament_type_id;
  if (typeOf(1) !== typeOf(2)) problems.push("  identical spools 1 and 2 were given different types");
  if (typeOf(1) === typeOf(3)) problems.push("  spools 1 and 3 have different owners but share a type");
  if (typeOf(4) === typeOf(5)) problems.push("  spools 4 and 5 have different materials but share a type");

  // The columns the second step removes have to be gone, or the drop silently
  // skipped and the database is not at the shape 0000 describes.
  const { rows: leftover } = await legacy.pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'filaments'
      AND column_name IN ('manufacturer','material','color_name','color_code','diameter','print_temp')`);
  if (leftover.length > 0) {
    problems.push(`  redundant columns still on filaments: ${leftover.map((r) => r.column_name).join(", ")}`);
  }

  await legacy.pool.end();
  return check("the filament_types backfill preserved every spool's identity",
    problems.length === 0, problems.join("\n"));
}

const dataBeforePath = join(tmpdir(), "upgrade-data-before.txt");
const dataAfterPath = join(tmpdir(), "upgrade-data-after.txt");

const containers: Array<StartedPostgreSqlContainer> = [];
let allPassed = true;

try {
  // --- the upgrade path -----------------------------------------------------
  console.log("Building a pre-drizzle installation...");
  const legacy = await buildLegacyDatabase();
  containers.push(legacy.container);

  console.log("Seeding it...");
  run("scripts/seed-demo-data.ts", legacy.url, "seed");

  // Discovered from the database as it is now, before scripts/migrate.ts runs,
  // and reused for every snapshot below.
  const shape = await discoverShape(legacy.pool);
  const dataBefore = await snapshotData(legacy.pool, shape);
  writeFileSync(dataBeforePath, dataBefore);
  // Not compared against anything - a later migration is allowed to change the
  // schema. It is written out because when one of the schema checks below
  // fails, the shape the upgrade started from is the first thing to diff.
  writeFileSync(join(tmpdir(), "upgrade-schema-before.txt"), await describeSchema(legacy.pool));
  console.log(`Snapshot taken: ${dataBefore.split("\n").length} lines of data.\n`);

  console.log("Upgrading:");
  const output = run("scripts/migrate.ts", legacy.url, "migrate");
  console.log(output.split("\n").filter((l) => l && !l.startsWith("  legacy:")).map((l) => "  " + l).join("\n"));

  const dataAfter = await snapshotData(legacy.pool, shape);
  const schemaAfter = await describeSchema(legacy.pool);
  writeFileSync(dataAfterPath, dataAfter);

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
      : `  data differs; see ${dataBeforePath} and ${dataAfterPath}`) && allPassed;

  const stale = await staleDropEntries(legacy.pool);
  allPassed = check("every column the upgrade was allowed to drop is gone", stale.length === 0,
    `  still present, so the INTENTIONALLY_DROPPED entry excludes live data: ${stale.join(", ")}`) && allPassed;

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

  // Re-running must be a no-op, since the entrypoint runs it on every start -
  // in the schema as well as in the data.
  run("scripts/migrate.ts", legacy.url, "migrate (again)");
  const dataAfterSecondRun = await snapshotData(legacy.pool, shape);
  const schemaAfterSecondRun = await describeSchema(legacy.pool);
  allPassed = check("running the migration again changes no row", dataAfter === dataAfterSecondRun) && allPassed;
  allPassed = check("running the migration again changes no schema", schemaAfter === schemaAfterSecondRun,
    schemaAfter === schemaAfterSecondRun ? undefined : diff(schemaAfter, schemaAfterSecondRun)) && allPassed;

  await freshPool.end();
  await legacy.pool.end();

  // --- the data transformation the checks above cannot see --------------------
  console.log("");
  allPassed = (await verifyBackfill(containers)) && allPassed;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  allPassed = false;
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

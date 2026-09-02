/**
 * Brings the database up to date.
 *
 *   DATABASE_URL=postgres://... npx tsx scripts/migrate.ts
 *
 * There are three cases, and the difference matters:
 *
 *   Already on drizzle   The journal table exists. Run the migrator; it applies
 *                        whatever is newer than the last recorded migration.
 *
 *   Fresh database       Nothing exists. Run the migrator from 0000, which
 *                        creates the whole schema.
 *
 *   Existing install     Tables exist but there is no journal - a deployment
 *                        built by docker-entrypoint.sh's CREATE TABLE block and
 *                        the migrations/legacy scripts. Running 0000 here would
 *                        fail on the first CREATE TABLE, so instead the legacy
 *                        chain is run once to bring the database to a known
 *                        state, and 0000 is then recorded as applied without
 *                        being run. From the next release onward such a
 *                        deployment is on the first path above.
 *
 * The legacy catch-up matters because an installation may be several versions
 * behind and have run only some of those scripts. They are all guarded on
 * information_schema, so re-running them on an up-to-date database does
 * nothing. Baselining without it would declare a schema present that is not.
 *
 * See migrations/legacy/README.md for why that chain stays in the repository
 * and what keeps it working.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../server/db";
import { runLegacyMigrations } from "../migrations/legacy";

const MIGRATIONS_FOLDER = "migrations/pg";

type JournalEntry = { idx: number; when: number; tag: string };

function firstMigration(): { tag: string; when: number } {
  const journal = JSON.parse(
    readFileSync(`${MIGRATIONS_FOLDER}/meta/_journal.json`, "utf8"),
  ) as { entries: JournalEntry[] };
  const first = journal.entries.find((entry) => entry.idx === 0);
  if (!first) throw new Error(`No 0000 migration in ${MIGRATIONS_FOLDER}/meta/_journal.json`);
  return { tag: first.tag, when: first.when };
}

/** The hash drizzle stores for a migration is the sha256 of its SQL file. */
function migrationHash(tag: string): string {
  const sqlText = readFileSync(`${MIGRATIONS_FOLDER}/${tag}.sql`, "utf8");
  return createHash("sha256").update(sqlText).digest("hex");
}

async function hasDrizzleJournal(): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
    ) AS present`);
  return Boolean(result.rows[0].present);
}

async function hasApplicationTables(): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'users'
    ) AS present`);
  return Boolean(result.rows[0].present);
}

/** Records 0000 as applied without running it, for a schema that already exists. */
async function baseline() {
  const { tag, when } = firstMigration();
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS drizzle`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )`);
  await db.execute(sql`
    INSERT INTO drizzle.__drizzle_migrations ("hash", "created_at")
    VALUES (${migrationHash(tag)}, ${when})`);
  console.log(`  baselined at ${tag}`);
}

async function main() {
  if (await hasDrizzleJournal()) {
    console.log("Database is on generated migrations; applying any new ones.");
  } else if (await hasApplicationTables()) {
    console.log("Existing installation found. Catching up on the legacy migrations first:");
    await runLegacyMigrations(db);
    console.log("Recording the current schema as the migration baseline:");
    await baseline();
  } else {
    console.log("Fresh database; creating the schema from the generated migrations.");
  }

  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  console.log("Database is up to date.");
}

main()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error(error);
    await pool.end();
    process.exit(1);
  });

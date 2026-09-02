/**
 * The test database connection, plus the schema and reset handling around it.
 *
 * The connection URL comes from tests/global-setup.ts, which either honours
 * DATABASE_URL or starts a throwaway Postgres container. Either way this is a
 * real server reached through the same node-postgres driver the application
 * uses, so nothing here changes the SQL semantics under test.
 *
 * The schema is derived from shared/schema.ts at startup via drizzle-kit's API
 * rather than from a checked-in .sql file or the imperative migrations/ scripts,
 * so it cannot drift from the schema the application actually uses.
 */
import { createRequire } from "node:module";
import { inject } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableName, is, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import * as schema from "../../shared/schema";

const require = createRequire(import.meta.url);
// drizzle-kit's ESM bundle (api.mjs) is broken in 0.30.4 - it `require()`s node
// builtins, which throws under ESM. The CJS build works.
const { generateDrizzleJson, generateMigration } = require("drizzle-kit/api");

const pool = new pg.Pool({ connectionString: inject("databaseUrl") });

/** The drizzle instance the application code is pointed at (see tests/setup.ts). */
export const db = drizzle(pool, { schema });

export const closeDb = () => pool.end();

const tables = Object.values(schema).filter((value) => is(value, PgTable));

/**
 * Rebuilds the schema from scratch. Test files run one at a time
 * (fileParallelism: false) so that each gets a clean database even when they
 * all share one server.
 */
export async function createSchema() {
  const statements: string[] = await generateMigration(
    generateDrizzleJson({}),
    generateDrizzleJson(schema),
  );

  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`create schema public`);
  for (const statement of statements) {
    await db.execute(sql.raw(statement));
  }
}

const truncateAll = sql.raw(
  `truncate table ${tables.map((t) => `"${getTableName(t)}"`).join(", ")} restart identity cascade`,
);

/** Empties every table and resets sequences, so each test starts from nothing. */
export async function resetDb() {
  await db.execute(truncateAll);
}

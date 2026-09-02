/**
 * Builds a database the way a deployment built one before this branch:
 * the base schema docker-entrypoint.sh used to create, then the frozen chain in
 * migrations/legacy.
 *
 * This is what an existing installation upgrades *from*, so it is what any
 * change to the migration system has to be tested against.
 *
 * Requires Docker.
 */
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { entrypointSchemaSql } from "./legacy-migrations";
import { runLegacyMigrations } from "../migrations/legacy";


export async function buildLegacyDatabase() {
  const container = await new PostgreSqlContainer("postgres:15-alpine").start();
  const url = container.getConnectionUri();
  const pool = new pg.Pool({ connectionString: url });

  await pool.query(entrypointSchemaSql());

  await runLegacyMigrations(drizzle(pool));

  return { container, pool, url };
}

/** A stable, diffable description of everything that matters about the schema. */
export async function describeSchema(pool: pg.Pool): Promise<string> {
  const columns = await pool.query(`
    SELECT table_name, column_name, data_type, is_nullable, column_default
    FROM information_schema.columns WHERE table_schema='public'
    ORDER BY table_name, column_name`);

  const constraints = await pool.query(`
    SELECT tc.table_name, tc.constraint_type, tc.constraint_name,
           string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position) AS cols
    FROM information_schema.table_constraints tc
    LEFT JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema='public'
      -- Postgres's internal NOT NULL checks are named after table OIDs, so they
      -- differ between any two databases and say nothing about the schema.
      AND tc.constraint_name !~ '^[0-9]+_[0-9]+_[0-9]+_not_null$'
    GROUP BY tc.table_name, tc.constraint_type, tc.constraint_name
    ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name`);

  const indexes = await pool.query(`
    SELECT tablename, indexname, indexdef FROM pg_indexes
    WHERE schemaname='public' ORDER BY tablename, indexname`);

  const lines: string[] = ["== COLUMNS =="];
  for (const c of columns.rows) {
    lines.push(`${c.table_name}.${c.column_name} ${c.data_type} null=${c.is_nullable} default=${c.column_default ?? "-"}`);
  }
  lines.push("", "== CONSTRAINTS ==");
  for (const c of constraints.rows) {
    lines.push(`${c.table_name} ${c.constraint_type} ${c.constraint_name} (${c.cols ?? "-"})`);
  }
  lines.push("", "== INDEXES ==");
  for (const i of indexes.rows) {
    lines.push(`${i.tablename} ${i.indexname}: ${i.indexdef}`);
  }
  return lines.join("\n");
}

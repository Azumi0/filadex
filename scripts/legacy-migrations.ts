/**
 * The starting point for rebuilding a pre-Drizzle database, for tests.
 *
 * The migration chain itself lives in migrations/legacy; only the base schema
 * it ran against is here, because docker-entrypoint.sh no longer contains it.
 */
import { readFileSync } from "node:fs";

/**
 * The schema docker-entrypoint.sh used to create, kept as a fixture because the
 * script no longer contains it. Only needed to rebuild a pre-drizzle database
 * for testing; real deployments already have these tables.
 */
export function entrypointSchemaSql(): string {
  return readFileSync("scripts/fixtures/legacy-schema.sql", "utf8");
}

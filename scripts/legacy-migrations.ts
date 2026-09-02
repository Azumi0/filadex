/**
 * The pre-drizzle upgrade path, described in one place.
 *
 * Used by scripts/migrate.ts to catch an existing installation up before
 * baselining it, and by scripts/legacy-db.ts to rebuild that installation for
 * testing. Neither should carry its own copy.
 */
import { readFileSync } from "node:fs";

/** The migrations docker-entrypoint.sh used to run, in the order it ran them. */
export const LEGACY_MIGRATIONS = [
  "run-migration.ts",
  "migrations/add_email_rbac_and_settings.ts",
  "migrations/add_filament_usage_log.ts",
  "migrations/add_material_density.ts",
  "migrations/add_notification_preferences.ts",
  "migrations/add_custom_fields.ts",
  "migrations/add_community_filament_cache.ts",
  "migrations/add_api_tokens.ts",
  "migrations/add_filament_types.ts",
  "migrations/drop_filament_type_columns.ts",
  "migrations/add_user_theme_preferences.ts",
];

/**
 * The schema docker-entrypoint.sh used to create, kept as a fixture because the
 * script no longer contains it. Only needed to rebuild a pre-drizzle database
 * for testing; real deployments already have these tables.
 */
export function entrypointSchemaSql(): string {
  return readFileSync("scripts/fixtures/legacy-schema.sql", "utf8");
}

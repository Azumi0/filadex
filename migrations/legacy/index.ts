import type { LegacyDatabase } from "./types";
import { runMigration as addUserIdColumn } from "./add_user_id_column";
import { runMigration as addEmailRbacAndSettings } from "./add_email_rbac_and_settings";
import { runMigration as addFilamentUsageLog } from "./add_filament_usage_log";
import { runMigration as addMaterialDensity } from "./add_material_density";
import { runMigration as addNotificationPreferences } from "./add_notification_preferences";
import { runMigration as addCustomFields } from "./add_custom_fields";
import { runMigration as addCommunityFilamentCache } from "./add_community_filament_cache";
import { runMigration as addApiTokens } from "./add_api_tokens";
import { runMigration as addFilamentTypes } from "./add_filament_types";
import { runMigration as dropFilamentTypeColumns } from "./drop_filament_type_columns";
import { runMigration as addUserThemePreferences } from "./add_user_theme_preferences";

export type { LegacyDatabase };

/**
 * The pre-Drizzle upgrade path, in the order docker-entrypoint.sh used to run
 * it. See README.md in this directory: this list is closed. Nothing is ever
 * added to it, because every schema change from now on is a generated
 * migration in ../pg.
 */
export const LEGACY_MIGRATIONS: Array<{
  name: string;
  run: (db: LegacyDatabase) => Promise<void>;
}> = [
  { name: "add user_id column to filaments", run: addUserIdColumn },
  { name: "add email, roles and catalog requests", run: addEmailRbacAndSettings },
  { name: "add filament usage log", run: addFilamentUsageLog },
  { name: "add material density", run: addMaterialDensity },
  { name: "add notification preferences", run: addNotificationPreferences },
  { name: "add custom field definitions", run: addCustomFields },
  { name: "add community filament cache", run: addCommunityFilamentCache },
  { name: "add API tokens", run: addApiTokens },
  { name: "add filament types", run: addFilamentTypes },
  { name: "drop redundant filament type columns", run: dropFilamentTypeColumns },
  { name: "add per-user theme preferences", run: addUserThemePreferences },
];

/** Brings a pre-Drizzle database to the state the baseline migration assumes. */
export async function runLegacyMigrations(db: LegacyDatabase): Promise<void> {
  for (const migration of LEGACY_MIGRATIONS) {
    console.log(`  ${migration.name}`);
    await migration.run(db);
  }
}

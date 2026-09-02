import { sql } from "drizzle-orm";
import type { LegacyDatabase } from "./types";
import { addColumnIfMissing } from "./helpers";

/**
 * Migration: adds per-user low-stock/drying-reminder email alert preferences,
 * a per-filament low-stock notification cooldown marker, and an
 * admin-editable "is this material hygroscopic" flag (seeded for the common
 * moisture-sensitive families) that the drying-reminder check reads instead
 * of a hardcoded material list.
 */
export async function runMigration(db: LegacyDatabase) {
  console.log("Starting migration: notification preferences...");

  await addColumnIfMissing(db, "users", "low_stock_threshold_percent", sql`ALTER TABLE users ADD COLUMN low_stock_threshold_percent INTEGER DEFAULT 15;`);
  await addColumnIfMissing(db, "users", "notify_low_stock", sql`ALTER TABLE users ADD COLUMN notify_low_stock BOOLEAN DEFAULT true;`);
  await addColumnIfMissing(db, "users", "notify_drying_reminder", sql`ALTER TABLE users ADD COLUMN notify_drying_reminder BOOLEAN DEFAULT true;`);
  await addColumnIfMissing(db, "users", "drying_reminder_days", sql`ALTER TABLE users ADD COLUMN drying_reminder_days INTEGER DEFAULT 30;`);
  console.log("✓ Added notification preference columns to users");

  await addColumnIfMissing(db, "filaments", "low_stock_notified_at", sql`ALTER TABLE filaments ADD COLUMN low_stock_notified_at TIMESTAMP;`);
  await addColumnIfMissing(db, "filaments", "drying_reminder_notified_at", sql`ALTER TABLE filaments ADD COLUMN drying_reminder_notified_at TIMESTAMP;`);
  console.log("✓ Added low_stock_notified_at and drying_reminder_notified_at columns to filaments");

  await addColumnIfMissing(db, "materials", "is_hygroscopic", sql`ALTER TABLE materials ADD COLUMN is_hygroscopic BOOLEAN DEFAULT false;`);
  console.log("✓ Added is_hygroscopic column to materials");

  // Deliberately no bare 'PA%'/'%PA%' pattern here - it would also match
  // e.g. "Panchroma" (a PLA line), which starts with "Pa".
  const hygroscopicPatterns = [
    "%PETG%", "%PVA%", "%ASA%", "%Nylon%",
    "%PA-%", "%PA6%", "%PA11%", "%PA12%", "%PAHT%", "%PA/%",
  ];
  for (const pattern of hygroscopicPatterns) {
    await db.execute(sql`
      UPDATE materials SET is_hygroscopic = true WHERE name ILIKE ${pattern};
    `);
  }
  console.log("✓ Flagged known hygroscopic material families");

  console.log("Migration completed successfully!");
}

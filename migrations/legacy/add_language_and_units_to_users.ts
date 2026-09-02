import { sql } from "drizzle-orm";
import type { LegacyDatabase } from "./types";
import { addColumnIfMissing } from "./helpers";

/**
 * Migration: adds the per-user locale and unit preferences - interface
 * language, price currency and temperature unit - to `users`.
 *
 * These were three hand-written ALTER TABLE checks in docker-entrypoint.sh
 * rather than a script of their own, and they ran ahead of every migration
 * script, which is why this comes first in the chain. A database created
 * after the columns entered the entrypoint's CREATE TABLE block already has
 * them; an older one does not, and migrations/pg/0000 assumes it does.
 */
export async function runMigration(db: LegacyDatabase) {
  console.log("Starting migration: language and unit preferences...");

  await addColumnIfMissing(db, "users", "language", sql`ALTER TABLE users ADD COLUMN language TEXT DEFAULT 'en';`);
  await addColumnIfMissing(db, "users", "currency", sql`ALTER TABLE users ADD COLUMN currency TEXT DEFAULT 'EUR';`);
  await addColumnIfMissing(db, "users", "temperature_unit", sql`ALTER TABLE users ADD COLUMN temperature_unit TEXT DEFAULT 'C';`);
  console.log("✓ Added language, currency and temperature_unit columns to users");

  console.log("Migration completed successfully!");
}

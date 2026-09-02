import { sql } from "drizzle-orm";
import type { LegacyDatabase } from "./types";

/**
 * Migration: Add currency and temperatureUnit columns to users table
 * Run with: npx tsx migrations/add_units_to_users.ts
 */
async function migrate() {
  try {
    console.log("Starting migration: Add units columns to users table...");

    // Add currency column if it doesn't exist
    await db.execute(sql`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'EUR';
    `);
    console.log("✓ Added currency column");

    // Add temperature_unit column if it doesn't exist
    await db.execute(sql`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS temperature_unit TEXT DEFAULT 'C';
    `);
    console.log("✓ Added temperature_unit column");

    console.log("Migration completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}

migrate();


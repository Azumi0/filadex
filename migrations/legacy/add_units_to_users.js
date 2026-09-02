const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/**
 * Migration: Add currency and temperatureUnit columns to users table
 * Run with: node migrations/add_units_to_users.js
 */
async function migrate() {
  const client = await pool.connect();
  try {
    console.log("Starting migration: Add units columns to users table...");

    // Add currency column if it doesn't exist
    await client.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'EUR';
    `);
    console.log("✓ Added currency column");

    // Add temperature_unit column if it doesn't exist
    await client.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS temperature_unit TEXT DEFAULT 'C';
    `);
    console.log("✓ Added temperature_unit column");

    console.log("Migration completed successfully!");
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));


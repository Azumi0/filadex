import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "@shared/schema";

import fs from "node:fs";
import path from "node:path";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

if (process.env.DATABASE_URL.startsWith("file:") || process.env.DATABASE_URL.startsWith("sqlite:")) {
  const filePath = process.env.DATABASE_URL.replace(/^(file|sqlite):\/\//, "/").replace(/^(file|sqlite):/, "");
  const dir = path.dirname(filePath);
  if (dir && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export const client = createClient({ url: process.env.DATABASE_URL });

/**
 * SQLite connections set three pragmas on connection:
 * - WAL allows readers to proceed during a write.
 * - busy_timeout = 5000 avoids immediate SQLITE_BUSY under concurrent Node requests.
 * - foreign_keys = ON is mandatory; without it SQLite ignores foreign keys and
 *   ON DELETE CASCADE behaviour declared in the schema will silently not happen.
 *
 * See docs/adr/0004.
 */
await client.executeMultiple(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  PRAGMA foreign_keys = ON;
`);

export const dialect = "sqlite" as const;
export const db = drizzle(client, { schema });
export async function closeDb(): Promise<void> {
  client.close();
}
export async function vacuumBackup(destinationPath: string): Promise<void> {
  const escaped = destinationPath.replace(/'/g, "''");
  await client.execute(`VACUUM INTO '${escaped}'`);
}


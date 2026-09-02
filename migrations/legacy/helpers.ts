import { sql } from "drizzle-orm";
import type { LegacyDatabase } from "./types";

export async function columnExists(db: LegacyDatabase, tableName: string, columnName: string) {
  const { rows } = await db.execute(sql`
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ${tableName}
      AND column_name = ${columnName}
    LIMIT 1;
  `);

  return rows.length > 0;
}

export async function addColumnIfMissing(
  db: LegacyDatabase,
  tableName: string,
  columnName: string,
  statement: ReturnType<typeof sql>,
) {
  if (await columnExists(db, tableName, columnName)) {
    console.log(`✓ ${tableName}.${columnName} already exists - skipping`);
    return;
  }

  await db.execute(statement);
}

export async function indexExists(
  db: LegacyDatabase,
indexName: string) {
  const { rows } = await db.execute(sql`
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = ${indexName}
    LIMIT 1;
  `);

  return rows.length > 0;
}

export async function createIndexIfMissing(
  db: LegacyDatabase,
  indexName: string,
  statement: ReturnType<typeof sql>,
) {
  if (await indexExists(db, indexName)) {
    console.log(`✓ ${indexName} already exists - skipping`);
    return;
  }

  await db.execute(statement);
}

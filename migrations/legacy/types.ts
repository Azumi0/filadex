import type { SQL } from "drizzle-orm";

/**
 * All a legacy migration needs of a database connection.
 *
 * Deliberately a structural type rather than drizzle's NodePgDatabase: these
 * scripts are frozen, and the less they know about the rest of the codebase the
 * longer they keep working. In particular they must not import server/db.ts,
 * whose shape is free to change.
 */
export type LegacyDatabase = {
  execute(query: SQL): Promise<{ rows: Record<string, unknown>[] }>;
};

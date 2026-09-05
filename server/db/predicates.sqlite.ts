import { sql, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";

/**
 * Case-insensitive comparisons, in one place (SQLite dialect).
 *
 * `eqIgnoreCase` uses LOWER() on both sides.
 * `containsIgnoreCase` uses LIKE with ESCAPE '\'.
 *
 * SQLite's LIKE folds case for ASCII characters only; Unicode characters
 * (like umlauts) are not folded. This is an accepted constraint matching
 * the product's username rules.
 *
 * See docs/adr/0004.
 */

/** Matches when the column equals the value, ignoring case. */
export function eqIgnoreCase(column: AnySQLiteColumn, value: string): SQL {
  return sql`LOWER(${column}) = LOWER(${value})`;
}

/**
 * The same rule as {@link eqIgnoreCase}, for two values already in hand rather
 * than in SQL. It lives here so the one place the caseless-comparison rule is
 * defined also covers the JS side: `isInUse` for materials compares a declared
 * material against a Catalog Material name and has to agree with how the two
 * resolve in the database.
 */
export function equalsIgnoreCase(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Matches when the column contains the value anywhere in it, ignoring case.
 *
 * `%`, `_` and `\` in the value are escaped rather than stripped, so a search
 * term matches those characters literally and cannot widen its own pattern. A
 * term made only of wildcards matches only rows that literally contain them.
 *
 * Uses SQLite's LIKE operator with ESCAPE '\'.
 */
export function containsIgnoreCase(column: AnySQLiteColumn, value: string): SQL {
  const escaped = value.replace(/[\\%_]/g, (char) => `\\${char}`);
  return sql`${column} LIKE ${`%${escaped}%`} ESCAPE '\\'`;
}

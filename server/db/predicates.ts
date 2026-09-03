import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

/**
 * Case-insensitive comparisons, in one place.
 *
 * Every case-insensitive match in the application goes through these two
 * functions rather than writing the SQL inline. That matters for two reasons.
 *
 * The first is consistency: "does this username already exist" and "can this
 * username log in" have to agree, and they only reliably agree if they are the
 * same predicate. They were not, once, and the result was that an account
 * registered as "Alice" could never be logged into as "alice".
 *
 * The second is that this is the one comparison SQL engines genuinely disagree
 * about. ILIKE is Postgres-only, and LOWER() is not the only way to spell a
 * caseless comparison. Keeping both behind a named function means a different
 * engine changes this file and nothing else.
 */

/** Matches when the column equals the value, ignoring case. */
export function eqIgnoreCase(column: AnyPgColumn, value: string): SQL {
  return sql`LOWER(${column}) = LOWER(${value})`;
}

/**
 * Matches when the column contains the value anywhere in it, ignoring case.
 *
 * `%`, `_` and `\` in the value are escaped rather than stripped, so a search
 * term matches those characters literally and cannot widen its own pattern. A
 * term made only of wildcards matches only rows that literally contain them.
 */
export function containsIgnoreCase(column: AnyPgColumn, value: string): SQL {
  const escaped = value.replace(/[\\%_]/g, (char) => `\\${char}`);
  return sql`${column} ILIKE ${`%${escaped}%`} ESCAPE '\\'`;
}

/**
 * @libsql/client rejects a `sqlite:` URL with URL_SCHEME_NOT_SUPPORTED, but the
 * scheme is accepted at every entry point that chooses the dialect
 * (docker-entrypoint.sh, scripts/migrate.ts). Normalising it to `file:` here is
 * what makes the two agree.
 *
 * This module is deliberately free of side effects: server/db.sqlite.ts opens a
 * database connection on import, and the test harness needs the function without
 * that. See docs/adr/0004-sqlite-alongside-postgres.md.
 */
export function normalizeSqliteUrl(url: string): string {
  if (url.startsWith("sqlite:")) {
    return url.replace(/^sqlite:/, "file:");
  }
  return url;
}

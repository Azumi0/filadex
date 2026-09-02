# Legacy migrations

The upgrade path Filadex used before it moved to generated Drizzle migrations.
`docker-entrypoint.sh` created the base tables with raw SQL and then ran these
scripts, in the order `index.ts` lists them, on every container start.

**They are frozen. Nothing here is ever edited, and nothing is ever added.**

## Why they stay

They are the only way a database created by an older Filadex reaches the state
`migrations/pg/0000` describes. An installation may be several versions behind
and have run only some of them. `scripts/migrate.ts` runs them once against such
a database, then records the baseline; from that point on the database is on
generated migrations and these never run again.

Deleting them would mean older installations could no longer upgrade — they
would have to start from an empty database. Keeping them costs nothing as long
as they keep working, which is what the rules below are for.

## What keeps them working

They are written so that nothing in the rest of the codebase can break them:

- **No imports from `server/` or `shared/`.** They take a connection as an
  argument (`LegacyDatabase` in `types.ts`, which is just "something with
  `execute`") rather than importing `server/db.ts`, and they use raw SQL rather
  than `shared/schema.ts`. Both of those files are free to change — `server/db.ts`
  in particular becomes a dialect switch if SQLite support lands — and none of
  that reaches here.
- **No process control.** They export a function and throw on failure. They do
  not call `process.exit`, and they are not run as subprocesses, so a failure
  propagates to the caller instead of depending on an exit code and on `tsx`
  resolving correctly inside the container.
- **They own no connection.** The caller opens and closes it.
- **They are idempotent.** Every one checks `information_schema` before acting,
  because they used to run on every startup. That is what makes it safe to run
  the whole chain against a database that has already had some of it.

## What proves they still work

`npm run db:verify-upgrade` builds a pre-Drizzle database from
`scripts/fixtures/legacy-schema.sql`, runs this chain against it, and checks that
the result matches a fresh install and that no row changed. CI runs it on every
pull request (`.github/workflows/test.yml`), which is what makes "frozen" safe:
these scripts are otherwise exercised only during a real upgrade, where finding
out they broke is too late.

## Not part of the chain

`add_timestamp_columns` and `add_units_to_users` were never wired into
`docker-entrypoint.sh`, so no deployment ran them. They are kept only so the
history is complete. The `.js` files are stale compiled copies of their `.ts`
siblings.

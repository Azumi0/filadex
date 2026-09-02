# Tests

```bash
npm test          # one run
npm run test:watch
```

## What these tests are

Characterisation tests: they record what the HTTP endpoints do **today**, not
what they ought to do. Their job is to make behaviour-preserving refactors
provable — if a change makes one of them fail, the change altered observable
behaviour.

A handful of them assert behaviour that is wrong. Those are marked
`KNOWN BUG (recorded, not fixed)` with an explanation. Fixing one means
changing its test in the same commit, deliberately — which is the point.

## The database

Every test runs against a **real Postgres server**. There is no in-memory
substitute and no stubbed query layer, so `LOWER()`, unique constraints,
`serial`, `numeric`-as-string and `RETURNING` behave exactly as they do in
production.

Which server is chosen by `TEST_DATABASE_URL`:

| `TEST_DATABASE_URL` | what happens                                                   |
| ------------------- | -------------------------------------------------------------- |
| unset               | a throwaway `postgres:15-alpine` container is started (Docker)   |
| set                 | that database is used as-is                                      |

So the default needs Docker and nothing else; CI can point at a `services:`
Postgres instead.

> The variable is deliberately **not** the application's `DATABASE_URL`. The
> harness drops and recreates the `public` schema, which would destroy a
> development database that happened to be configured in the shell.

The schema is generated from `shared/schema.ts` at startup through
`drizzle-kit`'s API rather than from checked-in SQL or the imperative scripts in
`migrations/`, so it cannot drift from the schema the application uses. Each
test file rebuilds it; each test starts from empty tables.

## What is substituted, and why

Only things outside the boundary under test:

- **`server/db.ts`** is pointed at the test database. Same driver, same SQL —
  only the connection URL differs.
- **`server/utils/mailer.ts`** collects mail instead of sending it
  (`tests/helpers/mailbox.ts`). This is also how tests get at verification and
  password-reset tokens: by reading the link the user would have been emailed.
- **`express-rate-limit`** is disabled. Every supertest request comes from the
  same address, so the limiters would trip partway through a run and make
  results depend on test order.

Nothing the tests are actually characterising is faked. Requests go through the
real route handlers, the real auth middleware and real SQL.

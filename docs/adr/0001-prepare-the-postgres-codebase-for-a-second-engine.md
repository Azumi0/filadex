---
status: accepted
date: 2026-09-03
---

# Prepare the Postgres codebase for a second database engine

Filadex is meant to be able to run as a single container with no database
server, so that a single-user homelab install does not need Postgres. That means
supporting SQLite alongside it. This ADR records how that is being approached,
what was decided along the way, and — most importantly — the constraint that
shapes everything: **stage 1 contains no SQLite.**

## Why two stages

The work splits into two branches and two pull requests.

**Stage 1 (this branch) is preparation, and every item in it has to stand on its
own merit against the Postgres-only codebase.** A reviewer must be able to
accept all of it without agreeing that SQLite is a good idea, or that it will
ever happen. That is a deliberate constraint, not a nicety:

- It is somebody else's project. A large refactor whose only justification is
  "it makes a feature I want easier" is a bad trade for a maintainer who does
  not want that feature.
- If SQLite is later abandoned, nothing here has to be reverted.
- It keeps the second pull request small enough to review. Almost all of the
  risk lives in stage 1; stage 2 should be a dialect switch and a second set of
  column definitions.

**Stage 2 adds SQLite**: a second implementation of the column factory, a
dialect switch in `server/db.ts`, a SQLite branch of the generated migrations,
and a Docker path that skips Postgres entirely.

The one place this constraint was strained is recorded honestly under
[Express the schema through a column factory](#express-the-schema-through-a-column-factory).

## What stage 1 actually buys

Stage 2's cost is now concentrated rather than spread. Specifically:

- **Every database call goes through one interface**, and `server/db.ts` is
  imported by exactly one file. A dialect switch has one place to happen.
- **The SQL that engines disagree about is enumerable.** Case-insensitive
  matching is two functions in `server/db/predicates.ts`; the only `TRUNCATE`
  and the only explicit transaction are one method in `server/storage.ts`. There
  is no other raw SQL in the application.
- **The schema is written in a vocabulary that can be spelled per dialect**,
  from a single set of table definitions.
- **There is a test suite**, and it runs against a real database chosen by a URL
  — so the same suite becomes the SQLite verification at close to zero extra
  cost.
- **The schema file describes the database that actually exists.** It did not
  before, and everything above would have been built on a false premise.

## Decisions

### Tests run against a real database, never a fake

The suite (242 tests) runs against a real Postgres server. There is no
in-memory substitute and no stubbed query layer.

`TEST_DATABASE_URL` selects the server; with it unset, a throwaway
`postgres:15-alpine` container is started for the run. The variable is
deliberately **not** the application's `DATABASE_URL`: the harness drops and
recreates the `public` schema, and keying off the app's own variable would
destroy a development database that happened to be configured in the shell.

The tests depend on behaviour a fake cannot reproduce — `LOWER()` matching,
unique constraints, `serial` identity, `numeric`-as-string, `RETURNING`,
`ON DELETE CASCADE`, `IS NULL` semantics. Several of the bugs found this session
*are* those semantics being got wrong; a fake would have agreed with the buggy
code.

The test schema is generated from `shared/schema.ts` through `drizzle-kit`'s API
rather than from committed SQL, so it cannot drift from the schema the
application uses.

Only boundaries outside the code under test are substituted: the database URL,
SMTP, the GitHub API, and `express-rate-limit` (whose per-IP limiters would
otherwise make results depend on test order).

### The tests are characterisation tests, not a specification

They record what the endpoints observably do, so that moving every database call
in the application could be shown to change nothing. Where behaviour was wrong,
the test asserted the wrong behaviour and said so, and the fix came in its own
commit alongside the rewritten test.

This is why the refactor commits can claim to be behaviour-preserving, and why
every behaviour change in this branch is visible as a test diff rather than
buried in one.

The suite was mutation-tested rather than trusted: reverting each fix and each
consolidated predicate fails the tests that are supposed to catch it.

### `MemStorage` is deleted, not repurposed

`MemStorage` was ~490 lines implementing `IStorage` against in-memory `Map`s,
constructed nowhere. The choice was to delete it or wire it in as the test fake,
and it was deliberately made *after* the tests existed, so the evidence was
available: the tests need real SQL semantics, so an in-memory adapter could not
have run them. Deleted.

### All database access goes through `IStorage`

`server/db.ts` is now imported by `server/storage.ts` and nothing else. Every
direct Drizzle call in the other eleven files that imported it moved behind the
interface.

(Counting those call sites by grep proved unreliable twice — a `db` alone on its
own line does not match a line-oriented pattern, and both the original
assessment and the first pass here undercounted. "Which files import
`server/db.ts`" is the check that cannot be fooled, and it is now one.)

The methods are named for what the flow does rather than the SQL it runs, and
the multi-column writes are bundled: `markEmailVerified` clears the token it
just spent; `resetPassword` clears the reset token and expiry alongside the new
password. Two hazards moved into storage where they can only be got wrong once —
the empty-`SET` update that produced a 500, and the `IS NULL` handling for a
global sharing row.

**Rejected: a generic `Database` facade over `select`/`insert`/`where`.** Its
interface would be nearly as large as Drizzle's, its implementation pure
pass-through, and it would destroy Drizzle's type inference.

**Rejected: a `SqliteStorage` adapter.** Engine variation does not belong at the
`IStorage` seam — that would be a third copy of the domain logic. It belongs
below it.

Where two methods differ only in a detail, they stay separate rather than being
unified during a refactor: `resetPassword` clears a pending reset token and
`changePassword` does not, which is the behaviour that exists today. Unifying
them may be right, but it is a behaviour change and belongs in its own commit.

### Name the comparisons engines disagree about

`server/db/predicates.ts` exposes `eqIgnoreCase` and `containsIgnoreCase`.

Two reasons, and the first matters more today. **Consistency:** "does this
username already exist" and "can this username log in" must agree, and they only
reliably agree if they are literally the same predicate. They were not —
registration compared with `LOWER()` and login with a plain `eq` — and an
account registered as `Alice` could never be logged into as `alice`.
**Portability:** `ILIKE` is Postgres-only, and this is the one comparison SQL
engines genuinely disagree about.

`server/utils/materials.ts` exists for the same reason at a different level: a
filament stores its material as free text while the catalog stores rows, the two
are matched by name, and the two places that did so were each separately wrong.

### Express the schema through a column factory

`shared/columns.ts` exports `table` and a `t` namespace (`t.pk`, `t.text`,
`t.int`, `t.bool`, `t.numeric`, `t.timestamp`, `t.timestamptz`, `t.date`,
`t.json`, `t.fk`), and all fifteen tables are written in it.

**This is the one item in stage 1 with no independent benefit on Postgres.** On
Postgres these helpers are a rename. Their value is that the schema is the one
place the application agrees on its data and should stay a single place even if
it has to be expressed in another dialect — the alternatives being code
generation or a hand-maintained second copy of fifteen tables, both of which
rot. It is a self-contained commit for exactly this reason, so it can be dropped
from the stage 1 pull request or moved to stage 2 without disturbing anything
else.

Conversion was verified by generating the DDL before and after and diffing it:
189 lines, byte-identical.

### `shared/schema.ts` describes the database that exists

`shared/schema.ts` described a database no Filadex installation has. What a
deployment actually contains is `docker-entrypoint.sh`'s `CREATE TABLE` block
plus eleven migration scripts; reconciling the two produced **57 statements of
difference**. The application worked anyway, because most of the difference is
in names and nullability the query builder does not consult — but the file was
not the source of truth it was treated as, and the migration work below depends
on it being one.

It now matches, verified by building a database the way a real deployment builds
one and running `drizzle-kit`'s `pushSchema` against it: 0 statements.

The consequential part is timestamps. The eight tables `docker-entrypoint.sh`
creates use `timestamp with time zone`; everything the migration scripts added
does not. The schema claimed all of them were plain timestamps, so following it
would have narrowed ten columns and **discarded each value's UTC offset,
reinterpreting it in the server's local zone** — silent, and wrong on every
deployment not running UTC. Both spellings are now recorded, which is why
`t.timestamp` and `t.timestamptz` both exist.

Also recovered: three indexes the schema declared none of — including
`users_username_lower_idx`, a `UNIQUE` index on `lower(username)` that is the
constraint actually enforcing case-insensitive username uniqueness, which the
rest of this branch relies on.

Constraint *names* are matched too. The hand-written SQL got Postgres's defaults
(`users_username_key`, `filaments_user_id_fkey`); Drizzle assumes its own. This
is why foreign keys are declared in table extras rather than with
`.references()` — that is the only form that can name them. A future migration
assuming Drizzle's names would not find the constraint it wanted to alter.

### Generated migrations, with a baseline for existing installs

`docker-entrypoint.sh` built the schema itself: 14 `psql` invocations, three
hand-written `ALTER TABLE` checks, and eleven imperative scripts re-run on every
container start. It is now one call to `scripts/migrate.ts`, and the script went
from 294 lines to 125.

**The cutover cannot be a straight swap.** An existing database has no Drizzle
journal, so the migrator would consider nothing applied and run `0000` — plain
`CREATE TABLE` — failing on the first statement. Every existing deployment would
fail to start. `scripts/migrate.ts` therefore distinguishes three cases:

| State | Action |
| --- | --- |
| journal present | apply whatever is newer than the last recorded migration |
| tables, no journal | run the legacy chain once, then record `0000` as applied without running it |
| empty database | create everything from `0000` |

The legacy catch-up is what makes the baseline honest. An installation may be
several versions behind and have run only some of those scripts; they are all
guarded on `information_schema`, so re-running them on a current database does
nothing, but skipping them could baseline a schema that is not actually there.

### The legacy migrations stay in the repository indefinitely

The first version of the cutover treated them as a temporary bridge to be
deleted once deployments had passed through this release. That is wrong:
deleting them means an older installation can never upgrade, only start over.

They are kept forever, which is only viable if nothing else can break them:

- **No imports from `server/` or `shared/`.** Each takes a connection as an
  argument, typed structurally as "something with `execute`". `server/db.ts` is
  free to change — it becomes a dialect switch in stage 2 — without reaching
  them. They were always raw SQL, so `shared/schema.ts` can keep evolving too.
- **No `process.exit`, and not run as subprocesses.** Each exports a function
  and throws. A failure propagates as an exception rather than depending on an
  exit code and on `tsx` resolving inside the container — which is exactly how
  GH issue #5 turned a broken migration into a silent no-op.
- **They own no connection.** The caller does.
- **CI runs the upgrade test on every pull request.** Frozen without
  verification just means unverified; these scripts are otherwise exercised only
  during a real upgrade, where finding out they broke is too late.

`migrations/legacy/README.md` states the contract: never edited, never added to.

### The upgrade is proven, not asserted

`npm run db:verify-upgrade` builds a pre-Drizzle installation from a frozen copy
of the old DDL, seeds it with `npm run db:seed`, snapshots every row, upgrades
it, and checks five things: every row survives byte-identical; an upgraded
database ends up with the same schema as a fresh install; both match
`shared/schema.ts` according to `drizzle-kit`; and re-running the migration
changes nothing, since the entrypoint runs it on every start.

This is not decoration. It is how the email-verification bug below was found.

## Bugs found, and how

Seven, all fixed here, each with its pinning test rewritten in the same commit.
They are listed because *how* they were found is the argument for the work:

| Bug | Found by |
| --- | --- |
| Login matched usernames case-sensitively while registration did not, so an account registered as `Alice` could never log in | writing characterisation tests |
| `PUT /api/users/:id` answered 500 for a no-op update, including renaming `bob` to `Bob` | writing characterisation tests |
| `POST /api/users` validated nothing; a missing password reached bcrypt and became an opaque 500 | writing characterisation tests |
| Per-material sharing matched material names case-sensitively | writing characterisation tests |
| Global sharing could not be switched off — the stale public row survived, so the collection stayed public | writing characterisation tests |
| The drying reminder matched material names case-sensitively | consolidating the two matchers |
| **The email migration verified every pending registration on every container restart**, letting anyone bypass verification by waiting for a restart | the upgrade row-comparison |

The last one is live in the released version, not introduced here, and is worth
reporting upstream ahead of everything else.

## Consequences

- `tsc` must eventually run once per dialect, and CI must run both. Not yet
  true; stage 2's cost.
- Postgres is the supported default. SQLite is intended as a documented
  single-user option, not a co-equal target. Every future schema change needs
  testing on both.
- The legacy migration chain is permanent surface area. It is small, frozen and
  CI-covered, but it is not free.
- `npm test` and `npm run db:verify-upgrade` both require Docker unless
  `TEST_DATABASE_URL` points at an existing server.

## Deliberately not done

Recorded in `TODO.md` rather than fixed, because each is a product decision or a
behaviour change rather than a refactor: filaments duplicating catalog names as
free text; two endpoints implementing sharing differently; the 8-versus-6
password length split; `PUT /api/settings/email` depending on a row it cannot
create; the dead `filaments.created_at`/`updated_at` columns; the
`timestamptz`/`timestamp` inconsistency; and the unused
`IStorage.getPublicFilamentsWithUser`.

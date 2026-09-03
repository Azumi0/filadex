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

- **Every database call in the application goes through one interface**, and
  `server/db.ts` is imported by exactly one application file. A dialect switch
  has one place to happen. The standalone scripts are a separate class of
  caller and open the connection themselves — `scripts/migrate.ts`,
  `scripts/seed-demo-data.ts` and `init-data.ts` import it too — but none of
  them is the running server.
- **The SQL that engines disagree about is enumerable.** Case-insensitive
  matching is two functions in `server/db/predicates.ts`; the only `TRUNCATE`
  and the only explicit transaction are one method in `server/storage.ts`. The
  only raw SQL left elsewhere is `shared/schema.ts`'s `lower()` index
  expression and the `CREATE TABLE` fallback block in `init-data.ts` — which
  is not part of the server either, but is built into the image
  (`Dockerfile:55`) and exposed as `npm run db:init`, so it is a second place
  that will need the dialect.
- **The schema is written in a vocabulary that can be spelled per dialect**,
  from a single set of table definitions.
- **There is a test suite**, and it runs against a real database chosen by a URL
  — so the same suite becomes the SQLite verification at close to zero extra
  cost.
- **The schema file describes the database that actually exists.** It did not
  before, and everything above would have been built on a false premise.

## Decisions

### Tests run against a real database, never a fake

The suite (243 tests) runs against a real Postgres server. There is no
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

### The dead session-authentication dependencies go too

`passport`, `passport-local`, `express-session`, `memorystore` and
`connect-pg-simple`, with their `@types`, were installed and referenced nowhere
outside `package.json`. They belong to a session-store login this application
does not have: authentication is a signed JWT in a cookie (`server/auth.ts`),
and one of them — `connect-pg-simple` — would have been a second, invisible
consumer of Postgres to account for in stage 2 had anything actually used it.

This is the one commit here that is not about the database, and it is included
on the same terms as everything else: the claim is "nothing imports this", and
that is a question with an answer. They were already dead before this branch
began; removing them only stops them being mistaken for load-bearing.

### All database access goes through `IStorage`

Within the application `server/db.ts` is now imported by `server/storage.ts` and
nothing else. Every direct Drizzle call in the other eleven files that imported
it moved behind the interface. Outside the application three scripts still
import it directly — `scripts/migrate.ts`, `scripts/seed-demo-data.ts` and
`init-data.ts` — which is fine and deliberate: they are not the server, they
run once, and two of them exist precisely to do things `IStorage` must not
expose.

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

The three `ALTER TABLE` checks moved into that chain rather than disappearing
with the script: `migrations/legacy/add_language_and_units_to_users.ts` adds
`users.language`, `users.currency` and `users.temperature_unit`, first in the
order, because that is where the entrypoint ran them. `0000` assumes those
columns exist, so a database old enough to predate them would otherwise be
baselined without them.

**Nothing under `migrations/pg/` may be hand-edited, including whitespace.**
`scripts/migrate.ts` baselines an existing installation by writing the hash of
the migration file into `drizzle.__drizzle_migrations` without running it, and
that hash is taken over the file's bytes, the same way drizzle's own migrator
takes it.

Be precise about what that buys, because the obvious assumption is wrong: as of
drizzle-orm 0.39.1 the migrator decides what to apply by comparing `created_at`
against each journal entry's `when`, and the `hash` column is written but never
read back. A changed hash would therefore *not* cause a baselined deployment to
re-run or reject a migration today. The reason to keep the bytes stable is that
this is undocumented internal behaviour of a dependency: the column exists to
identify the migration, matching drizzle's own writer keeps the row honest, and
nothing in the baseline should depend on a comparison that the library is free
to start performing in a later version. Writing a hash that is deliberately not
the file's hash would be a silent trap for whoever hits that release.

This is why those files are the one place in the repository that does not follow
CONTRIBUTING.md's "end all files with a newline": `0000`, `0001` and the three
`meta/` files are written by `drizzle-kit` and identified by hash, so they are
generated artefacts rather than source. The `meta/` files would revert on the
next `npm run db:generate` regardless.

**A baseline is a claim, and `scripts/migrate.ts` checks it before making it.**
`assertMatchesBaseline` compares the live schema against the tables, columns and
column types parsed out of `0000`'s own SQL, and refuses to record the baseline
if they differ. This matters because baselining is what stops the legacy chain
from ever running again: before it, a database that the chain had failed to
bring up to shape was re-attempted on every boot and healed itself once the
cause was fixed; after it, that database is declared correct and stays broken.
Three real cases produce exactly that, and each is caught here rather than at the
first request:

- Several legacy scripts log a warning and continue when the database user does
  not own the table they have to `ALTER` — `add_user_id_column` and
  `drop_filament_type_columns` both do, deliberately, because the entrypoint
  re-ran them. Their "completed successfully" is not evidence.
- The base tables were created by the entrypoint's `CREATE TABLE` block, not by
  anything in `migrations/legacy`, so an installation missing one never gets it
  from the chain.
- A schema built with `drizzle-kit push` has plain `timestamp` where `0000` has
  `timestamp with time zone`, which changes what the application reads back.

The one thing the entrypoint did that `0000` cannot is insert a row: it re-ran
the whole legacy chain on every start, and `add_email_rbac_and_settings`
inserted the `email_settings` singleton there. A fresh database now gets the
table from `0000` and the row from `0001`, which is a no-op on any database the
legacy chain has already touched. Without it a brand-new installation could
never save its SMTP settings.

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

  Both of these are true of the chain `index.ts` declares, which is what runs.
  `migrations/legacy/add_timestamp_columns.ts` and the three stale `.js` files
  in the directory meet neither: they open their own pool and call
  `process.exit`. They are kept only because deleting history is worse than
  keeping it, no deployment ever ran them, and nothing imports them.
  `migrations/legacy/README.md` names them under "Not part of the chain".
- **`npm run check` covers them.** `tsconfig.json` includes `migrations/**` and
  `scripts/**` alongside the application, so a script that stops compiling is a
  failed check rather than a surprise during someone's upgrade. This is not
  hypothetical: moving these files into `legacy/` left one of them calling a `db`
  that no longer existed, and it went unnoticed precisely because neither
  directory was being type-checked. (Including `scripts/` is also why `target` is
  now set: without it `tsc` defaults to ES5 and rejects top-level `await`.)
- **CI runs the upgrade test on every pull request.** Frozen without
  verification just means unverified; these scripts are otherwise exercised only
  during a real upgrade, where finding out they broke is too late. The fixture it
  upgrades is the oldest shape still supported, so the whole chain runs.

`migrations/legacy/README.md` states the contract: never edited, never added to.

### The upgrade is proven, not asserted

`npm run db:verify-upgrade` builds a pre-Drizzle installation from a frozen copy
of the old DDL, seeds it with `npm run db:seed`, snapshots every row, upgrades
it, and checks six things: every row survives byte-identical; an upgraded
database ends up with the same schema as a fresh install; both match
`shared/schema.ts` according to `drizzle-kit`; and re-running the migration
changes neither a row nor the schema, since the entrypoint runs it on every
start.

The fixture it starts from is deliberately the *oldest* database that can still
upgrade, not the newest: its `users` table predates `language`, `currency` and
`temperature_unit`. A fixture that already had them would never exercise the
chain entry that adds them.

Be exact about the window those six checks cover, because "every row survives
byte-identical" sounds like it covers more than it does. The snapshot is taken
after the legacy chain has already run, which is correct for what it is testing:
the old entrypoint ran that chain on every boot, so a database arriving at this
upgrade has been through it many times, and within that window the chain really
is a no-op. But it means the one legacy step that *rewrites* data rather than
adding to it — the `filament_types` backfill and the column drop that follows —
happens before the first snapshot and is invisible to all six. The seed cannot
close the gap either: it inserts through `shared/schema.ts`, which describes the
shape those columns were dropped into and can no longer express a flat
pre-migration `filaments` row.

So there is a seventh check, `verifyBackfill`, which builds its own database,
stops before the chain, seeds flat rows through raw SQL, runs the chain, and
compares across it: every spool survives, keeps its name, owner and weights,
gains a `filament_type_id`, and the type it points at carries the manufacturer,
material, colour, diameter and print temperature the flat row had. It also pins
the grouping — two spools of one product share a type, the same product owned by
two users does not — and that the dropped columns are actually gone.

This is not decoration. It is how the email-verification bug below was found.

## Bugs found, and how

Eight, all fixed here. Each is pinned, and all but one by a test rewritten in
the same commit: the email-verification fix (`065fd17`) ships no test, because
what pins it is a seed row — `scripts/seed-demo-data.ts` seeds an unverified
user with a pending token, and `npm run db:verify-upgrade` fails if the upgrade
verifies them. They are listed because *how* they were found is the argument
for the work:

| Bug | Found by |
| --- | --- |
| Login matched usernames case-sensitively while registration did not, so an account registered as `Alice` could never log in | writing characterisation tests |
| `PUT /api/users/:id` answered 500 for a no-op update, including renaming `bob` to `Bob` | writing characterisation tests |
| `POST /api/users` validated nothing; a missing password reached bcrypt and became an opaque 500 | writing characterisation tests |
| Per-material sharing matched material names case-sensitively | writing characterisation tests |
| Global sharing could not be switched off — the stale public row survived, so the collection stayed public | writing characterisation tests |
| The drying reminder matched material names case-sensitively | consolidating the two matchers |
| **The email migration verified every pending registration on every container restart**, letting anyone bypass verification by waiting for a restart | the upgrade row-comparison |
| `PUT /api/users/:id` answered 200 with an empty body when the row was deleted between the existence check and the update, instead of 404 | reviewing this branch |

The email-migration one is live in the released version, not introduced here,
and is worth reporting upstream ahead of everything else.

The last is the odd one out: it was found reviewing this branch rather than by
the work, and it predates the branch — `main` has the same empty 200. It is
fixed here anyway, because the file was being rewritten regardless and the fix
is one branch and one test.

## Behaviour changes that need release notes

Fixing a bug changes behaviour, and three of these change it in ways an
administrator can see without having done anything. None belongs only in this
document — all three go in the release notes for the version that ships them.

**Case-insensitive material matching can make a spool public that was not.**
Consolidating the two matchers into `server/utils/materials.ts` fixed
per-material sharing, and the fix widens what `GET /api/public/filaments/:userId`
returns. A user who shares the catalog material `PLA` and owns a spool whose
free-text material reads `pla` — from a SpoolmanDB import, or typed that way —
was previously not sharing that spool and now is. The new behaviour is the
intended one; the point is that it takes effect on upgrade, with no user action
and no notification, on an endpoint that needs no authentication. Anyone
upgrading should be told to re-check what their public collection contains.

**Timestamps read back correctly, which means they read back differently.**
The ten columns recovered as `timestamp with time zone` were previously mapped
by discarding the stored UTC offset and reinterpreting the value in the server's
zone. On a deployment whose Postgres session is not UTC, `createdAt` and
`lastLogin` in `GET /api/auth/me` and `GET /api/users` will shift by that offset
across the upgrade — the new value is the right one. Nothing in the test suite
catches this, because the containers it runs against are UTC.

There is also a case this does *not* fix. The legacy chain never converts a
column's type, so a database created by `drizzle-kit push` — which
`docs/DEVELOPMENT.md` used to recommend — has plain `timestamp` for those ten
columns and would read them in the Node process's local zone. `scripts/migrate.ts`
now refuses to baseline such a database rather than declaring it correct; see
`assertMatchesBaseline` above.

**Admin-created usernames are validated, and some existing ones cannot be
renamed.** `usernameSchema` has always applied to self-registration, but on
`main` both `POST /api/users` and `PUT /api/users/:id` destructured `req.body`
and validated nothing, and the admin form asked only for three characters. An
admin could therefore create `müller`, which no one could ever register. Both
endpoints now apply the same rules, so that name can no longer be created —
worth stating plainly, because the UI is German and the rule is ASCII-only.

Accounts already holding such a name keep working: `POST /api/auth/login` looks
the user up without validating, so nobody is locked out. They also stay
administrable, because the rules apply to a name being *set* rather than one
already held — the edit form prefills the username, and without that exemption
an admin resetting the password on `müller` would have been refused over a field
they never touched. What such an account cannot do is change its name, including
by capitalisation alone: that is setting a new name, and it gets the same answer
any other rename to a refused name gets. Renaming it to an acceptable name is
the way out.

Whether ASCII-only is the right rule for a German-language product is a product
decision, not a refactoring one, so it is left as it was found.

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
password length split, of which only the admin form was aligned here (it asked
for 6 while the endpoint behind it requires 8 — the client was simply wrong;
change-password still requires 6 server-side where registration and reset
require 8, and that split stands); `PUT /api/settings/email` depending on a row
it cannot create — `0001` now guarantees that row exists, so what is left is the
endpoint's fragility rather than a broken installation; the dead `filaments.created_at`/`updated_at` columns; the
`timestamptz`/`timestamp` inconsistency; and the unused
`IStorage.getPublicFilamentsWithUser`.

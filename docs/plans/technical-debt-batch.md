# Implementation plan: technical-debt batch

Seven entries from `TODO.md`'s Technical Debt section, as one branch and one
commit per item. They are independent; the order below exists only so that the
two commits touching the migration chain come last, after the cheap ones have
proven the branch is green.

Read `CONTEXT.md` before starting. It defines Spool, Filament Type, declared
material and Catalog Material, and this plan uses those words precisely.

**Item 5 (materials as free text) is not in this plan.** It has its own, in
`docs/plans/per-user-material-catalog-backend.md`. Do not start it here.

## Ground rules

- **Every commit ends green**: `npm test` and `npm run check` both pass.
- **Every behavioural change gets a test in its own commit.** The suite in
  `tests/` is characterisation-style — it records what the endpoints observably
  do. Read `tests/README.md` before writing one. Tests need Docker, or a
  `TEST_DATABASE_URL` pointing at a throwaway Postgres.
- **Match the surrounding style.** This codebase comments *why*, not *what*, and
  several comments record bugs that already happened. When you delete code, delete
  the comments that only existed to explain it; when you change behaviour a comment
  describes, change the comment in the same commit.
- **Do not reformat, rename or tidy anything adjacent.** Every changed line
  should trace to one of the seven items.

---

## Commit 1 — Delete the unused `getPublicFilamentsWithUser` (TODO item 4)

Nothing calls it. It is close to what `GET /api/public/filaments/:userId` does,
but it throws when the user does not exist where the route needs a 404, which is
why `server/routes/public.ts` composes `getUser` + `getFilaments` itself.

**Do:**
1. Delete the declaration at `server/storage.ts:292-293` (the `/** UNUSED ... */`
   comment and the signature).
2. Delete the implementation — the `async getPublicFilamentsWithUser` method
   ending at `server/storage.ts:720`, including its explanatory comment block.
3. Remove any import in `server/storage.ts` that only that method used.

**Do not** change `server/routes/public.ts`. Its composition is the behaviour
being kept.

**Verify:** `npm run check` (proves nothing referenced it) and `npm test`.

---

## Commit 2 — Remove the duplicate sharing endpoints (TODO item 7)

`POST /api/user-sharing` and `POST /api/sharing` are the same feature with
different semantics (replace vs. update-in-place, always-201 vs. 201/200). They
diverged once into a bug where sharing could not be switched off.

`/api/sharing` has **no callers** — not in `client/`, not in `tests/`.
`/api/user-sharing` is what `client/src/components/sharing-modal.tsx:48,67` calls
and what `tests/routes/users.test.ts:689-808` and
`tests/routes/public.test.ts:325` characterise. So `/api/sharing` goes.

Both storage methods are duplicate-safe today: `setUserSharing` deletes every
matching row before inserting, `upsertUserSharing` keeps the oldest and deletes
the rest. Nothing is lost by keeping the former.

**Do:**
1. Delete `POST /api/sharing` (`server/routes/public.ts:68-83`) and
   `GET /api/sharing` (`server/routes/public.ts:85-92`).
2. Delete `upsertUserSharing` from the `IStorage` interface
   (`server/storage.ts:287-288`) and its implementation
   (`server/storage.ts:643`ff), plus the `UpsertedSharing` type if nothing else
   uses it. Check with `grep -rn UpsertedSharing server shared`.
3. `upsertUserSharing`'s comment block explains why duplicate rows can exist and
   how they are cleaned up. That reasoning still applies to `setUserSharing`'s
   delete-all-then-insert. Move the relevant part of it onto `setUserSharing`
   rather than deleting it — it is the record of a real bug.
4. Remove `docs/API.md`'s `/api/sharing` sections (around lines 1138 and 1168),
   and fix the cross-reference at `docs/API.md:1190`, which currently tells the
   reader that sharing is configured via `POST /api/sharing`. It should name
   `POST /api/user-sharing`.
5. Remove the two `/api/sharing` checklist lines at
   `docs/TESTING_GUIDE.md:96-97`.

**Do not** move `/api/user-sharing` out of `server/routes/users.ts`. It reads
oddly next to the user-admin routes, but relocating it is a separate concern and
would make this commit a refactor as well as a deletion.

**Verify:** `npm test` — the existing `/api/user-sharing` tests must pass
unchanged. If any of them needed editing, you deleted the wrong endpoint.

---

## Commit 3 — Escape search wildcards instead of stripping them (TODO item 6)

`containsIgnoreCase` (`server/db/predicates.ts:31-34`) strips `%` and `_` from
the search term so a term cannot widen its own pattern. The side effect is that
a term made only of wildcards collapses to an empty pattern and matches
everything. Escaping is more predictable.

**Do:**
1. Replace the strip with an escape, and add the `ESCAPE` clause:

   ```ts
   export function containsIgnoreCase(column: AnyPgColumn, value: string): SQL {
     const escaped = value.replace(/[\\%_]/g, (char) => `\\${char}`);
     return sql`${column} ILIKE ${`%${escaped}%`} ESCAPE '\\'`;
   }
   ```

   Backslash must be escaped first — that is why it is in the character class
   alongside `%` and `_`, rather than handled in a second pass.
2. Rewrite the doc comment above it. It currently documents the stripping and
   the everything-matches consequence as deliberate; both statements become
   false.

**Verify:** add tests to `tests/routes/community-filaments.test.ts`, which
already exercises `GET /api/community-filaments/search`:
- a query of `%` alone returns **no** results (today it returns everything);
- a query of `_` alone returns no results;
- a manufacturer literally containing `%` or `_` is findable by searching for
  that character as part of its name;
- an ordinary substring search still works — the existing tests cover this and
  must not need changing.

---

## Commit 4 — One password rule everywhere (TODO item 9)

Registration and password reset require 8 characters; change-password requires
6, so a user can register with 8 and immediately downgrade to 6.

The rule binds a password being **set**, not one already held — existing short
passwords keep working at login. That is the same principle already applied to
usernames, recorded at `shared/schema.ts:186-191`.

**Do:**
1. `shared/schema.ts:124` — `changePasswordSchema.newPassword` becomes
   `passwordSchema` (the shared one at `shared/schema.ts:146-148`), rather than a
   fourth hand-written `min(8)`. That is the point of the shared schema; see the
   comment above it.
2. Client mirrors, which must not disagree with the server:
   - `client/src/components/change-password-modal.tsx:18` — `min(6)` → `min(8)`,
     message key `auth.passwordTooShort` to match the other forms.
   - `client/src/components/change-password-modal.tsx:19` — `confirmPassword`
     becomes `min(1)`. It is a match check, not a strength check; requiring a
     length here only produces a second, worse error message.
   - `client/src/pages/change-password.tsx:18` — same change as the modal.
3. Check `auth.passwordRequirements` in `client/src/i18n/locales/en.ts` and
   `de.ts`. If its text names six characters, fix both languages. If it is no
   longer referenced anywhere after step 2, leave it — removing unused
   translation keys is not this commit's business.

**Verify:** in `tests/routes/auth.test.ts`, alongside the existing
change-password tests: a 7-character new password is rejected with 400, an
8-character one succeeds, and a user whose stored password is shorter than 8 can
still log in.

---

## Commit 5 — Record the ASCII username rule as deliberate (TODO item 8)

`usernameSchema` requires `^[a-zA-Z0-9_-]+$`, so `müller` cannot be registered in
a German-language product. **The decision is to keep the rule and document it**,
not to widen it. This commit writes that down so the next reader does not
re-litigate it.

Two facts that were checked and that the TODO does not record:

- Uniqueness is already enforced by the database:
  `uniqueIndex("users_username_lower_idx")` at `shared/schema.ts:41`, present in
  `migrations/pg/0000_right_mathemanic.sql:194` and backfilled by
  `migrations/legacy/add_email_rbac_and_settings.ts:45`. The `LOWER()`
  comparison in `server/db/predicates.ts` is therefore backed by an index that
  agrees with it. **This is why widening is not urgent** — but it is also the
  thing that would need re-examining if the charset ever widened, because
  `LOWER()` on non-ASCII depends on the database's collation.
- Existing accounts holding a non-conforming name still log in and can still be
  administered. The rules bind a name being set, not one already held
  (`shared/schema.ts:186-191`).

**Do:**
1. Extend the comment above `usernameSchema` (`shared/schema.ts:136-137`) to say
   the ASCII restriction is deliberate, and why: uniqueness and login agree
   today only because `LOWER()` and `users_username_lower_idx` are both
   ASCII-safe, and widening the charset would make correctness depend on the
   deployed database's collation — which varies across the installs this project
   supports. Point at `server/db/predicates.ts`.
2. In `TODO.md`, replace the item-8 bullet with a short note that this was
   decided and where the reasoning lives. Do not delete it silently; the
   question is a reasonable one to ask again and deserves an answer in place.

**Verify:** `npm run check`. No behaviour changes, so no new test. Do not add one.

---

## Commit 6 — Drop the dead `filaments` timestamp columns (TODO item 10)

`filaments.created_at` and `filaments.updated_at` are written by nothing and
read by nothing. They are declared in `shared/schema.ts` only so it matches the
deployed database, and excluded from the API-facing `Filament` type via
`UnusedFilamentColumns`.

This is the first of the two migration commits. **Read `scripts/migrate.ts`'s
header comment before starting** — it explains the three cases a database can be
in and why the baseline is asserted rather than assumed.

**Do:**
1. Delete `createdAt` and `updatedAt` from the `filaments` table
   (`shared/schema.ts:96-98`) along with the comment above them, which exists
   only to explain why they were kept.
2. Delete the `UnusedFilamentColumns` type (`shared/schema.ts:237-240`) and
   remove it from the `Filament` and `InsertFilament` `Omit`s below it. Those
   types should now omit only `filamentTypeId`.
3. Generate the migration: `npm run db:generate`. It should produce
   `migrations/pg/0002_*.sql` containing two `ALTER TABLE ... DROP COLUMN`
   statements and nothing else. **Read the generated SQL.** If it contains
   anything beyond those two drops, stop — the schema has drifted from the
   migrations and that is a separate problem to solve first.
4. Commit the generated `.sql`, the updated `meta/_journal.json` and the new
   snapshot together with the schema change. A migration split across two
   commits leaves an intermediate commit that cannot migrate.

**Do not** touch `assertMatchesBaseline` in `scripts/migrate.ts`. It checks the
database against migration 0000, which still creates these columns; 0002 drops
them afterwards. That is the correct sequence for both a fresh database and an
upgraded one.

**Verify:**
- `npm test` — the test harness builds its schema from `shared/schema.ts`
  directly, so this proves the application no longer needs the columns, but
  proves **nothing** about the migration.
- `npx tsx scripts/verify-upgrade.ts` — this is what proves the migration. It
  builds a pre-drizzle installation, upgrades it, and checks that an upgraded
  database ends up identical to a fresh one and that both match
  `shared/schema.ts`. Requires Docker. **Do not report this commit as done
  without running it.**

---

## Commit 7 — Record why timestamp columns stay inconsistent (TODO item 11)

`docs/adr/0002-defer-unifying-timestamp-columns.md` already exists and records
the decision: the mixture of `timestamp` and `timestamptz` stays, because
converting reinterprets each stored value in the converting session's zone and
nothing in this repository sets `TZ` — so on an operator's own database the
conversion would silently shift rows.

**Do:** in `TODO.md`, replace the item-11 bullet with a pointer to that ADR, and
add a line to the item-10 bullet's replacement noting that dropping the dead
`filaments` columns was safe precisely because no value could be
misinterpreted.

**Do not** write the conversion migration. Do not add a `TZ` setting to the
Dockerfile as a "small first step" — the ADR explains why a pin only helps for
rows written after it, and doing half of it now would make the remaining half
harder to reason about.

**Verify:** `npm run check`.

---

## When the branch is finished

1. `npm test` and `npm run check` from a clean tree.
2. `npx tsx scripts/verify-upgrade.ts` once more on the final state.
3. `TODO.md` should have items 4, 6, 7, 9, 10 removed and items 8 and 11
   replaced by the decision notes described above. Item 5 stays, updated to
   point at its own plan.

If any step cannot be completed, stop and say which one and why. Do not work
around a failing `verify-upgrade` by adjusting what it checks.

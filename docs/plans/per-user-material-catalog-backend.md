# Implementation plan: per-user material catalog (backend)

This closes `TODO.md`'s **"Filaments duplicate catalog names as free text"**
(item 5). It is phase 1 of two. This phase changes no user-visible behaviour: at
the end of it, every declared material resolves to a Catalog Material, and
nothing looks different. Phase 2
(`docs/plans/per-user-material-catalog-ui.md`) makes it visible.

**Read these first, in order:**
1. `CONTEXT.md` — defines Spool, Filament Type, declared material, Catalog
   Material, Global Catalog, Personal Catalog, Resolve. This plan uses those
   words precisely and they are not interchangeable.
2. `docs/adr/0003-per-user-material-catalog.md` — the decision, the three
   rejected alternatives, and the consequences. If something below looks
   arbitrary, the reason is in there.

## What is actually being fixed

A Spool's declared material is text on `filament_types.material`. A Catalog
Material is a row in `materials`. Nothing links them, so
`server/utils/materials.ts` matches them by name. When a declared material
matches nothing, the Spool can never be shared per-material and never produces a
drying reminder — and the owner is never told why.

**The fix is not a foreign key.** `filament_types.material` stays text. The fix
is to guarantee the row exists: a declared material that resolves to nothing is
registered into that user's Personal Catalog. The ADR explains why the FK was
rejected (it breaks filament creation outright on a fresh install, where the
catalog is empty).

Note also that the TODO describes this against the wrong table — it says
`insertFilamentSchema` takes `material: z.string()` as though material lived on
`filaments`. It lives on `filament_types` (`shared/schema.ts:52`), which
**already has a `userId`** (`shared/schema.ts:50`). That is why per-user scoping
is a smaller change than the TODO implies.

## Ground rules

- **Every commit ends green**: `npm test` and `npm run check`.
- **Phase 1 is behaviour-preserving from a user's point of view.** If an
  existing test in `tests/` needs editing, stop and say so — that is a signal
  you have changed observable behaviour, which belongs in phase 2.
- Tests are characterisation-style; read `tests/README.md`.
- Case-insensitive comparison goes through `eqIgnoreCase`
  (`server/db/predicates.ts`) and nowhere else. That file exists because
  "does this exist" and "can this be found" disagreed once already.

---

## Commit 1 — `materials` gains an owner

**Do:**
1. In `shared/schema.ts`, add to the `materials` table (around line 283):
   ```ts
   userId: t.fk("user_id"),   // NULL = Global Catalog; set = that user's Personal Catalog
   ```
   with a `foreignKey` in the table extras named `materials_user_id_fkey`,
   referencing `users.id`, `onDelete("cascade")`. Follow the pattern at
   `shared/schema.ts:59-63` — foreign keys are declared in the extras rather
   than with `.references()` so the constraint can be named. `shared/columns.ts`
   explains why the names matter.

2. Replace the uniqueness rule. `materials_name_key` is a plain global
   `UNIQUE(name)` (`shared/schema.ts:285`) and cannot express what is now
   needed: unique within the Global Catalog, and unique within each Personal
   Catalog, case-insensitively. Drop `.unique("materials_name_key")` from the
   column and add two partial unique indexes in the extras:
   ```ts
   uniqueIndex("materials_global_name_lower_idx")
     .on(sql`lower(${table.name})`).where(sql`${table.userId} IS NULL`),
   uniqueIndex("materials_user_name_lower_idx")
     .on(table.userId, sql`lower(${table.name})`).where(sql`${table.userId} IS NOT NULL`),
   ```
   Two partial indexes rather than one on `(user_id, lower(name))` because SQL
   NULLs do not conflict with each other, so a single index would let the Global
   Catalog hold duplicates. Follow the existing precedent at
   `shared/schema.ts:41`.

3. Generate the migration: `npm run db:generate`. **Read the generated SQL.**

4. **The generated migration is not sufficient and must be edited by hand.**
   Dropping `materials_name_key` for two case-insensitive indexes will fail on
   any install that already holds two materials differing only by case (`PETG`
   and `petg`). A migration that fails partway leaves the database with neither
   the old constraint nor the new indexes. Add a guard *before* the index
   creation that detects collisions and raises with a message naming the
   offending rows:
   ```sql
   DO $$
   DECLARE conflict text;
   BEGIN
     SELECT string_agg(DISTINCT lower(name), ', ') INTO conflict
       FROM materials GROUP BY lower(name) HAVING count(*) > 1;
     IF conflict IS NOT NULL THEN
       RAISE EXCEPTION 'Cannot add case-insensitive material uniqueness: duplicate names exist (%). Merge or rename them, then re-run.', conflict;
     END IF;
   END $$;
   ```
   Refusing is correct here. Guessing which of two rows to keep would silently
   discard a density or a hygroscopic flag, and `user_sharing.material_id`
   points at one of them.

**Verify:**
- `npm test` — nothing should need changing yet.
- `npx tsx scripts/verify-upgrade.ts` (needs Docker). This is what proves the
  migration. Do not report the commit done without it.
- Manually: on a scratch database, insert `PETG` and `petg`, run the migration,
  confirm it aborts with the message and that `materials_name_key` is still
  present afterwards.

---

## Commit 2 — Resolution, in one place

`server/utils/materials.ts` currently exposes `isOneOfMaterials`, a
name-set-based predicate. Resolution now needs the user, needs to check the
Personal Catalog before the Global one, and needs to return the row rather than
a boolean.

**Do:**
1. Add `storage.resolveMaterial(userId: number, declared: string):
   Promise<Material | undefined>` to `IStorage` and `DatabaseStorage`
   (near the other material methods, `server/storage.ts:325-330` and `:929`ff).
   It selects from `materials` where the name matches `declared` via
   `eqIgnoreCase` **and** (`user_id = userId` OR `user_id IS NULL`), ordering so
   that the user's own row wins when both exist. One query, not two.
2. Change `getMaterials()` to `getMaterials(userId: number)`, returning the
   Global Catalog plus that user's Personal Catalog, keeping the existing
   `orderBy(sortOrder, name)`.
3. Change `getHygroscopicMaterialNames()` to take a `userId` and scope the same
   way.
4. Rewrite the module comment in `server/utils/materials.ts`. It currently says
   the underlying duplication is *not* fixed and points at `TODO.md`. After this
   phase that is no longer true, and a stale comment here is worse than none —
   this file exists specifically to be the one place the matching rule lives.

**Do not** delete `isOneOfMaterials` in this commit if callers still need it;
commit 4 removes its last caller.

**Verify:** `npm run check` will list every call site that now needs a `userId`.
Work through them; do not add a default value to make the errors go away.

---

## Commit 3 — Auto-registration on find-or-create

**Do:**
1. In `findOrCreateFilamentType` (`server/storage.ts:159`), before the Filament
   Type is created or found, resolve the declared material for that `userId`. If
   it resolves to nothing, insert a Catalog Material with `user_id = userId`,
   `name` exactly as the user typed it, `density` NULL and `is_hygroscopic`
   false. The ADR records why those defaults, and phase 2 makes the resulting
   row visible.
2. This fires on **every** path through find-or-create — manual create
   (`storage.ts:741`), edit (`storage.ts:762`), CSV import and the
   Spoolman-compat import. That is deliberate: CSV import is the most likely way
   to meet an unknown material, and the row lands in the importing user's own
   catalog where they can delete it.
3. Handle the race. Two concurrent requests declaring the same new material will
   both resolve to nothing and both insert; the partial unique index makes the
   second fail. Insert with `onConflictDoNothing()` and re-resolve, rather than
   letting the request 500.

**Verify:** new tests. `tests/routes/filaments.ts` has no test file yet — create
`tests/routes/filaments.test.ts` following the shape of
`tests/routes/public.test.ts`:
- creating a Spool with a material not in any catalog leaves a `materials` row
  owned by that user, with `density` NULL and `is_hygroscopic` false;
- a second user creating a Spool with the same material name gets **their own**
  row, and neither user's `GET /api/materials` shows the other's;
- declaring `petg` when the Global Catalog holds `PETG` creates **nothing** and
  resolves to the global row;
- declaring a material that is already in the user's Personal Catalog creates
  nothing.

---

## Commit 4 — Per-user hygroscopy in the scheduled checks

`runScheduledChecks` reads the hygroscopic names **once, before the per-user
loop** (`server/utils/notification-checks.ts:22`). With Personal Catalogs that
is a bug: one user marking a private material hygroscopic would start flagging
every user's Spools.

**Do:**
1. Move the lookup inside the `for (const user of allUsers)` loop, scoped to
   `user.id`, and only where `user.notifyDryingReminder` is set — there is no
   reason to query for users who have the reminder off.
2. Replace the `isOneOfMaterials` call with the per-user set. If nothing else
   calls `isOneOfMaterials` afterwards, delete it and reduce
   `server/utils/materials.ts` to what remains.
3. Keep the comment at `notification-checks.ts:29-31` explaining why filaments
   are read via storage rather than a raw query. It is still true and still
   worth knowing.

**Verify:** extend `tests/utils/notification-checks.test.ts`: two users, each
with a Spool of a same-named material, where only user A's Personal Catalog
entry is hygroscopic. Only user A is emailed a drying reminder.

---

## Commit 5 — User-scoping as a capability of the CRUD factory

`server/utils/settings-crud.ts` serves five entities through one 201-line
factory. Special-casing `materials` inside it is how that abstraction starts
rotting. Make scoping a declared capability instead.

**Do:**
1. Add an optional `userScoped?: true` to `CrudEntityConfig`, and change the
   `storage` callbacks it affects to take a `userId`. Only `materials` sets it;
   the other four configs in `server/routes/settings.ts` are unchanged.
2. When `userScoped` is set:
   - `GET` lists the Global Catalog plus the caller's Personal Catalog.
   - `POST` stays admin-only and creates into the **Global** Catalog. Users do
     not create Catalog Materials directly — they either declare one on a Spool,
     which auto-registers it, or submit a Catalog Request. The comment at
     `settings-crud.ts:74-76` explains this rule; extend it rather than
     replacing it.
   - `DELETE` lets a user delete a row they own; deleting a global row stays
     admin-only. The existing `isInUse` check applies unchanged — a Catalog
     Material in use by one of the caller's Spools cannot be deleted.
   - Reorder (`updateOrder`) stays admin-only and global. Personal Catalog
     entries sort by name after the global ones.
3. `isInUse` for materials (`server/routes/settings.ts:70`) compares
   `filament.material === item.name` — a case-sensitive comparison of a declared
   material against a Catalog Material name. Now that resolution is
   case-insensitive, this disagrees with it. Make it use the same rule.

**Do not** touch the `manufacturers`, `colors`, `diameters` or
`storageLocations` configs. If a change to the factory forces an edit to one of
them, the seam is in the wrong place — reconsider before proceeding.

**Verify:** new `tests/routes/settings.test.ts` covering material CRUD under
scoping: a non-admin sees global + own and not another user's; a non-admin can
delete their own but not a global one; `POST /api/materials` is still 403 for a
non-admin. Confirm the other four entities' behaviour is untouched.

---

## Commit 6 — Catalog Requests, unchanged but documented

The Catalog Request flow (`server/routes/catalog-requests.ts`) still works: a
user proposes an addition, an admin approves, and `storage.createMaterial` makes
it. Under this design that creates a **Global** Catalog Material, which is
correct — a curated global PETG with a real density is still worth requesting
even though the user could declare one privately.

**Do:**
1. Confirm `ENTITY_CONFIG.material.create` (`catalog-requests.ts:22`) still
   creates globally after commit 5's signature changes. If `createMaterial` now
   requires a `userId`, pass `null` explicitly rather than defaulting it.
2. Add a comment at that line recording that approval creates into the Global
   Catalog deliberately, and that promoting an existing Personal Catalog entry
   is **not** built — see the ADR's last consequence.
3. Update `TODO.md`'s item 5: replace it with a note that the decision is
   recorded in `docs/adr/0003-per-user-material-catalog.md`, that phase 1 is
   this plan and phase 2 is the UI plan, and keep the open question of promotion
   as a new, smaller entry.

**Verify:** `tests/routes/catalog-requests.test.ts` must pass unchanged —
approving a material request still produces a globally visible material.

---

## When phase 1 is finished

1. `npm test` and `npm run check` from a clean tree.
2. `npx tsx scripts/verify-upgrade.ts`.
3. Confirm the promise of this phase held: **no existing test needed editing.**
   If one did, say which and why in the handover — it means something
   user-visible changed a phase early.
4. Stop here. Phase 2 is a separate branch. This is a safe place to deploy and
   watch a real database before touching the UI.

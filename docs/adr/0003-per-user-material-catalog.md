---
status: accepted
date: 2026-09-03
---

# A material a user declares always resolves to a Catalog Material

A spool's declared material is text the user typed
(`filament_types.material`), while a Catalog Material is a row in `materials`.
Nothing linked them, so they were matched by name — and a spool whose material
had no matching row could never be shared per-material and never produced a
drying reminder, with nothing telling the owner why. We are closing that by
guaranteeing the row exists: a declared material the catalogs do not already
hold is registered into the declaring user's **Personal Catalog**, alongside the
admin-curated **Global Catalog** that every user sees.

Note that this keeps `filament_types.material` as text. The defect was never
that the column is text; it was that the text could point at nothing.

## Considered options

**Make `material` a foreign key.** Ends free-text entry, breaks CSV import of
unknown materials, and breaks filament creation outright on a fresh install,
where the catalog starts empty. Rejected: it turns a missing row from a silent
degradation into a hard failure, at the moment a new user is least able to fix
it.

**Auto-register into the existing global `materials` table.** Keeps free-text
entry and is a small change, but `materials` is global, so one user's typo
appears in every user's dropdown — and it hollows out the Catalog Request flow,
which exists so that additions to the shared catalog are reviewed. Rejected on
the pollution alone.

**Replace the global catalog with per-user copies.** Requires copying the
curated catalog into every user's namespace on migration and rewriting every
`user_sharing.material_id` to the copy, and leaves the Catalog Request flow with
no purpose. Rejected: the FK rewrite is the kind of migration that fails
quietly, and it discards admin curation for no gain.

**Global base plus Personal Catalogs (chosen).** `materials` gains a nullable
`user_id`, where `NULL` means global. No data moves and no foreign key is
rewritten. A typo is scoped to the user who made it, where they can see and
delete it. Admin curation and the Catalog Request flow both keep their meaning.

## Consequences

**A user's typo becomes a row in their own catalog.** This is the accepted cost.
It is visible to them, deletable by them, and invisible to everyone else — which
is the whole reason for choosing per-user scoping over the global table.

**Hygroscopy becomes a per-user lookup.** `runScheduledChecks` currently reads
the hygroscopic material names once, before the per-user loop
(`server/utils/notification-checks.ts:22`). Left alone, one user marking a
private material hygroscopic would start flagging every user's spools. The
lookup has to move inside the loop.

**`materials` stops being interchangeable with the other four settings
entities.** `manufacturers`, `colors`, `diameters` and `storage_locations` share
one CRUD factory with `materials`, and that factory is a deep module precisely
because all five go through it identically. Rather than special-casing one
entity, user-scoping becomes a declared capability in the factory's config, so
the second entity to need it does not add a second special case.

**Uniqueness gets more complicated.** `materials_name_key` is a plain global
`UNIQUE(name)` and cannot express "unique within the Global Catalog, and unique
within each Personal Catalog, case-insensitively". It is replaced by two partial
unique indexes on `LOWER(name)`. Since resolution is case-insensitive and
uniqueness must agree with it, both go through `eqIgnoreCase` in
`server/db/predicates.ts` rather than spelling out caseless comparison a third
time.

**Promotion is not built.** A user cannot yet ask for their Personal Catalog
Material to be moved into the Global Catalog; the existing Catalog Request flow
still works and is unchanged, so the path is open, just manual. Worth revisiting
once we know whether anyone uses it.

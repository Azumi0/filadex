# Implementation plan: per-user material catalog (UI)

Phase 2 of `TODO.md` item 5. **Do not start this until
`docs/plans/per-user-material-catalog-backend.md` is complete, merged and has
run against a real database.**

Read `CONTEXT.md` and `docs/adr/0003-per-user-material-catalog.md` first.

## What phase 1 left undone

After phase 1, every declared material resolves to a Catalog Material, so a
Spool can always be shared per-material and can always be flagged for drying.
But an auto-registered Catalog Material has `density` NULL and
`is_hygroscopic` false, so the drying reminder still will not fire for it — and
the owner is still not told why.

That is the whole job of this phase. Without it we have replaced *"cannot be
flagged, and you have no idea why"* with *"could be flagged, but isn't, and you
have no idea why"*, which is barely an improvement. The ADR records this as the
reason the UI signal was made part of the decision rather than an optional
extra.

## Ground rules

- This phase **does** change observable behaviour. Tests that need editing are
  expected here — but each such edit belongs in the same commit as the change
  that causes it, never folded into anything else (`tests/README.md`).
- Every user-facing string goes through i18n, in **both** `en.ts` and `de.ts`
  (`client/src/i18n/locales/`). Read `docs/TRANSLATION_GUIDE.md`. A missing
  German string shows the raw key to the user — this has been a bug before, see
  the "Missing Translation" entry in `TODO.md`.
- Match the surrounding component style. Do not introduce a new UI pattern for
  this.

---

## Commit 1 — The API says whether a Catalog Material needs attention

The client cannot tell an auto-registered row from a curated one, and should not
have to infer it from `density === null`.

**Do:**
1. Have `GET /api/materials` distinguish the three cases the UI needs: a Global
   Catalog entry, a Personal Catalog entry that has been filled in, and a
   Personal Catalog entry still carrying the auto-registration defaults. Prefer
   returning the facts (`userId`, `density`, `isHygroscopic`) and letting the
   client decide, over inventing a status enum — the facts are already there and
   an enum would be a second source of truth.
2. Document the shape in `docs/API.md` under the materials endpoint, including
   that a caller sees global entries plus their own.

**Verify:** extend `tests/routes/settings.test.ts` (created in phase 1) to
assert the response shape for each of the three cases.

---

## Commit 2 — Surface unattended materials in settings

`client/src/components/settings/settings-materials.tsx` renders the materials
list inside the settings dialog.

**Do:**
1. Mark Personal Catalog entries that still hold the auto-registration defaults
   as needing attention, and say what setting them buys: a density makes
   weight/length conversion work, and the hygroscopic flag is what enables
   drying reminders for Spools of that material. Do not just show a warning
   icon — the complaint being fixed is that the user was never told *why*
   something did not happen.
2. Let the owner edit `density` and `isHygroscopic` on their own entries. This
   is the point of per-user scoping: the user now has a row to point at.
   Global entries stay admin-only.
3. Show which entries are the user's own versus the shared catalog, so deleting
   one is not alarming.

**Verify:** run the app (`npm run dev`), declare a Spool with a material name
that is in neither catalog, and confirm it appears in settings marked as needing
attention, is editable, and that setting `isHygroscopic` makes the drying
reminder apply to that Spool.

---

## Commit 3 — Explain it where the consequence is felt

A user who wonders why a Spool is not shared or not reminded is looking at the
Spool or at the sharing modal, not at the settings dialog.

**Do:**
1. In `client/src/components/sharing-modal.tsx`, which lists materials to share
   per-material: it now lists the user's own entries too, so a Spool can always
   be shared. Confirm this works and that nothing in the modal assumed a global
   catalog.
2. Where a drying reminder is configured, note that reminders apply only to
   materials marked hygroscopic, and link to the materials settings.

**Verify:** manual, plus check that
`client/src/components/filter-sidebar.tsx:96-125` — which filters the materials
list down to those actually used by the user's Spools — still behaves. It
queries `/api/materials`, whose contents changed in phase 1.

---

## When phase 2 is finished

1. `npm test` and `npm run check`.
2. Both locale files complete — grep for any new key in `en.ts` and confirm it
   exists in `de.ts`.
3. Remove item 5 from `TODO.md`, leaving only the smaller follow-up entry about
   promoting a Personal Catalog Material into the Global Catalog.

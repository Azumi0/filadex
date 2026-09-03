# Filadex TODO List

This document contains a list of pending tasks and improvements for the Filadex application.

## User Interface Improvements

### Sharing Page
- [x] **Fix Back Button**: The back button on the sharing page view currently has no function. Implement proper navigation back to the previous page.
- [x] **Display Sharing User**: Add the username of the user who is sharing the filaments to the sharing page view to provide better context.

### Menu and Navigation
- [x] **Menu Structure Cleanup**: Reorganize the menu to have fewer buttons and a more logical structure. Consider grouping related functions.
- [x] **List Menu Icon**: Change the icon of the list menu button from the settings icon to a list icon for better visual representation.

### Filtering and Sorting
- [x] **Reorder Filter Bar**: Change the order of filters in the filament filter bar from "material, vendor, color" to "vendor, material, color" for a more logical flow.

### View Options
- [x] **Table View for Filaments**: Add a table/list view with columns as an alternative to the grid view. Include:
  - Column-based sorting functionality
  - Toggle switch between grid and table views
  - Maintain the current grid view as the default option
  - Ensure the table view shows all relevant filament data in a structured format with sortable columns

## Translations and Text

- [x] **German Translation Fix**: Change the German translation for "spooled" from the current text to "mit Spule" for better accuracy.
- [x] **Missing Translation**: Add missing translation for "filaments.spools" in all languages, which currently shows the key instead of the translated text in statistics.

## Data Management

- [x] **Empty Initial Lists**: When starting the application from scratch, all lists should be empty. Currently, there are prefilled entries. Modify the initialization process to only add data when explicitly requested.
- [x] **Filament Import/Export**: Implement functionality to import and export filament data:
  - Export all filaments to CSV or JSON format for backup purposes
  - Import filaments from CSV or JSON files
  - Provide validation for imported data
  - Handle duplicate detection during import

## Error Handling and Logging

- [x] **Unauthorized Access Errors**: Fix console error messages that appear when accessing the page while not logged in. These should be handled gracefully.
- [x] **General Error Cleanup**: Review and fix all other error messages or warnings that appear in the console to ensure a clean development environment.

## Technical Debt

- [ ] **Code Refactoring**: Identify and refactor any duplicated or complex code to improve maintainability.
- [ ] **Performance Optimization**: Review application performance, especially for larger filament collections, and optimize where necessary.
- [ ] **Test Coverage**: Increase test coverage for critical components and functionality.
- [ ] **Unused `IStorage.getPublicFilamentsWithUser`**: Nothing calls this method (`server/storage.ts`). It is close to what `GET /api/public/filaments/:userId` does, but it throws when the user does not exist where the route needs to answer 404, so `routes/public.ts` composes `getUser` + `getFilaments` itself instead. Decide one way or the other: give it a shape the route can actually use, or delete it. Left as-is it is unverified code that will drift from the behaviour it duplicates - the same trap `MemStorage` was in before it was removed.
- [ ] **Filaments duplicate catalog names as free text**: `insertFilamentSchema` takes `material: z.string()`, so a filament's material is free text while the catalog stores a row, and the two are matched by name (`server/utils/materials.ts` is the single place that does the matching). The consequence is that a spool whose material has no catalog row can never be shared per-material and never gets a drying reminder - there is nothing to point at or flag - and the owner is given no indication why. Closing this is a product decision, not a refactor:
  - Making `material` a foreign key would end free-text entry, break CSV import of unknown materials, and break filament creation entirely on a fresh install, where the catalog starts empty.
  - Auto-registering a material when a filament introduces one keeps free-text entry, but `materials` is a global table with no `userId`, so one user's typo would appear in every user's dropdown - and it undercuts the catalog-request flow, which exists so additions are reviewed.
  Note the catalog has no rename operation (create, delete and reorder only), so a rename cannot currently break an existing match.
- [ ] **Community filament search strips wildcards instead of escaping them**: `storage.searchCommunityFilaments` removes `%` and `_` from the query, so a search made only of wildcards collapses to an empty pattern and matches everything. Escaping them would be more predictable.
- [ ] **Two endpoints implement sharing**: `POST /api/user-sharing` and `POST /api/sharing` are the same feature with different semantics (replace vs. update-in-place, 201 vs. 200). They already diverged once into a bug where sharing could not be switched off. One of them should go.
- [ ] **Usernames are ASCII-only in a German-language product**: `usernameSchema` requires `^[a-zA-Z0-9_-]+$`, so `müller` cannot be registered. The rule has always bound self-registration; it now binds the admin endpoints too, which previously validated nothing, so an admin can no longer create such a name either. Existing accounts holding one still log in and can still be administered — the rules apply to a name being set, not one already held — but cannot be renamed except to an acceptable name. Whether to allow Unicode letters is a product decision: widening the regex is easy, but usernames are compared with `LOWER()` (`server/db/predicates.ts`), whose behaviour on non-ASCII depends on the database's collation - so uniqueness and login would need checking together, as they did the last time they disagreed.
- [ ] **Inconsistent password rules**: registration and password reset require 8 characters; change-password requires 6, so a user can register with 8 and immediately downgrade.
- [ ] **`filaments.created_at` / `filaments.updated_at` are dead columns**: created by `docker-entrypoint.sh` and never read or written by the application. They are declared in `shared/schema.ts` so it matches the deployed database, and excluded from the API-facing `Filament` type. Drop them once there is a migration path that can do it safely.
- [ ] **Timestamp columns are inconsistently typed**: the tables `docker-entrypoint.sh` creates use `timestamp with time zone`; everything added later by the migration scripts uses `timestamp without time zone`. `shared/schema.ts` now records both, because narrowing the former would discard each value's UTC offset and reinterpret it in the server's local zone. Worth unifying on `timestamptz` one day, with a migration that converts explicitly rather than by accident.
- [ ] **`PUT /api/settings/email` depends on a row it cannot create**: the email settings row is seeded by a migration, and the endpoint answers 500 if it is missing. It should upsert.
- [ ] **CONTRIBUTING.md claims lint tooling the repository does not have**: it states "All JavaScript code is linted with ESLint and formatted with Prettier", but there is no ESLint or Prettier config in the repository and neither is a dependency in `package.json`. Every rule under the JavaScript styleguide is therefore unenforceable - a contributor cannot run the check the guideline implies, and a reviewer has to apply those rules by hand. Two honest ways out: add ESLint and Prettier with a config that matches the code as it stands (and accept the first formatting commit will be large), or drop the claim and keep the styleguide as prose a human applies. Picking neither is what leaves the guideline lying.

## Documentation

- [x] **Update API Documentation**: Ensure all API endpoints are properly documented.
- [ ] **User Guide Updates**: Update the user guide to reflect recent changes and new features.
- [ ] **The documentation styleguide describes a notation nothing uses**: CONTRIBUTING.md asks that methods and classes be referenced with a custom `{}` notation (`{ClassName}`, `{ClassName.methodName}`), but no document in the repository does this - `docs/`, `README.md` and the ADRs all use backticks. So either the docs need a pass to adopt the notation, or the guideline should be changed to describe what is actually written. The second is probably right: the notation has no tooling behind it, so it buys nothing that backticks do not, and a rule every document ignores only teaches contributors that the guidelines are decorative.

## Future Enhancements (Backlog)

- [x] **Batch Operations**: Add functionality for batch operations on filaments (delete, update).
- [ ] **Filament Usage History**: Implement tracking of filament usage history.
- [ ] **Print Job Association**: Add ability to associate print jobs with filaments.
- [ ] **Enhanced Sharing Features**: Implement QR code generation, password protection, and temporary links for shared collections.

---

This TODO list is a living document and should be updated as tasks are completed or new requirements are identified.

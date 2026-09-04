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
- [ ] **Promoting a Personal Catalog Material into the Global Catalog**: a user cannot ask for their private material to be curated into the shared catalog. The Catalog Request flow still works and is the manual path (submit a fresh request for the same name); whether an explicit promotion is worth building is open - see the last consequence in `docs/adr/0003-per-user-material-catalog.md`.
- **Usernames are ASCII-only in a German-language product**: decided - the `^[a-zA-Z0-9_-]+$` rule stays. Case-insensitive uniqueness and login agree only while usernames stay ASCII, because `LOWER()` on non-ASCII depends on the deployed database's collation; widening the charset is a uniqueness-and-login question, not a regex change. Reasoning is recorded in the comment above `usernameSchema` in `shared/schema.ts`.
- **`filaments.created_at` / `filaments.updated_at` are dead columns**: done - dropped in generated migration `0002`. Safe where the general `timestamptz` unification below is not, precisely because these columns were written and read by nothing, so no stored value could be misinterpreted by removing them. See `docs/adr/0002-defer-unifying-timestamp-columns.md`.
- **Timestamp columns are inconsistently typed**: decided to defer - see `docs/adr/0002-defer-unifying-timestamp-columns.md`. `ALTER COLUMN ... TYPE timestamptz` reinterprets each stored value in the converting session's zone, and nothing here sets `TZ`, so on an operator's own database the conversion would silently shift rows. New timestamp columns should use `timestamptz`; the mixture is a fact about the deployed database, not a style choice.
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

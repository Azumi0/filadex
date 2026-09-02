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
- [ ] **Free-text material names are matched inconsistently**: A filament stores its material as free text while the catalog stores it as a row. Public sharing compares the two case-insensitively, but the hygroscopic check in `server/utils/notification-checks.ts` still uses exact equality, so a spool entered as `pla` never gets a drying reminder. The real fix is for filaments to reference the catalog rather than duplicate its names.
- [ ] **Community filament search strips wildcards instead of escaping them**: `storage.searchCommunityFilaments` removes `%` and `_` from the query, so a search made only of wildcards collapses to an empty pattern and matches everything. Escaping them would be more predictable.
- [ ] **Two endpoints implement sharing**: `POST /api/user-sharing` and `POST /api/sharing` are the same feature with different semantics (replace vs. update-in-place, 201 vs. 200). They already diverged once into a bug where sharing could not be switched off. One of them should go.
- [ ] **Inconsistent password rules**: registration and password reset require 8 characters; change-password requires 6, so a user can register with 8 and immediately downgrade.
- [ ] **`PUT /api/settings/email` depends on a row it cannot create**: the email settings row is seeded by a migration, and the endpoint answers 500 if it is missing. It should upsert.

## Documentation

- [x] **Update API Documentation**: Ensure all API endpoints are properly documented.
- [ ] **User Guide Updates**: Update the user guide to reflect recent changes and new features.

## Future Enhancements (Backlog)

- [x] **Batch Operations**: Add functionality for batch operations on filaments (delete, update).
- [ ] **Filament Usage History**: Implement tracking of filament usage history.
- [ ] **Print Job Association**: Add ability to associate print jobs with filaments.
- [ ] **Enhanced Sharing Features**: Implement QR code generation, password protection, and temporary links for shared collections.

---

This TODO list is a living document and should be updated as tasks are completed or new requirements are identified.

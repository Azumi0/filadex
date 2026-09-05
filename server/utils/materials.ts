/**
 * Matching a declared material against the catalog, ignoring case.
 *
 * A Spool's declared material is free text (`filament_types.material`); a
 * Catalog Material is a row in `materials`. Nothing links them, so the two are
 * matched by name - and every place that does this has to agree on how. They
 * did not: public sharing and the drying reminder each compared names their own
 * way, and each was a separate bug where a Spool silently failed to match.
 *
 * Resolution proper - case-insensitive, Personal Catalog before Global, and
 * guaranteeing the row exists - lives in `storage.resolveMaterial`, because it
 * needs the database. What is left here is the name-set predicate for callers
 * that have already loaded a set of catalog names: `server/routes/public.ts`
 * and the drying-reminder check in `server/utils/notification-checks.ts`.
 */

/**
 * A material name reduced to what the catalog actually matches on: surrounding
 * whitespace trimmed off, since it is not part of the name.
 *
 * A trailing space out of a CSV column or a paste is enough to make `" PETG"`
 * miss the curated `PETG` it obviously means, and the miss is silent - the
 * spool loses the curated density and the hygroscopic flag, and the owner's
 * Personal Catalog gains a row that looks identical to one already in the list.
 * The partial unique indexes cannot catch that, because `lower(name)` genuinely
 * differs between `"PETG"` and `" PETG"`.
 *
 * Case is deliberately not folded in here: the database compares names with
 * `LOWER()` (see `eqIgnoreCase`), so folding case in JS as well would mean two
 * spellings of the same rule.
 */
export function catalogName(name: string): string {
  return name.trim();
}

/**
 * Builds a test for whether a declared material is one of these catalog
 * material names, ignoring case.
 */
export function isOneOfMaterials(catalogNames: string[]): (material: string) => boolean {
  const names = new Set(catalogNames.map((name) => catalogName(name).toLowerCase()));
  return (material) => names.has(catalogName(material).toLowerCase());
}

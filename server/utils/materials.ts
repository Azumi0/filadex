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
 * that have already loaded a set of catalog names (`server/routes/public.ts`).
 */

/**
 * Builds a test for whether a declared material is one of these catalog
 * material names, ignoring case.
 */
export function isOneOfMaterials(catalogNames: string[]): (material: string) => boolean {
  const names = new Set(catalogNames.map((name) => name.toLowerCase()));
  return (material) => names.has(material.toLowerCase());
}

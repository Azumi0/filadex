/**
 * Matching a filament's material against the catalog.
 *
 * A filament records its material as free text, while the catalog stores a row
 * per material. Nothing links them, so the two are matched by name - and every
 * place that does this has to agree on how. They have not: public sharing and
 * the drying reminder each compared names their own way, and each was a
 * separate bug where a spool silently failed to match.
 *
 * This is the one place that decision lives. It does not fix the underlying
 * duplication - a filament whose material has no catalog row still cannot be
 * shared per-material or flagged as hygroscopic, because there is nothing to
 * point at. See TODO.md.
 */

/**
 * Builds a test for whether a filament's material is one of these catalog
 * materials, ignoring case.
 */
export function isOneOfMaterials(catalogNames: string[]): (material: string) => boolean {
  const names = new Set(catalogNames.map((name) => name.toLowerCase()));
  return (material) => names.has(material.toLowerCase());
}

import { type CommunityFilamentCacheEntry } from "@shared/schema";
import { storage, type NewCommunityFilament } from "../storage";
import { logger } from "./logger";

const REPO = "Donkie/SpoolmanDB";
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/main`;

interface SpoolmanDbColor {
  name: string;
  hex: string;
}

interface SpoolmanDbFilament {
  name: string;
  material: string;
  density?: number;
  diameters?: number[];
  extruder_temp?: number;
  bed_temp?: number;
  colors?: SpoolmanDbColor[];
}

interface SpoolmanDbVendorFile {
  manufacturer: string;
  filaments: SpoolmanDbFilament[];
}

async function fetchVendorFilePaths(): Promise<string[]> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/git/trees/main?recursive=1`);
  if (!res.ok) {
    throw new Error(`Failed to list SpoolmanDB tree: ${res.status} ${res.statusText}`);
  }
  const data = await res.json() as { tree: Array<{ path: string; type: string }> };
  return data.tree
    .filter((entry) => entry.type === "blob" && entry.path.startsWith("filaments/") && entry.path.endsWith(".json"))
    .map((entry) => entry.path);
}

async function fetchVendorFile(path: string): Promise<SpoolmanDbVendorFile | null> {
  const res = await fetch(`${RAW_BASE}/${path}`);
  if (!res.ok) {
    logger.warn(`Failed to fetch SpoolmanDB file ${path}: ${res.status}`);
    return null;
  }
  return await res.json() as SpoolmanDbVendorFile;
}

function toCacheRows(vendorFile: SpoolmanDbVendorFile): NewCommunityFilament[] {
  const rows: NewCommunityFilament[] = [];
  const diameter = (filament: SpoolmanDbFilament) => filament.diameters?.[0]?.toString();

  for (const filament of vendorFile.filaments) {
    const colors = filament.colors && filament.colors.length > 0 ? filament.colors : [{ name: "Unknown", hex: "" }];
    for (const color of colors) {
      // SpoolmanDB's `name` field is a template that's documented to contain
      // the literal placeholder `{color_name}` for products named after
      // their color (e.g. Bambu Lab's Basic PLA line).
      const name = filament.name.replace("{color_name}", color.name);
      rows.push({
        manufacturer: vendorFile.manufacturer,
        material: filament.material,
        name,
        colorName: color.name,
        colorCode: color.hex ? `#${color.hex.replace(/^#/, "")}` : null,
        density: filament.density?.toString(),
        diameter: diameter(filament),
        extruderTemp: filament.extruder_temp,
        bedTemp: filament.bed_temp,
      });
    }
  }
  return rows;
}

/**
 * Fetches every vendor filament profile from SpoolmanDB and replaces the
 * local cache with the fresh set. Admin-triggered (see
 * POST /api/community-filaments/refresh) rather than automatic - this hits
 * an external repo, and an operator should decide when that happens.
 */
export async function refreshCommunityFilamentCache(): Promise<number> {
  const paths = await fetchVendorFilePaths();
  logger.info(`Refreshing community filament cache from ${paths.length} SpoolmanDB vendor files...`);

  const allRows: NewCommunityFilament[] = [];
  for (const path of paths) {
    const vendorFile = await fetchVendorFile(path);
    if (vendorFile) {
      allRows.push(...toCacheRows(vendorFile));
    }
  }

  await storage.replaceCommunityFilaments(allRows);

  logger.info(`Community filament cache refreshed: ${allRows.length} entries`);
  return allRows.length;
}

export async function searchCommunityFilaments(query: string, limit = 20): Promise<CommunityFilamentCacheEntry[]> {
  return await storage.searchCommunityFilaments(query, limit);
}

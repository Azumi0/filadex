import {
  filaments, type InsertFilament,
  filamentTypes, type Filament,
  manufacturers, type Manufacturer, type InsertManufacturer,
  materials, type Material, type InsertMaterial,
  colors, type Color, type InsertColor,
  diameters, type Diameter, type InsertDiameter,
  storageLocations, type StorageLocation, type InsertStorageLocation,
  filamentUsageLog, type FilamentUsageLog,
  customFieldDefinitions, type CustomFieldDefinition, type InsertCustomFieldDefinition,
  apiTokens, type ApiToken
} from "@shared/schema";
import { users, type User, type InsertUser } from "@shared/schema";
import { db } from "./db";
import { eq, sql, and, inArray, desc, isNull } from "drizzle-orm";
import { logger } from "./utils/logger";

export interface InsertFilamentUsageLog {
  filamentId: number;
  userId: number;
  deltaWeight: string;
  remainingPercentageAfter: string;
  note?: string;
  source?: string;
}

type FilamentTypeFieldsInput = {
  manufacturer?: string | null;
  material: string;
  colorName: string;
  colorCode?: string | null;
  diameter?: string | null;
  printTemp?: string | null;
};

// Finds an existing filamentTypes row matching all product-identity fields
// exactly (nulls included), or creates one. This is the whole "dedup" payoff
// of the filament-type/spool-instance split: identical spools bought again
// reuse the same type row instead of duplicating manufacturer/material/etc.
async function findOrCreateFilamentType(userId: number, fields: FilamentTypeFieldsInput): Promise<number> {
  const manufacturer = fields.manufacturer ?? null;
  const colorCode = fields.colorCode ?? null;
  const diameter = fields.diameter ?? null;
  const printTemp = fields.printTemp ?? null;

  const conditions = [
    eq(filamentTypes.userId, userId),
    eq(filamentTypes.material, fields.material),
    eq(filamentTypes.colorName, fields.colorName),
    manufacturer !== null ? eq(filamentTypes.manufacturer, manufacturer) : isNull(filamentTypes.manufacturer),
    colorCode !== null ? eq(filamentTypes.colorCode, colorCode) : isNull(filamentTypes.colorCode),
    diameter !== null ? eq(filamentTypes.diameter, diameter) : isNull(filamentTypes.diameter),
    printTemp !== null ? eq(filamentTypes.printTemp, printTemp) : isNull(filamentTypes.printTemp),
  ];

  const [existing] = await db.select().from(filamentTypes).where(and(...conditions));
  if (existing) return existing.id;

  const [created] = await db.insert(filamentTypes).values({
    userId,
    manufacturer,
    material: fields.material,
    colorName: fields.colorName,
    colorCode,
    diameter,
    printTemp,
  }).returning();
  return created.id;
}

// Selection shape shared by every filament read - the spool instance's own
// columns plus its filament type's product-identity columns, flattened into
// the API-facing `Filament` shape.
const FILAMENT_SELECT_COLUMNS = {
  id: filaments.id,
  userId: filaments.userId,
  filamentTypeId: filaments.filamentTypeId,
  name: filaments.name,
  totalWeight: filaments.totalWeight,
  remainingPercentage: filaments.remainingPercentage,
  purchaseDate: filaments.purchaseDate,
  purchasePrice: filaments.purchasePrice,
  status: filaments.status,
  spoolType: filaments.spoolType,
  dryerCount: filaments.dryerCount,
  lastDryingDate: filaments.lastDryingDate,
  storageLocation: filaments.storageLocation,
  lowStockNotifiedAt: filaments.lowStockNotifiedAt,
  dryingReminderNotifiedAt: filaments.dryingReminderNotifiedAt,
  customFieldValues: filaments.customFieldValues,
  manufacturer: filamentTypes.manufacturer,
  material: filamentTypes.material,
  colorName: filamentTypes.colorName,
  colorCode: filamentTypes.colorCode,
  diameter: filamentTypes.diameter,
  printTemp: filamentTypes.printTemp,
};

// Modify the interface with any CRUD methods
// you might need
export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Filament operations
  getFilaments(userId: number): Promise<Filament[]>;
  getPublicFilamentsWithUser(userId: number, filterFn?: (filament: Filament) => boolean): Promise<{filaments: Filament[], user: {id: number, username: string}}>;
  getFilament(id: number, userId: number): Promise<Filament | undefined>;
  createFilament(filament: InsertFilament): Promise<Filament>;
  updateFilament(id: number, filament: Partial<InsertFilament>, userId: number): Promise<Filament | undefined>;
  deleteFilament(id: number, userId: number): Promise<boolean>;

  // Batch filament operations
  batchDeleteFilaments(ids: number[], userId: number): Promise<number>;
  batchUpdateFilaments(ids: number[], updates: Partial<InsertFilament>, userId: number): Promise<number>;

  // Filament usage log
  getFilamentUsageLog(filamentId: number, userId: number): Promise<FilamentUsageLog[]>;
  createFilamentUsageLog(entry: InsertFilamentUsageLog): Promise<FilamentUsageLog>;

  // Custom field definitions
  getCustomFieldDefinitions(userId: number): Promise<CustomFieldDefinition[]>;
  createCustomFieldDefinition(userId: number, definition: InsertCustomFieldDefinition): Promise<CustomFieldDefinition>;
  deleteCustomFieldDefinition(id: number, userId: number): Promise<boolean>;

  // API tokens
  getApiTokens(userId: number): Promise<ApiToken[]>;
  createApiToken(userId: number, tokenHash: string, label: string | undefined): Promise<ApiToken>;
  deleteApiToken(id: number, userId: number): Promise<boolean>;
  getUserIdByTokenHash(tokenHash: string): Promise<number | undefined>;
  touchApiTokenLastUsed(id: number): Promise<void>;

  // Manufacturer operations
  getManufacturers(): Promise<Manufacturer[]>;
  createManufacturer(manufacturer: InsertManufacturer): Promise<Manufacturer>;
  deleteManufacturer(id: number): Promise<boolean>;
  updateManufacturerOrder(id: number, newOrder: number): Promise<Manufacturer | undefined>;

  // Material operations
  getMaterials(): Promise<Material[]>;
  createMaterial(material: InsertMaterial): Promise<Material>;
  deleteMaterial(id: number): Promise<boolean>;
  updateMaterialOrder(id: number, newOrder: number): Promise<Material | undefined>;

  // Color operations
  getColors(): Promise<Color[]>;
  createColor(color: InsertColor): Promise<Color>;
  deleteColor(id: number): Promise<boolean>;

  // Diameter operations
  getDiameters(): Promise<Diameter[]>;
  createDiameter(diameter: InsertDiameter): Promise<Diameter>;
  deleteDiameter(id: number): Promise<boolean>;

  // Storage Location operations
  getStorageLocations(): Promise<StorageLocation[]>;
  createStorageLocation(location: InsertStorageLocation): Promise<StorageLocation>;
  deleteStorageLocation(id: number): Promise<boolean>;
  updateStorageLocationOrder(id: number, newOrder: number): Promise<StorageLocation | undefined>;
}

// Database Storage implementation using PostgreSQL
export class DatabaseStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
  }

  // Filament implementations
  async getFilaments(userId: number): Promise<Filament[]> {
    return await db.select(FILAMENT_SELECT_COLUMNS).from(filaments)
      .innerJoin(filamentTypes, eq(filaments.filamentTypeId, filamentTypes.id))
      .where(eq(filaments.userId, userId));
  }

  async getPublicFilamentsWithUser(userId: number, filterFn?: (filament: Filament) => boolean): Promise<{filaments: Filament[], user: {id: number, username: string}}> {
    // Get user information
    const [user] = await db.select({
      id: users.id,
      username: users.username
    }).from(users).where(eq(users.id, userId));

    if (!user) {
      throw new Error(`User with ID ${userId} not found`);
    }

    logger.debug(`Getting public filaments for user: ${user.username} (ID: ${userId})`);

    // Get filaments
    const allFilaments = await this.getFilaments(userId);

    // Apply filter if provided
    const filteredFilaments = filterFn ? allFilaments.filter(filterFn) : allFilaments;

    logger.debug(`Found ${filteredFilaments.length} public filaments for user ${user.username}`);

    // Return filaments with user information
    return {
      filaments: filteredFilaments,
      user: {
        id: user.id,
        username: user.username
      }
    };
  }

  async getFilament(id: number, userId: number): Promise<Filament | undefined> {
    try {
      const [filament] = await db.select(FILAMENT_SELECT_COLUMNS).from(filaments)
        .innerJoin(filamentTypes, eq(filaments.filamentTypeId, filamentTypes.id))
        .where(and(eq(filaments.id, id), eq(filaments.userId, userId)));

      return filament || undefined;
    } catch (err) {
      logger.error(`Error in getFilament:`, err);
      throw err;
    }
  }

  async createFilament(insertFilament: InsertFilament): Promise<Filament> {
    const { manufacturer, material, colorName, colorCode, diameter, printTemp, ...spoolFields } = insertFilament;
    if (spoolFields.userId == null) {
      throw new Error("createFilament requires a userId");
    }

    const filamentTypeId = await findOrCreateFilamentType(spoolFields.userId, {
      manufacturer, material, colorName, colorCode, diameter, printTemp,
    });
    const [created] = await db.insert(filaments).values({ ...spoolFields, filamentTypeId }).returning();

    const result = await this.getFilament(created.id, spoolFields.userId);
    if (!result) throw new Error("Failed to load newly created filament");
    return result;
  }

  async updateFilament(id: number, updateFilament: Partial<InsertFilament>, userId: number): Promise<Filament | undefined> {
    try {
      const existing = await this.getFilament(id, userId);
      if (!existing) return undefined;

      const { manufacturer, material, colorName, colorCode, diameter, printTemp, ...spoolFields } = updateFilament;
      const typeFieldsChanged = [manufacturer, material, colorName, colorCode, diameter, printTemp]
        .some((value) => value !== undefined);

      const dbUpdate: Partial<typeof filaments.$inferInsert> = { ...spoolFields };
      if (typeFieldsChanged) {
        dbUpdate.filamentTypeId = await findOrCreateFilamentType(userId, {
          manufacturer: manufacturer !== undefined ? manufacturer : existing.manufacturer,
          material: material !== undefined ? material : existing.material,
          colorName: colorName !== undefined ? colorName : existing.colorName,
          colorCode: colorCode !== undefined ? colorCode : existing.colorCode,
          diameter: diameter !== undefined ? diameter : existing.diameter,
          printTemp: printTemp !== undefined ? printTemp : existing.printTemp,
        });
      }

      const [updated] = await db
        .update(filaments)
        .set(dbUpdate)
        .where(and(eq(filaments.id, id), eq(filaments.userId, userId)))
        .returning();

      if (!updated) return undefined;
      return await this.getFilament(id, userId);
    } catch (err) {
      logger.error(`Error in updateFilament:`, err);
      throw err;
    }
  }

  async deleteFilament(id: number, userId: number): Promise<boolean> {
    const [deleted] = await db
      .delete(filaments)
      .where(and(eq(filaments.id, id), eq(filaments.userId, userId)))
      .returning();
    return !!deleted;
  }

  // Batch operations
  async batchDeleteFilaments(ids: number[], userId: number): Promise<number> {
    // Convert all IDs to numbers to ensure they're valid
    const validIds = ids.map(id => Number(id));

    // Use the in operator from drizzle instead of raw SQL
    const deleted = await db
      .delete(filaments)
      .where(
        and(
          inArray(filaments.id, validIds),
          eq(filaments.userId, userId)
        )
      )
      .returning();

    logger.info(`Batch deleted ${deleted.length} filaments with IDs:`, validIds);
    return deleted.length;
  }

  async batchUpdateFilaments(ids: number[], updates: Partial<InsertFilament>, userId: number): Promise<number> {
    // Convert all IDs to numbers to ensure they're valid
    const validIds = ids.map(id => Number(id));

    // Applied one at a time (not a single bulk UPDATE): each filament may
    // need its own filamentType resolved/created if the update touches a
    // product-identity field (manufacturer/material/colorName/etc.) - see
    // updateFilament's find-or-create logic.
    let updatedCount = 0;
    for (const id of validIds) {
      const updated = await this.updateFilament(id, updates, userId);
      if (updated) updatedCount++;
    }

    logger.info(`Batch updated ${updatedCount} filaments with IDs:`, validIds);
    return updatedCount;
  }

  // Filament usage log implementations
  async getFilamentUsageLog(filamentId: number, userId: number): Promise<FilamentUsageLog[]> {
    return await db.select().from(filamentUsageLog)
      .where(and(eq(filamentUsageLog.filamentId, filamentId), eq(filamentUsageLog.userId, userId)))
      .orderBy(desc(filamentUsageLog.createdAt));
  }

  async createFilamentUsageLog(entry: InsertFilamentUsageLog): Promise<FilamentUsageLog> {
    const [log] = await db
      .insert(filamentUsageLog)
      .values(entry)
      .returning();
    return log;
  }

  // Custom field definition implementations
  async getCustomFieldDefinitions(userId: number): Promise<CustomFieldDefinition[]> {
    return await db.select().from(customFieldDefinitions).where(eq(customFieldDefinitions.userId, userId));
  }

  async createCustomFieldDefinition(userId: number, definition: InsertCustomFieldDefinition): Promise<CustomFieldDefinition> {
    const [created] = await db
      .insert(customFieldDefinitions)
      .values({ ...definition, userId })
      .returning();
    return created;
  }

  async deleteCustomFieldDefinition(id: number, userId: number): Promise<boolean> {
    const [deleted] = await db
      .delete(customFieldDefinitions)
      .where(and(eq(customFieldDefinitions.id, id), eq(customFieldDefinitions.userId, userId)))
      .returning();
    return !!deleted;
  }

  // API token implementations
  async getApiTokens(userId: number): Promise<ApiToken[]> {
    return await db.select().from(apiTokens).where(eq(apiTokens.userId, userId));
  }

  async createApiToken(userId: number, tokenHash: string, label: string | undefined): Promise<ApiToken> {
    const [created] = await db.insert(apiTokens).values({ userId, tokenHash, label }).returning();
    return created;
  }

  async deleteApiToken(id: number, userId: number): Promise<boolean> {
    const [deleted] = await db
      .delete(apiTokens)
      .where(and(eq(apiTokens.id, id), eq(apiTokens.userId, userId)))
      .returning();
    return !!deleted;
  }

  async getUserIdByTokenHash(tokenHash: string): Promise<number | undefined> {
    const [row] = await db.select({ userId: apiTokens.userId, id: apiTokens.id }).from(apiTokens)
      .where(eq(apiTokens.tokenHash, tokenHash));
    if (row) {
      await this.touchApiTokenLastUsed(row.id);
    }
    return row?.userId;
  }

  async touchApiTokenLastUsed(id: number): Promise<void> {
    await db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, id));
  }

  // Manufacturer implementations
  async getManufacturers(): Promise<Manufacturer[]> {
    return await db.select().from(manufacturers).orderBy(manufacturers.sortOrder, manufacturers.name);
  }

  async createManufacturer(insertManufacturer: InsertManufacturer): Promise<Manufacturer> {
    const [manufacturer] = await db
      .insert(manufacturers)
      .values(insertManufacturer)
      .returning();
    return manufacturer;
  }

  async deleteManufacturer(id: number): Promise<boolean> {
    const [deleted] = await db
      .delete(manufacturers)
      .where(eq(manufacturers.id, id))
      .returning();
    return !!deleted;
  }

  async updateManufacturerOrder(id: number, newOrder: number): Promise<Manufacturer | undefined> {
    const [updated] = await db
      .update(manufacturers)
      .set({ sortOrder: newOrder })
      .where(eq(manufacturers.id, id))
      .returning();
    return updated || undefined;
  }

  // Material implementations
  async getMaterials(): Promise<Material[]> {
    return await db.select().from(materials).orderBy(materials.sortOrder, materials.name);
  }

  async createMaterial(insertMaterial: InsertMaterial): Promise<Material> {
    const [material] = await db
      .insert(materials)
      .values(insertMaterial)
      .returning();
    return material;
  }

  async deleteMaterial(id: number): Promise<boolean> {
    const [deleted] = await db
      .delete(materials)
      .where(eq(materials.id, id))
      .returning();
    return !!deleted;
  }

  async updateMaterialOrder(id: number, newOrder: number): Promise<Material | undefined> {
    const [updated] = await db
      .update(materials)
      .set({ sortOrder: newOrder })
      .where(eq(materials.id, id))
      .returning();
    return updated || undefined;
  }

  // Color implementations
  async getColors(): Promise<Color[]> {
    return await db.select().from(colors);
  }

  async createColor(insertColor: InsertColor): Promise<Color> {
    const [color] = await db
      .insert(colors)
      .values(insertColor)
      .returning();
    return color;
  }

  async deleteColor(id: number): Promise<boolean> {
    const [deleted] = await db
      .delete(colors)
      .where(eq(colors.id, id))
      .returning();
    return !!deleted;
  }

  // Diameter implementations
  async getDiameters(): Promise<Diameter[]> {
    return await db.select().from(diameters);
  }

  async createDiameter(insertDiameter: InsertDiameter): Promise<Diameter> {
    const [diameter] = await db
      .insert(diameters)
      .values(insertDiameter)
      .returning();
    return diameter;
  }

  async deleteDiameter(id: number): Promise<boolean> {
    const [deleted] = await db
      .delete(diameters)
      .where(eq(diameters.id, id))
      .returning();
    return !!deleted;
  }

  // Storage Location implementations
  async getStorageLocations(): Promise<StorageLocation[]> {
    return await db.select().from(storageLocations).orderBy(storageLocations.sortOrder, storageLocations.name);
  }

  async createStorageLocation(insertLocation: InsertStorageLocation): Promise<StorageLocation> {
    const [location] = await db
      .insert(storageLocations)
      .values(insertLocation)
      .returning();
    return location;
  }

  async deleteStorageLocation(id: number): Promise<boolean> {
    const [deleted] = await db
      .delete(storageLocations)
      .where(eq(storageLocations.id, id))
      .returning();
    return !!deleted;
  }

  async updateStorageLocationOrder(id: number, newOrder: number): Promise<StorageLocation | undefined> {
    const [updated] = await db
      .update(storageLocations)
      .set({ sortOrder: newOrder })
      .where(eq(storageLocations.id, id))
      .returning();
    return updated || undefined;
  }
}

// Export database storage for production use
export const storage = new DatabaseStorage();

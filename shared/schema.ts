import { sql } from "drizzle-orm";
import { table, t, foreignKey, index, uniqueIndex } from "./columns";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = table("users", {
  id: t.pk("id"),
  username: t.text("username").notNull().unique("users_username_key"),
  password: t.text("password").notNull(),
  isAdmin: t.bool("is_admin").default(false),
  // Source of truth for authorization; isAdmin above is kept as a mirror
  // (role === 'admin') so existing code reading isAdmin keeps working.
  role: t.text("role").notNull().default("user"), // 'admin' | 'user'
  email: t.text("email").unique("users_email_key"),
  emailVerified: t.bool("email_verified").default(false),
  emailVerificationToken: t.text("email_verification_token"),
  emailVerificationExpires: t.timestamp("email_verification_expires"),
  passwordResetToken: t.text("password_reset_token"),
  passwordResetExpires: t.timestamp("password_reset_expires"),
  forceChangePassword: t.bool("force_change_password").default(true),
  language: t.text("language").default("en"),
  currency: t.text("currency").default("EUR"),
  temperatureUnit: t.text("temperature_unit").default("C"),
  lastLogin: t.timestamptz("last_login"),
  createdAt: t.timestamptz("created_at").defaultNow().notNull(),
  // Low-stock / drying-reminder email alert preferences (per-user, not global)
  lowStockThresholdPercent: t.int("low_stock_threshold_percent").default(15),
  notifyLowStock: t.bool("notify_low_stock").default(true),
  notifyDryingReminder: t.bool("notify_drying_reminder").default(true),
  dryingReminderDays: t.int("drying_reminder_days").default(30),
  // Per-user UI theme (previously a single global theme.json file shared by
  // every user - see migrations/add_user_theme_preferences.ts)
  themeVariant: t.text("theme_variant").default("professional"),
  themePrimary: t.text("theme_primary").default("#EA580C"),
  themeAppearance: t.text("theme_appearance").default("dark"), // 'light' | 'dark'
  themeRadius: t.numeric("theme_radius").default("0.8"),
}, (table) => [
  // Enforces that usernames are unique regardless of case. This is what makes
  // the LOWER() lookups throughout the app safe: without it "Alice" and "alice"
  // could both exist and the lookup would be ambiguous.
  uniqueIndex("users_username_lower_idx").on(sql`lower(${table.username})`),
]);

// A filament product (vendor, material, color, diameter, print temp) defined
// once; filaments (below) become spool instances referencing one of these,
// so buying 5 identical spools no longer means re-entering the same
// manufacturer/material/color/diameter 5 times. See IMPLEMENTATION_PLAN.md #9.
export const filamentTypes = table("filament_types", {
  id: t.pk("id"),
  userId: t.fk("user_id"),
  manufacturer: t.text("manufacturer"),
  material: t.text("material").notNull(),
  colorName: t.text("color_name").notNull(),
  colorCode: t.text("color_code"),
  diameter: t.numeric("diameter"),
  printTemp: t.text("print_temp"),
  createdAt: t.timestamp("created_at").defaultNow(),
}, (table) => [
  foreignKey({
    name: "filament_types_user_id_fkey",
    columns: [table.userId],
    foreignColumns: [users.id],
  }).onDelete("cascade"),
]);

export type FilamentType = typeof filamentTypes.$inferSelect;

// The spool instance table. Product-identity fields (manufacturer, material,
// colorName, colorCode, diameter, printTemp) live on filamentTypes instead -
// server/storage.ts joins them back in so every route/component keeps
// working against the same flattened shape (see the `Filament` type below).
export const filaments = table("filaments", {
  id: t.pk("id"),
  userId: t.fk("user_id"),
  filamentTypeId: t.fk("filament_type_id").notNull(),
  name: t.text("name").notNull(),
  totalWeight: t.numeric("total_weight").notNull(),
  remainingPercentage: t.numeric("remaining_percentage").notNull(),
  purchaseDate: t.date("purchase_date"),
  purchasePrice: t.numeric("purchase_price"), // Kaufpreis in EUR
  status: t.text("status"),  // 'sealed', 'opened'
  spoolType: t.text("spool_type"), // 'spooled', 'spoolless'
  dryerCount: t.int("dryer_count").default(0).notNull(), // Anzahl der Trocknungen
  lastDryingDate: t.date("last_drying_date"), // Datum der letzten Trocknung
  storageLocation: t.text("storage_location"), // Lagerort
  // Set when a low-stock email is sent, cleared once remaining % rises back
  // above the threshold - prevents re-notifying every scheduled check.
  lowStockNotifiedAt: t.timestamp("low_stock_notified_at"),
  // Set when a drying-reminder email is sent; throttles reminders to at most
  // once/day rather than every scheduled check, until lastDryingDate changes.
  dryingReminderNotifiedAt: t.timestamp("drying_reminder_notified_at"),
  // Values for this user's customFieldDefinitions, keyed by definition id (as a string)
  customFieldValues: t.json<Record<string, any>>("custom_field_values").default({}),
  // Written by docker-entrypoint.sh's CREATE TABLE and never read by the
  // application. Declared so the schema matches the deployed database; see
  // TODO.md before removing them.
  createdAt: t.timestamptz("created_at").defaultNow(),
  updatedAt: t.timestamptz("updated_at").defaultNow(),
}, (table) => [
  foreignKey({
    name: "filaments_user_id_fkey",
    columns: [table.userId],
    foreignColumns: [users.id],
  }).onDelete("cascade"),
  foreignKey({
    name: "filaments_filament_type_id_fkey",
    columns: [table.filamentTypeId],
    foreignColumns: [filamentTypes.id],
  }),
]);

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
  isAdmin: true,
  forceChangePassword: true,
  language: true,
  currency: true,
  temperatureUnit: true,
});

export const updateThemeSchema = z.object({
  variant: z.string().min(1).optional(),
  primary: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Must be a hex color like #EA580C").optional(),
  appearance: z.enum(["light", "dark"]).optional(),
  radius: z.number().min(0).max(2).optional(),
});

export type UpdateTheme = z.infer<typeof updateThemeSchema>;

// 3-30 chars, letters/numbers/underscore/hyphen only - shared between the
// registration schema and the /api/auth/check-username validation.
export const usernameSchema = z
  .string()
  .min(3, "Username must be at least 3 characters")
  .max(30, "Username must be at most 30 characters")
  .regex(/^[a-zA-Z0-9_-]+$/, "Username may only contain letters, numbers, underscores, and hyphens");

// Shared between self-registration and admin-created accounts so the two ways
// of creating a user cannot drift apart on what counts as an acceptable password.
export const passwordSchema = z
  .string({ required_error: "Password is required" })
  .min(8, "Password must be at least 8 characters");

// newPassword uses passwordSchema so changing your password is held to the same
// length as registering: a user could otherwise register with 8 and immediately
// downgrade. The rule binds the password being set, not one already stored -
// short existing passwords keep working at login.
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: passwordSchema,
});

export const registerSchema = z.object({
  username: usernameSchema,
  email: z.string().email("Please enter a valid email address"),
  password: passwordSchema,
});

// Both admin endpoints were unvalidated before, so anything that sent a
// JSON-ish boolean worked. Rejecting "true" or 1 now would break a caller that
// has been doing it for releases, which is not a change either endpoint set out
// to make, so those forms are still accepted and normalised here.
const flexibleBoolean = z.preprocess((value) => {
  if (value === "true" || value === 1 || value === "1") return true;
  if (value === "false" || value === 0 || value === "0") return false;
  return value;
}, z.boolean());

// An admin creating an account skips email verification, so there is no email
// here - but the username and password rules are the same ones self-registration
// applies.
export const adminCreateUserSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  isAdmin: flexibleBoolean.optional(),
  forceChangePassword: flexibleBoolean.optional(),
});

// Editing a user applies the same rules to the fields it is given. Every field
// is optional - the endpoint is a partial update - but a username or password
// that arrives has to satisfy what creating one would, or a name the system
// refuses to create could still be set by renaming into it.
// An empty string means "leave this alone" rather than "set it to nothing":
// the edit form clears the password field it did not touch, and the endpoint
// skipped falsy values before this was validated at all.
const omitIfBlank = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

// The username is checked against usernameSchema by the endpoint rather than
// here, because whether the rules apply depends on the name the user already
// has: before either endpoint was validated an admin could create any name at
// all, and the edit form prefills the username, so re-applying the rules to
// every request would lock an upgraded install out of administering such an
// account over a field nobody touched. Setting a name is still checked.
export const adminUpdateUserSchema = z.object({
  username: omitIfBlank(z.string()),
  password: omitIfBlank(passwordSchema),
  isAdmin: flexibleBoolean.optional(),
  forceChangePassword: flexibleBoolean.optional(),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, "Reset token is required"),
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
});

export const resendVerificationSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// The flattened API-facing shape: a spool instance (filaments row) joined
// with its filament type. This is what every route/component reads and
// writes; storage.ts's find-or-create logic handles translating to/from the
// normalized filamentTypeId model underneath.
type FilamentTypeSelectFields = {
  manufacturer: string | null;
  material: string;
  colorName: string;
  colorCode: string | null;
  diameter: string | null;
  printTemp: string | null;
};

type FilamentTypeInsertFields = {
  manufacturer?: string | null;
  material: string;
  colorName: string;
  colorCode?: string | null;
  diameter?: string | null;
  printTemp?: string | null;
};

// createdAt/updatedAt exist on the filaments table but are not part of the
// API-facing shape: docker-entrypoint.sh creates them and nothing reads them.
// See TODO.md.
type UnusedFilamentColumns = "createdAt" | "updatedAt";

export type Filament = Omit<typeof filaments.$inferSelect, "filamentTypeId" | UnusedFilamentColumns> & FilamentTypeSelectFields & {
  filamentTypeId: number;
};

export type InsertFilament = Omit<typeof filaments.$inferInsert, "id" | "filamentTypeId" | UnusedFilamentColumns> & FilamentTypeInsertFields;

// Bearbeiten Sie das Schema, um sicherzustellen, dass numerische Felder korrekt konvertiert werden
// Schema für das Einfügen von Filaments ohne Transformation
const baseInsertFilamentSchema = createInsertSchema(filaments).omit({
  id: true,
  filamentTypeId: true,
}).extend({
  manufacturer: z.string().nullable().optional(),
  material: z.string(),
  colorName: z.string(),
  colorCode: z.string().nullable().optional(),
  diameter: z.union([z.string(), z.number()]).nullable().optional(),
  printTemp: z.string().nullable().optional(),
});

// Schema mit Transformation für die Formvalidierung
export const insertFilamentSchema = baseInsertFilamentSchema.transform((data) => {
  // Konvertiert numerische Werte zu Strings für die Datenbank
  return {
    ...data,
    diameter: data.diameter !== undefined && data.diameter !== null ? data.diameter.toString() : data.diameter,
    totalWeight: data.totalWeight.toString(),
    remainingPercentage: data.remainingPercentage.toString(),
    purchasePrice: data.purchasePrice?.toString(),
    dryerCount: data.dryerCount !== undefined ? data.dryerCount : 0
  };
});

// Neue Listen für die Einstellungen
export const manufacturers = table("manufacturers", {
  id: t.pk("id"),
  name: t.text("name").notNull().unique("manufacturers_name_key"),
  sortOrder: t.int("sort_order").default(999),
  createdAt: t.timestamptz("created_at").defaultNow().notNull()
});

export const materials = table("materials", {
  id: t.pk("id"),
  name: t.text("name").notNull().unique("materials_name_key"),
  sortOrder: t.int("sort_order").default(999),
  density: t.numeric("density"), // g/cm^3; lets weight<->length conversions work without an external lookup
  isHygroscopic: t.bool("is_hygroscopic").default(false), // drives the drying-reminder email check
  createdAt: t.timestamptz("created_at").defaultNow().notNull()
});

export const colors = table("colors", {
  id: t.pk("id"),
  name: t.text("name").notNull(),
  code: t.text("code").notNull(),
  createdAt: t.timestamptz("created_at").defaultNow().notNull()
});

export const diameters = table("diameters", {
  id: t.pk("id"),
  value: t.numeric("value").notNull().unique("diameters_value_key"),
  createdAt: t.timestamptz("created_at").defaultNow().notNull()
});

export const storageLocations = table("storage_locations", {
  id: t.pk("id"),
  name: t.text("name").notNull().unique("storage_locations_name_key"),
  sortOrder: t.int("sort_order").default(999),
  createdAt: t.timestamptz("created_at").defaultNow().notNull()
});

// Insert-Schemas für die neuen Listen
export const insertManufacturerSchema = createInsertSchema(manufacturers).omit({
  id: true,
  createdAt: true,
  sortOrder: true,
});

export const insertMaterialSchema = createInsertSchema(materials).omit({
  id: true,
  createdAt: true,
  sortOrder: true,
});

export const insertColorSchema = createInsertSchema(colors).omit({
  id: true,
  createdAt: true,
});

export const insertDiameterSchema = createInsertSchema(diameters).omit({
  id: true,
  createdAt: true,
}).transform((data) => {
  return {
    ...data,
    value: data.value.toString()
  };
});

export const insertStorageLocationSchema = createInsertSchema(storageLocations).omit({
  id: true,
  createdAt: true,
  sortOrder: true,
});

// Typen für die neuen Listen
export type InsertManufacturer = z.infer<typeof insertManufacturerSchema>;
export type Manufacturer = typeof manufacturers.$inferSelect;

export type InsertMaterial = z.infer<typeof insertMaterialSchema>;
export type Material = typeof materials.$inferSelect;

export type InsertColor = z.infer<typeof insertColorSchema>;
export type Color = typeof colors.$inferSelect;

export type InsertDiameter = z.infer<typeof insertDiameterSchema>;
export type Diameter = typeof diameters.$inferSelect;

export type InsertStorageLocation = z.infer<typeof insertStorageLocationSchema>;
export type StorageLocation = typeof storageLocations.$inferSelect;

// User sharing settings
export const userSharing = table("user_sharing", {
  id: t.pk("id"),
  userId: t.fk("user_id").notNull(),
  materialId: t.fk("material_id"),
  isPublic: t.bool("is_public").default(false),
  createdAt: t.timestamptz("created_at").defaultNow().notNull()
}, (table) => [
  foreignKey({
    name: "user_sharing_user_id_fkey",
    columns: [table.userId],
    foreignColumns: [users.id],
  }).onDelete("cascade"),
  foreignKey({
    name: "user_sharing_material_id_fkey",
    columns: [table.materialId],
    foreignColumns: [materials.id],
  }).onDelete("cascade"),
]);

export const insertUserSharingSchema = createInsertSchema(userSharing).omit({
  id: true,
  createdAt: true,
});

export type InsertUserSharing = z.infer<typeof insertUserSharingSchema>;
export type UserSharing = typeof userSharing.$inferSelect;

// Singleton row (id fixed to 1) holding the admin-configured SMTP settings
export const emailSettings = table("email_settings", {
  id: t.int("id").primaryKey().default(1),
  enabled: t.bool("enabled").default(false),
  smtpHost: t.text("smtp_host"),
  smtpPort: t.int("smtp_port"),
  smtpUser: t.text("smtp_user"),
  smtpPassword: t.text("smtp_password"),
  smtpSecure: t.bool("smtp_secure").default(true),
  fromEmail: t.text("from_email"),
  fromName: t.text("from_name"),
  updatedAt: t.timestamp("updated_at").defaultNow(),
});

export const updateEmailSettingsSchema = createInsertSchema(emailSettings).omit({
  id: true,
  updatedAt: true,
});

export type UpdateEmailSettings = z.infer<typeof updateEmailSettingsSchema>;
export type EmailSettings = typeof emailSettings.$inferSelect;

// User-submitted requests to add a new catalog entry (manufacturer/material/
// color/diameter/storage location); reviewed by an admin before the entry
// becomes real. Keeps the shared catalog tables admin-only while still
// letting any user propose additions.
export const catalogRequestEntityTypes = [
  "manufacturer",
  "material",
  "color",
  "diameter",
  "storageLocation",
] as const;

export const catalogRequests = table("catalog_requests", {
  id: t.pk("id"),
  userId: t.fk("user_id").notNull(),
  entityType: t.text("entity_type").notNull(), // one of catalogRequestEntityTypes
  payload: t.json("payload").notNull(), // e.g. {name} | {name, code} | {value}
  status: t.text("status").notNull().default("pending"), // 'pending' | 'approved' | 'rejected'
  reviewNote: t.text("review_note"),
  reviewedBy: t.fk("reviewed_by"),
  reviewedAt: t.timestamp("reviewed_at"),
  createdAt: t.timestamp("created_at").defaultNow(),
}, (table) => [
  foreignKey({
    name: "catalog_requests_user_id_fkey",
    columns: [table.userId],
    foreignColumns: [users.id],
  }).onDelete("cascade"),
  foreignKey({
    name: "catalog_requests_reviewed_by_fkey",
    columns: [table.reviewedBy],
    foreignColumns: [users.id],
  }),
]);

export const insertCatalogRequestSchema = z.object({
  entityType: z.enum(catalogRequestEntityTypes),
  payload: z.record(z.string(), z.any()),
});

export type InsertCatalogRequest = z.infer<typeof insertCatalogRequestSchema>;
export type CatalogRequest = typeof catalogRequests.$inferSelect;

// Records every change to a filament's remainingPercentage, so "how much did
// I use and when" is answerable without the user having tracked it manually.
export const filamentUsageLog = table("filament_usage_log", {
  id: t.pk("id"),
  filamentId: t.fk("filament_id").notNull(),
  userId: t.fk("user_id").notNull(),
  deltaWeight: t.numeric("delta_weight").notNull(), // grams; negative = consumed, positive = corrected/refilled
  remainingPercentageAfter: t.numeric("remaining_percentage_after").notNull(),
  note: t.text("note"),
  source: t.text("source").notNull().default("manual"), // 'manual' | 'printer'
  createdAt: t.timestamp("created_at").defaultNow(),
}, (table) => [
  foreignKey({
    name: "filament_usage_log_filament_id_fkey",
    columns: [table.filamentId],
    foreignColumns: [filaments.id],
  }).onDelete("cascade"),
  foreignKey({
    name: "filament_usage_log_user_id_fkey",
    columns: [table.userId],
    foreignColumns: [users.id],
  }).onDelete("cascade"),
  index("filament_usage_log_filament_id_idx").on(table.filamentId),
]);

export type FilamentUsageLog = typeof filamentUsageLog.$inferSelect;

// Lets a user define their own tracked attributes on filaments (e.g. "shelf",
// "batch number") without a schema change; values live in
// filaments.customFieldValues, keyed by this definition's id.
export const customFieldFieldTypes = ["text", "number", "boolean", "date"] as const;

export const customFieldDefinitions = table("custom_field_definitions", {
  id: t.pk("id"),
  userId: t.fk("user_id").notNull(),
  entityType: t.text("entity_type").notNull().default("filament"), // only 'filament' for now
  name: t.text("name").notNull(),
  fieldType: t.text("field_type").notNull(), // one of customFieldFieldTypes
  createdAt: t.timestamp("created_at").defaultNow(),
}, (table) => [
  foreignKey({
    name: "custom_field_definitions_user_id_fkey",
    columns: [table.userId],
    foreignColumns: [users.id],
  }).onDelete("cascade"),
]);

export const insertCustomFieldDefinitionSchema = createInsertSchema(customFieldDefinitions).omit({
  id: true,
  userId: true,
  createdAt: true,
}).extend({
  fieldType: z.enum(customFieldFieldTypes),
});

export type InsertCustomFieldDefinition = z.infer<typeof insertCustomFieldDefinitionSchema>;
export type CustomFieldDefinition = typeof customFieldDefinitions.$inferSelect;

// A locally-cached copy of community filament profiles from SpoolmanDB
// (https://github.com/Donkie/SpoolmanDB, MIT licensed), refreshed by an
// admin action rather than a live external API call per search. One row per
// manufacturer/product/color combination.
export const communityFilamentCache = table("community_filament_cache", {
  id: t.pk("id"),
  manufacturer: t.text("manufacturer").notNull(),
  material: t.text("material").notNull(),
  name: t.text("name").notNull(),
  colorName: t.text("color_name").notNull(),
  colorCode: t.text("color_code"),
  density: t.numeric("density"),
  diameter: t.numeric("diameter"),
  extruderTemp: t.int("extruder_temp"),
  bedTemp: t.int("bed_temp"),
  updatedAt: t.timestamp("updated_at").defaultNow(),
}, (table) => [
  index("community_filament_cache_search_idx").on(table.manufacturer, table.name, table.colorName),
]);

export type CommunityFilamentCacheEntry = typeof communityFilamentCache.$inferSelect;

// Per-user API tokens for printer/print-server integrations (a print server
// can't hold a user's login cookie). tokenHash is a SHA-256 digest of the
// plaintext token - looked up directly, not bcrypt-compared, since the
// token itself is high-entropy random data rather than a user-chosen password.
export const apiTokens = table("api_tokens", {
  id: t.pk("id"),
  userId: t.fk("user_id").notNull(),
  tokenHash: t.text("token_hash").notNull().unique("api_tokens_token_hash_key"),
  label: t.text("label"),
  createdAt: t.timestamp("created_at").defaultNow(),
  lastUsedAt: t.timestamp("last_used_at"),
}, (table) => [
  foreignKey({
    name: "api_tokens_user_id_fkey",
    columns: [table.userId],
    foreignColumns: [users.id],
  }).onDelete("cascade"),
]);

export type ApiToken = typeof apiTokens.$inferSelect;

export const insertApiTokenSchema = z.object({
  label: z.string().optional(),
});

export type InsertApiToken = z.infer<typeof insertApiTokenSchema>;

// Body for POST /api/integrations/usage (Phase A generic printer ingestion)
export const printerUsageEventSchema = z.object({
  filamentId: z.number().int().positive(),
  deltaWeight: z.number(), // grams; negative = consumed
  externalJobId: z.string().optional(),
});

export type PrinterUsageEvent = z.infer<typeof printerUsageEventSchema>;

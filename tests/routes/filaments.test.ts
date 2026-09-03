/**
 * Characterisation tests for the auto-registration of declared materials.
 *
 * A declared material that resolves to no Catalog Material is registered into
 * the declaring user's Personal Catalog, so from then on it always resolves to
 * a row (docs/adr/0003-per-user-material-catalog.md). These record that at the
 * storage seam plus GET /api/materials; they are not a specification.
 */
import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { eq } from "drizzle-orm";
import { registerAuthRoutes } from "../../server/routes/auth";
import { registerSettingsRoutes } from "../../server/routes/settings";
import { storage } from "../../server/storage";
import { db } from "../helpers/db";
import { materials } from "../../shared/schema";
import { createApp, registerAndVerify } from "../helpers/app";

let app: Express;

// Mock credentials for a throwaway test database - not a real login anywhere, so
// the password below is safe to keep in the repository (hence the ggignore tag).
const PASSWORD = "correct-horse"; // ggignore

async function newUser(username: string) {
  const cookie = await registerAndVerify(app, {
    username,
    email: `${username}@example.com`,
    password: PASSWORD,
  });
  const me = await request(app).get("/api/auth/me").set("Cookie", cookie);
  return { cookie, id: me.body.id as number };
}

/** Records a spool of the given material, through the storage interface the app itself uses. */
async function giveSpoolOf(userId: number, material: string) {
  return storage.createFilament({
    userId,
    name: `${material} spool`,
    material,
    colorName: "Black",
    totalWeight: "1000",
    remainingPercentage: "80",
  });
}

/** The rows a user owns in their Personal Catalog. */
const ownRows = (userId: number) => db.select().from(materials).where(eq(materials.userId, userId));

beforeEach(async () => {
  app = createApp(registerAuthRoutes, registerSettingsRoutes);
});

describe("auto-registration of a declared material", () => {
  it("registers a material in no catalog into the declaring user's Personal Catalog", async () => {
    const alice = await newUser("alice");

    await giveSpoolOf(alice.id, "MoonPLA");

    const rows = await ownRows(alice.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "MoonPLA",
      userId: alice.id,
      density: null,
      isHygroscopic: false,
    });
  });

  it("gives each user their own private row for an identically-named new material", async () => {
    const alice = await newUser("alice");
    const bob = await newUser("bob");

    await giveSpoolOf(alice.id, "MoonPLA");
    await giveSpoolOf(bob.id, "MoonPLA");

    const aliceRow = (await ownRows(alice.id))[0];
    const bobRow = (await ownRows(bob.id))[0];
    expect(aliceRow.id).not.toBe(bobRow.id);

    const aliceView = await request(app).get("/api/materials").set("Cookie", alice.cookie);
    const bobView = await request(app).get("/api/materials").set("Cookie", bob.cookie);
    expect(aliceView.body.map((m: { id: number }) => m.id)).toEqual([aliceRow.id]);
    expect(bobView.body.map((m: { id: number }) => m.id)).toEqual([bobRow.id]);
  });

  it("resolves to the Global Catalog row, creating nothing, when only the case differs", async () => {
    const alice = await newUser("alice");
    await storage.createMaterial({ name: "PETG" });

    await giveSpoolOf(alice.id, "petg");

    expect(await ownRows(alice.id)).toHaveLength(0);
    const view = await request(app).get("/api/materials").set("Cookie", alice.cookie);
    expect(view.body.map((m: { name: string }) => m.name)).toEqual(["PETG"]);
  });

  it("resolves to the user's own row when a Global Catalog row of the same name also exists", async () => {
    const alice = await newUser("alice");
    const [own] = await db.insert(materials).values({ userId: alice.id, name: "Dualite" }).returning();
    await storage.createMaterial({ name: "Dualite" });

    const resolved = await storage.resolveMaterial(alice.id, "dualite");

    expect(resolved?.id).toBe(own.id);
    expect(resolved?.userId).toBe(alice.id);
  });

  it("creates nothing when the material is already in the user's Personal Catalog", async () => {
    const alice = await newUser("alice");

    await giveSpoolOf(alice.id, "MoonPLA");
    await giveSpoolOf(alice.id, "moonpla");

    expect(await ownRows(alice.id)).toHaveLength(1);
  });
});

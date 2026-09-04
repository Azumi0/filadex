/**
 * Characterisation tests for server/utils/settings-crud.ts under the
 * `userScoped` capability, which only `materials` declares: a Global Catalog
 * (rows owned by nobody) plus a Personal Catalog per user.
 *
 * The other four entities (manufacturers, colors, diameters, storage locations)
 * go through the same factory and must be untouched by it - a couple of their
 * cases are pinned here alongside.
 */
import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { registerAuthRoutes } from "../../server/routes/auth";
import { registerSettingsRoutes } from "../../server/routes/settings";
import { initializeAdminUser } from "../../server/auth";
import { storage } from "../../server/storage";
import { db } from "../helpers/db";
import { materials } from "../../shared/schema";
import { createApp, loginAs, registerAndVerify } from "../helpers/app";

let app: Express;
let adminCookie: string;

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

const names = (body: Array<{ name: string }>) => body.map((m) => m.name).sort();
const allMaterialRows = () => db.select().from(materials);

beforeEach(async () => {
  app = createApp(registerAuthRoutes, registerSettingsRoutes);
  await initializeAdminUser();
  adminCookie = await loginAs(app, "admin", "admin");
});

describe("GET /api/materials", () => {
  it("shows a non-admin the Global Catalog plus their own Personal Catalog, and no one else's", async () => {
    await storage.createMaterial({ name: "PLA" });
    const alice = await newUser("alice");
    const bob = await newUser("bob");
    await db.insert(materials).values([
      { userId: alice.id, name: "AliceOnly" },
      { userId: bob.id, name: "BobOnly" },
    ]);

    const res = await request(app).get("/api/materials").set("Cookie", alice.cookie);

    expect(res.status).toBe(200);
    expect(names(res.body)).toEqual(["AliceOnly", "PLA"]);
  });

  // The client tells the three cases apart from these facts alone (no status
  // enum): userId null is the Global Catalog; userId set with density/
  // isHygroscopic still at the auto-registration defaults needs attention;
  // userId set with either filled in does not. See
  // docs/plans/per-user-material-catalog-ui.md, Commit 1.
  it("returns userId, density and isHygroscopic so the client can tell a global row from a filled-in or still-default personal one", async () => {
    const alice = await newUser("alice");
    await storage.createMaterial({ name: "PLA", density: "1.24", isHygroscopic: false });
    await db.insert(materials).values([
      { userId: alice.id, name: "Filled", density: "1.27", isHygroscopic: true },
      { userId: alice.id, name: "StillDefault", density: null, isHygroscopic: false },
    ]);

    const res = await request(app).get("/api/materials").set("Cookie", alice.cookie);

    const byName = (name: string) => res.body.find((m: any) => m.name === name);
    expect(byName("PLA")).toMatchObject({ userId: null, density: "1.24", isHygroscopic: false });
    expect(byName("Filled")).toMatchObject({ userId: alice.id, density: "1.27", isHygroscopic: true });
    expect(byName("StillDefault")).toMatchObject({ userId: alice.id, density: null, isHygroscopic: false });
  });
});

describe("POST /api/materials", () => {
  it("is still 403 for a non-admin", async () => {
    const alice = await newUser("alice");

    const res = await request(app).post("/api/materials").set("Cookie", alice.cookie).send({ name: "Nope" });

    expect(res.status).toBe(403);
    expect(await allMaterialRows()).toHaveLength(0);
  });

  it("creates a Global Catalog row for an admin", async () => {
    const res = await request(app).post("/api/materials").set("Cookie", adminCookie).send({ name: "PLA" });

    expect(res.status).toBe(201);
    expect(res.body.userId).toBeNull();
  });
});

describe("DELETE /api/materials/:id", () => {
  it("lets a non-admin delete a row they own", async () => {
    const alice = await newUser("alice");
    const [row] = await db.insert(materials).values({ userId: alice.id, name: "AliceOnly" }).returning();

    const res = await request(app).delete(`/api/materials/${row.id}`).set("Cookie", alice.cookie);

    expect(res.status).toBe(204);
    expect(await allMaterialRows()).toHaveLength(0);
  });

  it("refuses a non-admin deleting a Global Catalog row", async () => {
    const global = await storage.createMaterial({ name: "PLA" });
    const alice = await newUser("alice");

    const res = await request(app).delete(`/api/materials/${global.id}`).set("Cookie", alice.cookie);

    expect(res.status).toBe(403);
    expect(await allMaterialRows()).toHaveLength(1);
  });

  it("does not let a non-admin reach another user's Personal Catalog row", async () => {
    const alice = await newUser("alice");
    const bob = await newUser("bob");
    const [bobRow] = await db.insert(materials).values({ userId: bob.id, name: "BobOnly" }).returning();

    const res = await request(app).delete(`/api/materials/${bobRow.id}`).set("Cookie", alice.cookie);

    expect(res.status).toBe(404);
    expect(await allMaterialRows()).toHaveLength(1);
  });

  it("still blocks deleting a Catalog Material one of the caller's Spools uses", async () => {
    const alice = await newUser("alice");
    const [row] = await db.insert(materials).values({ userId: alice.id, name: "InUse" }).returning();
    await storage.createFilament({
      userId: alice.id,
      name: "spool",
      material: "InUse",
      colorName: "Black",
      totalWeight: "1000",
      remainingPercentage: "50",
    });

    const res = await request(app).delete(`/api/materials/${row.id}`).set("Cookie", alice.cookie);

    expect(res.status).toBe(400);
    expect(await allMaterialRows()).toHaveLength(1);
  });

  it("lets an admin delete a Global Catalog row", async () => {
    const global = await storage.createMaterial({ name: "PLA" });

    const res = await request(app).delete(`/api/materials/${global.id}`).set("Cookie", adminCookie);

    expect(res.status).toBe(204);
  });
});

describe("the non-scoped entities go through the same factory unchanged", () => {
  it("lets any authenticated user list manufacturers", async () => {
    await storage.createManufacturer({ name: "Bambu Lab" });
    const alice = await newUser("alice");

    const res = await request(app).get("/api/manufacturers").set("Cookie", alice.cookie);

    expect(names(res.body)).toEqual(["Bambu Lab"]);
  });

  it("still refuses a non-admin creating a manufacturer", async () => {
    const alice = await newUser("alice");

    const res = await request(app).post("/api/manufacturers").set("Cookie", alice.cookie).send({ name: "X" });

    expect(res.status).toBe(403);
  });

  it("still refuses a non-admin deleting a manufacturer", async () => {
    const manufacturer = await storage.createManufacturer({ name: "Bambu Lab" });
    const alice = await newUser("alice");

    const res = await request(app).delete(`/api/manufacturers/${manufacturer.id}`).set("Cookie", alice.cookie);

    expect(res.status).toBe(403);
  });
});

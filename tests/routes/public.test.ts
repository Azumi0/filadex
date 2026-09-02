/**
 * Characterisation tests for server/routes/public.ts - the unauthenticated
 * sharing path, plus the /api/sharing endpoints that control it.
 *
 * These record observable behaviour at the HTTP boundary, so that moving the
 * database access behind IStorage can be shown to change nothing. They are not
 * a specification: a behaviour change belongs in its own commit, together with
 * the test that pins it.
 */
import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { registerAuthRoutes } from "../../server/routes/auth";
import { registerPublicRoutes } from "../../server/routes/public";
import { registerUserRoutes } from "../../server/routes/users";
import { storage } from "../../server/storage";
import { createApp, registerAndVerify } from "../helpers/app";

let app: Express;
let aliceCookie: string;
let aliceId: number;

// Mock credentials for a throwaway test database - not a real login anywhere, so
// the password below is safe to keep in the repository (hence the ggignore tag).
const alice = { username: "alice", email: "alice@example.com", password: "correct-horse" }; // ggignore

beforeEach(async () => {
  app = createApp(registerAuthRoutes, registerPublicRoutes);
  aliceCookie = await registerAndVerify(app, alice);
  const me = await request(app).get("/api/auth/me").set("Cookie", aliceCookie);
  aliceId = me.body.id;
});

/** Gives Alice a spool of the given material, through the storage interface the app itself uses. */
async function giveAliceASpoolOf(material: string, name = `${material} spool`) {
  return storage.createFilament({
    userId: aliceId,
    name,
    material,
    colorName: "Black",
    totalWeight: "1000",
    remainingPercentage: "80",
  });
}

async function share(cookie: string, body: Record<string, unknown>) {
  const response = await request(app).post("/api/sharing").set("Cookie", cookie).send(body);
  expect([200, 201]).toContain(response.status);
  return response.body;
}

describe("GET /api/public/filaments/:userId", () => {
  it("rejects a user id that is not a number", async () => {
    const response = await request(app).get("/api/public/filaments/not-a-number");

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Invalid user ID");
  });

  it("reports an unknown user as not found", async () => {
    const response = await request(app).get("/api/public/filaments/9999");

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("User not found");
  });

  it("reports a user who has shared nothing as having no public filaments", async () => {
    await giveAliceASpoolOf("PLA");

    const response = await request(app).get(`/api/public/filaments/${aliceId}`);

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("No public filaments found");
  });

  it("treats sharing that has been switched off as no sharing at all", async () => {
    await giveAliceASpoolOf("PLA");
    await share(aliceCookie, { isPublic: false });

    const response = await request(app).get(`/api/public/filaments/${aliceId}`);

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("No public filaments found");
  });

  it("returns every filament when sharing is global, with the owner's name but not their email", async () => {
    await giveAliceASpoolOf("PLA");
    await giveAliceASpoolOf("PETG");
    await share(aliceCookie, { isPublic: true });

    const response = await request(app).get(`/api/public/filaments/${aliceId}`);

    expect(response.status).toBe(200);
    expect(response.body.user).toEqual({ id: aliceId, username: "alice" });
    expect(response.body.filaments.map((f: { material: string }) => f.material).sort()).toEqual([
      "PETG",
      "PLA",
    ]);
  });

  it("returns only the shared material when sharing is per-material", async () => {
    await giveAliceASpoolOf("PLA");
    await giveAliceASpoolOf("PETG");
    const petg = await storage.createMaterial({ name: "PETG" });
    await share(aliceCookie, { materialId: petg.id, isPublic: true });

    const response = await request(app).get(`/api/public/filaments/${aliceId}`);

    expect(response.status).toBe(200);
    expect(response.body.filaments).toHaveLength(1);
    expect(response.body.filaments[0].material).toBe("PETG");
  });

  it("does not leak another user's filaments", async () => {
    await giveAliceASpoolOf("PLA");
    await share(aliceCookie, { isPublic: true });

    const bobCookie = await registerAndVerify(app, {
      username: "bob",
      email: "bob@example.com",
      password: "bobs-password",
    });
    const bob = await request(app).get("/api/auth/me").set("Cookie", bobCookie);
    await storage.createFilament({
      userId: bob.body.id,
      name: "Bob's spool",
      material: "ABS",
      colorName: "White",
      totalWeight: "1000",
      remainingPercentage: "50",
    });

    const response = await request(app).get(`/api/public/filaments/${aliceId}`);

    expect(response.body.filaments.map((f: { name: string }) => f.name)).toEqual(["PLA spool"]);
  });

  it("lets a public global row widen the share past a narrower per-material row", async () => {
    await giveAliceASpoolOf("PLA");
    await giveAliceASpoolOf("PETG");
    const petg = await storage.createMaterial({ name: "PETG" });
    await share(aliceCookie, { materialId: petg.id, isPublic: true });
    await share(aliceCookie, { isPublic: true });

    const response = await request(app).get(`/api/public/filaments/${aliceId}`);

    expect(response.status).toBe(200);
    expect(response.body.filaments).toHaveLength(2);
  });

  // Deleting the catalogue entry cascades the user_sharing row away with it, so
  // the share is silently revoked rather than left dangling.
  it("revokes the share when the shared material is deleted from the catalogue", async () => {
    await giveAliceASpoolOf("PETG");
    const petg = await storage.createMaterial({ name: "PETG" });
    await share(aliceCookie, { materialId: petg.id, isPublic: true });
    await storage.deleteMaterial(petg.id);

    const response = await request(app).get(`/api/public/filaments/${aliceId}`);

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("No public filaments found");
  });

  it("returns an empty list when a shared material matches none of the owner's filaments", async () => {
    await giveAliceASpoolOf("PLA");
    const abs = await storage.createMaterial({ name: "ABS" });
    await share(aliceCookie, { materialId: abs.id, isPublic: true });

    const response = await request(app).get(`/api/public/filaments/${aliceId}`);

    expect(response.status).toBe(200);
    expect(response.body.filaments).toEqual([]);
  });

  // A filament records its material as free text while user_sharing.material_id
  // points at the materials catalogue, so the two are matched by name, ignoring
  // case - otherwise a spool entered as "petg" would not be covered by sharing
  // the catalogue's "PETG".
  it("matches a filament whose material differs from the catalogue name only in case", async () => {
    await giveAliceASpoolOf("petg");
    const petg = await storage.createMaterial({ name: "PETG" });
    await share(aliceCookie, { materialId: petg.id, isPublic: true });

    const response = await request(app).get(`/api/public/filaments/${aliceId}`);

    expect(response.status).toBe(200);
    expect(response.body.filaments).toHaveLength(1);
    expect(response.body.filaments[0].material).toBe("petg");
  });

  it("still excludes filaments of a material that was not shared", async () => {
    await giveAliceASpoolOf("PLA");
    await giveAliceASpoolOf("petg");
    const petg = await storage.createMaterial({ name: "PETG" });
    await share(aliceCookie, { materialId: petg.id, isPublic: true });

    const response = await request(app).get(`/api/public/filaments/${aliceId}`);

    expect(response.body.filaments.map((f: { material: string }) => f.material)).toEqual(["petg"]);
  });
});

describe("POST /api/sharing", () => {
  it("rejects a request with no session cookie", async () => {
    const response = await request(app).post("/api/sharing").send({ isPublic: true });

    expect(response.status).toBe(401);
  });

  it("creates a global sharing setting", async () => {
    const response = await request(app)
      .post("/api/sharing")
      .set("Cookie", aliceCookie)
      .send({ isPublic: true });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ userId: aliceId, materialId: null, isPublic: true });
  });

  it("updates the existing global setting instead of adding a second", async () => {
    await share(aliceCookie, { isPublic: true });

    const response = await request(app)
      .post("/api/sharing")
      .set("Cookie", aliceCookie)
      .send({ isPublic: false });

    expect(response.status).toBe(200);
    expect(response.body.isPublic).toBe(false);

    const listed = await request(app).get("/api/sharing").set("Cookie", aliceCookie);
    expect(listed.body).toHaveLength(1);
  });

  it("keeps per-material and global settings as separate rows", async () => {
    const petg = await storage.createMaterial({ name: "PETG" });
    await share(aliceCookie, { isPublic: true });
    await share(aliceCookie, { materialId: petg.id, isPublic: true });

    const listed = await request(app).get("/api/sharing").set("Cookie", aliceCookie);

    expect(listed.body).toHaveLength(2);
    expect(listed.body.map((s: { materialId: number | null }) => s.materialId)).toEqual(
      expect.arrayContaining([null, petg.id]),
    );
  });

  it("updates the existing per-material setting instead of adding a second", async () => {
    const petg = await storage.createMaterial({ name: "PETG" });
    await share(aliceCookie, { materialId: petg.id, isPublic: true });

    const response = await request(app)
      .post("/api/sharing")
      .set("Cookie", aliceCookie)
      .send({ materialId: petg.id, isPublic: false });

    expect(response.status).toBe(200);
    expect(response.body.isPublic).toBe(false);

    const listed = await request(app).get("/api/sharing").set("Cookie", aliceCookie);
    expect(listed.body).toHaveLength(1);
  });
});

describe("GET /api/sharing", () => {
  it("rejects a request with no session cookie", async () => {
    const response = await request(app).get("/api/sharing");

    expect(response.status).toBe(401);
  });

  it("starts with nothing shared", async () => {
    const response = await request(app).get("/api/sharing").set("Cookie", aliceCookie);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it("shows a user only their own settings", async () => {
    await share(aliceCookie, { isPublic: true });
    const bobCookie = await registerAndVerify(app, {
      username: "bob",
      email: "bob@example.com",
      password: "bobs-password",
    });

    const response = await request(app).get("/api/sharing").set("Cookie", bobCookie);

    expect(response.body).toEqual([]);
  });
});

describe("switching sharing off through /api/user-sharing", () => {
  it("makes the collection private again", async () => {
    const withUserRoutes = createApp(registerAuthRoutes, registerPublicRoutes, registerUserRoutes);
    await giveAliceASpoolOf("PLA");

    await request(withUserRoutes)
      .post("/api/user-sharing")
      .set("Cookie", aliceCookie)
      .send({ isPublic: true })
      .expect(201);
    await request(withUserRoutes)
      .post("/api/user-sharing")
      .set("Cookie", aliceCookie)
      .send({ isPublic: false })
      .expect(201);

    const response = await request(withUserRoutes).get(`/api/public/filaments/${aliceId}`);

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("No public filaments found");
  });
});

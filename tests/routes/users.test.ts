/**
 * Characterisation tests for server/routes/users.ts.
 *
 * These record what the endpoints do TODAY, so that moving their database
 * access behind IStorage can be shown to change nothing. Where current
 * behaviour looks wrong, the test still asserts the current behaviour and says
 * so in a comment - fixes belong in their own change, not in a refactor.
 */
import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { registerAuthRoutes } from "../../server/routes/auth";
import { registerUserRoutes } from "../../server/routes/users";
import { initializeAdminUser } from "../../server/auth";
import { storage } from "../../server/storage";
import { createApp, loginAs, registerAndVerify } from "../helpers/app";

let app: Express;
let adminCookie: string;

// Mock credentials for a throwaway test database - not a real login anywhere, so
// the password below is safe to keep in the repository (hence the ggignore tag).
const alice = { username: "alice", email: "alice@example.com", password: "correct-horse" }; // ggignore

beforeEach(async () => {
  app = createApp(registerAuthRoutes, registerUserRoutes);
  // The only way an installation gets its first admin; password is hard-coded.
  await initializeAdminUser();
  adminCookie = await loginAs(app, "admin", "admin");
});

/** Creates a user through the admin API and returns their id and a session cookie. */
async function createUserAsAdmin(body: Record<string, unknown>) {
  const response = await request(app).post("/api/users").set("Cookie", adminCookie).send(body);
  expect(response.status).toBe(201);
  return response.body as {
    id: number;
    username: string;
    isAdmin: boolean;
    role: string;
    forceChangePassword: boolean;
  };
}

async function currentUser(cookie: string) {
  const response = await request(app).get("/api/auth/me").set("Cookie", cookie);
  expect(response.status).toBe(200);
  return response.body;
}

describe("POST /api/users/language", () => {
  it("rejects a request with no session cookie", async () => {
    const response = await request(app).post("/api/users/language").send({ language: "de" });

    expect(response.status).toBe(401);
  });

  it.each(["en", "de"])("stores the %s preference", async (language) => {
    const cookie = await registerAndVerify(app, alice);

    const response = await request(app).post("/api/users/language").set("Cookie", cookie).send({ language });

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Language preference updated successfully");
    expect((await currentUser(cookie)).language).toBe(language);
  });

  it.each([["fr"], [undefined], [""]])("rejects %s", async (language) => {
    const cookie = await registerAndVerify(app, alice);

    const response = await request(app).post("/api/users/language").set("Cookie", cookie).send({ language });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Invalid language. Supported languages are 'en' and 'de'.");
  });
});

describe("POST /api/users/units", () => {
  it("rejects a request with no session cookie", async () => {
    const response = await request(app).post("/api/users/units").send({ currency: "USD" });

    expect(response.status).toBe(401);
  });

  it("stores currency and temperature unit together", async () => {
    const cookie = await registerAndVerify(app, alice);

    const response = await request(app)
      .post("/api/users/units")
      .set("Cookie", cookie)
      .send({ currency: "PLN", temperatureUnit: "F" });

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Units preferences updated successfully");
    expect(await currentUser(cookie)).toMatchObject({ currency: "PLN", temperatureUnit: "F" });
  });

  it("rejects an unsupported currency", async () => {
    const cookie = await registerAndVerify(app, alice);

    const response = await request(app)
      .post("/api/users/units")
      .set("Cookie", cookie)
      .send({ currency: "XYZ" });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/^Invalid currency\. Supported currencies are: EUR, USD/);
    expect((await currentUser(cookie)).currency).toBe("EUR");
  });

  it("rejects an unsupported temperature unit", async () => {
    const cookie = await registerAndVerify(app, alice);

    const response = await request(app)
      .post("/api/users/units")
      .set("Cookie", cookie)
      .send({ temperatureUnit: "K" });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Invalid temperature unit. Supported units are 'C' and 'F'.");
  });

  it("accepts an empty body and changes nothing", async () => {
    const cookie = await registerAndVerify(app, alice);

    const response = await request(app).post("/api/users/units").set("Cookie", cookie).send({});

    expect(response.status).toBe(200);
    expect(await currentUser(cookie)).toMatchObject({ currency: "EUR", temperatureUnit: "C" });
  });
});

describe("POST /api/users/notification-preferences", () => {
  it("rejects a request with no session cookie", async () => {
    const response = await request(app)
      .post("/api/users/notification-preferences")
      .send({ notifyLowStock: false });

    expect(response.status).toBe(401);
  });

  it("stores every preference at once", async () => {
    const cookie = await registerAndVerify(app, alice);

    const response = await request(app)
      .post("/api/users/notification-preferences")
      .set("Cookie", cookie)
      .send({
        lowStockThresholdPercent: 42,
        notifyLowStock: false,
        notifyDryingReminder: false,
        dryingReminderDays: 7,
      });

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Notification preferences updated successfully");
    expect(await currentUser(cookie)).toMatchObject({
      lowStockThresholdPercent: 42,
      notifyLowStock: false,
      notifyDryingReminder: false,
      dryingReminderDays: 7,
    });
  });

  it.each([
    ["a threshold below 0", { lowStockThresholdPercent: -1 }, "lowStockThresholdPercent must be a number between 0 and 100"],
    ["a threshold above 100", { lowStockThresholdPercent: 101 }, "lowStockThresholdPercent must be a number between 0 and 100"],
    ["a non-numeric threshold", { lowStockThresholdPercent: "high" }, "lowStockThresholdPercent must be a number between 0 and 100"],
    ["a non-boolean notifyLowStock", { notifyLowStock: "yes" }, "notifyLowStock must be a boolean"],
    ["a non-boolean notifyDryingReminder", { notifyDryingReminder: 1 }, "notifyDryingReminder must be a boolean"],
    ["fewer than one drying reminder day", { dryingReminderDays: 0 }, "dryingReminderDays must be a positive number"],
  ])("rejects %s", async (_label, body, message) => {
    const cookie = await registerAndVerify(app, alice);

    const response = await request(app)
      .post("/api/users/notification-preferences")
      .set("Cookie", cookie)
      .send(body);

    expect(response.status).toBe(400);
    expect(response.body.message).toBe(message);
  });

  it("accepts an empty body and changes nothing", async () => {
    const cookie = await registerAndVerify(app, alice);

    const response = await request(app)
      .post("/api/users/notification-preferences")
      .set("Cookie", cookie)
      .send({});

    expect(response.status).toBe(200);
    expect(await currentUser(cookie)).toMatchObject({
      lowStockThresholdPercent: 15,
      notifyLowStock: true,
      notifyDryingReminder: true,
      dryingReminderDays: 30,
    });
  });
});

describe("GET /api/users", () => {
  it("rejects a request with no session cookie", async () => {
    const response = await request(app).get("/api/users");

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Authentication required");
  });

  it("rejects a non-admin", async () => {
    const cookie = await registerAndVerify(app, alice);

    const response = await request(app).get("/api/users").set("Cookie", cookie);

    expect(response.status).toBe(403);
    expect(response.body.message).toBe("Insufficient privileges");
  });

  it("lists every account without password hashes", async () => {
    await registerAndVerify(app, alice);

    const response = await request(app).get("/api/users").set("Cookie", adminCookie);

    expect(response.status).toBe(200);
    expect(response.body.map((user: { username: string }) => user.username).sort()).toEqual([
      "admin",
      "alice",
    ]);
    for (const user of response.body) {
      expect(user).not.toHaveProperty("password");
    }
  });
});

describe("POST /api/users", () => {
  it("rejects a non-admin", async () => {
    const cookie = await registerAndVerify(app, alice);

    const response = await request(app)
      .post("/api/users")
      .set("Cookie", cookie)
      .send({ username: "intruder", password: "some-password" });

    expect(response.status).toBe(403);
  });

  it("creates an account that can log in straight away, with no email verification", async () => {
    const created = await createUserAsAdmin({ username: "bob", password: "bobs-password" });

    expect(created).toMatchObject({
      username: "bob",
      isAdmin: false,
      role: "user",
      forceChangePassword: true,
    });
    expect(created).not.toHaveProperty("password");

    const cookie = await loginAs(app, "bob", "bobs-password");
    expect(await currentUser(cookie)).toMatchObject({ emailVerified: true, email: null });
  });

  it("creates an admin when asked, keeping role and isAdmin in step", async () => {
    const created = await createUserAsAdmin({
      username: "root",
      password: "roots-password",
      isAdmin: true,
    });

    expect(created).toMatchObject({ isAdmin: true, role: "admin" });

    const cookie = await loginAs(app, "root", "roots-password");
    await request(app).get("/api/users").set("Cookie", cookie).expect(200);
  });

  it("can opt the new account out of the forced password change", async () => {
    const created = await createUserAsAdmin({
      username: "bob",
      password: "bobs-password",
      forceChangePassword: false,
    });

    expect(created.forceChangePassword).toBe(false);
  });

  it("rejects a username that already exists, ignoring case", async () => {
    await createUserAsAdmin({ username: "bob", password: "bobs-password" });

    const response = await request(app)
      .post("/api/users")
      .set("Cookie", adminCookie)
      .send({ username: "BOB", password: "another-password" });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Username already exists");
  });

  // KNOWN BUG (recorded, not fixed): unlike self-registration, this endpoint
  // validates nothing. A missing password reaches bcrypt and blows up as an
  // opaque 500 rather than a 400 explaining what was wrong.
  it("answers 500 when no password is given", async () => {
    const response = await request(app)
      .post("/api/users")
      .set("Cookie", adminCookie)
      .send({ username: "bob" });

    expect(response.status).toBe(500);
    expect(response.body.message).toBe("Server error");
  });
});

describe("PUT /api/users/:id", () => {
  it("rejects a non-admin", async () => {
    const cookie = await registerAndVerify(app, alice);
    const bob = await createUserAsAdmin({ username: "bob", password: "bobs-password" });

    const response = await request(app)
      .put(`/api/users/${bob.id}`)
      .set("Cookie", cookie)
      .send({ username: "bobby" });

    expect(response.status).toBe(403);
  });

  it("rejects an id that is not a number", async () => {
    const response = await request(app)
      .put("/api/users/not-a-number")
      .set("Cookie", adminCookie)
      .send({ username: "bobby" });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Invalid user ID");
  });

  it("reports an unknown user as not found", async () => {
    const response = await request(app)
      .put("/api/users/9999")
      .set("Cookie", adminCookie)
      .send({ username: "bobby" });

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("User not found");
  });

  it("renames a user", async () => {
    const bob = await createUserAsAdmin({ username: "bob", password: "bobs-password" });

    const response = await request(app)
      .put(`/api/users/${bob.id}`)
      .set("Cookie", adminCookie)
      .send({ username: "bobby" });

    expect(response.status).toBe(200);
    expect(response.body.username).toBe("bobby");
    await expect(loginAs(app, "bobby", "bobs-password")).resolves.toBeTruthy();
  });

  it("rejects a rename onto another user's name, ignoring case", async () => {
    await createUserAsAdmin({ username: "bob", password: "bobs-password" });
    const carol = await createUserAsAdmin({ username: "carol", password: "carols-password" });

    const response = await request(app)
      .put(`/api/users/${carol.id}`)
      .set("Cookie", adminCookie)
      .send({ username: "BOB" });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Username already exists");
  });

  // KNOWN BUG (recorded, not fixed): the guard that stops a user colliding with
  // someone else's name also swallows a pure change of capitalisation, which
  // leaves nothing to update - and an update with nothing to set is the 500
  // below. So "rename bob to Bob" fails with a server error.
  it("answers 500 for a rename that only changes capitalisation", async () => {
    const bob = await createUserAsAdmin({ username: "bob", password: "bobs-password" });

    const response = await request(app)
      .put(`/api/users/${bob.id}`)
      .set("Cookie", adminCookie)
      .send({ username: "Bob" });

    expect(response.status).toBe(500);
    expect(response.body.message).toBe("Server error");
  });

  it("changes a user's password", async () => {
    const bob = await createUserAsAdmin({ username: "bob", password: "bobs-password" });

    await request(app)
      .put(`/api/users/${bob.id}`)
      .set("Cookie", adminCookie)
      .send({ password: "a-new-password" })
      .expect(200);

    await expect(loginAs(app, "bob", "a-new-password")).resolves.toBeTruthy();
    await request(app)
      .post("/api/auth/login")
      .send({ username: "bob", password: "bobs-password" })
      .expect(401);
  });

  it("promotes a user to admin", async () => {
    const bob = await createUserAsAdmin({ username: "bob", password: "bobs-password" });

    const response = await request(app)
      .put(`/api/users/${bob.id}`)
      .set("Cookie", adminCookie)
      .send({ isAdmin: true });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ isAdmin: true, role: "admin" });

    const cookie = await loginAs(app, "bob", "bobs-password");
    await request(app).get("/api/users").set("Cookie", cookie).expect(200);
  });

  it("refuses to demote the only admin", async () => {
    const admins = await request(app).get("/api/users").set("Cookie", adminCookie);
    const admin = admins.body.find((user: { role: string }) => user.role === "admin");

    const response = await request(app)
      .put(`/api/users/${admin.id}`)
      .set("Cookie", adminCookie)
      .send({ isAdmin: false });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Cannot remove admin privileges from the last admin user");
  });

  it("demotes an admin once another one exists", async () => {
    const second = await createUserAsAdmin({
      username: "root",
      password: "roots-password",
      isAdmin: true,
    });

    const response = await request(app)
      .put(`/api/users/${second.id}`)
      .set("Cookie", adminCookie)
      .send({ isAdmin: false });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ isAdmin: false, role: "user" });

    const cookie = await loginAs(app, "root", "roots-password");
    await request(app).get("/api/users").set("Cookie", cookie).expect(403);
  });

  it("clears the forced password change", async () => {
    const bob = await createUserAsAdmin({ username: "bob", password: "bobs-password" });

    const response = await request(app)
      .put(`/api/users/${bob.id}`)
      .set("Cookie", adminCookie)
      .send({ forceChangePassword: false });

    expect(response.status).toBe(200);
    expect(response.body.forceChangePassword).toBe(false);
  });

  // KNOWN BUG (recorded, not fixed): with nothing to change, the handler still
  // issues an UPDATE with an empty SET clause, which drizzle refuses. A no-op
  // request should be a no-op, not a 500.
  it("answers 500 for a request that changes nothing", async () => {
    const bob = await createUserAsAdmin({ username: "bob", password: "bobs-password" });

    const response = await request(app).put(`/api/users/${bob.id}`).set("Cookie", adminCookie).send({});

    expect(response.status).toBe(500);
    expect(response.body.message).toBe("Server error");
  });
});

describe("DELETE /api/users/:id", () => {
  it("rejects a non-admin", async () => {
    const cookie = await registerAndVerify(app, alice);
    const bob = await createUserAsAdmin({ username: "bob", password: "bobs-password" });

    const response = await request(app).delete(`/api/users/${bob.id}`).set("Cookie", cookie);

    expect(response.status).toBe(403);
  });

  it("rejects an id that is not a number", async () => {
    const response = await request(app).delete("/api/users/not-a-number").set("Cookie", adminCookie);

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Invalid user ID");
  });

  it("reports an unknown user as not found", async () => {
    const response = await request(app).delete("/api/users/9999").set("Cookie", adminCookie);

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("User not found");
  });

  it("deletes a user, who can then no longer log in", async () => {
    const bob = await createUserAsAdmin({ username: "bob", password: "bobs-password" });

    const response = await request(app).delete(`/api/users/${bob.id}`).set("Cookie", adminCookie);

    expect(response.status).toBe(204);
    await request(app)
      .post("/api/auth/login")
      .send({ username: "bob", password: "bobs-password" })
      .expect(401);
  });

  it("refuses to delete the only admin", async () => {
    const admins = await request(app).get("/api/users").set("Cookie", adminCookie);
    const admin = admins.body.find((user: { role: string }) => user.role === "admin");

    const response = await request(app).delete(`/api/users/${admin.id}`).set("Cookie", adminCookie);

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Cannot delete the last admin user");
  });

  it("deletes an admin once another one exists", async () => {
    const second = await createUserAsAdmin({
      username: "root",
      password: "roots-password",
      isAdmin: true,
    });

    const response = await request(app).delete(`/api/users/${second.id}`).set("Cookie", adminCookie);

    expect(response.status).toBe(204);
  });
});

describe("/api/user-sharing", () => {
  it("rejects requests with no session cookie", async () => {
    await request(app).get("/api/user-sharing").expect(401);
    await request(app).post("/api/user-sharing").send({ isPublic: true }).expect(401);
  });

  it("starts with nothing shared", async () => {
    const cookie = await registerAndVerify(app, alice);

    const response = await request(app).get("/api/user-sharing").set("Cookie", cookie);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it("shares one material and reads it back", async () => {
    const cookie = await registerAndVerify(app, alice);
    const petg = await storage.createMaterial({ name: "PETG" });

    const created = await request(app)
      .post("/api/user-sharing")
      .set("Cookie", cookie)
      .send({ materialId: petg.id, isPublic: true });

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ materialId: petg.id, isPublic: true });

    const listed = await request(app).get("/api/user-sharing").set("Cookie", cookie);
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0]).toMatchObject({ materialId: petg.id, isPublic: true });
  });

  it("replaces the existing setting for a material rather than adding a second", async () => {
    const cookie = await registerAndVerify(app, alice);
    const petg = await storage.createMaterial({ name: "PETG" });

    await request(app)
      .post("/api/user-sharing")
      .set("Cookie", cookie)
      .send({ materialId: petg.id, isPublic: true })
      .expect(201);
    await request(app)
      .post("/api/user-sharing")
      .set("Cookie", cookie)
      .send({ materialId: petg.id, isPublic: false })
      .expect(201);

    const listed = await request(app).get("/api/user-sharing").set("Cookie", cookie);
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0].isPublic).toBe(false);
  });

  it("defaults isPublic to false when it is left out", async () => {
    const cookie = await registerAndVerify(app, alice);
    const petg = await storage.createMaterial({ name: "PETG" });

    const created = await request(app)
      .post("/api/user-sharing")
      .set("Cookie", cookie)
      .send({ materialId: petg.id });

    expect(created.status).toBe(201);
    expect(created.body.isPublic).toBe(false);
  });

  it("shows a user only their own settings", async () => {
    const aliceCookie = await registerAndVerify(app, alice);
    const petg = await storage.createMaterial({ name: "PETG" });
    await request(app)
      .post("/api/user-sharing")
      .set("Cookie", aliceCookie)
      .send({ materialId: petg.id, isPublic: true })
      .expect(201);

    const bobCookie = await registerAndVerify(app, {
      username: "bob",
      email: "bob@example.com",
      password: "bobs-password",
    });

    const response = await request(app).get("/api/user-sharing").set("Cookie", bobCookie);
    expect(response.body).toEqual([]);
  });
});

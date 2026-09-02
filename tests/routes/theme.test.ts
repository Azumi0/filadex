/**
 * Characterisation tests for server/routes/theme.ts.
 *
 * These record observable behaviour at the HTTP boundary, so that moving the
 * database access behind IStorage can be shown to change nothing.
 */
import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { registerAuthRoutes } from "../../server/routes/auth";
import { registerThemeRoutes } from "../../server/routes/theme";
import { createApp, registerAndVerify } from "../helpers/app";

let app: Express;
let cookie: string;

// Mock credentials for a throwaway test database - not a real login anywhere, so
// the password below is safe to keep in the repository (hence the ggignore tag).
const alice = { username: "alice", email: "alice@example.com", password: "correct-horse" }; // ggignore

beforeEach(async () => {
  app = createApp(registerAuthRoutes, registerThemeRoutes);
  cookie = await registerAndVerify(app, alice);
});

describe("GET /api/theme", () => {
  it("rejects a request with no session cookie", async () => {
    const response = await request(app).get("/api/theme");

    expect(response.status).toBe(401);
  });

  it("returns the defaults a new account starts with", async () => {
    const response = await request(app).get("/api/theme").set("Cookie", cookie);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      variant: "professional",
      primary: "#EA580C",
      appearance: "dark",
      // themeRadius is a numeric column, which drizzle hands back as a string
      radius: "0.8",
    });
  });
});

describe("POST /api/theme", () => {
  it("rejects a request with no session cookie", async () => {
    const response = await request(app).post("/api/theme").send({ appearance: "light" });

    expect(response.status).toBe(401);
  });

  it("stores every part of the theme", async () => {
    const response = await request(app)
      .post("/api/theme")
      .set("Cookie", cookie)
      .send({ variant: "tint", primary: "#00FF00", appearance: "light", radius: 1.25 });

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Theme updated successfully");

    const after = await request(app).get("/api/theme").set("Cookie", cookie);
    expect(after.body).toEqual({
      variant: "tint",
      primary: "#00FF00",
      appearance: "light",
      radius: "1.25",
    });
  });

  it("leaves the parts that were not sent alone", async () => {
    await request(app).post("/api/theme").set("Cookie", cookie).send({ appearance: "light" }).expect(200);

    const after = await request(app).get("/api/theme").set("Cookie", cookie);
    expect(after.body).toEqual({
      variant: "professional",
      primary: "#EA580C",
      appearance: "light",
      radius: "0.8",
    });
  });

  it("accepts an empty body and changes nothing", async () => {
    const response = await request(app).post("/api/theme").set("Cookie", cookie).send({});

    expect(response.status).toBe(200);
    const after = await request(app).get("/api/theme").set("Cookie", cookie);
    expect(after.body.appearance).toBe("dark");
  });

  it.each([
    ["a colour that is not hex", { primary: "red" }, 'Validation error: Must be a hex color like #EA580C at "primary"'],
    [
      "an unknown appearance",
      { appearance: "neon" },
      "Validation error: Invalid enum value. Expected 'light' | 'dark', received 'neon' at \"appearance\"",
    ],
    ["a radius above 2", { radius: 5 }, 'Validation error: Number must be less than or equal to 2 at "radius"'],
    ["a negative radius", { radius: -1 }, 'Validation error: Number must be greater than or equal to 0 at "radius"'],
  ])("rejects %s", async (_label, body, message) => {
    const response = await request(app).post("/api/theme").set("Cookie", cookie).send(body);

    expect(response.status).toBe(400);
    expect(response.body.message).toBe(message);
  });

  it("keeps each user's theme to themselves", async () => {
    await request(app).post("/api/theme").set("Cookie", cookie).send({ appearance: "light" }).expect(200);

    const bobCookie = await registerAndVerify(app, {
      username: "bob",
      email: "bob@example.com",
      password: "bobs-password",
    });

    const bobTheme = await request(app).get("/api/theme").set("Cookie", bobCookie);
    expect(bobTheme.body.appearance).toBe("dark");
  });
});

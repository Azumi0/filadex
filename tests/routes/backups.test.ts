import { beforeEach, afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { registerAuthRoutes } from "../../server/routes/auth";
import { registerBackupRoutes } from "../../server/routes/backups";
import { initializeAdminUser } from "../../server/auth";
import { storage } from "../../server/storage";
import { createApp, loginAs, registerAndVerify } from "../helpers/app";

let app: Express;
let adminCookie: string;
let userCookie: string;
let testBackupDir: string;

beforeEach(async () => {
  testBackupDir = fs.mkdtempSync(path.join(os.tmpdir(), "filadex-backup-test-"));
  process.env.BACKUP_DIR = testBackupDir;

  app = createApp(registerAuthRoutes, registerBackupRoutes);
  await initializeAdminUser();
  adminCookie = await loginAs(app, "admin", "admin");
  userCookie = await registerAndVerify(app, {
    username: "bob",
    email: "bob@example.com",
    password: "bob-password-123",
  });
});

afterEach(() => {
  if (testBackupDir && fs.existsSync(testBackupDir)) {
    fs.rmSync(testBackupDir, { recursive: true, force: true });
  }
});

describe("GET /api/system/database", () => {
  it("reports the current database dialect", async () => {
    const res = await request(app).get("/api/system/database");
    expect(res.status).toBe(200);
    expect(["postgres", "sqlite"]).toContain(res.body.dialect);
    expect(res.body.dialect).toBe(storage.getDialect());
  });
});

describe("Backup routes on Postgres", () => {
  it("refuses all backup endpoints if dialect is Postgres", async () => {
    if (storage.getDialect() !== "postgres") return;

    const listRes = await request(app)
      .get("/api/admin/backups")
      .set("Cookie", adminCookie);
    expect(listRes.status).toBe(400);
    expect(listRes.body.message).toMatch(/only supported on SQLite/i);

    const postRes = await request(app)
      .post("/api/admin/backups")
      .set("Cookie", adminCookie);
    expect(postRes.status).toBe(400);

    const streamRes = await request(app)
      .post("/api/admin/backups/stream")
      .set("Cookie", adminCookie);
    expect(streamRes.status).toBe(400);

    const settingsRes = await request(app)
      .get("/api/admin/backups/settings")
      .set("Cookie", adminCookie);
    expect(settingsRes.status).toBe(400);
  });
});

describe("Backup routes on SQLite", () => {
  it("rejects unauthenticated requests", async () => {
    if (storage.getDialect() !== "sqlite") return;

    const res = await request(app).get("/api/admin/backups");
    expect(res.status).toBe(401);
  });

  it("rejects authenticated non-admin users", async () => {
    if (storage.getDialect() !== "sqlite") return;

    const res = await request(app)
      .get("/api/admin/backups")
      .set("Cookie", userCookie);
    expect(res.status).toBe(403);
  });

  it("gets and updates backup settings", async () => {
    if (storage.getDialect() !== "sqlite") return;

    const initial = await request(app)
      .get("/api/admin/backups/settings")
      .set("Cookie", adminCookie);
    expect(initial.status).toBe(200);
    expect(initial.body.schedule).toBe("off");

    const update = await request(app)
      .put("/api/admin/backups/settings")
      .set("Cookie", adminCookie)
      .send({
        enabled: true,
        schedule: "daily",
        time: "03:30",
        retentionCount: 5,
      });
    expect(update.status).toBe(200);
    expect(update.body.enabled).toBe(true);
    expect(update.body.schedule).toBe("daily");
    expect(update.body.time).toBe("03:30");
    expect(update.body.retentionCount).toBe(5);

    const fetched = await request(app)
      .get("/api/admin/backups/settings")
      .set("Cookie", adminCookie);
    expect(fetched.status).toBe(200);
    expect(fetched.body.time).toBe("03:30");
  });

  it("creates a backup on disk, updates lastBackupAt, and prunes old backups", async () => {
    if (storage.getDialect() !== "sqlite") return;

    await storage.updateBackupSettings({ retentionCount: 2 });

    const create1 = await request(app)
      .post("/api/admin/backups")
      .set("Cookie", adminCookie);
    expect(create1.status).toBe(201);
    expect(create1.body.filename).toMatch(/^filadex-backup-.*\.db$/);
    expect(create1.body.size).toBeGreaterThan(0);

    const fullPath1 = path.join(testBackupDir, create1.body.filename);
    expect(fs.existsSync(fullPath1)).toBe(true);

    const header = Buffer.alloc(16);
    const fd = fs.openSync(fullPath1, "r");
    fs.readSync(fd, header, 0, 16, 0);
    fs.closeSync(fd);
    expect(header.toString("utf8", 0, 15)).toBe("SQLite format 3");

    // Wait 15ms so timestamp differences distinguish filenames
    await new Promise((resolve) => setTimeout(resolve, 15));
    const create2 = await request(app)
      .post("/api/admin/backups")
      .set("Cookie", adminCookie);
    expect(create2.status).toBe(201);

    await new Promise((resolve) => setTimeout(resolve, 15));
    const create3 = await request(app)
      .post("/api/admin/backups")
      .set("Cookie", adminCookie);
    expect(create3.status).toBe(201);

    // List backups: should have at most retentionCount (2)
    const list = await request(app)
      .get("/api/admin/backups")
      .set("Cookie", adminCookie);
    expect(list.status).toBe(200);
    expect(list.body.length).toBe(2);
    expect(list.body[0].filename).toBe(create3.body.filename);
    expect(list.body[1].filename).toBe(create2.body.filename);
  });

  it("downloads a backup file and rejects path traversal attempts", async () => {
    if (storage.getDialect() !== "sqlite") return;

    const create = await request(app)
      .post("/api/admin/backups")
      .set("Cookie", adminCookie);
    expect(create.status).toBe(201);
    const filename = create.body.filename;

    const dl = await request(app)
      .get(`/api/admin/backups/${filename}`)
      .set("Cookie", adminCookie);
    expect(dl.status).toBe(200);
    expect(dl.headers["content-disposition"]).toContain(filename);
    expect(dl.body.length).toBeGreaterThan(0);

    // Path traversal attempts
    const traversal1 = await request(app)
      .get("/api/admin/backups/..%2f..%2fpackage.json")
      .set("Cookie", adminCookie);
    expect(traversal1.status).toBe(400);

    const traversal2 = await request(app)
      .get("/api/admin/backups/%2e%2e%2fsecret.txt")
      .set("Cookie", adminCookie);
    expect(traversal2.status).toBe(400);

    const notFound = await request(app)
      .get("/api/admin/backups/nonexistent-backup.db")
      .set("Cookie", adminCookie);
    expect(notFound.status).toBe(404);
  });

  it("deletes a backup file", async () => {
    if (storage.getDialect() !== "sqlite") return;

    const create = await request(app)
      .post("/api/admin/backups")
      .set("Cookie", adminCookie);
    expect(create.status).toBe(201);
    const filename = create.body.filename;

    const del = await request(app)
      .delete(`/api/admin/backups/${filename}`)
      .set("Cookie", adminCookie);
    expect(del.status).toBe(200);
    expect(del.body.success).toBe(true);

    expect(fs.existsSync(path.join(testBackupDir, filename))).toBe(false);
  });

  it("streams a snapshot without leaving a persistent file", async () => {
    if (storage.getDialect() !== "sqlite") return;

    const res = await request(app)
      .post("/api/admin/backups/stream")
      .set("Cookie", adminCookie)
      .responseType("blob");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/x-sqlite3");
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename="filadex-backup-.*\.db"/);
    expect(res.body.length).toBeGreaterThan(0);

    const header = res.body.slice(0, 15).toString("utf8");
    expect(header).toBe("SQLite format 3");

    // No files should be left in testBackupDir
    const files = fs.readdirSync(testBackupDir);
    expect(files.length).toBe(0);
  });
});

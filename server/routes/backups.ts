import type { Express, Request, Response, NextFunction } from "express";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { nanoid } from "nanoid";
import { ZodError } from "zod";
import { fromZodError } from "zod-validation-error";
import { authenticate, isAdmin } from "../auth";
import { storage } from "../storage";
import { updateBackupSettingsSchema } from "@shared/schema";
import { logger } from "../utils/logger";

export function getBackupDir(): string {
  if (process.env.BACKUP_DIR) {
    return path.resolve(process.env.BACKUP_DIR);
  }
  if (process.env.NODE_ENV === "production") {
    return "/data/backups";
  }
  return path.resolve(process.cwd(), "data", "backups");
}

export function pruneBackups(backupDir: string, retentionCount: number): void {
  if (!fs.existsSync(backupDir)) return;
  const files = fs.readdirSync(backupDir).filter((f) => f.endsWith(".db") || f.endsWith(".sqlite"));
  const withStats = files.map((file) => {
    const fullPath = path.join(backupDir, file);
    try {
      return { file, fullPath, mtime: fs.statSync(fullPath).mtimeMs };
    } catch {
      return null;
    }
  }).filter((x): x is { file: string; fullPath: string; mtime: number } => x !== null);

  withStats.sort((a, b) => b.mtime - a.mtime); // newest first

  if (withStats.length > retentionCount) {
    const toDelete = withStats.slice(retentionCount);
    for (const item of toDelete) {
      try {
        fs.unlinkSync(item.fullPath);
      } catch (err) {
        logger.error(`Failed to prune backup ${item.fullPath}:`, err);
      }
    }
  }
}

export async function createBackupFile(): Promise<{ filename: string; size: number; createdAt: string }> {
  const backupDir = getBackupDir();
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `filadex-backup-${timestamp}.db`;
  const fullPath = path.join(backupDir, filename);

  await storage.createBackup(fullPath);

  const stat = fs.statSync(fullPath);
  await storage.updateBackupSettings({ lastBackupAt: new Date() });

  const settings = await storage.getBackupSettings();
  const retentionCount = settings?.retentionCount ?? 7;
  pruneBackups(backupDir, retentionCount);

  return {
    filename,
    size: stat.size,
    createdAt: stat.mtime.toISOString(),
  };
}

function resolveBackupPath(filename: string): string | null {
  const base = path.basename(filename);
  if (base !== filename || filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    return null;
  }
  if (!filename.endsWith(".db") && !filename.endsWith(".sqlite")) {
    return null;
  }
  const backupDir = getBackupDir();
  const fullPath = path.resolve(backupDir, filename);
  const resolvedDir = path.resolve(backupDir);
  if (!fullPath.startsWith(resolvedDir + path.sep)) {
    return null;
  }
  return fullPath;
}

function requireSqliteDialect(_req: Request, res: Response, next: NextFunction) {
  if (storage.getDialect() !== "sqlite") {
    return res.status(400).json({ message: "Backups are only supported on SQLite installations" });
  }
  next();
}

export function registerBackupRoutes(app: Express): void {
  // System database dialect information (open to any authenticated or client query)
  app.get("/api/system/database", (_req: Request, res: Response) => {
    res.json({ dialect: storage.getDialect() });
  });

  // Get backup settings (admin only, SQLite only)
  app.get("/api/admin/backups/settings", authenticate, isAdmin, requireSqliteDialect, async (_req: Request, res: Response) => {
    try {
      const settings = await storage.getBackupSettings();
      if (!settings) {
        return res.json({
          id: 1,
          enabled: false,
          schedule: "off",
          time: "02:00",
          dayOfWeek: 1,
          retentionCount: 7,
          lastBackupAt: null,
        });
      }
      res.json(settings);
    } catch (error) {
      logger.error("Error fetching backup settings:", error);
      res.status(500).json({ message: "Failed to fetch backup settings" });
    }
  });

  // Update backup settings (admin only, SQLite only)
  app.put("/api/admin/backups/settings", authenticate, isAdmin, requireSqliteDialect, async (req: Request, res: Response) => {
    try {
      const validated = updateBackupSettingsSchema.partial().parse(req.body);
      const updated = await storage.updateBackupSettings(validated);
      res.json(updated);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        return res.status(400).json({ message: validationError.message });
      }
      logger.error("Error updating backup settings:", error);
      res.status(500).json({ message: "Failed to update backup settings" });
    }
  });

  // List existing backups on disk (admin only, SQLite only)
  app.get("/api/admin/backups", authenticate, isAdmin, requireSqliteDialect, async (_req: Request, res: Response) => {
    try {
      const backupDir = getBackupDir();
      if (!fs.existsSync(backupDir)) {
        return res.json([]);
      }
      const files = fs.readdirSync(backupDir).filter((f) => f.endsWith(".db") || f.endsWith(".sqlite"));
      const backups = files.map((file) => {
        const fullPath = path.join(backupDir, file);
        try {
          const stat = fs.statSync(fullPath);
          return {
            filename: file,
            size: stat.size,
            createdAt: stat.mtime.toISOString(),
          };
        } catch {
          return null;
        }
      }).filter((item): item is { filename: string; size: number; createdAt: string } => item !== null);

      backups.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      res.json(backups);
    } catch (error) {
      logger.error("Error listing backups:", error);
      res.status(500).json({ message: "Failed to list backups" });
    }
  });

  // Trigger immediate backup snapshot to disk (admin only, SQLite only)
  app.post("/api/admin/backups", authenticate, isAdmin, requireSqliteDialect, async (_req: Request, res: Response) => {
    try {
      const result = await createBackupFile();
      res.status(201).json(result);
    } catch (error) {
      logger.error("Error creating backup:", error);
      res.status(500).json({ message: "Failed to create database backup" });
    }
  });

  // Stream a fresh snapshot directly without leaving a persistent file behind (admin only, SQLite only)
  app.post("/api/admin/backups/stream", authenticate, isAdmin, requireSqliteDialect, async (_req: Request, res: Response) => {
    const tempFile = path.join(os.tmpdir(), `filadex-snapshot-${nanoid()}.db`);
    try {
      await storage.createBackup(tempFile);
      const stat = fs.statSync(tempFile);

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      res.setHeader("Content-Type", "application/x-sqlite3");
      res.setHeader("Content-Disposition", `attachment; filename="filadex-backup-${timestamp}.db"`);
      res.setHeader("Content-Length", stat.size);

      const stream = fs.createReadStream(tempFile);
      stream.pipe(res);

      const cleanup = () => {
        try {
          if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        } catch {}
      };
      res.on("finish", cleanup);
      res.on("close", cleanup);
    } catch (error) {
      try {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      } catch {}
      logger.error("Error streaming backup snapshot:", error);
      res.status(500).json({ message: "Failed to stream backup snapshot" });
    }
  });

  // Download an existing backup file (admin only, SQLite only, strict path containment)
  app.get("/api/admin/backups/:filename", authenticate, isAdmin, requireSqliteDialect, async (req: Request, res: Response) => {
    const filePath = resolveBackupPath(req.params.filename);
    if (!filePath) {
      return res.status(400).json({ message: "Invalid backup filename" });
    }
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: "Backup file not found" });
    }

    res.download(filePath, path.basename(filePath));
  });

  // Delete an existing backup file (admin only, SQLite only)
  app.delete("/api/admin/backups/:filename", authenticate, isAdmin, requireSqliteDialect, async (req: Request, res: Response) => {
    const filePath = resolveBackupPath(req.params.filename);
    if (!filePath) {
      return res.status(400).json({ message: "Invalid backup filename" });
    }
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: "Backup file not found" });
    }

    try {
      fs.unlinkSync(filePath);
      res.json({ success: true });
    } catch (error) {
      logger.error("Error deleting backup file:", error);
      res.status(500).json({ message: "Failed to delete backup file" });
    }
  });
}

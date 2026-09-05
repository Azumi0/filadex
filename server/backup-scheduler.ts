import { storage } from "./storage";
import { createBackupFile } from "./routes/backups";
import { logger } from "./utils/logger";

import type { BackupSettings } from "@shared/schema";

const CHECK_INTERVAL_MS = 60 * 1000; // Check every 60 seconds

export function isBackupDue(settings: Partial<BackupSettings> | null | undefined, now: Date = new Date()): boolean {
  if (!settings || !settings.enabled || settings.schedule === "off") {
    return false;
  }

  const [targetH, targetM] = (settings.time || "").split(":").map(Number);
  if (isNaN(targetH) || isNaN(targetM) || targetH < 0 || targetH > 23 || targetM < 0 || targetM > 59) {
    return false;
  }

  // 1-hour dedupe guard: never run if a backup completed less than 1 hour ago
  if (settings.lastBackupAt) {
    const last = new Date(settings.lastBackupAt);
    const diffMs = now.getTime() - last.getTime();
    if (diffMs < 60 * 60 * 1000) {
      return false;
    }
  }

  if (settings.schedule === "daily") {
    const targetToday = new Date(now);
    targetToday.setHours(targetH, targetM, 0, 0);

    if (now.getTime() < targetToday.getTime()) {
      return false;
    }

    if (settings.lastBackupAt) {
      const last = new Date(settings.lastBackupAt);
      if (last.getTime() >= targetToday.getTime()) {
        return false;
      }
    }

    return true;
  }

  if (settings.schedule === "weekly") {
    const day = now.getDay() === 0 ? 7 : now.getDay();
    if (day !== (settings.dayOfWeek ?? 1)) {
      return false;
    }

    const targetToday = new Date(now);
    targetToday.setHours(targetH, targetM, 0, 0);

    if (now.getTime() < targetToday.getTime()) {
      return false;
    }

    if (settings.lastBackupAt) {
      const last = new Date(settings.lastBackupAt);
      if (last.getTime() >= targetToday.getTime()) {
        return false;
      }
    }

    return true;
  }

  return false;
}

export async function runScheduledBackupCheck(): Promise<void> {
  if (storage.getDialect() !== "sqlite") {
    return;
  }

  const settings = await storage.getBackupSettings();
  if (!isBackupDue(settings)) {
    return;
  }

  logger.info("Executing scheduled SQLite database backup...");
  try {
    const result = await createBackupFile();
    logger.info(`Scheduled backup completed successfully: ${result.filename} (${result.size} bytes)`);
  } catch (error) {
    logger.error("Scheduled backup failed:", error);
  }
}

export function startBackupScheduler(): NodeJS.Timeout | null {
  if (storage.getDialect() !== "sqlite") {
    return null;
  }

  return setInterval(() => {
    runScheduledBackupCheck().catch((error) => {
      logger.error("Error during scheduled backup check:", error);
    });
  }, CHECK_INTERVAL_MS);
}

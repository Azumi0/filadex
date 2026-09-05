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

  let daysAgo = 0;
  if (settings.schedule === "weekly") {
    const currentDay = now.getDay() === 0 ? 7 : now.getDay();
    const targetDay = settings.dayOfWeek ?? 1;
    daysAgo = (currentDay - targetDay + 7) % 7;
  } else if (settings.schedule !== "daily") {
    return false;
  }

  const target = new Date(now);
  target.setDate(now.getDate() - daysAgo);
  target.setHours(targetH, targetM, 0, 0);

  if (now.getTime() < target.getTime()) {
    return false;
  }

  if (settings.lastBackupAt) {
    const last = new Date(settings.lastBackupAt);
    if (last.getTime() >= target.getTime()) {
      return false;
    }
  }

  return true;
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

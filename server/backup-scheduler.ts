import { storage } from "./storage";
import { createBackupFile } from "./routes/backups";
import { logger } from "./utils/logger";

import type { BackupSettings } from "@shared/schema";

const CHECK_INTERVAL_MS = 60 * 1000; // Check every 60 seconds

export function isBackupDue(settings: Partial<BackupSettings> | null | undefined, now: Date = new Date()): boolean {
  if (!settings || !settings.enabled) {
    return false;
  }

  if (settings.schedule !== "daily" && settings.schedule !== "weekly") {
    return false;
  }

  const [targetH, targetM] = (settings.time || "").split(":").map(Number);
  if (isNaN(targetH) || isNaN(targetM) || targetH < 0 || targetH > 23 || targetM < 0 || targetM > 59) {
    return false;
  }

  const lastBackupAt = settings.lastBackupAt ? new Date(settings.lastBackupAt) : null;

  // 1-hour dedupe guard: never run if a backup completed less than 1 hour ago
  if (lastBackupAt && now.getTime() - lastBackupAt.getTime() < 60 * 60 * 1000) {
    return false;
  }

  // Walk back to the scheduled slot that has most recently passed, rather than
  // testing for an exact match: a delayed tick or a restart must not lose a run.
  const periodDays = settings.schedule === "weekly" ? 7 : 1;
  const daysSinceScheduledDay =
    settings.schedule === "weekly"
      ? ((now.getDay() === 0 ? 7 : now.getDay()) - (settings.dayOfWeek ?? 1) + 7) % 7
      : 0;

  const target = new Date(now);
  target.setDate(now.getDate() - daysSinceScheduledDay);
  target.setHours(targetH, targetM, 0, 0);

  // On the scheduled day itself the slot may still be ahead of us; the most
  // recent one that has passed is then a whole period earlier.
  if (now.getTime() < target.getTime()) {
    target.setDate(target.getDate() - periodDays);
  }

  return !lastBackupAt || lastBackupAt.getTime() < target.getTime();
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

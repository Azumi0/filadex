import { storage } from "./storage";
import { createBackupFile } from "./routes/backups";
import { logger } from "./utils/logger";

const CHECK_INTERVAL_MS = 60 * 1000; // Check every 60 seconds

export async function runScheduledBackupCheck(): Promise<void> {
  if (storage.getDialect() !== "sqlite") {
    return;
  }

  const settings = await storage.getBackupSettings();
  if (!settings || !settings.enabled || settings.schedule === "off") {
    return;
  }

  const now = new Date();
  const [targetH, targetM] = settings.time.split(":").map(Number);
  if (isNaN(targetH) || isNaN(targetM)) {
    return;
  }

  const currentH = now.getHours();
  const currentM = now.getMinutes();

  if (currentH !== targetH || currentM !== targetM) {
    return;
  }

  if (settings.schedule === "weekly") {
    const day = now.getDay() === 0 ? 7 : now.getDay();
    if (day !== (settings.dayOfWeek ?? 1)) {
      return;
    }
  }

  if (settings.lastBackupAt) {
    const last = new Date(settings.lastBackupAt);
    const diffMs = now.getTime() - last.getTime();
    if (diffMs < 60 * 60 * 1000) {
      // Already backed up within the last hour
      return;
    }
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

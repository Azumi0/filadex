import { describe, expect, it, vi } from "vitest";
import { isBackupDue, runScheduledBackupCheck } from "../server/backup-scheduler";
import { storage } from "../server/storage";
import type { BackupSettings } from "@shared/schema";

describe("isBackupDue", () => {
  it("returns false if settings is null or undefined or disabled or off", () => {
    expect(isBackupDue(null)).toBe(false);
    expect(isBackupDue(undefined)).toBe(false);
    expect(isBackupDue({ id: 1, enabled: false, schedule: "daily", time: "02:00", dayOfWeek: 1, retentionCount: 7, lastBackupAt: null })).toBe(false);
    expect(isBackupDue({ id: 1, enabled: true, schedule: "off", time: "02:00", dayOfWeek: 1, retentionCount: 7, lastBackupAt: null })).toBe(false);
  });

  it("returns false if time format is invalid", () => {
    const settings: Partial<BackupSettings> = {
      id: 1,
      enabled: true,
      schedule: "daily",
      time: "invalid",
      dayOfWeek: 1,
      retentionCount: 7,
      lastBackupAt: null,
    };
    expect(isBackupDue(settings, new Date(2026, 8, 5, 2, 0, 0))).toBe(false);
  });

  it("returns true when current time is exactly at scheduled daily target", () => {
    const settings: Partial<BackupSettings> = {
      id: 1,
      enabled: true,
      schedule: "daily",
      time: "02:00",
      dayOfWeek: 1,
      retentionCount: 7,
      lastBackupAt: new Date(2026, 8, 4, 2, 0, 0), // yesterday
    };
    const now = new Date(2026, 8, 5, 2, 0, 0);
    expect(isBackupDue(settings, now)).toBe(true);
  });

  it("returns true when a tick is delayed or missed (A2 bug: current minute > target minute)", () => {
    const settings: Partial<BackupSettings> = {
      id: 1,
      enabled: true,
      schedule: "daily",
      time: "02:00",
      dayOfWeek: 1,
      retentionCount: 7,
      lastBackupAt: new Date(2026, 8, 4, 2, 0, 0), // yesterday
    };
    // 3 minutes late due to system delay
    const now = new Date(2026, 8, 5, 2, 3, 0);
    expect(isBackupDue(settings, now)).toBe(true);
  });

  it("returns true when server restarts past the target hour (A2 bug: restarted at 03:30)", () => {
    const settings: Partial<BackupSettings> = {
      id: 1,
      enabled: true,
      schedule: "daily",
      time: "02:00",
      dayOfWeek: 1,
      retentionCount: 7,
      lastBackupAt: new Date(2026, 8, 4, 2, 0, 0), // yesterday
    };
    const now = new Date(2026, 8, 5, 3, 30, 0);
    expect(isBackupDue(settings, now)).toBe(true);
  });

  it("returns false if time has not arrived yet today", () => {
    const settings: Partial<BackupSettings> = {
      id: 1,
      enabled: true,
      schedule: "daily",
      time: "02:00",
      dayOfWeek: 1,
      retentionCount: 7,
      lastBackupAt: new Date(2026, 8, 4, 2, 0, 0),
    };
    const now = new Date(2026, 8, 5, 1, 59, 0);
    expect(isBackupDue(settings, now)).toBe(false);
  });

  it("returns false if already backed up today after scheduled target time", () => {
    const settings: Partial<BackupSettings> = {
      id: 1,
      enabled: true,
      schedule: "daily",
      time: "02:00",
      dayOfWeek: 1,
      retentionCount: 7,
      lastBackupAt: new Date(2026, 8, 5, 2, 1, 0), // backed up today at 02:01
    };
    // Checking at 04:00 today
    const now = new Date(2026, 8, 5, 4, 0, 0);
    expect(isBackupDue(settings, now)).toBe(false);
  });

  it("respects the 1-hour dedupe guard", () => {
    const settings: Partial<BackupSettings> = {
      id: 1,
      enabled: true,
      schedule: "daily",
      time: "02:00",
      dayOfWeek: 1,
      retentionCount: 7,
      lastBackupAt: new Date(2026, 8, 5, 1, 45, 0), // 15 mins ago
    };
    const now = new Date(2026, 8, 5, 2, 0, 0);
    expect(isBackupDue(settings, now)).toBe(false);
  });

  it("handles weekly schedule correctly on correct day and wrong day", () => {
    // 2026-09-07 is a Monday (dayOfWeek = 1)
    // 2026-09-08 is a Tuesday (dayOfWeek = 2)
    const settings: Partial<BackupSettings> = {
      id: 1,
      enabled: true,
      schedule: "weekly",
      time: "03:00",
      dayOfWeek: 1, // Monday
      retentionCount: 7,
      lastBackupAt: new Date(2026, 7, 31, 3, 0, 0), // Last Monday
    };

    // Tuesday at 03:00 -> false
    expect(isBackupDue(settings, new Date(2026, 8, 8, 3, 0, 0))).toBe(false);

    // Monday before target -> false
    expect(isBackupDue(settings, new Date(2026, 8, 7, 2, 59, 0))).toBe(false);

    // Monday exactly at target -> true
    expect(isBackupDue(settings, new Date(2026, 8, 7, 3, 0, 0))).toBe(true);

    // Monday 30 minutes late -> true
    expect(isBackupDue(settings, new Date(2026, 8, 7, 3, 30, 0))).toBe(true);
  });
});

describe("runScheduledBackupCheck", () => {
  it("does nothing if dialect is not sqlite", async () => {
    vi.spyOn(storage, "getDialect").mockReturnValue("postgres");
    const getSettingsSpy = vi.spyOn(storage, "getBackupSettings");
    await runScheduledBackupCheck();
    expect(getSettingsSpy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});


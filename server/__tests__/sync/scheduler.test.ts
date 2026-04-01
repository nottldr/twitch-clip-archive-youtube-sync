import type Database from "better-sqlite3";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb } from "#server/db/connection.js";
import { createQuotaRepository } from "#server/db/repositories/quota.js";
import { createScheduler } from "#server/sync/scheduler.js";

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
});

afterEach(() => {
  db.close();
  vi.useRealTimers();
});

function makeScheduler(limit = 10000, cost = 100) {
  const quotaRepo = createQuotaRepository(db);
  return { scheduler: createScheduler(quotaRepo, limit, cost), quotaRepo };
}

describe("canUpload / recordUpload", () => {
  it("allows uploads when quota is available", () => {
    const { scheduler } = makeScheduler();
    expect(scheduler.canUpload()).toBe(true);
  });

  it("blocks uploads when quota is exhausted", () => {
    const { scheduler } = makeScheduler(1000, 100);
    // Use up all quota
    for (let i = 0; i < 10; i++) {
      scheduler.recordUpload();
    }
    expect(scheduler.canUpload()).toBe(false);
  });

  it("the 100th upload succeeds but 101st is blocked at default limits", () => {
    const { scheduler } = makeScheduler(10000, 100);
    for (let i = 0; i < 100; i++) {
      expect(scheduler.canUpload()).toBe(true);
      scheduler.recordUpload();
    }
    expect(scheduler.canUpload()).toBe(false);
  });
});

describe("getQuotaUsage", () => {
  it("returns current day stats", () => {
    const { scheduler } = makeScheduler(10000, 100);
    scheduler.recordUpload();
    scheduler.recordUpload();

    const usage = scheduler.getQuotaUsage();
    expect(usage.used).toBe(200);
    expect(usage.limit).toBe(10000);
    expect(usage.remaining).toBe(9800);
    expect(usage.uploadsToday).toBe(2);
    expect(usage.limitSource).toBe("config");
  });

  it("reflects discovered limit", () => {
    const { scheduler } = makeScheduler(10000, 100);
    scheduler.setDiscoveredLimit(50000);

    const usage = scheduler.getQuotaUsage();
    expect(usage.limit).toBe(50000);
    expect(usage.limitSource).toBe("google-api");
  });
});

describe("quota persistence across restarts", () => {
  it("accounts for pre-existing usage", () => {
    const quotaRepo = createQuotaRepository(db);
    const scheduler1 = createScheduler(quotaRepo, 1000, 100);

    // "First run", use 5 uploads
    for (let i = 0; i < 5; i++) {
      scheduler1.recordUpload();
    }

    // "Second run", same DB, new scheduler instance
    const scheduler2 = createScheduler(quotaRepo, 1000, 100);
    const usage = scheduler2.getQuotaUsage();
    expect(usage.used).toBe(500);
    expect(usage.remaining).toBe(500);
    expect(scheduler2.canUpload()).toBe(true);

    // Use remaining quota
    for (let i = 0; i < 5; i++) {
      scheduler2.recordUpload();
    }
    expect(scheduler2.canUpload()).toBe(false);
  });
});

describe("configurable limits", () => {
  it("respects custom daily limit", () => {
    const { scheduler } = makeScheduler(500, 100);
    for (let i = 0; i < 5; i++) {
      scheduler.recordUpload();
    }
    expect(scheduler.canUpload()).toBe(false);
  });

  it("respects custom upload cost", () => {
    const { scheduler } = makeScheduler(1000, 500);
    scheduler.recordUpload();
    expect(scheduler.canUpload()).toBe(true);
    scheduler.recordUpload();
    expect(scheduler.canUpload()).toBe(false);
  });
});

describe("getQuotaHistory", () => {
  it("returns historical usage with zero-filled gaps", () => {
    const { scheduler, quotaRepo } = makeScheduler();

    // Seed some historical data using fixed dates
    quotaRepo.recordUpload("2026-03-10", 100);
    quotaRepo.recordUpload("2026-03-10", 100);
    quotaRepo.recordUpload("2026-03-12", 100);

    // Request history that covers those dates
    // We'll get a 4-day window and check the structure
    const history = scheduler.getQuotaHistory(4);
    expect(history).toHaveLength(4);

    // Should be ordered oldest first
    expect(history[0].date < history[1].date).toBe(true);
    expect(history[1].date < history[2].date).toBe(true);
    expect(history[2].date < history[3].date).toBe(true);

    // The last entry should be today (PT)
    expect(history[3].date).toBe(scheduler.getTodayPT());
  });

  it("zero-fills days with no uploads", () => {
    const { scheduler } = makeScheduler();
    const history = scheduler.getQuotaHistory(7);

    expect(history).toHaveLength(7);
    for (const entry of history) {
      expect(entry.unitsUsed).toBe(0);
      expect(entry.uploadsCount).toBe(0);
    }
  });

  it("includes seeded data at the correct date", () => {
    const { scheduler, quotaRepo } = makeScheduler();
    const today = scheduler.getTodayPT();
    quotaRepo.recordUpload(today, 100);
    quotaRepo.recordUpload(today, 100);

    const history = scheduler.getQuotaHistory(3);
    const todayEntry = history.find((h) => h.date === today);
    expect(todayEntry).toBeDefined();
    expect(todayEntry!.unitsUsed).toBe(200);
    expect(todayEntry!.uploadsCount).toBe(2);
  });
});

describe("getEstimatedCompletion", () => {
  it("returns 0 days for 0 pending", () => {
    const { scheduler } = makeScheduler();
    const est = scheduler.getEstimatedCompletion(0);
    expect(est.daysRemaining).toBe(0);
    expect(est.estimatedDate).toBeNull();
  });

  it("calculates correct days for pending clips", () => {
    const { scheduler } = makeScheduler(10000, 100);
    // 10000/100 = 100 uploads/day, 500 clips = 5 days
    const est = scheduler.getEstimatedCompletion(500);
    expect(est.daysRemaining).toBe(5);
    expect(est.estimatedDate).toBeTruthy();
  });

  it("rounds up partial days", () => {
    const { scheduler } = makeScheduler(10000, 100);
    // 101 clips / 100 per day = 2 days
    const est = scheduler.getEstimatedCompletion(101);
    expect(est.daysRemaining).toBe(2);
  });
});

describe("msUntilQuotaReset", () => {
  it("returns a positive number", () => {
    const { scheduler } = makeScheduler();
    const ms = scheduler.msUntilQuotaReset();
    expect(ms).toBeGreaterThan(0);
    // Should be less than 24 hours
    expect(ms).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  });
});

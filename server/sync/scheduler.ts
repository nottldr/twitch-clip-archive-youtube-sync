import { Temporal } from "@js-temporal/polyfill";

import type { QuotaRepository } from "#server/db/repositories/quota.js";

const PT = "America/Los_Angeles";

export interface QuotaUsage {
  used: number;
  limit: number;
  limitSource: "google-api" | "config";
  remaining: number;
  uploadsToday: number;
  resetsAt: Date;
}

export interface QuotaHistoryEntry {
  date: string;
  unitsUsed: number;
  uploadsCount: number;
}

export function createScheduler(
  quotaRepo: QuotaRepository,
  dailyQuotaLimit: number,
  uploadCost: number,
) {
  let effectiveLimit = dailyQuotaLimit;
  let limitSource: "google-api" | "config" = "config";

  function setDiscoveredLimit(limit: number): void {
    effectiveLimit = limit;
    limitSource = "google-api";
  }

  function getTodayPT(): string {
    return Temporal.Now.plainDateISO(PT).toString();
  }

  function canUpload(): boolean {
    const usage = quotaRepo.getUsageForDate(getTodayPT());
    return usage.units_used + uploadCost <= effectiveLimit;
  }

  function recordUpload(): void {
    quotaRepo.recordUpload(getTodayPT(), uploadCost);
  }

  function getQuotaUsage(): QuotaUsage {
    const usage = quotaRepo.getUsageForDate(getTodayPT());
    return {
      used: usage.units_used,
      limit: effectiveLimit,
      limitSource,
      remaining: Math.max(0, effectiveLimit - usage.units_used),
      uploadsToday: usage.uploads_count,
      resetsAt: getNextMidnightPT(),
    };
  }

  function getQuotaHistory(days: number): QuotaHistoryEntry[] {
    const raw = quotaRepo.getHistory(days);
    const rawMap = new Map(raw.map((r) => [r.date_pt, r]));

    const today = Temporal.Now.plainDateISO(PT);
    const result: QuotaHistoryEntry[] = [];

    for (let i = days - 1; i >= 0; i--) {
      const date = today.subtract({ days: i });
      const dateStr = date.toString();
      const entry = rawMap.get(dateStr);
      result.push({
        date: dateStr,
        unitsUsed: entry?.units_used ?? 0,
        uploadsCount: entry?.uploads_count ?? 0,
      });
    }

    return result;
  }

  function getEstimatedCompletion(pendingCount: number): {
    daysRemaining: number;
    estimatedDate: string | null;
  } {
    if (pendingCount === 0) {
      return { daysRemaining: 0, estimatedDate: null };
    }

    const uploadsPerDay = Math.floor(effectiveLimit / uploadCost);
    if (uploadsPerDay === 0) {
      return { daysRemaining: Infinity, estimatedDate: null };
    }

    const daysRemaining = Math.ceil(pendingCount / uploadsPerDay);
    const estimated = Temporal.Now.plainDateISO(PT).add({
      days: daysRemaining,
    });

    return {
      daysRemaining,
      estimatedDate: estimated.toString(),
    };
  }

  function msUntilQuotaReset(): number {
    const now = Temporal.Now.zonedDateTimeISO(PT);
    const midnight = now.add({ days: 1 }).startOfDay();
    return midnight.since(now).total("milliseconds");
  }

  function getNextMidnightPT(): Date {
    const ms = msUntilQuotaReset();
    return new Date(Date.now() + ms);
  }

  return {
    canUpload,
    recordUpload,
    getQuotaUsage,
    getQuotaHistory,
    getEstimatedCompletion,
    msUntilQuotaReset,
    getTodayPT,
    setDiscoveredLimit,
  };
}

export type Scheduler = ReturnType<typeof createScheduler>;

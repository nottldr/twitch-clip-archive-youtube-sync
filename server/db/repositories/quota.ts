import type Database from "better-sqlite3";

import { z } from "zod/v4";

import { parseRow, parseRows } from "../parse.js";

export const QuotaUsageRowSchema = z.object({
  date_pt: z.string(),
  units_used: z.number(),
  uploads_count: z.number(),
});

export type QuotaUsageRow = z.infer<typeof QuotaUsageRowSchema>;

export function createQuotaRepository(db: Database.Database) {
  function recordUpload(datePt: string, cost: number): void {
    db.prepare(
      `INSERT INTO quota_usage (date_pt, units_used, uploads_count)
       VALUES (?, ?, 1)
       ON CONFLICT(date_pt) DO UPDATE SET
         units_used = units_used + ?,
         uploads_count = uploads_count + 1,
         updated_at = datetime('now')`,
    ).run(datePt, cost, cost);
  }

  function getUsageForDate(datePt: string): QuotaUsageRow {
    return (
      parseRow(
        QuotaUsageRowSchema,
        db.prepare("SELECT * FROM quota_usage WHERE date_pt = ?").get(datePt),
      ) ?? { date_pt: datePt, units_used: 0, uploads_count: 0 }
    );
  }

  function getHistory(days: number): QuotaUsageRow[] {
    return parseRows(
      QuotaUsageRowSchema,
      db.prepare("SELECT * FROM quota_usage ORDER BY date_pt DESC LIMIT ?").all(days),
    );
  }

  return {
    recordUpload,
    getUsageForDate,
    getHistory,
  };
}

export type QuotaRepository = ReturnType<typeof createQuotaRepository>;

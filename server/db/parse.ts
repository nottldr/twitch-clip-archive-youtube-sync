import type { z } from "zod/v4";

import { createLogger } from "#server/logger.js";

const logger = createLogger("db-parse");

/** Parse a single DB row with a zod schema. Returns undefined if input is falsy. */
export function parseRow<T extends z.ZodType>(schema: T, row: unknown): z.infer<T> | undefined {
  if (!row) return undefined;
  return schema.parse(row);
}

/** Parse an array of DB rows with a zod schema. Strict — throws on any invalid row. */
export function parseRows<T extends z.ZodType>(schema: T, rows: unknown[]): z.infer<T>[] {
  return rows.map((row) => schema.parse(row));
}

/**
 * Parse an array of DB rows, skipping any that fail validation with a warning log.
 * Use for read paths where one corrupt legacy row shouldn't blow up the request.
 * Returns the count of dropped rows alongside the parsed ones so callers can surface it.
 */
export function parseRowsLenient<T extends z.ZodType>(
  schema: T,
  rows: unknown[],
  context: string,
): z.infer<T>[] {
  const ok: z.infer<T>[] = [];
  let skipped = 0;
  let firstError: string | null = null;

  for (const row of rows) {
    const result = schema.safeParse(row);
    if (result.success) {
      ok.push(result.data);
    } else {
      skipped++;
      firstError ??= result.error.message;
    }
  }

  if (skipped > 0) {
    logger.warn({ context, skipped, firstError }, "Dropped invalid DB rows during parse");
  }
  return ok;
}

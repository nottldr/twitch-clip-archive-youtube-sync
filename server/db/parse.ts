import type { z } from "zod/v4";

/** Parse a single DB row with a zod schema. Returns undefined if input is falsy. */
export function parseRow<T extends z.ZodType>(schema: T, row: unknown): z.infer<T> | undefined {
  if (!row) return undefined;
  return schema.parse(row);
}

/** Parse an array of DB rows with a zod schema. */
export function parseRows<T extends z.ZodType>(schema: T, rows: unknown[]): z.infer<T>[] {
  return rows.map((row) => schema.parse(row));
}

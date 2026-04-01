import type { z } from "zod/v4";

export async function fetchJson<T extends z.ZodType>(path: string, schema: T): Promise<z.infer<T>> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const json = await res.json();
  return schema.parse(json);
}

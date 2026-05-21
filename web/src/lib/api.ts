import type { z } from "zod/v4";

class ApiError extends Error {
  status: number;
  body: string | null;
  constructor(status: number, statusText: string, body: string | null) {
    super(`${status} ${statusText}`);
    this.status = status;
    this.body = body;
  }
}

async function readErrorBody(res: Response): Promise<string | null> {
  try {
    return await res.text();
  } catch {
    return null;
  }
}

export async function fetchJson<T extends z.ZodType>(path: string, schema: T): Promise<z.infer<T>> {
  const res = await fetch(path);
  if (!res.ok) throw new ApiError(res.status, res.statusText, await readErrorBody(res));
  const json: unknown = await res.json();
  return schema.parse(json);
}

/**
 * POST JSON to the API and parse the response with a Zod schema. Replaces the
 * hand-rolled `fetch(..., { method: "POST", headers, body: JSON.stringify(...) })`
 * pattern that was sprinkled across every mutation. Throws ApiError on non-2xx.
 *
 * If you don't care about the response body (most action endpoints return
 * `{ ok: true }`), pass the OkResponseSchema export below.
 */
export async function apiPost<T extends z.ZodType>(
  path: string,
  body: unknown,
  schema: T,
): Promise<z.infer<T>> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, res.statusText, await readErrorBody(res));
  const json: unknown = await res.json();
  return schema.parse(json);
}

export { ApiError };

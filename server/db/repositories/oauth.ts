import type Database from "better-sqlite3";

import { z } from "zod/v4";

import { parseRow } from "../parse.js";

export const OAuthTokensSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expiry_date: z.string(),
  scope: z.string(),
  token_type: z.string(),
});

export type OAuthTokens = z.infer<typeof OAuthTokensSchema>;

/**
 * Public-safe token metadata for the diagnostics page. Excludes access_token
 * and refresh_token; callers shouldn't be displaying those in the UI.
 */
export interface OAuthInfo {
  expiry_date: string;
  scope: string;
  token_type: string;
  /** When we last wrote a refresh — i.e. the freshness of the row. */
  updated_at: string;
}

const OAuthInfoSchema = z.object({
  expiry_date: z.string(),
  scope: z.string(),
  token_type: z.string(),
  updated_at: z.string(),
});

export function createOAuthRepository(db: Database.Database) {
  function saveTokens(tokens: OAuthTokens): void {
    db.prepare(
      `INSERT INTO oauth_tokens (id, access_token, refresh_token, expiry_date, scope, token_type)
       VALUES (1, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         access_token = excluded.access_token,
         refresh_token = excluded.refresh_token,
         expiry_date = excluded.expiry_date,
         scope = excluded.scope,
         token_type = excluded.token_type,
         updated_at = datetime('now')`,
    ).run(
      tokens.access_token,
      tokens.refresh_token,
      tokens.expiry_date,
      tokens.scope,
      tokens.token_type,
    );
  }

  function getTokens(): OAuthTokens | null {
    return (
      parseRow(
        OAuthTokensSchema,
        db
          .prepare(
            "SELECT access_token, refresh_token, expiry_date, scope, token_type FROM oauth_tokens WHERE id = 1",
          )
          .get(),
      ) ?? null
    );
  }

  function clearTokens(): void {
    db.prepare("DELETE FROM oauth_tokens WHERE id = 1").run();
  }

  function getInfo(): OAuthInfo | null {
    return (
      parseRow(
        OAuthInfoSchema,
        db
          .prepare(
            "SELECT expiry_date, scope, token_type, updated_at FROM oauth_tokens WHERE id = 1",
          )
          .get(),
      ) ?? null
    );
  }

  return {
    saveTokens,
    getTokens,
    getInfo,
    clearTokens,
  };
}

export type OAuthRepository = ReturnType<typeof createOAuthRepository>;

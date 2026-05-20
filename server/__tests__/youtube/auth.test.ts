import type Database from "better-sqlite3";
import type { OAuth2Client } from "google-auth-library";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb } from "#server/db/connection.js";
import { createOAuthRepository } from "#server/db/repositories/oauth.js";
import { createAuthManagerWithClient } from "#server/youtube/auth.js";

/** Cast a structural fake to OAuth2Client. The factory only touches the four
 *  methods we mock; the rest of OAuth2Client's surface is never exercised. */
// eslint-disable-next-line typescript/no-unsafe-type-assertion -- structural mock; only the mocked methods are reached
const asClient = <T extends object>(fake: T): OAuth2Client => fake as unknown as OAuth2Client;

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
});

afterEach(() => {
  db.close();
});

interface MockOptions {
  /** ms to delay before refreshAccessToken resolves */
  refreshLatencyMs?: number;
  /** value the refresh returns */
  newAccessToken?: string;
  newExpiryMs?: number;
}

function makeMockClient(opts: MockOptions = {}) {
  const refreshAccessToken = vi.fn(async () => {
    if (opts.refreshLatencyMs) {
      await new Promise((r) => setTimeout(r, opts.refreshLatencyMs));
    }
    return {
      credentials: {
        access_token: opts.newAccessToken ?? "fresh-access",
        refresh_token: "refresh-unchanged",
        expiry_date: opts.newExpiryMs ?? Date.now() + 60 * 60 * 1000,
        scope: "scope",
        token_type: "Bearer",
      },
    };
  });

  return {
    generateAuthUrl: () => "",
    setCredentials: () => {},
    getToken: async () => ({ tokens: {} }),
    refreshAccessToken,
  };
}

function seedExpiringTokens(repo: ReturnType<typeof createOAuthRepository>) {
  // Token expires in 1 second — within the 5-minute refresh window.
  repo.saveTokens({
    access_token: "stale-access",
    refresh_token: "refresh-1",
    expiry_date: new Date(Date.now() + 1_000).toISOString(),
    scope: "scope",
    token_type: "Bearer",
  });
}

describe("single-flight refresh", () => {
  it("collapses concurrent expiring-token callers into a single refreshAccessToken call", async () => {
    const repo = createOAuthRepository(db);
    seedExpiringTokens(repo);

    const client = makeMockClient({ refreshLatencyMs: 50 });
    const auth = createAuthManagerWithClient(asClient(client), repo);

    const results = await Promise.all(Array.from({ length: 5 }, () => auth.getOAuth2Client()));

    expect(client.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r !== null)).toBe(true);
    // After the refresh, repo should hold the new access token
    expect(repo.getTokens()?.access_token).toBe("fresh-access");
  });

  it("does NOT refresh when token is not near expiry", async () => {
    const repo = createOAuthRepository(db);
    // Token expires in 1 hour — well outside the 5min window.
    repo.saveTokens({
      access_token: "still-valid",
      refresh_token: "refresh-1",
      expiry_date: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      scope: "scope",
      token_type: "Bearer",
    });

    const client = makeMockClient();
    const auth = createAuthManagerWithClient(asClient(client), repo);

    await auth.getOAuth2Client();
    await auth.getOAuth2Client();
    expect(client.refreshAccessToken).not.toHaveBeenCalled();
  });

  it("allows a fresh refresh after a previous one completed (cache is cleared in finally)", async () => {
    const repo = createOAuthRepository(db);
    seedExpiringTokens(repo);

    const client = makeMockClient({ refreshLatencyMs: 5 });
    const auth = createAuthManagerWithClient(asClient(client), repo);

    await auth.getOAuth2Client();
    // Re-seed an expiring token so the second call also triggers a refresh
    seedExpiringTokens(repo);
    await auth.getOAuth2Client();

    expect(client.refreshAccessToken).toHaveBeenCalledTimes(2);
  });

  it("clears the in-flight cache when a refresh throws so the next attempt can retry", async () => {
    const repo = createOAuthRepository(db);
    seedExpiringTokens(repo);

    let attempts = 0;
    const client = {
      generateAuthUrl: () => "",
      setCredentials: () => {},
      getToken: async () => ({ tokens: {} }),
      refreshAccessToken: vi.fn(async () => {
        attempts++;
        if (attempts === 1) throw new Error("network blip");
        return {
          credentials: {
            access_token: "recovered",
            refresh_token: "refresh-1",
            expiry_date: Date.now() + 60 * 60 * 1000,
            scope: "scope",
            token_type: "Bearer",
          },
        };
      }),
    };

    const auth = createAuthManagerWithClient(asClient(client), repo);

    await expect(auth.getOAuth2Client()).rejects.toThrow("network blip");
    // Second call should kick off a fresh refresh, not be stuck on the failed one
    const result = await auth.getOAuth2Client();
    expect(result).not.toBeNull();
    expect(client.refreshAccessToken).toHaveBeenCalledTimes(2);
    expect(repo.getTokens()?.access_token).toBe("recovered");
  });
});

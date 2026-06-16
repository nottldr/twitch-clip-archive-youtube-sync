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
    generateAuthUrl: vi.fn(
      (urlOpts: { state?: string }) => `https://example.com/auth?state=${urlOpts.state ?? ""}`,
    ),
    setCredentials: () => {},
    getToken: vi.fn(async () => ({
      tokens: {
        access_token: "exchanged-access",
        refresh_token: "exchanged-refresh",
        expiry_date: Date.now() + 60 * 60 * 1000,
        scope: "scope",
        token_type: "Bearer",
      },
    })),
    refreshAccessToken,
  };
}

function extractState(url: string): string {
  return new URL(url).searchParams.get("state") ?? "";
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

describe("refresh token revocation", () => {
  function invalidGrantError() {
    return Object.assign(new Error("invalid_grant"), {
      response: { data: { error: "invalid_grant", error_description: "Token revoked" } },
    });
  }

  it("clears stored tokens on invalid_grant and returns null from getAuthenticatedClient", async () => {
    const repo = createOAuthRepository(db);
    seedExpiringTokens(repo);

    const client = makeMockClient();
    client.refreshAccessToken = vi.fn(async () => {
      throw invalidGrantError();
    });

    const auth = createAuthManagerWithClient(asClient(client), repo);
    const result = await auth.getAuthenticatedClient();

    expect(result).toBeNull();
    expect(repo.getTokens()).toBeNull();
  });

  it("preserves stored tokens on transient refresh errors", async () => {
    const repo = createOAuthRepository(db);
    seedExpiringTokens(repo);

    const client = makeMockClient();
    client.refreshAccessToken = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });

    const auth = createAuthManagerWithClient(asClient(client), repo);
    await expect(auth.getAuthenticatedClient()).rejects.toThrow("ECONNRESET");
    // Tokens still present so the next attempt can retry the refresh
    expect(repo.getTokens()).not.toBeNull();
  });

  it("isAuthenticated reports false after a revocation has cleared tokens", async () => {
    const repo = createOAuthRepository(db);
    seedExpiringTokens(repo);

    const client = makeMockClient();
    client.refreshAccessToken = vi.fn(async () => {
      throw invalidGrantError();
    });

    const auth = createAuthManagerWithClient(asClient(client), repo);
    expect(auth.isAuthenticated()).toBe(true);
    await auth.getAuthenticatedClient();
    expect(auth.isAuthenticated()).toBe(false);
  });
});

describe("OAuth state parameter", () => {
  it("issues a random state on getAuthUrl and accepts it in exchangeCode", async () => {
    const repo = createOAuthRepository(db);
    const client = makeMockClient();
    const auth = createAuthManagerWithClient(asClient(client), repo);

    const state = extractState(auth.getAuthUrl());
    expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(state.length).toBeGreaterThan(20);

    await expect(auth.exchangeCode("code-1", state)).resolves.toBeUndefined();
    expect(client.getToken).toHaveBeenCalledWith("code-1");
  });

  it("rejects an exchangeCode with a state that was never issued", async () => {
    const repo = createOAuthRepository(db);
    const client = makeMockClient();
    const auth = createAuthManagerWithClient(asClient(client), repo);

    await expect(auth.exchangeCode("code-1", "forged-state")).rejects.toThrow(
      /invalid or expired oauth state/i,
    );
    expect(client.getToken).not.toHaveBeenCalled();
  });

  it("rejects reuse of a state that was already consumed", async () => {
    const repo = createOAuthRepository(db);
    const client = makeMockClient();
    const auth = createAuthManagerWithClient(asClient(client), repo);

    const state = extractState(auth.getAuthUrl());
    await auth.exchangeCode("code-1", state);
    await expect(auth.exchangeCode("code-2", state)).rejects.toThrow(
      /invalid or expired oauth state/i,
    );
  });

  it("issues distinct state values for separate calls", () => {
    const repo = createOAuthRepository(db);
    const client = makeMockClient();
    const auth = createAuthManagerWithClient(asClient(client), repo);

    const a = extractState(auth.getAuthUrl());
    const b = extractState(auth.getAuthUrl());
    expect(a).not.toBe(b);
  });
});

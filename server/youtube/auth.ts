import { randomBytes } from "node:crypto";

import { google } from "googleapis";

import type { Config } from "#server/config.js";
import type { OAuthRepository, OAuthTokens } from "#server/db/repositories/oauth.js";
import { createLogger } from "#server/logger.js";

const logger = createLogger("oauth-refresh");

/**
 * `invalid_grant` from Google's token endpoint means the refresh token is no
 * longer usable (revoked, expired, account password reset, etc.). It's not
 * recoverable without a fresh user consent, so we treat it as the trigger to
 * clear stored tokens and surface as "not authenticated". Other refresh errors
 * (network blips, 5xx) propagate as-is for the engine's normal retry path.
 */
function isRefreshTokenRevoked(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const err = error as { response?: { data?: { error?: string } } };
  return err.response?.data?.error === "invalid_grant";
}

/** The real OAuth2 client type, derived via the googleapis surface so we don't
 *  need a direct dep on google-auth-library. */
export type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/cloud-platform.read-only",
];

const REFRESH_WINDOW_MS = 5 * 60 * 1000;
const STATE_TTL_MS = 10 * 60 * 1000;

export function createAuthManager(config: Config, oauthRepo: OAuthRepository): AuthManager {
  const oauth2Client = new google.auth.OAuth2(
    config.googleClientId,
    config.googleClientSecret,
    `${config.oauthRedirectBase}/api/oauth/callback`,
  );
  return createAuthManagerWithClient(oauth2Client, oauthRepo);
}

/**
 * Internal factory exposed for tests. Accepts a pre-built OAuth2 client so the
 * test suite can inject a counted/mocked instance instead of hitting Google.
 * Tests can pass a structurally-compatible fake via `as unknown as OAuth2Client`.
 */
export function createAuthManagerWithClient(
  oauth2Client: OAuth2Client,
  oauthRepo: OAuthRepository,
): AuthManager {
  // Single-flight refresh: while one refresh is in flight, concurrent callers
  // share its promise instead of each kicking off their own. Cleared in `finally`
  // so a failed refresh doesn't poison subsequent attempts.
  let inflightRefresh: Promise<OAuthTokens> | null = null;

  // OAuth `state` parameter: issued in getAuthUrl, validated in exchangeCode.
  // Single-use; entries expire after STATE_TTL_MS to bound memory if a user
  // starts the flow but never returns.
  const pendingStates = new Map<string, number>();
  function purgeExpiredStates() {
    const now = Date.now();
    for (const [s, expiry] of pendingStates) {
      if (expiry < now) pendingStates.delete(s);
    }
  }

  async function refreshNow(tokens: OAuthTokens): Promise<OAuthTokens> {
    if (inflightRefresh) return inflightRefresh;
    inflightRefresh = (async () => {
      try {
        const { credentials } = await oauth2Client.refreshAccessToken();
        const next: OAuthTokens = {
          access_token: credentials.access_token ?? tokens.access_token,
          refresh_token: credentials.refresh_token ?? tokens.refresh_token,
          expiry_date: new Date(credentials.expiry_date ?? Date.now()).toISOString(),
          scope: credentials.scope ?? tokens.scope,
          token_type: credentials.token_type ?? tokens.token_type,
        };
        oauthRepo.saveTokens(next);
        return next;
      } catch (error) {
        if (isRefreshTokenRevoked(error)) {
          logger.warn(
            { err: error },
            "Refresh token revoked by Google; clearing stored tokens. User must re-authenticate.",
          );
          oauthRepo.clearTokens();
        }
        throw error;
      } finally {
        inflightRefresh = null;
      }
    })();
    return inflightRefresh;
  }

  async function loadAndRefresh(): Promise<OAuthTokens | null> {
    const tokens = oauthRepo.getTokens();
    if (!tokens) return null;

    oauth2Client.setCredentials({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: new Date(tokens.expiry_date).getTime(),
      scope: tokens.scope,
      token_type: tokens.token_type,
    });

    const expiryMs = new Date(tokens.expiry_date).getTime();
    if (Date.now() >= expiryMs - REFRESH_WINDOW_MS) {
      try {
        const refreshed = await refreshNow(tokens);
        oauth2Client.setCredentials({
          access_token: refreshed.access_token,
          refresh_token: refreshed.refresh_token,
          expiry_date: new Date(refreshed.expiry_date).getTime(),
          scope: refreshed.scope,
          token_type: refreshed.token_type,
        });
        return refreshed;
      } catch (error) {
        // refreshNow cleared tokens on permanent revocation; surface as
        // "not authenticated" so the engine routes to blocked.awaitingAuth.
        // Transient errors (network, 5xx) leave tokens intact and re-throw.
        if (!oauthRepo.getTokens()) return null;
        throw error;
      }
    }
    return tokens;
  }

  function getAuthUrl(): string {
    purgeExpiredStates();
    const state = randomBytes(32).toString("base64url");
    pendingStates.set(state, Date.now() + STATE_TTL_MS);
    return oauth2Client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: SCOPES,
      state,
    });
  }

  async function exchangeCode(code: string, state: string): Promise<void> {
    const expiry = pendingStates.get(state);
    pendingStates.delete(state);
    if (expiry === undefined || Date.now() > expiry) {
      throw new Error("Invalid or expired OAuth state parameter");
    }

    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.refresh_token) {
      throw new Error(
        "No refresh token received. Ensure the consent screen prompted for offline access.",
      );
    }

    oauthRepo.saveTokens({
      access_token: tokens.access_token ?? "",
      refresh_token: tokens.refresh_token,
      expiry_date: new Date(tokens.expiry_date ?? Date.now()).toISOString(),
      scope: tokens.scope ?? "",
      token_type: tokens.token_type ?? "Bearer",
    });

    oauth2Client.setCredentials(tokens);
  }

  async function getAuthenticatedClient() {
    const tokens = await loadAndRefresh();
    if (!tokens) return null;
    return google.youtube({ version: "v3", auth: oauth2Client });
  }

  function isAuthenticated(): boolean {
    return oauthRepo.getTokens() !== null;
  }

  function revokeTokens(): void {
    oauthRepo.clearTokens();
  }

  /** Get the raw OAuth2 client (for non-YouTube Google APIs). Refreshes token if needed. */
  async function getOAuth2Client() {
    const tokens = await loadAndRefresh();
    if (!tokens) return null;
    return oauth2Client;
  }

  return {
    getAuthUrl,
    exchangeCode,
    getAuthenticatedClient,
    getOAuth2Client,
    isAuthenticated,
    revokeTokens,
  };
}

export interface AuthManager {
  getAuthUrl(): string;
  exchangeCode(code: string, state: string): Promise<void>;
  getAuthenticatedClient(): Promise<ReturnType<typeof google.youtube> | null>;
  getOAuth2Client(): Promise<OAuth2Client | null>;
  isAuthenticated(): boolean;
  revokeTokens(): void;
}

/**
 * Dry-run auth manager that skips Google OAuth entirely.
 * Connect/disconnect toggle a local flag for state machine testing.
 * The dry-run upload function never uses the YouTube client, so we
 * return a proxy that throws if anything tries to use it.
 */
type YouTubeClient = NonNullable<Awaited<ReturnType<AuthManager["getAuthenticatedClient"]>>>;

/**
 * Dry-run auth manager that skips Google OAuth entirely.
 * Uses oauthRepo for persistence (dummy tokens) so connected state survives restarts.
 * The YouTube/OAuth2 clients are proxies that throw on any property access.
 */
export function createDryRunAuthManager(baseUrl: string, oauthRepo: OAuthRepository): AuthManager {
  function unusableProxy<T extends object>(label: string): T {
    // eslint-disable-next-line typescript/no-unsafe-type-assertion -- Proxy traps all access; the target is never used
    return new Proxy({} as T, {
      get(_target, prop) {
        throw new Error(`Dry-run auth: attempted to use ${label} property "${String(prop)}"`);
      },
    });
  }

  const youtubeClient = unusableProxy<YouTubeClient>("YouTube client");
  const oauth2Client = unusableProxy<OAuth2Client>("OAuth2 client");

  return {
    getAuthUrl() {
      return `${baseUrl}/api/oauth/callback?code=dry-run&state=dry-run`;
    },
    async exchangeCode() {
      oauthRepo.saveTokens({
        access_token: "dry-run",
        refresh_token: "dry-run",
        expiry_date: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        scope: "dry-run",
        token_type: "Bearer",
      });
    },
    async getAuthenticatedClient() {
      return oauthRepo.getTokens() ? youtubeClient : null;
    },
    async getOAuth2Client() {
      return oauthRepo.getTokens() ? oauth2Client : null;
    },
    isAuthenticated() {
      return oauthRepo.getTokens() !== null;
    },
    revokeTokens() {
      oauthRepo.clearTokens();
    },
  };
}

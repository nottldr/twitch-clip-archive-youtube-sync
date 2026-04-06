import { google } from "googleapis";

import type { Config } from "#server/config.js";
import type { OAuthRepository } from "#server/db/repositories/oauth.js";

const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/cloud-platform.read-only",
];

export function createAuthManager(config: Config, oauthRepo: OAuthRepository) {
  const oauth2Client = new google.auth.OAuth2(
    config.googleClientId,
    config.googleClientSecret,
    `${config.oauthRedirectBase}/api/oauth/callback`,
  );

  function getAuthUrl(): string {
    return oauth2Client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: SCOPES,
    });
  }

  async function exchangeCode(code: string): Promise<void> {
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
    const tokens = oauthRepo.getTokens();
    if (!tokens) return null;

    oauth2Client.setCredentials({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: new Date(tokens.expiry_date).getTime(),
      scope: tokens.scope,
      token_type: tokens.token_type,
    });

    // Refresh if within 5 minutes of expiry
    const expiryDate = new Date(tokens.expiry_date).getTime();
    const fiveMinutes = 5 * 60 * 1000;
    if (Date.now() >= expiryDate - fiveMinutes) {
      const { credentials } = await oauth2Client.refreshAccessToken();
      oauthRepo.saveTokens({
        access_token: credentials.access_token ?? tokens.access_token,
        refresh_token: credentials.refresh_token ?? tokens.refresh_token,
        expiry_date: new Date(credentials.expiry_date ?? Date.now()).toISOString(),
        scope: credentials.scope ?? tokens.scope,
        token_type: credentials.token_type ?? tokens.token_type,
      });
    }

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
    const tokens = oauthRepo.getTokens();
    if (!tokens) return null;

    oauth2Client.setCredentials({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: new Date(tokens.expiry_date).getTime(),
      scope: tokens.scope,
      token_type: tokens.token_type,
    });

    const expiryDate = new Date(tokens.expiry_date).getTime();
    const fiveMinutes = 5 * 60 * 1000;
    if (Date.now() >= expiryDate - fiveMinutes) {
      const { credentials } = await oauth2Client.refreshAccessToken();
      oauthRepo.saveTokens({
        access_token: credentials.access_token ?? tokens.access_token,
        refresh_token: credentials.refresh_token ?? tokens.refresh_token,
        expiry_date: new Date(credentials.expiry_date ?? Date.now()).toISOString(),
        scope: credentials.scope ?? tokens.scope,
        token_type: credentials.token_type ?? tokens.token_type,
      });
    }

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

export type AuthManager = ReturnType<typeof createAuthManager>;

/**
 * Dry-run auth manager that skips Google OAuth entirely.
 * Connect/disconnect toggle a local flag for state machine testing.
 * The dry-run upload function never uses the YouTube client, so we
 * return a proxy that throws if anything tries to use it.
 */
type YouTubeClient = NonNullable<Awaited<ReturnType<AuthManager["getAuthenticatedClient"]>>>;
type OAuth2Client = NonNullable<Awaited<ReturnType<AuthManager["getOAuth2Client"]>>>;

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
      return `${baseUrl}/api/oauth/callback?code=dry-run`;
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

import { Hono } from "hono";

import type { OAuthRepository } from "#server/db/repositories/oauth.js";
import type { SyncEngine } from "#server/sync/engine.js";
import type { AuthManager } from "#server/youtube/auth.js";

export function createOAuthRoutes(
  authManager: AuthManager,
  engine: SyncEngine,
  oauthRepo: OAuthRepository,
) {
  const app = new Hono();

  app.get("/oauth/status", (c) => {
    const connected = authManager.isAuthenticated();
    if (!connected) return c.json({ connected: false });
    const info = oauthRepo.getInfo();
    return c.json({
      connected: true,
      expiryDate: info?.expiry_date ?? null,
      scope: info?.scope ?? null,
      lastRefresh: info?.updated_at ?? null,
    });
  });

  app.get("/oauth/connect", (c) => {
    const url = authManager.getAuthUrl();
    return c.redirect(url);
  });

  app.get("/oauth/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    if (!code) {
      return c.text("Missing authorization code", 400);
    }
    if (!state) {
      return c.text("Missing OAuth state parameter", 400);
    }

    try {
      await authManager.exchangeCode(code, state);
      engine.notifyAuthComplete();
      return c.redirect("/#/connected");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return c.text(`OAuth error: ${message}`, 500);
    }
  });

  app.post("/oauth/disconnect", (c) => {
    engine.pause();
    authManager.revokeTokens();
    return c.json({ ok: true });
  });

  return app;
}

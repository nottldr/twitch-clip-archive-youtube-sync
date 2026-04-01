import { Hono } from "hono";

import type { SyncEngine } from "#server/sync/engine.js";
import type { AuthManager } from "#server/youtube/auth.js";

export function createOAuthRoutes(authManager: AuthManager, engine: SyncEngine) {
  const app = new Hono();

  app.get("/oauth/status", (c) => {
    return c.json({ connected: authManager.isAuthenticated() });
  });

  app.get("/oauth/connect", (c) => {
    const url = authManager.getAuthUrl();
    return c.redirect(url);
  });

  app.get("/oauth/callback", async (c) => {
    const code = c.req.query("code");
    if (!code) {
      return c.text("Missing authorization code", 400);
    }

    try {
      await authManager.exchangeCode(code);
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

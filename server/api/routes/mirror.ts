import { Hono } from "hono";

import type { MirrorPublishesRepository } from "#server/db/repositories/mirror-publishes.js";
import type { MirrorConfig, PublisherDeps } from "#server/mirror/publisher.js";
import { nextDueAt, publishNow } from "#server/mirror/publisher.js";

export function createMirrorRoutes(
  deps: PublisherDeps & { mirrorRepo: MirrorPublishesRepository },
) {
  const app = new Hono();
  const cfg = deps.config;
  const configured = cfg !== null;

  app.get("/mirror/status", (c) => {
    const last = deps.mirrorRepo.lastSuccess();
    const lastAttempt = deps.mirrorRepo.lastAttempt();
    return c.json({
      configured,
      repo: cfg ? `${cfg.owner}/${cfg.repo}` : null,
      branch: cfg ? cfg.branch : null,
      lastSuccess: last
        ? {
            at: last.succeeded_at,
            clipCount: last.clip_count,
            commitSha: last.commit_sha,
          }
        : null,
      lastAttempt: lastAttempt
        ? {
            at: lastAttempt.attempted_at,
            ok: lastAttempt.succeeded_at !== null,
            error: lastAttempt.error_message,
          }
        : null,
      nextDueAt: nextDueAt(deps.mirrorRepo, configured),
    });
  });

  app.post("/mirror/publish", async (c) => {
    if (!cfg) {
      return c.json({ ok: false, error: "Mirror not configured (MIRROR_GITHUB_TOKEN unset)" }, 503);
    }
    // Always return 200 — failures are encoded as `{ ok: false, error }` in
    // the body so the UI gets the full PublishOutcome shape (commit SHA on
    // success, error message on failure). A non-2xx would short-circuit the
    // mutation onSuccess and lose the structured outcome.
    const outcome = await publishNow(deps);
    return c.json(outcome);
  });

  return app;
}

export function mirrorConfigFromEnv(env: {
  mirrorGithubToken: string | null;
  mirrorRepoOwner: string | null;
  mirrorRepoName: string | null;
  mirrorBranch: string;
}): MirrorConfig {
  if (!env.mirrorGithubToken || !env.mirrorRepoOwner || !env.mirrorRepoName) return null;
  return {
    token: env.mirrorGithubToken,
    owner: env.mirrorRepoOwner,
    repo: env.mirrorRepoName,
    branch: env.mirrorBranch,
  };
}

import { z } from "zod/v4";

/**
 * Minimal GitHub Contents API client. We deliberately avoid `@octokit/*` —
 * one upload-a-file endpoint doesn't warrant the dep. Plain `fetch` against
 * `api.github.com` with a fine-grained PAT does the job.
 *
 * The Contents API does an atomic "upsert" given the previous SHA: GET to
 * fetch it (404 → file doesn't exist yet), PUT to write the new content +
 * commit message in one call.
 *
 * Docs: https://docs.github.com/en/rest/repos/contents
 */

const FileMetadataSchema = z.object({
  sha: z.string(),
});

const PutResponseSchema = z.object({
  commit: z.object({ sha: z.string() }),
});

export class GitHubApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

export interface MirrorRepoConfig {
  token: string;
  owner: string;
  repo: string;
  branch: string;
}

async function getCurrentSha(cfg: MirrorRepoConfig, path: string): Promise<string | null> {
  const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(cfg.branch)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "User-Agent": "georgy-youtube-sync-mirror",
      Accept: "application/vnd.github+json",
    },
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new GitHubApiError(
      `GET contents/${path} failed: ${String(res.status)} ${res.statusText}`,
      res.status,
      await res.text(),
    );
  }
  const json: unknown = await res.json();
  return FileMetadataSchema.parse(json).sha;
}

/**
 * Upsert a single file at `path` on `branch`. Returns the new commit SHA.
 * Looks up the previous SHA in the same call (one round-trip per file is
 * fine at our cadence — twice a day at most).
 */
export async function publishFile(
  cfg: MirrorRepoConfig,
  path: string,
  content: string,
  commitMessage: string,
): Promise<string> {
  const sha = await getCurrentSha(cfg, path);
  const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURIComponent(path)}`;

  const body = {
    message: commitMessage,
    content: Buffer.from(content, "utf-8").toString("base64"),
    branch: cfg.branch,
    ...(sha ? { sha } : {}),
  };

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "User-Agent": "georgy-youtube-sync-mirror",
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new GitHubApiError(
      `PUT contents/${path} failed: ${String(res.status)} ${res.statusText}`,
      res.status,
      await res.text(),
    );
  }
  const json: unknown = await res.json();
  return PutResponseSchema.parse(json).commit.sha;
}

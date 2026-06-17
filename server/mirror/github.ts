import { z } from "zod/v4";

/**
 * Multi-file atomic publisher for the mirror repo using GitHub's Git Data API.
 *
 * Why not the Contents API? Each `PUT /contents/{path}` creates its own commit.
 * Publishing N files = N commits, with N-1 intermediate states where consumers
 * fetching mid-flight see clips.json from this run + manifest.json from the
 * previous one. The Git Data API lets us bundle multiple file changes into a
 * single tree and a single commit, then atomically point the branch ref at it.
 *
 * Flow per publish:
 *   1. GET /git/ref/heads/{branch}        → current commit SHA (or 404 = empty branch)
 *   2. GET /git/commits/{commitSha}       → parent tree SHA (skipped if empty branch)
 *   3. POST /git/blobs (one per file)     → blob SHAs
 *   4. POST /git/trees (base_tree=parent) → new tree SHA (preserves untouched files)
 *   5. POST /git/commits                  → new commit SHA
 *   6. PATCH /git/refs/heads/{branch}     → fast-forward update (force: false)
 *
 * The fast-forward check on step 6 means a concurrent publish that landed
 * between steps 1 and 6 makes our PATCH fail with 422. Caller retries on the
 * next scheduled tick — no data loss, no force-push.
 *
 * Docs: https://docs.github.com/en/rest/git
 */

const RefSchema = z.object({
  object: z.object({ sha: z.string() }),
});

const CommitSchema = z.object({
  sha: z.string(),
  tree: z.object({ sha: z.string() }),
});

const BlobSchema = z.object({ sha: z.string() });
const TreeSchema = z.object({ sha: z.string() });

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

export interface FileEntry {
  path: string;
  content: string;
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "User-Agent": "georgy-youtube-sync-mirror",
    Accept: "application/vnd.github+json",
  };
}

async function ghFetch(
  cfg: MirrorRepoConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  // Encode owner/repo so any edge-case characters (dots, dashes are fine
  // bare; we encode defensively in case GitHub ever broadens what's legal).
  // `path` is built by the caller and may already contain encoded segments —
  // see publishFiles, where it encodes the branch name.
  const url = `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}${path}`;
  const headers: Record<string, string> = authHeaders(cfg.token);
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function jsonOrThrow<T extends z.ZodType>(res: Response, schema: T): Promise<z.infer<T>> {
  if (!res.ok) {
    throw new GitHubApiError(
      `${res.url}: ${String(res.status)} ${res.statusText}`,
      res.status,
      await res.text(),
    );
  }
  return schema.parse(await res.json());
}

/**
 * Publish multiple files in a single atomic commit. Returns the new commit SHA.
 * `base_tree` inheritance means any files in the repo that aren't in `files`
 * (README.md, .gitignore, whatever) carry forward untouched.
 */
export async function publishFiles(
  cfg: MirrorRepoConfig,
  files: FileEntry[],
  commitMessage: string,
): Promise<string> {
  // Encode the branch for URL-path use — a value like `feature/x` would
  // otherwise be parsed as two path segments and silently target the wrong
  // ref. The JSON body uses `cfg.branch` raw, since JSON encoding is
  // separate from URL encoding.
  const branchPath = encodeURIComponent(cfg.branch);

  // 1. Look up current branch tip. 404 = empty/new branch (first publish).
  const refRes = await ghFetch(cfg, "GET", `/git/ref/heads/${branchPath}`);
  const parentCommitSha =
    refRes.status === 404 ? null : (await jsonOrThrow(refRes, RefSchema)).object.sha;

  // 2. Look up parent commit's tree (so base_tree carries other files through).
  let baseTreeSha: string | null = null;
  if (parentCommitSha) {
    const commit = await jsonOrThrow(
      await ghFetch(cfg, "GET", `/git/commits/${parentCommitSha}`),
      CommitSchema,
    );
    baseTreeSha = commit.tree.sha;
  }

  // 3. Upload each file as a blob in parallel. Promise.all dispatches in
  //    array order, so the kth blob in the result corresponds to the kth file.
  const blobs = await Promise.all(
    files.map(async (file) => {
      const blob = await jsonOrThrow(
        await ghFetch(cfg, "POST", "/git/blobs", {
          content: Buffer.from(file.content, "utf-8").toString("base64"),
          encoding: "base64",
        }),
        BlobSchema,
      );
      return { path: file.path, sha: blob.sha };
    }),
  );

  // 4. Build a tree. base_tree inherits any unchanged paths (README etc.);
  //    our blob entries override clips.json / manifest.json.
  const treeBody: Record<string, unknown> = {
    tree: blobs.map((b) => ({ path: b.path, mode: "100644", type: "blob", sha: b.sha })),
  };
  if (baseTreeSha) treeBody["base_tree"] = baseTreeSha;
  const tree = await jsonOrThrow(await ghFetch(cfg, "POST", "/git/trees", treeBody), TreeSchema);

  // 5. Create the commit. parents=[parentCommitSha] for normal updates,
  //    parents=[] for the very first commit on an empty branch.
  const commit = await jsonOrThrow(
    await ghFetch(cfg, "POST", "/git/commits", {
      message: commitMessage,
      tree: tree.sha,
      parents: parentCommitSha ? [parentCommitSha] : [],
    }),
    CommitSchema,
  );

  // 6. Point the branch at the new commit. force: false enforces fast-forward,
  //    so a concurrent publish that landed between steps 1 and 6 makes this
  //    fail with 422 — caller retries next tick.
  if (parentCommitSha) {
    const patchRes = await ghFetch(cfg, "PATCH", `/git/refs/heads/${branchPath}`, {
      sha: commit.sha,
      force: false,
    });
    if (!patchRes.ok) {
      throw new GitHubApiError(
        `PATCH /git/refs/heads/${cfg.branch}: ${String(patchRes.status)} ${patchRes.statusText}`,
        patchRes.status,
        await patchRes.text(),
      );
    }
  } else {
    // First commit on an empty branch — create the ref instead of patching.
    const postRes = await ghFetch(cfg, "POST", "/git/refs", {
      ref: `refs/heads/${cfg.branch}`,
      sha: commit.sha,
    });
    if (!postRes.ok) {
      throw new GitHubApiError(
        `POST /git/refs (create ${cfg.branch}): ${String(postRes.status)} ${postRes.statusText}`,
        postRes.status,
        await postRes.text(),
      );
    }
  }

  return commit.sha;
}

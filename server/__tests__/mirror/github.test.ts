import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GitHubApiError, publishFiles } from "#server/mirror/github.js";

const CFG = {
  token: "tok",
  owner: "me",
  repo: "mirror",
  branch: "main",
};

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetchSequence(responses: Array<Partial<Response> & { body?: unknown }>) {
  const queue = [...responses];
  globalThis.fetch = vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error("Unexpected extra fetch call");
    const body = next.body ?? {};
    return new Response(JSON.stringify(body), {
      status: next.status ?? 200,
      statusText: next.statusText ?? "OK",
      headers: { "content-type": "application/json" },
    });
  });
}

function calls() {
  return (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit][];
}

describe("publishFiles", () => {
  it("on an existing branch: reads ref → reads commit → blobs → tree → commit → fast-forward PATCH", async () => {
    mockFetchSequence([
      { status: 200, body: { object: { sha: "parent-commit" } } }, // GET ref
      { status: 200, body: { sha: "parent-commit", tree: { sha: "parent-tree" } } }, // GET commit
      { status: 201, body: { sha: "blob-1" } }, // POST blob clips.json
      { status: 201, body: { sha: "blob-2" } }, // POST blob manifest.json
      { status: 201, body: { sha: "new-tree" } }, // POST tree
      { status: 201, body: { sha: "new-commit", tree: { sha: "new-tree" } } }, // POST commit
      { status: 200, body: { ref: "refs/heads/main", object: { sha: "new-commit" } } }, // PATCH ref
    ]);

    const sha = await publishFiles(
      CFG,
      [
        { path: "clips.json", content: "[]\n" },
        { path: "manifest.json", content: "{}\n" },
      ],
      "msg",
    );
    expect(sha).toBe("new-commit");

    const c = calls();
    expect(c.map(([url]) => url)).toEqual([
      "https://api.github.com/repos/me/mirror/git/ref/heads/main",
      "https://api.github.com/repos/me/mirror/git/commits/parent-commit",
      "https://api.github.com/repos/me/mirror/git/blobs",
      "https://api.github.com/repos/me/mirror/git/blobs",
      "https://api.github.com/repos/me/mirror/git/trees",
      "https://api.github.com/repos/me/mirror/git/commits",
      "https://api.github.com/repos/me/mirror/git/refs/heads/main",
    ]);

    // Tree body includes base_tree (so README etc. carries forward) and both blobs.
    const treeBody = JSON.parse(c[4][1].body as string) as {
      base_tree: string;
      tree: { path: string; sha: string }[];
    };
    expect(treeBody.base_tree).toBe("parent-tree");
    expect(treeBody.tree.map((t) => t.path)).toEqual(["clips.json", "manifest.json"]);
    expect(treeBody.tree.map((t) => t.sha)).toEqual(["blob-1", "blob-2"]);

    // Commit body includes parent.
    const commitBody = JSON.parse(c[5][1].body as string) as { parents: string[]; tree: string };
    expect(commitBody.parents).toEqual(["parent-commit"]);
    expect(commitBody.tree).toBe("new-tree");

    // Ref update is fast-forward, not force.
    const patchBody = JSON.parse(c[6][1].body as string) as { sha: string; force: boolean };
    expect(patchBody.sha).toBe("new-commit");
    expect(patchBody.force).toBe(false);
  });

  it("on an empty branch (404 on ref): skips parent-commit lookup, omits base_tree, parents=[], creates ref", async () => {
    mockFetchSequence([
      { status: 404, body: {} }, // GET ref
      { status: 201, body: { sha: "blob-1" } }, // POST blob clips.json
      { status: 201, body: { sha: "blob-2" } }, // POST blob manifest.json
      { status: 201, body: { sha: "new-tree" } }, // POST tree
      { status: 201, body: { sha: "new-commit", tree: { sha: "new-tree" } } }, // POST commit
      { status: 201, body: { ref: "refs/heads/main", object: { sha: "new-commit" } } }, // POST refs
    ]);

    const sha = await publishFiles(
      CFG,
      [
        { path: "clips.json", content: "[]\n" },
        { path: "manifest.json", content: "{}\n" },
      ],
      "first",
    );
    expect(sha).toBe("new-commit");

    const c = calls();
    expect(c.map(([url]) => url)).toEqual([
      "https://api.github.com/repos/me/mirror/git/ref/heads/main",
      "https://api.github.com/repos/me/mirror/git/blobs",
      "https://api.github.com/repos/me/mirror/git/blobs",
      "https://api.github.com/repos/me/mirror/git/trees",
      "https://api.github.com/repos/me/mirror/git/commits",
      "https://api.github.com/repos/me/mirror/git/refs",
    ]);

    const treeBody = JSON.parse(c[3][1].body as string) as { base_tree?: string };
    expect(treeBody.base_tree).toBeUndefined();

    const commitBody = JSON.parse(c[4][1].body as string) as { parents: string[] };
    expect(commitBody.parents).toEqual([]);

    const refBody = JSON.parse(c[5][1].body as string) as { ref: string; sha: string };
    expect(refBody.ref).toBe("refs/heads/main");
    expect(refBody.sha).toBe("new-commit");
  });

  it("fast-forward conflict (422 on PATCH) throws GitHubApiError so caller can retry next tick", async () => {
    mockFetchSequence([
      { status: 200, body: { object: { sha: "parent-commit" } } }, // GET ref
      { status: 200, body: { sha: "parent-commit", tree: { sha: "parent-tree" } } }, // GET commit
      { status: 201, body: { sha: "blob-1" } }, // POST blob (single file)
      { status: 201, body: { sha: "new-tree" } }, // POST tree
      { status: 201, body: { sha: "new-commit", tree: { sha: "new-tree" } } }, // POST commit
      {
        status: 422,
        statusText: "Unprocessable Entity",
        body: { message: "Update is not a fast forward" },
      }, // PATCH ref
    ]);

    await expect(
      publishFiles(CFG, [{ path: "clips.json", content: "[]" }], "msg"),
    ).rejects.toBeInstanceOf(GitHubApiError);
  });

  it("throws GitHubApiError on a non-404 GET ref failure (e.g. 401 bad creds)", async () => {
    mockFetchSequence([
      { status: 401, statusText: "Unauthorized", body: { message: "bad creds" } },
    ]);

    await expect(
      publishFiles(CFG, [{ path: "clips.json", content: "[]" }], "msg"),
    ).rejects.toBeInstanceOf(GitHubApiError);
  });
});

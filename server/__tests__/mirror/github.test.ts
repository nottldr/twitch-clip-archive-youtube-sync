import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GitHubApiError, publishFile } from "#server/mirror/github.js";

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

describe("publishFile", () => {
  it("looks up existing SHA then PUTs with it included", async () => {
    mockFetchSequence([
      { status: 200, body: { sha: "old-sha" } },
      { status: 200, body: { commit: { sha: "new-commit" } } },
    ]);

    const sha = await publishFile(CFG, "clips.json", "hello", "msg");
    expect(sha).toBe("new-commit");

    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(2);

    // First call: GET contents to fetch current SHA.
    const [getUrl, getInit] = calls[0] as [string, RequestInit];
    expect(getUrl).toContain("/repos/me/mirror/contents/clips.json");
    expect(getUrl).toContain("ref=main");
    expect(getInit.method ?? "GET").toBe("GET");

    // Second call: PUT with sha included.
    const [putUrl, putInit] = calls[1] as [string, RequestInit];
    expect(putUrl).toContain("/repos/me/mirror/contents/clips.json");
    expect(putInit.method).toBe("PUT");
    const putBody = JSON.parse(putInit.body as string) as {
      content: string;
      sha?: string;
      message: string;
      branch: string;
    };
    expect(putBody.sha).toBe("old-sha");
    expect(putBody.branch).toBe("main");
    expect(putBody.message).toBe("msg");
    expect(Buffer.from(putBody.content, "base64").toString("utf-8")).toBe("hello");
  });

  it("omits sha on first create (404 from GET)", async () => {
    mockFetchSequence([
      { status: 404, body: { message: "not found" } },
      { status: 201, body: { commit: { sha: "first-commit" } } },
    ]);

    const sha = await publishFile(CFG, "manifest.json", "{}", "first");
    expect(sha).toBe("first-commit");

    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const [, putInit] = calls[1] as [string, RequestInit];
    const putBody = JSON.parse(putInit.body as string) as { sha?: string };
    expect(putBody.sha).toBeUndefined();
  });

  it("throws GitHubApiError on PUT failure", async () => {
    mockFetchSequence([
      { status: 404, body: {} },
      { status: 422, statusText: "Unprocessable Entity", body: { message: "conflict" } },
    ]);

    await expect(publishFile(CFG, "clips.json", "x", "msg")).rejects.toBeInstanceOf(GitHubApiError);
  });

  it("throws GitHubApiError on GET failure that isn't 404", async () => {
    mockFetchSequence([
      { status: 401, statusText: "Unauthorized", body: { message: "bad creds" } },
    ]);

    await expect(publishFile(CFG, "clips.json", "x", "msg")).rejects.toBeInstanceOf(GitHubApiError);
  });
});

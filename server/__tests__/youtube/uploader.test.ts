import { describe, expect, it } from "vitest";

import { classifyError } from "#server/youtube/uploader.js";

/**
 * Build a fake GaxiosError-shaped object. classifyError reads `code`, `errors[0].reason`,
 * `errors[0].message`, and `message` — that's the full surface it needs.
 */
function googleError(opts: { code?: number; reason?: string; message: string }) {
  return {
    code: opts.code,
    errors:
      opts.reason || opts.message ? [{ reason: opts.reason, message: opts.message }] : undefined,
    message: opts.message,
  };
}

describe("classifyError", () => {
  it("maps 429 'Video Uploads per day' to UPLOAD_LIMIT_EXCEEDED (not RATE_LIMITED)", () => {
    const err = googleError({
      code: 429,
      message:
        "Quota exceeded for quota metric 'Video Uploads' and limit 'Video Uploads per day' of service 'youtube.googleapis.com'",
    });
    expect(classifyError(err).code).toBe("UPLOAD_LIMIT_EXCEEDED");
  });

  it("maps the 403 'exceeded the number of videos' variant to UPLOAD_LIMIT_EXCEEDED", () => {
    const err = googleError({
      code: 403,
      message: "The user has exceeded the number of videos they may upload.",
    });
    expect(classifyError(err).code).toBe("UPLOAD_LIMIT_EXCEEDED");
  });

  it("still maps generic 403 quota errors to QUOTA_EXCEEDED", () => {
    const err = googleError({
      code: 403,
      reason: "quotaExceeded",
      message: "Quota exceeded.",
    });
    expect(classifyError(err).code).toBe("QUOTA_EXCEEDED");
  });

  it("still maps unrelated 429 errors to RATE_LIMITED", () => {
    const err = googleError({
      code: 429,
      message: "Too many requests, please slow down.",
    });
    expect(classifyError(err).code).toBe("RATE_LIMITED");
  });
});

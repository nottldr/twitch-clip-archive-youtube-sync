import type { youtube_v3 } from "googleapis";

import { createReadStream, statSync } from "node:fs";
import { resolve } from "node:path";

import { z } from "zod/v4";

import type { TwitchClip } from "#server/archive/types.js";
import type { UploadsRepository } from "#server/db/repositories/uploads.js";

import { buildVideoMetadata } from "./metadata.js";

export class UploadError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "UploadError";
  }
}

export interface UploadResult {
  youtubeId: string;
}

export async function uploadClip(
  clip: TwitchClip,
  archivePath: string,
  youtube: youtube_v3.Youtube,
  uploadsRepo: UploadsRepository,
  uploadCost: number,
  descriptionTemplate?: string | null,
): Promise<UploadResult> {
  const mp4Path = resolve(archivePath, "media/clips", `${clip.clipId}.mp4`);

  // Check file exists and is > 1KB
  let stat;
  try {
    stat = statSync(mp4Path);
  } catch {
    throw new UploadError("MP4 file not found", "FILE_NOT_FOUND", false);
  }

  if (stat.size < 1024) {
    throw new UploadError(`MP4 file too small (${stat.size} bytes)`, "FILE_TOO_SMALL", false);
  }

  const metadata = buildVideoMetadata(clip, descriptionTemplate ?? undefined);
  const attemptId = uploadsRepo.logAttempt(clip.clipId, uploadCost);

  try {
    const response = await youtube.videos.insert({
      part: ["snippet", "status", "recordingDetails"],
      requestBody: metadata,
      media: {
        body: createReadStream(mp4Path),
      },
    });

    const youtubeId = response.data.id;
    if (!youtubeId) {
      throw new UploadError("YouTube returned no video ID", "NO_VIDEO_ID", true);
    }

    uploadsRepo.completeAttempt(attemptId, true, youtubeId);
    return { youtubeId };
  } catch (error: unknown) {
    const classified = classifyError(error);
    uploadsRepo.completeAttempt(attemptId, false, undefined, classified.message, classified.code);
    throw classified;
  }
}

function classifyError(err: unknown): UploadError {
  if (err instanceof UploadError) return err;

  const GoogleErrorSchema = z.object({
    code: z.number().optional(),
    errors: z
      .array(z.object({ reason: z.string().optional(), message: z.string().optional() }))
      .optional(),
    message: z.string().optional(),
  });

  // googleapis wraps errors in GaxiosError — try to extract the inner error
  const rawMessage = err instanceof Error ? err.message : String(err);

  const parsed = GoogleErrorSchema.safeParse(err);
  const error = parsed.success
    ? parsed.data
    : { code: undefined, errors: undefined, message: undefined };

  const status = error.code;
  const reason = error.errors?.[0]?.reason;
  const message = error.errors?.[0]?.message ?? error.message ?? rawMessage;

  // Quota exceeded — match by reason, status, or message content
  if (
    reason === "quotaExceeded" ||
    (status === 403 && message.toLowerCase().includes("quota")) ||
    message.toLowerCase().includes("exceeded your quota")
  ) {
    return new UploadError(message, "QUOTA_EXCEEDED", false);
  }

  if (message.includes("exceeded the number of videos")) {
    return new UploadError(message, "UPLOAD_LIMIT_EXCEEDED", false);
  }

  if (status === 403) {
    // Non-quota 403: content policy, copyright, etc.
    return new UploadError(message, "REJECTED", false);
  }

  if (status === 401) {
    return new UploadError(message, "UNAUTHORIZED", true);
  }

  if (status === 429) {
    return new UploadError(message, "RATE_LIMITED", true);
  }

  if (status === 400) {
    return new UploadError(message, "BAD_REQUEST", false);
  }

  if (status && status >= 500) {
    return new UploadError(message, "SERVER_ERROR", true);
  }

  // Network errors, timeouts, etc.
  return new UploadError(message, "NETWORK_ERROR", true);
}

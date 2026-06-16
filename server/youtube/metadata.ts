import type { youtube_v3 } from "googleapis";

import type { TwitchClip } from "#server/archive/types.js";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// YouTube rejects `<` and `>` in snippet.title/description with a misleading
// `invalidTitle` error. Substitute common patterns to preserve meaning, then
// strip any remaining angle brackets.
const SANITIZE_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/<\/3/g, "💔"],
  [/<3/g, "❤️"],
  [/<\.</g, "‹.‹"],
  [/>\.>/g, "›.›"],
  [/<<</g, "«««"],
  [/>>>/g, "»»»"],
  [/<-/g, "←"],
  [/->/g, "→"],
  [/<=/g, "⇐"],
  [/=>/g, "⇒"],
  [/<>/g, "↔"],
];

export function sanitizeForYouTube(input: string): string {
  let output = input;
  for (const [pattern, replacement] of SANITIZE_RULES) {
    output = output.replaceAll(pattern, replacement);
  }
  return output.replaceAll(/[<>]/g, "");
}

const DEFAULT_DESCRIPTION_TEMPLATE = [
  "Twitch Clip Archive - {{ broadcaster_name }}",
  "",
  "Originally clipped by {{ creator_name }} on {{ created_at_formatted }}",
  "Original Twitch URL: {{ url }}",
  "",
  "Clip ID: {{ clip_id }}",
  "{{ deleted_notice }}",
].join("\n");

/**
 * Interpolate `{{ key }}` placeholders in a template string with clip data.
 * Available variables:
 *   clip_id, url, embed_url, broadcaster_id, broadcaster_name,
 *   creator_id, creator_name, game_id, language, title, view_count,
 *   created_at, created_at_formatted, thumbnail_url,
 *   clip_archived, thumbnail_archived, deleted_on_twitch
 */
export function interpolateTemplate(template: string, clip: TwitchClip): string {
  const vars: Record<string, string> = {
    clip_id: clip.clipId,
    url: clip.url,
    embed_url: clip.embedUrl,
    broadcaster_id: String(clip.broadcasterId),
    broadcaster_name: clip.broadcasterName,
    creator_id: String(clip.creatorId),
    creator_name: clip.creatorName,
    game_id: clip.gameId !== null ? String(clip.gameId) : "",
    language: clip.language,
    title: clip.title,
    view_count: String(clip.viewCount),
    created_at: clip.createdAt,
    created_at_formatted: formatDate(clip.createdAt),
    thumbnail_url: clip.thumbnailUrl,
    clip_archived: String(clip.clipArchived),
    thumbnail_archived: String(clip.thumbnailArchived),
    deleted_on_twitch: String(clip.deletedOnTwitch),
    deleted_notice: clip.deletedOnTwitch ? "(This clip has been deleted from Twitch)" : "",
  };

  return template.replaceAll(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => vars[key] ?? match);
}

export function buildVideoMetadata(
  clip: TwitchClip,
  descriptionTemplate?: string,
): youtube_v3.Schema$Video {
  const title = sanitizeForYouTube(clip.title).slice(0, 100);
  const template = descriptionTemplate ?? DEFAULT_DESCRIPTION_TEMPLATE;
  const description = sanitizeForYouTube(interpolateTemplate(template, clip).trim());

  return {
    snippet: {
      title,
      description,
      tags: [clip.clipId, clip.broadcasterName, "twitch-clip", "archive"],
      defaultLanguage: clip.language || "en",
    },
    status: {
      privacyStatus: "unlisted",
      embeddable: true,
      selfDeclaredMadeForKids: false,
    },
    recordingDetails: {
      recordingDate: clip.createdAt.split("T")[0],
    },
  };
}

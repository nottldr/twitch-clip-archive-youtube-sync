import { z } from "zod/v4";

/** Schema for the `fields` object of a clips.clip entry in the Django dump. */
export const DjangoClipFieldsSchema = z.object({
  clip_id: z.string(),
  url: z.url(),
  embed_url: z.url(),
  broadcaster_id: z.number().int(),
  broadcaster_name: z.string(),
  creator_id: z.number().int(),
  creator_name: z.string(),
  game_id: z.number().int().nullable(),
  language: z.string(),
  title: z.string(),
  view_count: z.number().int().min(0),
  created_at: z.iso.datetime(),
  thumbnail_url: z.url(),
  clip_archived: z.boolean(),
  thumbnail_archived: z.boolean(),
  deleted_on_twitch: z.boolean(),
});

/** Schema for a single entry in the Django JSON dump (intentionally loose). */
export const DjangoDumpEntrySchema = z.object({
  model: z.string(),
  pk: z.unknown(),
  fields: z.record(z.string(), z.unknown()),
});

/** Schema for a clips.clip dump entry specifically. */
export const DjangoClipEntrySchema = z.object({
  model: z.literal("clips.clip"),
  pk: z.number().int(),
  fields: DjangoClipFieldsSchema,
});

/** Schema for the full dump file (array of mixed model entries). */
export const DjangoDumpFileSchema = z.array(DjangoDumpEntrySchema);

/** Our normalized clip type used throughout the app. */
export const TwitchClipSchema = z.object({
  clipId: z.string(),
  url: z.string(),
  embedUrl: z.string(),
  broadcasterId: z.number().int(),
  broadcasterName: z.string(),
  creatorId: z.number().int(),
  creatorName: z.string(),
  gameId: z.number().int().nullable(),
  language: z.string(),
  title: z.string(),
  viewCount: z.number().int().min(0),
  createdAt: z.string(),
  thumbnailUrl: z.string(),
  clipArchived: z.boolean(),
  thumbnailArchived: z.boolean(),
  deletedOnTwitch: z.boolean(),
});

export type DjangoClipFields = z.infer<typeof DjangoClipFieldsSchema>;
export type DjangoDumpEntry = z.infer<typeof DjangoDumpEntrySchema>;
export type DjangoClipEntry = z.infer<typeof DjangoClipEntrySchema>;
export type TwitchClip = z.infer<typeof TwitchClipSchema>;

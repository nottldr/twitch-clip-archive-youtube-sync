/**
 * Generates tiny test MP4 and JPG files for the fixture archive,
 * and validates the fixture dump JSON against the zod schema.
 * Requires ffmpeg to be installed.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { z } from "zod/v4";

import { DjangoClipFieldsSchema } from "../server/archive/types.js";

const LooseEntrySchema = z.object({
  model: z.string(),
  pk: z.unknown(),
  fields: z.record(z.string(), z.unknown()),
});

const fixturesDir = resolve(import.meta.dirname, "../fixtures/archive");
const clipsDir = resolve(fixturesDir, "media/clips");
const thumbsDir = resolve(fixturesDir, "media/clip_thumbnails");
const dumpPath = resolve(fixturesDir, "db/dump_2026-01-01_00_00_00.json");

// 1. Validate the fixture dump against our schemas
console.log("Validating fixture dump against schema...");
const raw = readFileSync(dumpPath, "utf-8");
const parsed = JSON.parse(raw);

if (!Array.isArray(parsed)) {
  console.error("Fixture dump is not an array");
  process.exit(1);
}

const clipIds: string[] = [];

for (const raw of parsed) {
  const entry = LooseEntrySchema.safeParse(raw);
  if (!entry.success) continue;
  if (entry.data.model !== "clips.clip") continue;

  const fieldsResult = DjangoClipFieldsSchema.safeParse(entry.data.fields);
  if (!fieldsResult.success) {
    console.error(`Clip pk=${String(entry.data.pk)} failed validation:`);
    console.error(fieldsResult.error.message);
    process.exit(1);
  }
  clipIds.push(fieldsResult.data.clip_id);
}

console.log(`Validated ${clipIds.length} clip entries.`);

// 2. Generate media files
for (const id of clipIds) {
  const mp4Path = resolve(clipsDir, `${id}.mp4`);
  const jpgPath = resolve(thumbsDir, `${id}.jpg`);

  if (!existsSync(mp4Path)) {
    console.log(`Generating ${id}.mp4...`);
    execSync(
      `ffmpeg -y -f lavfi -i color=c=blue:s=320x180:d=2 -f lavfi -i anullsrc -shortest -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac "${mp4Path}" 2>/dev/null`,
    );
  }

  if (!existsSync(jpgPath)) {
    console.log(`Generating ${id}.jpg...`);
    execSync(
      `ffmpeg -y -f lavfi -i color=c=blue:s=480x272:d=1 -frames:v 1 "${jpgPath}" 2>/dev/null`,
    );
  }
}

console.log("Fixtures generated and validated.");

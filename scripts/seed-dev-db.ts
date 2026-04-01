/**
 * Seeds the dev database with fixture clips in mixed states
 * for a realistic-looking admin UI. Run after `pnpm dev` has started
 * at least once (to create the DB), or standalone.
 *
 * Usage: pnpm dev:seed
 */
import { resolve } from "node:path";

import Database from "better-sqlite3";

import { readLatestDump } from "../server/archive/reader.js";

const dataPath = resolve(import.meta.dirname, "../data");
const archivePath = resolve(import.meta.dirname, "../fixtures/archive");

const db = new Database(resolve(dataPath, "sync.db"));
db.pragma("journal_mode = WAL");

// Import migrations
const { runMigrations } = await import("../server/db/migrations.js");
runMigrations(db);

// Import clips from fixtures
const { createClipsRepository } = await import("../server/db/repositories/clips.js");
const clipsRepo = createClipsRepository(db);

const clips = readLatestDump(archivePath, 0);
console.log(`Importing ${clips.length} clips from fixtures...`);
clipsRepo.upsertFromArchive(clips);

// Set mixed states for a realistic UI
const states: Array<{ clipId: string; status: string; youtubeId?: string; error?: string }> = [
  { clipId: "TestClipAlpha-abc123", status: "uploaded", youtubeId: "dQw4w9WgXcQ" },
  { clipId: "TestClipBeta-def456", status: "uploaded", youtubeId: "jNQXAC9IVRw" },
  { clipId: "TestClipGamma-ghi789", status: "uploaded", youtubeId: "9bZkp7q19f0" },
  { clipId: "TestClipDelta-jkl012", status: "uploaded", youtubeId: "kJQP7kiw5Fk" },
  { clipId: "TestClipEpsilon-mno345", status: "pending" },
  { clipId: "TestClipZeta-pqr678", status: "failed", error: "quotaExceeded: Daily quota reached" },
  { clipId: "TestClipEta-stu901", status: "pending" },
  { clipId: "TestClipTheta-vwx234", status: "skipped", error: "MP4 file not found" },
  { clipId: "TestClipIota-yza567", status: "pending" },
  { clipId: "TestClipKappa-bcd890", status: "pending" },
];

for (const s of states) {
  switch (s.status) {
    case "uploaded":
      clipsRepo.markUploading(s.clipId);
      clipsRepo.markUploaded(s.clipId, s.youtubeId ?? "");
      break;
    case "failed":
      clipsRepo.markFailed(s.clipId, s.error ?? "Unknown error");
      break;
    case "skipped":
      clipsRepo.markSkipped(s.clipId, s.error ?? "");
      break;
    case "pending":
      // Already pending from upsert
      break;
  }
}

// Seed some quota history
const { createQuotaRepository } = await import("../server/db/repositories/quota.js");
const quotaRepo = createQuotaRepository(db);

const today = new Date();
for (let i = 7; i >= 1; i--) {
  const d = new Date(today);
  d.setDate(d.getDate() - i);
  const date = d.toISOString().split("T")[0];
  const uploads = Math.floor(Math.random() * 80) + 20;
  for (let j = 0; j < uploads; j++) {
    quotaRepo.recordUpload(date, 100);
  }
}

db.close();

const stats = { uploaded: 4, pending: 4, failed: 1, skipped: 1 };
console.log(`Seeded: ${JSON.stringify(stats)}`);
console.log("Dev database ready at data/sync.db");

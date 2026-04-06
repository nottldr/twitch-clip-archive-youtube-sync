import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { Temporal } from "@js-temporal/polyfill";
import { Hono } from "hono";
import { z } from "zod/v4";

import type { DjangoClipEntry } from "#server/archive/types.js";
import { DjangoDumpFileSchema } from "#server/archive/types.js";
import type { Config } from "#server/config.js";
import type { SyncEngine } from "#server/sync/engine.js";
import { getRawQuotaMetrics } from "#server/sync/quota-discovery.js";
import type { AuthManager } from "#server/youtube/auth.js";

const DebugFlagSchema = z.enum(["fail", "quota", "uploadLimit"]);

export function createEngineRoutes(engine: SyncEngine, authManager: AuthManager, config: Config) {
  const app = new Hono();

  app.get("/engine/status", (c) => {
    return c.json(engine.getSnapshot());
  });

  app.post("/engine/pause", (c) => {
    engine.pause();
    return c.json(engine.getSnapshot());
  });

  app.post("/engine/resume", (c) => {
    engine.resume();
    return c.json(engine.getSnapshot());
  });

  app.post("/engine/trigger/:clipId", (c) => {
    const clipId = c.req.param("clipId");
    engine.triggerClip(clipId);
    return c.json({ ok: true });
  });

  app.post("/engine/import-now", (c) => {
    engine.importNow();
    return c.json({ ok: true });
  });

  app.post("/engine/discover-now", (c) => {
    engine.discoverNow();
    return c.json({ ok: true });
  });

  app.post("/engine/reset-failed", (c) => {
    const result = engine.resetFailedClips();
    return c.json(result);
  });

  app.post("/engine/reset-all", (c) => {
    const result = engine.resetAllClips();
    return c.json(result);
  });

  // Debug endpoints
  app.get("/engine/debug/quota-metrics", async (c) => {
    if (!config.googleProjectNumber) {
      return c.json({ error: "GOOGLE_PROJECT_NUMBER not set" }, 400);
    }
    const raw = await getRawQuotaMetrics(authManager, config.googleProjectNumber);
    return c.json(raw);
  });

  app.post("/debug/set-flag/:flag", (c) => {
    const parsed = DebugFlagSchema.safeParse(c.req.param("flag"));
    if (!parsed.success) return c.json({ error: "Invalid flag" }, 400);
    engine.setDebugFlag(parsed.data, true);
    return c.json({ ok: true });
  });

  app.post("/debug/clear-flag/:flag", (c) => {
    const parsed = DebugFlagSchema.safeParse(c.req.param("flag"));
    if (!parsed.success) return c.json({ error: "Invalid flag" }, 400);
    engine.setDebugFlag(parsed.data, false);
    return c.json({ ok: true });
  });

  app.post("/debug/clear-all-flags", (c) => {
    engine.clearDebugFlags();
    return c.json({ ok: true });
  });

  app.post("/debug/reset-quota", (c) => {
    engine.notifyQuotaReset();
    return c.json({ ok: true });
  });

  app.post("/debug/add-clips", (c) => {
    const count = Number.parseInt(c.req.query("count") ?? "5", 10);
    const clamped = Math.min(Math.max(count, 1), 50);

    const dbDir = resolve(config.archivePath, "db");
    const clipsDir = resolve(config.archivePath, "media/clips");

    // Find the latest existing dump to read existing entries and determine max pk
    const dumpFiles = readdirSync(dbDir)
      .filter((f) => f.startsWith("dump_") && f.endsWith(".json"))
      .sort();
    const latestDump = dumpFiles.at(-1);
    const existingEntries = latestDump
      ? DjangoDumpFileSchema.parse(JSON.parse(readFileSync(resolve(dbDir, latestDump), "utf-8")))
      : [];

    let maxPk = 0;
    for (const e of existingEntries) {
      if (typeof e.pk === "number") {
        maxPk = Math.max(maxPk, e.pk);
      }
    }

    const titles = [
      "Insane clutch moment",
      "Lucky headshot",
      "Team wipe in overtime",
      "Funny fail compilation",
      "Last-second save",
      "1v5 ace play",
      "Unexpected outplay",
      "Calculated prediction",
      "Wild RNG moment",
      "Perfect timing",
    ];

    const newEntries: DjangoClipEntry[] = [];
    for (let i = 0; i < clamped; i++) {
      const id = `DebugClip-${randomBytes(6).toString("hex")}`;
      const pk = maxPk + i + 1;
      const date = new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000).toISOString();

      newEntries.push({
        model: "clips.clip",
        pk,
        fields: {
          clip_id: id,
          url: `https://www.twitch.tv/test/clip/${id}`,
          embed_url: `https://clips.twitch.tv/embed?clip=${id}`,
          broadcaster_id: 135075027,
          broadcaster_name: "georgy177",
          creator_id: 100000 + pk,
          creator_name: "debug_viewer",
          game_id: 509658,
          language: "en",
          title: titles[i % titles.length],
          view_count: Math.floor(Math.random() * 1000),
          created_at: date,
          thumbnail_url: "https://example.com/debug-thumb.jpg",
          clip_archived: true,
          thumbnail_archived: true,
          deleted_on_twitch: false,
        },
      });

      // Create a tiny MP4 file
      const mp4Path = resolve(clipsDir, `${id}.mp4`);
      try {
        execSync(
          `ffmpeg -y -f lavfi -i color=c=red:s=320x180:d=2 -f lavfi -i anullsrc -shortest -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac "${mp4Path}" 2>/dev/null`,
        );
      } catch {
        // ffmpeg not available — write a dummy file large enough to pass validation
        writeFileSync(mp4Path, Buffer.alloc(5000));
      }
    }

    // Write a new dump file with current timestamp so the archive reader picks it up as latest
    const now = Temporal.Now.plainDateTimeISO();
    const ts = `${now.year}_${String(now.month).padStart(2, "0")}_${String(now.day).padStart(2, "0")}_${String(now.hour).padStart(2, "0")}_${String(now.minute).padStart(2, "0")}_${String(now.second).padStart(2, "0")}`;
    const newDumpPath = resolve(dbDir, `dump_${ts}.json`);
    writeFileSync(newDumpPath, JSON.stringify([...existingEntries, ...newEntries], null, 2));

    // Backdate mtime so the archive reader doesn't skip it (it ignores files < 60s old)
    const past = new Date(Temporal.Now.instant().subtract({ seconds: 120 }).epochMilliseconds);
    utimesSync(newDumpPath, past, past);

    return c.json({ added: newEntries.length, clipIds: newEntries.map((e) => e.fields.clip_id) });
  });

  return app;
}

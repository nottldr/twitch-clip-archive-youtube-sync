import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { parseDumpFile } from "#server/archive/reader.js";

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: tsx scripts/dump-to-csv.ts <dump-file.json>");
  process.exit(1);
}

const resolved = resolve(inputPath);
const clips = parseDumpFile(resolved);

clips.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

const header = "createdAt,clipId,creatorName,title,deletedOnTwitch";
const rows = clips.map((c) => {
  const escape = (s: string) => `"${s.replaceAll('"', '""')}"`;
  return `${escape(c.createdAt)},${escape(c.clipId)},${escape(c.creatorName)},${escape(c.title)},${c.deletedOnTwitch}`;
});

const outputPath = resolved.replace(/\.json$/, ".csv");
writeFileSync(outputPath, [header, ...rows].join("\n") + "\n");
console.log(`Wrote ${clips.length} clips to ${outputPath}`);

import type Database from "better-sqlite3";

import { z } from "zod/v4";

import { parseRow } from "../parse.js";

const EngineStateRowSchema = z.object({
  user_paused: z.number(),
});

export function createEngineStateRepository(db: Database.Database) {
  function isUserPaused(): boolean {
    const row = parseRow(
      EngineStateRowSchema,
      db.prepare("SELECT user_paused FROM engine_state WHERE id = 1").get(),
    );
    return row?.user_paused === 1;
  }

  function setUserPaused(paused: boolean): void {
    db.prepare(
      `INSERT INTO engine_state (id, user_paused)
       VALUES (1, ?)
       ON CONFLICT(id) DO UPDATE SET
         user_paused = excluded.user_paused,
         updated_at = datetime('now')`,
    ).run(paused ? 1 : 0);
  }

  return {
    isUserPaused,
    setUserPaused,
  };
}

export type EngineStateRepository = ReturnType<typeof createEngineStateRepository>;

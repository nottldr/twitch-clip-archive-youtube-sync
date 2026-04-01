import { resolve } from "node:path";

import Database from "better-sqlite3";

import { runMigrations } from "./migrations.js";

let db: Database.Database | null = null;

export function getDb(dataPath: string): Database.Database {
  if (db) return db;

  const dbPath = resolve(dataPath, "sync.db");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  runMigrations(db);

  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/** Create an in-memory database for testing. */
export function createTestDb(): Database.Database {
  const testDb = new Database(":memory:");
  testDb.pragma("foreign_keys = ON");
  runMigrations(testDb);
  return testDb;
}

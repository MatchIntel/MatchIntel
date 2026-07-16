import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";

const migrationsDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../migrations"
);
const advisoryLockId = "8604132219";

export const migrationState = {
  ready: false,
  running: false,
  attempts: 0,
  applied: [],
  startedAt: null,
  completedAt: null,
  lastError: null
};

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function safeMessage(error) {
  return String(error?.message || error || "Unknown database error").slice(0, 500);
}

export async function runMigrations() {
  const client = await pool.connect();
  let lockHeld = false;

  try {
    await client.query("SELECT pg_advisory_lock($1::bigint)", [advisoryLockId]);
    lockHeld = true;

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations(
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const filenames = (await fs.readdir(migrationsDirectory))
      .filter(name => name.endsWith(".sql"))
      .sort();

    const applied = [];
    for (const filename of filenames) {
      const existing = await client.query(
        "SELECT 1 FROM schema_migrations WHERE name=$1",
        [filename]
      );
      if (existing.rowCount) continue;

      const sql = await fs.readFile(path.join(migrationsDirectory, filename), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations(name) VALUES($1)",
          [filename]
        );
        await client.query("COMMIT");
        applied.push(filename);
        console.log(`[migrations] Applied ${filename}`);
      } catch (error) {
        await client.query("ROLLBACK");
        error.message = `Migration ${filename} failed: ${safeMessage(error)}`;
        throw error;
      }
    }

    return applied;
  } finally {
    if (lockHeld) {
      await client.query("SELECT pg_advisory_unlock($1::bigint)", [advisoryLockId]).catch(() => {});
    }
    client.release();
  }
}

export async function startMigrationLoop({ initialDelayMs = 0 } = {}) {
  if (migrationState.running || migrationState.ready) return;
  migrationState.running = true;
  migrationState.startedAt ||= new Date().toISOString();

  if (initialDelayMs > 0) await sleep(initialDelayMs);

  while (!migrationState.ready) {
    migrationState.attempts += 1;
    try {
      const applied = await runMigrations();
      migrationState.applied.push(...applied);
      migrationState.ready = true;
      migrationState.completedAt = new Date().toISOString();
      migrationState.lastError = null;
      console.log(`[migrations] Database ready after ${migrationState.attempts} attempt(s).`);
    } catch (error) {
      migrationState.lastError = safeMessage(error);
      const retryMs = Math.min(30000, 3000 * migrationState.attempts);
      console.error(`[migrations] Attempt ${migrationState.attempts} failed: ${migrationState.lastError}`);
      console.error(`[migrations] Retrying in ${Math.round(retryMs / 1000)} seconds.`);
      await sleep(retryMs);
    }
  }

  migrationState.running = false;
}

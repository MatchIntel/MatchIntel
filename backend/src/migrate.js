import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";
const dir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../migrations");
try {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY,applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  for (const name of (await fs.readdir(dir)).filter(x=>x.endsWith(".sql")).sort()) {
    const done=await pool.query("SELECT 1 FROM schema_migrations WHERE name=$1",[name]);
    if(done.rowCount) continue;
    const sql=await fs.readFile(path.join(dir,name),"utf8");
    const c=await pool.connect();
    try { await c.query("BEGIN"); await c.query(sql); await c.query("INSERT INTO schema_migrations(name) VALUES($1)",[name]); await c.query("COMMIT"); console.log(`Applied ${name}`); }
    catch(error){ await c.query("ROLLBACK"); throw error; }
    finally { c.release(); }
  }
} finally { await pool.end(); }

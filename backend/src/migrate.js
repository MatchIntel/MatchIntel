import { pool } from "./db.js";
import { runMigrations } from "./migrations.js";

try {
  const applied = await runMigrations();
  console.log(`[migrations] Complete. ${applied.length} migration(s) applied.`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await pool.end();
}

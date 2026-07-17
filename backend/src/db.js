import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;
// Keep /health available even before Railway variables are complete. Protected
// routes and migrations remain disabled until the real DATABASE_URL exists.
const connectionString = config.databaseUrl || "postgresql://invalid:invalid@127.0.0.1:1/invalid";

export const pool = new Pool({
  connectionString,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  keepAlive: true
});

pool.on("error", error => {
  console.error(`[database] Idle client error: ${error.message}`);
});

export const query = (text, params = []) => pool.query(text, params);

export async function tx(callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const value = await callback(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

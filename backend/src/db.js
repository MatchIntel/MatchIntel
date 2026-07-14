import pg from "pg";
import { config } from "./config.js";
const { Pool } = pg;
export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : false,
  max: 12,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});
export const query = (text, params=[]) => pool.query(text, params);
export async function tx(callback) {
  const client = await pool.connect();
  try { await client.query("BEGIN"); const value=await callback(client); await client.query("COMMIT"); return value; }
  catch(error){ await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

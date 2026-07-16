import { config } from "./config.js";

export async function api(path, options = {}) {
  const {
    actor = "discord-bot",
    timeoutMs = 15000,
    headers: extraHeaders = {},
    ...fetchOptions
  } = options;

  const response = await fetch(`${config.backendUrl}${path}`, {
    ...fetchOptions,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Key": config.backendAdminKey,
      "X-Admin-Actor": actor,
      ...extraHeaders
    }
  });

  const text = await response.text();
  let body = {};
  if (text) {
    try { body = JSON.parse(text); }
    catch { body = { message: text.slice(0, 500) }; }
  }
  if (!response.ok) {
    const error = new Error(body.message || `Backend returned HTTP ${response.status}`);
    error.code = body.code;
    error.status = response.status;
    throw error;
  }
  return body;
}

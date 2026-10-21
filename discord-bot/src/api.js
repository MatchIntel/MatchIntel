import { config } from "./config.js";

export function routeApiPath(path){
  // Keep existing guild/ticket storage so live ticket buttons and settings survive.
  if(path.startsWith("/v1/admin/discord/"))return path;
  if(path==="/v1/admin"||path.startsWith("/v1/admin/"))return "/v1/qt-admin"+path.slice("/v1/admin".length);
  return path;
}

export async function api(path, options = {}) {
  const {
    actor = "discord-bot",
    timeoutMs = 15000,
    headers: extraHeaders = {},
    ...fetchOptions
  } = options;

  const response = await fetch(`${config.backendUrl}${routeApiPath(path)}`, {
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
    const missingQuiltedRoutes=response.status===404&&!body.code&&routeApiPath(path).startsWith("/v1/qt-admin/");
    const error = new Error(missingQuiltedRoutes?(path.includes('/website-keys/')?"Deploy Quilted Tweaks backend 0.10.0 first; its website-key routes are not available yet.":path.includes('/sales/')?"Deploy the updated Quilted Tweaks backend first; its sales/expense routes are not available yet.":path.endsWith("/force-update")?"Deploy Quilted Tweaks backend 0.8.2 first; its force-update route is not available yet.":"Deploy Quilted Tweaks backend 0.8.1 first; its licensing routes are not available yet."):body.message || `Backend returned HTTP ${response.status}`);
    error.code = missingQuiltedRoutes?"QT-BACKEND-UPDATE":body.code;
    error.status = response.status;
    throw error;
  }
  return body;
}

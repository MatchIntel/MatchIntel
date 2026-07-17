function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function cleanUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

export const config = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 3000),
  siteName: process.env.SITE_NAME?.trim() || "MatchIntel",
  siteUrl: cleanUrl(required("SITE_URL")),
  backendUrl: cleanUrl(required("BACKEND_URL")),
  websiteApiKey: required("WEBSITE_API_KEY"),
  cookieSecret: required("COOKIE_SECRET"),
  discordClientId: required("DISCORD_CLIENT_ID"),
  discordClientSecret: required("DISCORD_CLIENT_SECRET"),
  discordRedirectUri: required("DISCORD_REDIRECT_URI"),
  discordInviteUrl: cleanUrl(process.env.DISCORD_INVITE_URL || ""),
  lifetimeBuyUrl: cleanUrl(process.env.LIFETIME_BUY_URL || process.env.CHECKOUT_URL || ""),
  downloadUrl: cleanUrl(process.env.DOWNLOAD_URL || ""),
  supportUrl: cleanUrl(process.env.SUPPORT_URL || ""),
  supportEmail: process.env.SUPPORT_EMAIL?.trim() || "",
  lifetimePriceLabel: process.env.LIFETIME_PRICE_LABEL?.trim()
    || process.env.PRODUCT_PRICE_LABEL?.trim()
    || "Lifetime access",
  freeTrialDays: Math.max(1, Math.min(30, Number(process.env.FREE_TRIAL_DAYS || 3)))
};

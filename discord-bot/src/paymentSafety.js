const VALID_TICKET_TYPES = new Set(["general", "purchase", "bug"]);
const PAYMENT_GLOBAL_MARKER = /(?:^|\s)\[MI-PAYMENT-REMINDERS:(ON|OFF)\](?=\s|$)/i;

export const PAYMENT_REMINDER_COOLDOWN_MS = 10 * 60 * 1000;

export function ticketTopic(userId, status = "open", claimedBy = "", ticketType = "general", paymentReminderEnabled = true) {
  const safeType = VALID_TICKET_TYPES.has(ticketType) ? ticketType : "general";
  return `matchintel-ticket:${userId}:${status}${claimedBy ? `:${claimedBy}` : ""}|type=${safeType}|payment=${paymentReminderEnabled ? "on" : "off"}`;
}

export function parseTicketTopic(topic) {
  const [base, ...metadataParts] = String(topic || "").split("|");
  const match = /^matchintel-ticket:(\d{15,25}):(open|closed)(?::(\d{15,25}))?$/.exec(base);
  if (!match) return null;
  const metadata = Object.fromEntries(metadataParts.map(part => {
    const [key, ...rest] = part.split("=");
    return [String(key || "").trim().toLowerCase(), rest.join("=").trim().toLowerCase()];
  }).filter(([key]) => key));
  return {
    userId: match[1],
    status: match[2],
    claimedBy: match[3] || "",
    type: VALID_TICKET_TYPES.has(metadata.type) ? metadata.type : "",
    paymentReminderEnabled: metadata.payment !== "off"
  };
}

export function paymentMessageMatches(content) {
  const text = String(content || "").toLowerCase();
  if (!text.trim()) return false;
  const patterns = [
    /\bpay\s*pal\b/i,
    /\bpayments?\b/i,
    /\bpaying\b/i,
    /\bpaid\b/i,
    /\bsend(?:ing)?\s+(?:you|him|her|them|someone|the owner|an admin|staff|money|funds|cash)\b/i,
    /\b(?:send|transfer|wire)\s+(?:the\s+)?(?:money|funds|payment|cash)\b/i,
    /\b(?:cash\s*app|venmo|zelle|bank transfer|wire transfer|crypto|bitcoin|btc|ethereum|eth)\b/i,
    /\b(?:credit|debit)\s*card\b/i,
    /\b(?:money|funds|cash)\b/i,
    /(?:[$€£]\s*\d|\b\d+(?:\.\d{1,2})?\s*(?:usd|eur|gbp|dollars?|euros?|pounds?)\b)/i,
    /\b(?:invoice|payment link|checkout link|payment address|payment email|paypal email)\b/i,
    /\b(?:where|who|how)\s+(?:do|can|should)\s+i\s+pay\b/i,
    /\bpay\s+(?:you|him|her|them|someone|the owner|an admin|staff|with|through|via|now|today|tomorrow)\b/i
  ];
  return patterns.some(pattern => pattern.test(text));
}

export function globalPaymentRemindersEnabled(topic) {
  const match = PAYMENT_GLOBAL_MARKER.exec(String(topic || ""));
  return !match || match[1].toUpperCase() !== "OFF";
}

export function topicWithGlobalPaymentSetting(topic, enabled) {
  const marker = `[MI-PAYMENT-REMINDERS:${enabled ? "ON" : "OFF"}]`;
  const cleaned = String(topic || "").replace(PAYMENT_GLOBAL_MARKER, " ").replace(/\s{2,}/g, " ").trim();
  return `${cleaned}${cleaned ? " " : ""}${marker}`.slice(0, 1024);
}

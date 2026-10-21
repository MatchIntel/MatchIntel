const DISCORD_EMBED_DESCRIPTION_LIMIT = 4096;

function tidyWhitespace(value) {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Discord slash-command text inputs are single-line controls, so pasted line
 * breaks can arrive flattened. This restores explicit \\n tokens and adds
 * sensible spacing around common Markdown sections without changing normal
 * inline bold text.
 */
export function formatBotMessage(input) {
  let text = String(input || "")
    .replace(/\\n/g, "\n")
    .replace(/<br\s*\/?\s*>/gi, "\n");

  text = tidyWhitespace(text);
  if (!text) return "";

  // Rebuild collapsed numbered sections such as: 1. **Download** Details...
  text = text.replace(
    /(?:^|[ \t]+)(\d{1,2})\.\s*\*\*([^*\n]{1,120})\*\*\s*/g,
    (match, number, heading, offset) => `${offset === 0 ? "" : "\n\n"}**${number}. ${heading.trim()}**\n`
  );

  // Rebuild the support section used in onboarding/help messages.
  text = text.replace(
    /(?:^|[ \t]+)\*\*(Need help\?|Need support\?|Important|Safety note)\*\*\s*/gi,
    (match, heading, offset) => `${offset === 0 ? "" : "\n\n"}**${heading.trim()}**\n`
  );

  // Turn inline bullet separators into actual bullet lines.
  text = text.replace(/[ \t]+•[ \t]*/g, "\n• ");

  // Put slash commands introduced by “use:” on their own readable line.
  text = text.replace(/\b(use:)\s*(\/[a-z0-9_-]+)\s+/gi, "$1\n`$2`\n\n");

  // Keep bug-report instructions from being attached to the final bullet.
  text = text.replace(/[ \t]+(?=Please include screenshots\b)/i, "\n\n");

  // Keep the competitive-safety note visually separate in Getting Started.
  text = text.replace(
    /[ \t]+(?=MatchIntel does not modify Fortnite files\b)/i,
    "\n\n**Competitive safety**\n"
  );

  text = tidyWhitespace(text);
  if (text.length <= DISCORD_EMBED_DESCRIPTION_LIMIT) return text;
  return `${text.slice(0, DISCORD_EMBED_DESCRIPTION_LIMIT - 1).trimEnd()}…`;
}

import test from "node:test";
import assert from "node:assert/strict";
import { formatBotMessage } from "../src/messageFormat.js";

test("restores explicit slash-command line-break tokens", () => {
  assert.equal(formatBotMessage("First line\\n\\nSecond line"), "First line\n\nSecond line");
});

test("formats collapsed Getting Started copy into readable sections", () => {
  const input = "Welcome to MatchIntel. Here’s everything you need to get set up. 1. **Download MatchIntel** Download the latest version. 2. **Get a license key** Claim a free trial. **Need help?** Open a ticket: • General Support • Purchase MatchIntel • Report a Bug MatchIntel does not modify Fortnite files, inject into the game, access game memory, or control gameplay.";
  const formatted = formatBotMessage(input);
  assert.match(formatted, /set up\.\n\n\*\*1\. Download MatchIntel\*\*\nDownload/);
  assert.match(formatted, /\n\n\*\*2\. Get a license key\*\*\nClaim/);
  assert.match(formatted, /\n\n\*\*Need help\?\*\*\nOpen a ticket:\n• General Support\n• Purchase MatchIntel\n• Report a Bug/);
  assert.match(formatted, /\n\n\*\*Competitive safety\*\*\nMatchIntel does not modify/);
});

test("does not split ordinary inline bold text", () => {
  assert.equal(formatBotMessage("Welcome to **MatchIntel** today."), "Welcome to **MatchIntel** today.");
});


test("separates slash commands and text following the final support bullet", () => {
  const formatted = formatBotMessage("DM the bot and use: /whatsmytrialkey It will return your key. • Report a Bug Please include screenshots when reporting an issue.");
  assert.match(formatted, /use:\n`\/whatsmytrialkey`\n\nIt will return your key/);
  assert.match(formatted, /• Report a Bug\n\nPlease include screenshots/);
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const commandsSource = await fs.readFile(new URL("../src/commands.js", import.meta.url), "utf8");
const indexSource = await fs.readFile(new URL("../src/index.js", import.meta.url), "utf8");
const communitySource = await fs.readFile(new URL("../src/community.js", import.meta.url), "utf8");

test("website trial recovery command is globally registered", () => {
  assert.match(commandsSource, /setName\("whatsmytrialkey"\)/);
  assert.match(commandsSource, /latest timed Quilted Tweaks key linked to your account/i);
});

test("website trial recovery command is routed before staff permissions", () => {
  const commandPosition = indexSource.indexOf('interaction.commandName === "whatsmytrialkey"');
  const staffPosition = indexSource.indexOf('canUse(interaction, "staff")');
  assert.ok(commandPosition >= 0);
  assert.ok(staffPosition > commandPosition);
  assert.match(indexSource, /handleWhatsMyTrialKey\(interaction\)/);
});

test("trial recovery uses the dedicated website-trial backend endpoint", () => {
  assert.match(communitySource, /website-trial\/reveal/);
  assert.match(communitySource, /your Quilted Tweaks timed key/i);
});

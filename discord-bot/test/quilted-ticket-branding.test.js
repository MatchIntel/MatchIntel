import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const community = fs.readFileSync(new URL("../src/community.js", import.meta.url), "utf8");
const config = fs.readFileSync(new URL("../src/config.js", import.meta.url), "utf8");
const index = fs.readFileSync(new URL("../src/index.js", import.meta.url), "utf8");

test("ticket panel is branded for Quilted Tweaks", () => {
  assert.match(community, /Quilted Tweaks Support/);
  assert.match(community, /A Quilted Tweaks staff member will respond as soon as possible\./);
  assert.match(community, /label: "Purchase"/);
  assert.doesNotMatch(community, /label: "Purchase MatchIntel"/);
});

test("claim and close ticket buttons include emojis", () => {
  assert.match(community, /setLabel\("Claim Ticket"\)\.setEmoji\("🙋"\)/);
  assert.match(community, /setLabel\("Close Ticket"\)\.setEmoji\("🔒"\)/);
});

test("purchase ticket advertises all requested payment methods and commands", () => {
  for (const expected of [
    "1560055356074496061",
    "1560055180953657485",
    "1560055341511737394",
    "1560055327188197436",
    "!cashapp",
    "!venmo",
    "!applepay",
    "!paypal",
    "# 💳 PAYMENT METHODS"
  ]) assert.match(community, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("official payment destinations have requested defaults", () => {
  assert.match(config, /\$p1chtarded/);
  assert.match(config, /@Liam-Katan/);
  assert.match(config, /Ping @liamfv for further help\./);
  assert.match(config, /liamlifeisgood@gmail\.com/);
});

test("message commands are routed before generic payment reminders and helper nickname is applied", () => {
  assert.match(index, /handlePaymentMethodCommand/);
  assert.match(index, /if \(await handlePaymentMethodCommand\(message\)\) return;/);
  assert.match(index, /setNickname\(config\.botDisplayName/);
});

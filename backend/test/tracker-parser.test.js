import test from "node:test";
import assert from "node:assert/strict";
import { parseTrackerProfileHtml } from "../src/trackerPublicProvider.js";

test("parses lifetime PR from rendered PR History text", () => {
  const html = `
    <html><body><h1>Example Player</h1>
    <section><h2>PR History</h2><div>Yearly Seasonal</div>
    <div>Lifetime</div><strong>114,963</strong><div>(No Decay)</div></section>
    </body></html>`;
  const result = parseTrackerProfileHtml(html, "Requested Player");
  assert.equal(result.displayName, "Example Player");
  assert.equal(result.powerRanking, 114963);
});

test("parses PR and lifetime earnings from embedded JSON", () => {
  const html = `
    <html><body><h1>Cash Player</h1>
    <script id="__NEXT_DATA__" type="application/json">
      {"props":{"pageProps":{"totals":{"powerRankingLifetime":{"value":649301},"lifetimeEarnings":{"value":923350}}}}}
    </script></body></html>`;
  const result = parseTrackerProfileHtml(html, "Cash Player");
  assert.equal(result.powerRanking, 649301);
  assert.equal(result.lifetimeEarnings, 923350);
});

test("does not confuse rank numbers with PR", () => {
  const html = `<html><body><h1>No Data</h1><div>Power Ranking #553 EU (PC)</div></body></html>`;
  const result = parseTrackerProfileHtml(html, "No Data");
  assert.equal(result.powerRanking, null);
  assert.equal(result.lifetimeEarnings, null);
});

test("parses global leaderboard PR and earnings rows", async () => {
  const { parseTrackerEarningsLeaderboardHtml } = await import("../src/trackerPublicProvider.js");
  const html = `
    <a href="/profile/kbm/Peterbot/events?region=GLOBAL"><span>Peterbot</span></a>
    <a href="/org/falcons">Falcons Esport</a>
    <div>$1,098,860</div><div>1,161,330 PR</div>
    <a href="/profile/kbm/Pollo/events?region=GLOBAL">Pollo</a>
    <div>$831,445</div><div>972,419 PR</div>`;
  const players = parseTrackerEarningsLeaderboardHtml(html);
  assert.equal(players.length, 2);
  assert.deepEqual(
    players.map(player => [player.displayName, player.lifetimeEarnings, player.powerRanking]),
    [["Peterbot", 1098860, 1161330], ["Pollo", 831445, 972419]]
  );
});

import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgresql://x:x@localhost/x";
process.env.JWT_SECRET ||= "x".repeat(64);
process.env.ADMIN_API_KEY ||= "y".repeat(64);
process.env.WEBSITE_API_KEY ||= "w".repeat(64);
process.env.DEVICE_HASH_PEPPER ||= "z".repeat(64);

const { fetchCitoPlayer, parseCitoPlayerResponse } = await import("../src/citoProvider.js");

function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers }
  });
}

test("parses the documented Cito earnings shape", () => {
  const result = parseCitoPlayerResponse({
    success: true,
    data: {
      player_id: "bugha-us-001",
      identifiers: {
        display_name: "Bugha",
        epic_account_id: "4735ce9132924caf8a5b17789b40f79c",
        wiki_url: "https://example.test/bugha"
      },
      verified_competitive: true,
      identity_confidence: "high",
      earnings: {
        total: 3402100,
        earnings_currency: "USD",
        earnings_confidence: "high"
      }
    }
  }, "Bugha", "https://api.citoapi.com/api/v1/fortnite/players/Bugha");

  assert.equal(result.displayName, "Bugha");
  assert.equal(result.accountId, "4735ce9132924caf8a5b17789b40f79c");
  assert.equal(result.lifetimeEarnings, 3402100);
  assert.equal(result.provider, "cito");
});

test("uses Epic account ID before display name", async () => {
  const calls = [];
  const result = await fetchCitoPlayer({
    displayName: "Example Player",
    accountId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }, {
    apiKey: "test-key",
    baseUrl: "https://api.example.test/api/v1",
    disableRateLimit: true,
    fetchImpl: async url => {
      calls.push(url);
      return jsonResponse(200, {
        success: true,
        data: {
          display_name: "Example Player",
          identifiers: { epic_account_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
          earnings: { total: 12500 }
        }
      });
    }
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0], /aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa$/);
  assert.equal(result.lifetimeEarnings, 12500);
  assert.equal(result.raw.lookupUsedAccountId, true);
});

test("falls back to exact display name after account ID is not indexed", async () => {
  const calls = [];
  const result = await fetchCitoPlayer({
    displayName: "Exact Name",
    accountId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  }, {
    apiKey: "test-key",
    baseUrl: "https://api.example.test/api/v1",
    disableRateLimit: true,
    fetchImpl: async url => {
      calls.push(url);
      if (calls.length === 1) {
        return jsonResponse(404, { success: false, code: "IDENTIFIER_NOT_FOUND", error: "Not found" });
      }
      return jsonResponse(200, {
        success: true,
        data: { display_name: "Exact Name", earnings: { earnings_usd: 8750 } }
      });
    }
  });

  assert.equal(calls.length, 2);
  assert.match(calls[1], /Exact%20Name$/);
  assert.equal(result.lifetimeEarnings, 8750);
  assert.equal(result.raw.lookupUsedAccountId, false);
});

test("returns an unavailable result when neither identifier is indexed", async () => {
  const result = await fetchCitoPlayer({ displayName: "Unknown Player" }, {
    apiKey: "test-key",
    baseUrl: "https://api.example.test/api/v1",
    disableRateLimit: true,
    fetchImpl: async () => jsonResponse(404, {
      success: false,
      code: "PLAYER_NOT_FOUND",
      error: "Player not found"
    })
  });

  assert.equal(result.lifetimeEarnings, null);
  assert.equal(result.raw.reason, "identifier_not_found");
});

test("propagates Cito rate-limit retry time", async () => {
  await assert.rejects(
    fetchCitoPlayer({ displayName: "Rate Limited" }, {
      apiKey: "test-key",
      baseUrl: "https://api.example.test/api/v1",
      disableRateLimit: true,
      fetchImpl: async () => jsonResponse(429, {
        success: false,
        code: "RATE_LIMITED",
        error: "Rate limit exceeded",
        retry_after_seconds: 17
      })
    }),
    error => error.status === 429 && error.retryAfterMs === 17000
  );
});

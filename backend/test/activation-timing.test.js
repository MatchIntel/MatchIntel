import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL = "postgresql://x:x@localhost/x";
process.env.JWT_SECRET = "x".repeat(64);
process.env.ADMIN_API_KEY = "y".repeat(64);
process.env.WEBSITE_API_KEY = "w".repeat(64);
process.env.DEVICE_HASH_PEPPER = "z".repeat(64);

const { startTimedLicenseIfNeeded } = await import("../src/licenses.js");

test("pending timed license starts its countdown on activation", async () => {
  const calls = [];
  const client = {
    async query(text, params) {
      calls.push({ text, params });
      return {
        rowCount: 1,
        rows: [{
          id: params[0],
          plan: "trial",
          expires_at: new Date(Date.now() + 3 * 86400000),
          activated_at: new Date(),
          activation_duration_seconds: params[1]
        }]
      };
    }
  };

  const result = await startTimedLicenseIfNeeded(client, {
    id: "11111111-1111-4111-8111-111111111111",
    plan: "trial",
    expires_at: null,
    activated_at: null,
    activation_duration_seconds: 259200
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].params[1], 259200);
  assert.ok(result.expires_at);
  assert.ok(result.activated_at);
});

test("lifetime and already-activated licenses are unchanged", async () => {
  const client = { query: async () => { throw new Error("query should not run"); } };
  const lifetime = { id: "a", plan: "lifetime", expires_at: null };
  const activeTrial = { id: "b", plan: "trial", expires_at: new Date() };
  assert.equal(await startTimedLicenseIfNeeded(client, lifetime), lifetime);
  assert.equal(await startTimedLicenseIfNeeded(client, activeTrial), activeTrial);
});

test("pending timed license requires a stored duration", async () => {
  await assert.rejects(
    startTimedLicenseIfNeeded({ query: async () => ({ rows: [] }) }, {
      id: "c",
      plan: "trial",
      expires_at: null,
      activation_duration_seconds: null
    }),
    error => error.code === "MI-ACTIVATION-DURATION-MISSING"
  );
});

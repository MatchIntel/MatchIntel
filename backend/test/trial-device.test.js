import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL = "postgresql://x:x@localhost/x";
process.env.JWT_SECRET = "x".repeat(64);
process.env.ADMIN_API_KEY = "y".repeat(64);
process.env.WEBSITE_API_KEY = "w".repeat(64);
process.env.DEVICE_HASH_PEPPER = "z".repeat(64);

const { enforceFreeTrialDevice } = await import("../src/licenses.js");

function clientFor({ byDevice = [], byLicense = [] } = {}) {
  const calls = [];
  return {
    calls,
    async query(text, params) {
      calls.push({ text, params });
      if (text.includes("WHERE device_hash=$1 FOR UPDATE")) return { rowCount: byDevice.length, rows: byDevice };
      if (text.includes("WHERE first_license_id=$1 FOR UPDATE")) return { rowCount: byLicense.length, rows: byLicense };
      return { rowCount: 1, rows: [] };
    }
  };
}

test("paid licenses skip free-trial history", async () => {
  const client = clientFor();
  await enforceFreeTrialDevice(client, { id: "paid", is_free_trial: false }, "device-a");
  assert.equal(client.calls.length, 0);
});

test("fresh free trial records its first device", async () => {
  const client = clientFor();
  await enforceFreeTrialDevice(client, {
    id: "11111111-1111-4111-8111-111111111111",
    is_free_trial: true,
    discord_user_id: "123456789012345678"
  }, "device-a");
  assert.ok(client.calls.some(call => call.text.includes("INSERT INTO free_trial_device_usage")));
});

test("same device cannot activate a different free trial", async () => {
  const client = clientFor({
    byDevice: [{ first_license_id: "22222222-2222-4222-8222-222222222222" }]
  });
  await assert.rejects(
    enforceFreeTrialDevice(client, {
      id: "11111111-1111-4111-8111-111111111111",
      is_free_trial: true
    }, "device-a"),
    error => error.code === "MI-FREE-TRIAL-DEVICE-USED"
  );
});

test("free-trial key cannot move to another device", async () => {
  const client = clientFor({ byLicense: [{ device_hash: "device-a" }] });
  await assert.rejects(
    enforceFreeTrialDevice(client, {
      id: "11111111-1111-4111-8111-111111111111",
      is_free_trial: true
    }, "device-b"),
    error => error.code === "MI-FREE-TRIAL-KEY-BOUND"
  );
});

test("same free-trial key and device remain valid", async () => {
  const licenseId = "11111111-1111-4111-8111-111111111111";
  const client = clientFor({
    byDevice: [{ first_license_id: licenseId }],
    byLicense: [{ device_hash: "device-a" }]
  });
  await enforceFreeTrialDevice(client, { id: licenseId, is_free_trial: true }, "device-a");
  assert.ok(client.calls.some(call => call.text.includes("UPDATE free_trial_device_usage SET last_seen_at")));
});

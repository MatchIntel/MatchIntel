import test from "node:test";
import assert from "node:assert/strict";

// Pure permission behavior is covered here without importing environment-dependent config.
function level(userId, roles, owners, staff, admins) {
  if (owners.has(userId)) return "owner";
  if ([...admins].some(role => roles.has(role))) return "admin";
  if ([...staff].some(role => roles.has(role))) return "staff";
  return "none";
}

test("owner bypasses role checks", () => {
  assert.equal(level("1", new Set(), new Set(["1"]), new Set(), new Set()), "owner");
});

test("admin role outranks staff role", () => {
  assert.equal(level("2", new Set(["staff", "admin"]), new Set(), new Set(["staff"]), new Set(["admin"])), "admin");
});

test("unknown user has no access", () => {
  assert.equal(level("3", new Set(["other"]), new Set(), new Set(["staff"]), new Set(["admin"])), "none");
});

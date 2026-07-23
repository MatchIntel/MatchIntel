import test from "node:test";
import assert from "node:assert/strict";
import { isVersionOutdated, requiredClientVersion, updatePayload } from "../src/versionControl.js";

test("minimum version is enforced even when forceUpdate is false", () => {
  const version = { minimumVersion: "0.6.9", latestVersion: "0.7.0", forceUpdate: false };
  assert.equal(requiredClientVersion(version), "0.6.9");
  assert.equal(isVersionOutdated("0.6.8", version), true);
  assert.equal(isVersionOutdated("0.6.9", version), false);
});

test("forceUpdate makes latest version mandatory", () => {
  const version = { minimumVersion: "0.6.0", latestVersion: "0.6.9", forceUpdate: true };
  assert.equal(requiredClientVersion(version), "0.6.9");
  assert.equal(isVersionOutdated("0.6.8", version), true);
  assert.equal(isVersionOutdated("0.6.9", version), false);
});

test("update payload exposes the exact required version", () => {
  const payload = updatePayload({
    minimumVersion: "0.6.4",
    latestVersion: "0.6.9",
    forceUpdate: true,
    updateUrl: "https://matchintel.cc/download",
    message: "Update MatchIntel."
  });
  assert.equal(payload.requiredVersion, "0.6.9");
  assert.equal(payload.code, "MI-UPDATE-REQUIRED");
  assert.equal(payload.updateUrl, "https://matchintel.cc/download");
});

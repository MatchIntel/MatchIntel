import test from "node:test";
import assert from "node:assert/strict";
process.env.DATABASE_URL="postgresql://x:x@localhost/x";process.env.JWT_SECRET="x".repeat(64);process.env.ADMIN_API_KEY="y".repeat(64);process.env.WEBSITE_API_KEY="w".repeat(64);process.env.DEVICE_HASH_PEPPER="z".repeat(64);
const { createLicenseKey,encryptLicenseKey,decryptLicenseKey,parseDuration,compareVersions }=await import("../src/security.js");
test("key format",()=>assert.match(createLicenseKey(),/^MI-(?:[A-Z0-9]{4}-){5}[A-Z0-9]{4}$/));
test("duration",()=>{assert.equal(parseDuration("lifetime"),null);assert.ok(parseDuration("7d")>new Date())});
test("versions",()=>{assert.equal(compareVersions("1.2.0","1.1.9"),1);assert.equal(compareVersions("1.0","1.0.0"),0)});

test("license key encryption round trip",()=>{const key=createLicenseKey();const encrypted=encryptLicenseKey(key);assert.notEqual(encrypted,key);assert.equal(decryptLicenseKey(encrypted),key);assert.equal(decryptLicenseKey("broken"),null)});

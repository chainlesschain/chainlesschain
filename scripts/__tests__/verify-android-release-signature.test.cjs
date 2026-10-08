"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  verifySignerFingerprints,
} = require("../verify-android-release-signature.cjs");
const expected = "a1".repeat(32);
const other = "b2".repeat(32);
const numbered = (fingerprint) =>
  `Signer #1 certificate SHA-256 digest: ${fingerprint}`;
const ranged = (fingerprint) =>
  `Signer (minSdkVersion=26, maxSdkVersion=2147483647) certificate SHA-256 digest: ${fingerprint}`;

test("legacy numbered and v3.1 range signer reports bind the actual release certificate", () => {
  assert.equal(
    verifySignerFingerprints(numbered(expected), expected).verifiedSigners,
    1,
  );
  assert.equal(
    verifySignerFingerprints(ranged(expected), expected).verifiedSigners,
    1,
  );
});

test("all APK signers must match rather than accepting one matching certificate", () => {
  const report = `${numbered(expected)}\nSigner #2 certificate SHA-256 digest: ${other}`;
  assert.throws(
    () => verifySignerFingerprints(report, expected),
    /does not match/,
  );
  assert.throws(
    () => verifySignerFingerprints(ranged(other), expected),
    /does not match/,
  );
});

test("source stamp certificates never substitute for APK signer certificates", () => {
  const stamp = `Source Stamp Signer certificate SHA-256 digest: ${expected}`;
  assert.throws(
    () => verifySignerFingerprints(stamp, expected),
    /No APK signer/,
  );
  assert.throws(
    () => verifySignerFingerprints(`${stamp}\n${numbered(other)}`, expected),
    /does not match/,
  );
  assert.equal(
    verifySignerFingerprints(
      `${numbered(expected)}\nSource Stamp Signer certificate SHA-256 digest: ${other}`,
      expected,
    ).verifiedSigners,
    1,
  );
});

test("empty, malformed and unsupported signer reports fail closed", () => {
  for (const report of [
    "",
    "DOES NOT VERIFY",
    "Signer #1 certificate SHA-256 digest: malformed",
    `Signer unknown certificate SHA-256 digest: ${expected}`,
    `Signer #0 certificate SHA-256 digest: ${expected}`,
  ]) {
    assert.throws(() => verifySignerFingerprints(report, expected));
  }
});

test("CRLF and uppercase hexadecimal reports normalize without relaxing identity", () => {
  const report = `${numbered(expected.toUpperCase())}\r\n${ranged(expected)}\r\n`;
  assert.equal(
    verifySignerFingerprints(report, expected.toUpperCase()).verifiedSigners,
    2,
  );
});

test("invalid SDK ranges and malformed extra signers are rejected", () => {
  assert.throws(
    () =>
      verifySignerFingerprints(
        `Signer (minSdkVersion=35, maxSdkVersion=24) certificate SHA-256 digest: ${expected}`,
        expected,
      ),
    /Invalid APK signer SDK range/,
  );
  assert.throws(
    () =>
      verifySignerFingerprints(
        `${numbered(expected)}\nSigner #2 certificate SHA-256 digest: invalid`,
        expected,
      ),
    /Unrecognized/,
  );
});

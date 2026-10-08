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

test("the actual SDK 37 release report selects the certificate rather than the public key", () => {
  const certificate =
    "97acc2cb1e335923619cf642229b9d42d44515832eb04c82cce369ab67b60753";
  const report = `Verifies
Verified using v1 scheme (JAR signing): false
Verified using v2 scheme (APK Signature Scheme v2): true
Verified using v3 scheme (APK Signature Scheme v3): false
Verified using v3.1 scheme (APK Signature Scheme v3.1): false
Verified using v3.2 scheme (APK Signature Scheme v3.2): false
Verified using v4 scheme (APK Signature Scheme v4): false
Verified for SourceStamp: false
Number of signers: 1
V2 Signer: certificate SHA-256 digest: ${certificate}
V2 Signer: certificate SHA-1 digest: d6c07e44b5d72c7cfc19fa4938890d0107daf0be
V2 Signer: public key SHA-256 digest: d837be1d7fe1c9ca8acac6d52ff30f42faf3c4625670005a5e5cc87ddb755e04
`;
  const result = verifySignerFingerprints(report, certificate);
  assert.equal(result.verifiedSigners, 1);
  assert.equal(result.signers[0].sha256, certificate);
});

test("SDK 37 single and numbered V1, V2 and V3.0 certificates are recognized", () => {
  for (const scheme of ["V1", "V2", "V3.0"]) {
    for (const label of [`${scheme} Signer:`, `${scheme} Signer #1:`]) {
      assert.equal(
        verifySignerFingerprints(
          `${label} certificate SHA-256 digest: ${expected}`,
          expected,
        ).verifiedSigners,
        1,
      );
    }
  }
});

test("rotation, development SDK ranges and both hybrid certificate roles remain identity-bound", () => {
  for (const label of [
    "V3.0 Signer:",
    "V3.1 Signer:",
    "V3.2 Hybrid Classical Signer:",
    "V3.2 Hybrid PQC Signer:",
  ]) {
    for (const development of ["", " (dev release=true)"]) {
      const report = `${label} (minSdkVersion=33${development}, maxSdkVersion=2147483647) certificate SHA-256 digest: ${expected}`;
      assert.equal(
        verifySignerFingerprints(report, expected).verifiedSigners,
        1,
      );
    }
  }
  const legacyDevelopment = `Signer (minSdkVersion=33 (dev release=true), maxSdkVersion=2147483647) certificate SHA-256 digest: ${expected}`;
  assert.equal(
    verifySignerFingerprints(legacyDevelopment, expected).verifiedSigners,
    1,
  );
  const rotation = `Number of signers: 1\nV3.0 Signer: (minSdkVersion=28, maxSdkVersion=32) certificate SHA-256 digest: ${expected}\nV3.1 Signer: (minSdkVersion=33, maxSdkVersion=2147483647) certificate SHA-256 digest: ${expected}`;
  assert.equal(verifySignerFingerprints(rotation, expected).verifiedSigners, 2);
});

test("a matching SDK 37 certificate cannot hide a wrong second, rotated or PQC certificate", () => {
  for (const report of [
    `V2 Signer #1: certificate SHA-256 digest: ${expected}\nV2 Signer #2: certificate SHA-256 digest: ${other}`,
    `V3.0 Signer: (minSdkVersion=28, maxSdkVersion=32) certificate SHA-256 digest: ${expected}\nV3.1 Signer: (minSdkVersion=33, maxSdkVersion=2147483647) certificate SHA-256 digest: ${other}`,
    `V3.2 Hybrid Classical Signer: (minSdkVersion=36, maxSdkVersion=2147483647) certificate SHA-256 digest: ${expected}\nV3.2 Hybrid PQC Signer: (minSdkVersion=36, maxSdkVersion=2147483647) certificate SHA-256 digest: ${other}`,
  ]) {
    assert.throws(
      () => verifySignerFingerprints(report, expected),
      /does not match/,
    );
  }
});

test("SDK 37 stamp and public key fingerprints cannot replace an APK certificate", () => {
  const stamp = `Source Stamp Signer: certificate SHA-256 digest: ${expected}`;
  const publicKey = `V2 Signer: public key SHA-256 digest: ${expected}`;
  assert.throws(
    () => verifySignerFingerprints(`${stamp}\n${publicKey}`, expected),
    /No APK signer/,
  );
  assert.throws(
    () =>
      verifySignerFingerprints(
        `${stamp}\nV2 Signer: certificate SHA-256 digest: ${other}`,
        expected,
      ),
    /does not match/,
  );
  assert.equal(
    verifySignerFingerprints(
      `V2 Signer: certificate SHA-256 digest: ${expected}\nSource Stamp Signer: certificate SHA-256 digest: ${other}`,
      expected,
    ).verifiedSigners,
    1,
  );
});

test("unknown or malformed extra certificate lines fail closed beside a matching SDK 37 signer", () => {
  const matching = `V2 Signer: certificate SHA-256 digest: ${expected}`;
  for (const extra of [
    `V99 Signer: certificate SHA-256 digest: ${other}`,
    `V3 Signer: certificate SHA-256 digest: ${other}`,
    `V3.2 Signer: certificate SHA-256 digest: ${other}`,
    `V2 Signer #0: certificate SHA-256 digest: ${expected}`,
    "V2 Signer #2: certificate SHA-256 digest: malformed",
    `V2 Signer: certificate SHA-256 digest (hex): ${expected}`,
    `V3.1 Signer: (minSdkVersion=35, maxSdkVersion=24) certificate SHA-256 digest: ${expected}`,
    `V3.1 Signer: (minSdkVersion=33 (dev release=false), maxSdkVersion=35) certificate SHA-256 digest: ${expected}`,
  ]) {
    assert.throws(() =>
      verifySignerFingerprints(`${matching}\n${extra}`, expected),
    );
  }
});

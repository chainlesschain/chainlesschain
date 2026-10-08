#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");

function verifySignerFingerprints(report, expectedFingerprint) {
  assert.match(
    expectedFingerprint,
    /^[a-f0-9]{64}$/i,
    "Expected a SHA256 release certificate fingerprint",
  );
  const expected = expectedFingerprint.toLowerCase();
  const candidates = report
    .split(/\r?\n/)
    .filter(
      (line) =>
        /certificate SHA-256 digest\b/i.test(line) &&
        !/^Source Stamp Signer:?\s+certificate SHA-256 digest\b/i.test(line),
    );
  assert.ok(
    candidates.length > 0,
    "No APK signer certificate fingerprints were reported",
  );
  const signers = candidates.map((line) => {
    // SDK 37 changed the labels to scheme-specific names. Keep this list
    // exact: every certificate line, including hybrid/rotation certificates,
    // must match rather than disappearing behind an unknown label.
    // Android apksig 179f60df00d242f6bb22acf828b0884eac2d5f72,
    // ApkSignerTool.java:727-785, getV3SignerName and printCertificate.
    const legacy =
      /^(?<name>Signer (?:#(?<index>[1-9]\d*)|\(minSdkVersion=(?<minimum>\d+)(?: \(dev release=true\))?,\s*maxSdkVersion=(?<maximum>\d+)\))) certificate SHA-256 digest:\s*(?<fingerprint>[a-f0-9]{64})\s*$/i.exec(
        line,
      );
    const scheme =
      /^(?<name>V(?:1|2|3\.0) Signer(?: #[1-9]\d*)?): certificate SHA-256 digest:\s*(?<fingerprint>[a-f0-9]{64})\s*$/i.exec(
        line,
      );
    const ranged =
      /^(?<name>(?:V3\.[01] Signer|V3\.2 Hybrid (?:Classical|PQC) Signer): \(minSdkVersion=(?<minimum>\d+)(?: \(dev release=true\))?,\s*maxSdkVersion=(?<maximum>\d+)\)) certificate SHA-256 digest:\s*(?<fingerprint>[a-f0-9]{64})\s*$/i.exec(
        line,
      );
    const match = legacy || scheme || ranged;
    assert.ok(match, "Unrecognized APK signer certificate report format");
    const fields = match.groups;
    if (fields.minimum != null) {
      const minimum = Number(fields.minimum);
      const maximum = Number(fields.maximum);
      assert.ok(
        Number.isSafeInteger(minimum) &&
          minimum >= 1 &&
          Number.isSafeInteger(maximum) &&
          maximum >= minimum,
        "Invalid APK signer SDK range",
      );
    }
    const fingerprint = fields.fingerprint.toLowerCase();
    assert.equal(
      fingerprint,
      expected,
      "APK signer certificate does not match the configured release keystore",
    );
    return {
      signer: legacy
        ? fields.index
          ? `#${fields.index}`
          : `SDK ${fields.minimum}..${fields.maximum}`
        : fields.name,
      sha256: fingerprint,
    };
  });
  return {
    expectedFingerprint: expected,
    signers,
    verifiedSigners: signers.length,
  };
}

if (require.main === module) {
  const [reportFile, expected] = process.argv.slice(2);
  assert.ok(
    reportFile && expected,
    "Usage: verify-android-release-signature.cjs <apksigner-report> <expected-sha256>",
  );
  console.log(
    JSON.stringify(
      verifySignerFingerprints(fs.readFileSync(reportFile, "utf8"), expected),
    ),
  );
}

module.exports = { verifySignerFingerprints };

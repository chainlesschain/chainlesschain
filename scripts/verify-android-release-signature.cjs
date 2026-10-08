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
    .filter((line) => /^Signer\s.*certificate SHA-256 digest:/.test(line));
  assert.ok(
    candidates.length > 0,
    "No APK signer certificate fingerprints were reported",
  );
  const signers = candidates.map((line) => {
    const match =
      /^Signer (?:#([1-9]\d*)|\(minSdkVersion=(\d+),\s*maxSdkVersion=(\d+)\)) certificate SHA-256 digest:\s*([a-f0-9]{64})\s*$/i.exec(
        line,
      );
    assert.ok(match, "Unrecognized APK signer certificate report format");
    if (match[2]) {
      const minimum = Number(match[2]);
      const maximum = Number(match[3]);
      assert.ok(
        Number.isSafeInteger(minimum) &&
          minimum >= 1 &&
          Number.isSafeInteger(maximum) &&
          maximum >= minimum,
        "Invalid APK signer SDK range",
      );
    }
    const fingerprint = match[4].toLowerCase();
    assert.equal(
      fingerprint,
      expected,
      "APK signer certificate does not match the configured release keystore",
    );
    return {
      signer: match[1] ? `#${match[1]}` : `SDK ${match[2]}..${match[3]}`,
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

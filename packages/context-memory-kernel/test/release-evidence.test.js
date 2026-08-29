"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  EVIDENCE_SCHEMA,
  assembleReleaseEvidence,
  validateReleaseEvidence,
} = require("../scripts/release-evidence.cjs");

const SHA = "a".repeat(40);
const DIGEST = `sha256:${"b".repeat(64)}`;
const requirements = JSON.parse(
  readFileSync(
    path.resolve(__dirname, "..", "release", "required-evidence.v1.json"),
    "utf8",
  ),
);

function validManifest() {
  return {
    schema: EVIDENCE_SCHEMA,
    candidateSha: SHA,
    repository: "chainlesschain/chainlesschain",
    checks: requirements.requiredChecks.flatMap((check, checkIndex) =>
      check.platforms.map((platform, platformIndex) => ({
        id: check.id,
        workflow: check.workflow,
        platform,
        status: "passed",
        commitSha: SHA,
        runId: String(1000 + checkIndex * 10 + platformIndex),
        evidenceDigest: DIGEST,
      })),
    ),
  };
}

test("release evidence accepts one exact-SHA complete platform matrix", () => {
  const receipt = validateReleaseEvidence(validManifest(), requirements, {
    expectedCommit: SHA,
    expectedRepository: "chainlesschain/chainlesschain",
  });
  assert.equal(receipt.status, "passed");
  assert.equal(receipt.checkCount, 26);
  assert.match(receipt.digest, /^sha256:[a-f0-9]{64}$/u);
});

test("release evidence assembler binds the four authoritative workflow runs", () => {
  const workflowNames = [
    ...new Set(requirements.requiredChecks.map((check) => check.workflow)),
  ];
  const manifest = assembleReleaseEvidence({
    candidateSha: SHA,
    repository: "chainlesschain/chainlesschain",
    requirements,
    runs: workflowNames.map((name, index) => ({
      id: 2000 + index,
      name,
      head_sha: SHA,
      conclusion: "success",
      run_attempt: 1,
      html_url: `https://github.com/chainlesschain/chainlesschain/actions/runs/${2000 + index}`,
    })),
  });
  assert.equal(manifest.checks.length, 26);
  assert.equal(
    validateReleaseEvidence(manifest, requirements, { expectedCommit: SHA }).status,
    "passed",
  );
});

test("release evidence rejects mixed SHA, missing evidence, and non-passing checks", () => {
  const mixed = validManifest();
  mixed.checks[0].commitSha = "c".repeat(40);
  assert.throws(
    () => validateReleaseEvidence(mixed, requirements, { expectedCommit: SHA }),
    { code: "CONTEXT_MEMORY_RELEASE_MIXED_SHA" },
  );

  const missing = validManifest();
  missing.checks.pop();
  assert.throws(
    () => validateReleaseEvidence(missing, requirements, { expectedCommit: SHA }),
    { code: "CONTEXT_MEMORY_RELEASE_EVIDENCE_MISSING" },
  );

  const failed = validManifest();
  failed.checks[0].status = "failed";
  assert.throws(
    () => validateReleaseEvidence(failed, requirements, { expectedCommit: SHA }),
    /did not pass/u,
  );
});

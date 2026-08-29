"use strict";

const { createHash } = require("node:crypto");

const EVIDENCE_SCHEMA = "chainlesschain.context-memory-release-evidence/v1";
const RECEIPT_SCHEMA = "chainlesschain.context-memory-release-receipt/v1";
const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function digest(value) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex")}`;
}

function fail(message, code = "CONTEXT_MEMORY_RELEASE_EVIDENCE_INVALID") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assertExactKeys(value, required, optional, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${label} contains unknown field ${key}`);
  }
  for (const key of required) {
    if (!(key in value)) fail(`${label} is missing ${key}`);
  }
}

function validateReleaseEvidence(manifest, requirements, options = {}) {
  assertExactKeys(
    manifest,
    ["schema", "candidateSha", "repository", "checks"],
    ["generatedAt", "metadata"],
    "release evidence",
  );
  if (manifest.schema !== EVIDENCE_SCHEMA) fail("release evidence schema is unsupported");
  if (!SHA_PATTERN.test(manifest.candidateSha)) fail("candidateSha must be a full commit SHA");
  if (options.expectedCommit && manifest.candidateSha !== options.expectedCommit) {
    fail("release evidence candidateSha does not match the expected commit", "CONTEXT_MEMORY_RELEASE_MIXED_SHA");
  }
  if (typeof manifest.repository !== "string" || !manifest.repository.trim()) {
    fail("repository is required");
  }
  if (options.expectedRepository && manifest.repository !== options.expectedRepository) {
    fail("release evidence repository does not match");
  }
  if (!Array.isArray(manifest.checks) || manifest.checks.length > 256) {
    fail("checks must be a bounded array");
  }
  if (
    !requirements ||
    requirements.schema !== "chainlesschain.context-memory-release-requirements/v1" ||
    !Array.isArray(requirements.requiredChecks)
  ) {
    fail("release requirements are invalid");
  }

  const required = new Map(
    requirements.requiredChecks.map((entry) => [
      entry.id,
      { workflow: entry.workflow, platforms: new Set(entry.platforms) },
    ]),
  );
  const seen = new Set();
  for (const check of manifest.checks) {
    assertExactKeys(
      check,
      ["id", "workflow", "platform", "status", "commitSha", "runId", "evidenceDigest"],
      ["runAttempt", "runUrl"],
      "release check",
    );
    if (!required.has(check.id)) fail(`unknown release check ${check.id}`);
    if (!required.get(check.id).platforms.has(check.platform)) {
      fail(`unexpected platform ${check.platform} for ${check.id}`);
    }
    if (check.workflow !== required.get(check.id).workflow) {
      fail(`unexpected workflow ${check.workflow} for ${check.id}`);
    }
    const key = `${check.id}:${check.platform}`;
    if (seen.has(key)) fail(`duplicate release check ${key}`);
    seen.add(key);
    if (check.status !== "passed") fail(`release check ${key} did not pass`);
    if (check.commitSha !== manifest.candidateSha) {
      fail(`release check ${key} belongs to a different commit`, "CONTEXT_MEMORY_RELEASE_MIXED_SHA");
    }
    if (!/^[1-9][0-9]*$/u.test(String(check.runId))) {
      fail(`release check ${key} has an invalid runId`);
    }
    if (!DIGEST_PATTERN.test(check.evidenceDigest)) {
      fail(`release check ${key} has an invalid evidenceDigest`);
    }
  }
  for (const [id, requirement] of required) {
    for (const platform of requirement.platforms) {
      if (!seen.has(`${id}:${platform}`)) {
        fail(`release evidence is missing ${id}:${platform}`, "CONTEXT_MEMORY_RELEASE_EVIDENCE_MISSING");
      }
    }
  }

  const receipt = {
    schema: RECEIPT_SCHEMA,
    schemaVersion: 1,
    candidateSha: manifest.candidateSha,
    repository: manifest.repository,
    status: "passed",
    checkCount: manifest.checks.length,
    evidenceDigest: digest(manifest),
    requirementsDigest: digest(requirements),
  };
  receipt.digest = digest(receipt);
  return Object.freeze(receipt);
}

function assembleReleaseEvidence({ candidateSha, repository, requirements, runs }) {
  if (!SHA_PATTERN.test(candidateSha)) fail("candidateSha must be a full commit SHA");
  if (typeof repository !== "string" || !repository.trim()) fail("repository is required");
  if (!requirements || !Array.isArray(requirements.requiredChecks)) {
    fail("release requirements are invalid");
  }
  const byWorkflow = new Map();
  for (const run of Array.isArray(runs) ? runs : []) {
    assertExactKeys(
      run,
      ["id", "name", "head_sha", "conclusion"],
      ["run_attempt", "html_url"],
      "workflow run",
    );
    if (byWorkflow.has(run.name)) fail(`duplicate workflow run ${run.name}`);
    if (run.head_sha !== candidateSha) {
      fail(`workflow ${run.name} belongs to a different commit`, "CONTEXT_MEMORY_RELEASE_MIXED_SHA");
    }
    if (run.conclusion !== "success") fail(`workflow ${run.name} did not succeed`);
    if (!/^[1-9][0-9]*$/u.test(String(run.id))) fail(`workflow ${run.name} has an invalid run id`);
    byWorkflow.set(run.name, run);
  }
  const checks = [];
  for (const requirement of requirements.requiredChecks) {
    const run = byWorkflow.get(requirement.workflow);
    if (!run) {
      fail(
        `release evidence is missing workflow ${requirement.workflow}`,
        "CONTEXT_MEMORY_RELEASE_EVIDENCE_MISSING",
      );
    }
    const runEvidence = {
      id: String(run.id),
      name: run.name,
      headSha: run.head_sha,
      conclusion: run.conclusion,
      runAttempt: Number(run.run_attempt || 1),
      runUrl: run.html_url || null,
    };
    for (const platform of requirement.platforms) {
      checks.push({
        id: requirement.id,
        workflow: requirement.workflow,
        platform,
        status: "passed",
        commitSha: candidateSha,
        runId: String(run.id),
        runAttempt: Number(run.run_attempt || 1),
        evidenceDigest: digest(runEvidence),
        ...(run.html_url ? { runUrl: run.html_url } : {}),
      });
    }
  }
  return {
    schema: EVIDENCE_SCHEMA,
    candidateSha,
    repository,
    checks,
  };
}

module.exports = {
  EVIDENCE_SCHEMA,
  RECEIPT_SCHEMA,
  assembleReleaseEvidence,
  digest,
  validateReleaseEvidence,
};

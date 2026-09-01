#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const MAX_JSON_BYTES = 16 * 1024 * 1024;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_ATTESTATION_AGE_MS = 6 * 60 * 60 * 1000;
const COMMIT = /^[a-f0-9]{40}$/u;
const CHALLENGE = /^[A-Za-z0-9_-]{32,128}$/u;

function fail(message) {
  const error = new Error(message);
  error.code = "CC_P1_10_GITHUB_TRUST_INVALID";
  throw error;
}

function required(options, name) {
  const value = options[name];
  if (!value) fail(name + " is required");
  return value;
}

function parseArguments(argv) {
  const command = argv[0];
  const options = {};
  for (let index = 1; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (
      !name?.startsWith("--") ||
      !value ||
      value.startsWith("--") ||
      options[name]
    ) {
      fail("arguments must be unique --name value pairs");
    }
    options[name] = value;
  }
  return { command, options };
}

function readJson(file, field) {
  const resolved = path.resolve(file);
  let descriptor;
  try {
    descriptor = fs.openSync(
      resolved,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
    );
    const stat = fs.fstatSync(descriptor);
    if (
      !stat.isFile() ||
      stat.size < 1 ||
      stat.size > MAX_JSON_BYTES ||
      stat.nlink !== 1
    ) {
      fail(field + " must be a bounded, non-hardlinked regular JSON file");
    }
    return JSON.parse(fs.readFileSync(descriptor, "utf8"));
  } catch (error) {
    if (error?.code === "CC_P1_10_GITHUB_TRUST_INVALID") throw error;
    fail(field + " cannot be read safely: " + error.message);
  } finally {
    if (descriptor != null) fs.closeSync(descriptor);
  }
}

function writeJson(file, value) {
  const resolved = path.resolve(file);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, JSON.stringify(value, null, 2) + "\n", {
    flag: "wx",
  });
}

function positive(value, field) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    fail(field + " must be a positive safe integer");
  }
  return normalized;
}

function milliseconds(value, field) {
  const normalized = Date.parse(String(value || ""));
  if (!Number.isFinite(normalized)) fail(field + " is not a timestamp");
  return normalized;
}

function expectedIdentity(options) {
  const commitSha = required(options, "--commit");
  if (!COMMIT.test(commitSha)) fail("--commit must be an exact lowercase SHA");
  const repository = required(options, "--repository");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) {
    fail("--repository must be owner/repository");
  }
  const serverUrl = required(options, "--server-url").replace(/\/$/u, "");
  if (!/^https:\/\/[^/?#]+$/u.test(serverUrl))
    fail("--server-url must be a trusted HTTPS origin");
  return {
    commitSha,
    repository,
    workflow: required(options, "--workflow"),
    runId: positive(required(options, "--run-id"), "--run-id"),
    runAttempt: positive(required(options, "--run-attempt"), "--run-attempt"),
    serverUrl,
  };
}

function validateRun(run, expected) {
  const startedAt = milliseconds(run?.run_started_at, "run.run_started_at");
  const completedAt = milliseconds(run?.updated_at, "run.updated_at");
  if (
    positive(run?.id, "run.id") !== expected.runId ||
    positive(run?.run_attempt, "run.run_attempt") !== expected.runAttempt ||
    run?.head_sha !== expected.commitSha ||
    run?.path !== expected.workflow ||
    run?.event !== "workflow_dispatch" ||
    run?.conclusion !== "success" ||
    run?.head_branch !== "main" ||
    run?.head_repository?.full_name !== expected.repository ||
    completedAt < startedAt
  ) {
    fail("producer REST run is not the exact successful main workflow attempt");
  }
  return { startedAt, completedAt };
}

export function selectP110Artifacts(pages, run, expected) {
  const window = validateRun(run, expected);
  if (!Array.isArray(pages) || pages.length < 1 || pages.length > 100) {
    fail("artifact pagination response must be a bounded non-empty array");
  }
  const totals = pages.map((page) =>
    positive(page?.total_count, "artifacts.total_count"),
  );
  if (new Set(totals).size !== 1)
    fail("artifact pagination total_count changed between pages");
  const artifacts = pages.flatMap((page) =>
    Array.isArray(page?.artifacts)
      ? page.artifacts
      : fail("artifact page has no artifacts array"),
  );
  if (
    artifacts.length !== totals[0] ||
    new Set(artifacts.map((artifact) => positive(artifact?.id, "artifact.id")))
      .size !== artifacts.length
  ) {
    fail("artifact pagination is incomplete or contains duplicate IDs");
  }
  const names = {
    evidence: `p1-10-external-evidence-${expected.runId}-${expected.runAttempt}`,
    challenge: `p1-10-challenge-${expected.runId}-${expected.runAttempt}`,
  };
  const selected = {};
  for (const [kind, name] of Object.entries(names)) {
    const matches = artifacts.filter((artifact) => artifact?.name === name);
    if (matches.length !== 1)
      fail("expected exactly one non-replayable " + kind + " artifact");
    const artifact = matches[0];
    const createdAt = milliseconds(artifact.created_at, kind + ".created_at");
    const updatedAt = milliseconds(artifact.updated_at, kind + ".updated_at");
    if (
      artifact.expired !== false ||
      artifact?.workflow_run?.id !== expected.runId ||
      artifact?.workflow_run?.head_sha !== expected.commitSha ||
      createdAt < window.startedAt ||
      updatedAt < createdAt ||
      updatedAt > window.completedAt
    ) {
      fail(kind + " artifact does not intersect the exact run/attempt window");
    }
    selected[kind] = artifact;
  }
  return selected;
}

export function verifyP110Attestation(
  results,
  run,
  artifact,
  expected,
  nowMs = Date.now(),
) {
  const window = validateRun(run, expected);
  if (!Array.isArray(results) || results.length < 1 || results.length > 32) {
    fail("verified attestation output must be a bounded non-empty array");
  }
  const sourceRepositoryURI = `${expected.serverUrl}/${expected.repository}`;
  const sourceRepositoryRef = "refs/heads/main";
  const buildSignerURI = `${sourceRepositoryURI}/${expected.workflow}@${sourceRepositoryRef}`;
  const runInvocationURI = `${sourceRepositoryURI}/actions/runs/${expected.runId}/attempts/${expected.runAttempt}`;
  const artifactUpdatedAt = milliseconds(
    artifact?.updated_at,
    "artifact.updated_at",
  );
  const matches = results.filter((result) => {
    const certificate = result?.verificationResult?.signature?.certificate;
    if (
      typeof certificate?.certificateIssuer !== "string" ||
      certificate.certificateIssuer.length < 1 ||
      certificate.certificateIssuer.length > 512 ||
      certificate.issuer !== "https://token.actions.githubusercontent.com" ||
      certificate.subjectAlternativeName !== buildSignerURI ||
      certificate.runnerEnvironment !== "github-hosted" ||
      certificate.sourceRepositoryURI !== sourceRepositoryURI ||
      certificate.sourceRepositoryRef !== sourceRepositoryRef ||
      certificate.sourceRepositoryDigest !== expected.commitSha ||
      certificate.buildSignerURI !== buildSignerURI ||
      certificate.buildSignerDigest !== expected.commitSha ||
      certificate.buildTrigger !== "workflow_dispatch" ||
      certificate.runInvocationURI !== runInvocationURI
    ) {
      return false;
    }
    const timestamps = result?.verificationResult?.verifiedTimestamps;
    if (
      !Array.isArray(timestamps) ||
      timestamps.length < 1 ||
      timestamps.length > 32
    ) {
      return false;
    }
    return timestamps.every((entry) => {
      if (!entry?.type || !entry?.uri) return false;
      const value = milliseconds(entry.timestamp, "verified timestamp");
      return (
        value >= window.startedAt - CLOCK_SKEW_MS &&
        value <= artifactUpdatedAt + CLOCK_SKEW_MS &&
        value <= nowMs + CLOCK_SKEW_MS &&
        nowMs - value <= MAX_ATTESTATION_AGE_MS
      );
    });
  });
  if (matches.length !== 1) {
    fail(
      "exactly one certificate must bind hosted main and the exact producer attempt",
    );
  }
  return matches[0];
}

function appendOutput(values) {
  if (!process.env.GITHUB_OUTPUT) fail("GITHUB_OUTPUT is required");
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(""),
    "utf8",
  );
}

function main() {
  const { command, options } = parseArguments(process.argv.slice(2));
  const expected = expectedIdentity(options);
  const run = readJson(required(options, "--run"), "run");
  if (command === "select-artifacts") {
    const selected = selectP110Artifacts(
      readJson(required(options, "--artifact-pages"), "artifact pages"),
      run,
      expected,
    );
    writeJson(required(options, "--evidence-metadata"), selected.evidence);
    writeJson(required(options, "--challenge-metadata"), selected.challenge);
    appendOutput({
      evidence_id: selected.evidence.id,
      challenge_id: selected.challenge.id,
    });
    return;
  }
  if (command !== "verify-attestations") fail("unsupported command");
  const evidenceArtifact = readJson(
    required(options, "--evidence-metadata"),
    "evidence artifact",
  );
  const challengeArtifact = readJson(
    required(options, "--challenge-metadata"),
    "challenge artifact",
  );
  verifyP110Attestation(
    readJson(
      required(options, "--evidence-attestation"),
      "evidence attestation",
    ),
    run,
    evidenceArtifact,
    expected,
  );
  verifyP110Attestation(
    readJson(
      required(options, "--challenge-attestation"),
      "challenge attestation",
    ),
    run,
    challengeArtifact,
    expected,
  );
  const challenge = readJson(
    required(options, "--challenge"),
    "challenge receipt",
  );
  const challengeKeys = [
    "schema",
    "repository",
    "workflow",
    "commitSha",
    "runId",
    "runAttempt",
    "challenge",
    "issuedAt",
  ].sort();
  if (
    Object.keys(challenge).sort().join("\0") !== challengeKeys.join("\0") ||
    challenge.schema !== "chainlesschain.p1-10-hosted-challenge/v1" ||
    challenge.repository !== expected.repository ||
    challenge.workflow !== expected.workflow ||
    challenge.commitSha !== expected.commitSha ||
    challenge.runId !== expected.runId ||
    challenge.runAttempt !== expected.runAttempt ||
    !CHALLENGE.test(challenge.challenge) ||
    milliseconds(challenge.issuedAt, "challenge.issuedAt") <
      milliseconds(run.run_started_at, "run.run_started_at") ||
    milliseconds(challenge.issuedAt, "challenge.issuedAt") >
      milliseconds(
        challengeArtifact.updated_at,
        "challengeArtifact.updated_at",
      ) +
        CLOCK_SKEW_MS
  ) {
    fail("hosted challenge receipt does not bind the exact producer attempt");
  }
  appendOutput({
    challenge: challenge.challenge,
    verified_at: new Date().toISOString(),
  });
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      (error?.code ? error.code + ": " : "") + (error?.message || error) + "\n",
    );
    process.exitCode = 1;
  }
}

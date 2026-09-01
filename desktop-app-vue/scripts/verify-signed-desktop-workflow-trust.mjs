#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const COMMIT_SHA = /^[a-f0-9]{40}$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_ATTESTATION_AGE_MS = 6 * 60 * 60 * 1000;
const MAIN_REF = "refs/heads/main";
const OIDC_ISSUER = "https://token.actions.githubusercontent.com";

export const DESKTOP_PRODUCER_WORKFLOW =
  ".github/workflows/desktop-signed-skill-platform.yml";

function fail(message) {
  const error = new Error(message);
  error.code = "CC_DESKTOP_WORKFLOW_TRUST_INVALID";
  throw error;
}

function required(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${name} is required`);
  }
  return value;
}

function positiveInteger(value, name) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    fail(`${name} must be a positive safe integer`);
  }
  return normalized;
}

function timestamp(value, name) {
  const normalized = Date.parse(String(value || ""));
  if (!Number.isFinite(normalized)) {
    fail(`${name} must be a valid timestamp`);
  }
  return normalized;
}

function strictHttpsOrigin(value, name) {
  const raw = required(value, name);
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    fail(`${name} must be a canonical HTTPS origin`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    raw !== parsed.origin
  ) {
    fail(`${name} must be a canonical HTTPS origin`);
  }
  return parsed.origin;
}

function normalizeExpected(expected) {
  if (!COMMIT_SHA.test(expected?.commitSha || "")) {
    fail("expected commit must be an exact lowercase SHA");
  }
  if (!REPOSITORY.test(expected?.repository || "")) {
    fail("expected repository must be owner/repository");
  }
  return Object.freeze({
    commitSha: expected.commitSha,
    repository: expected.repository,
    runId: positiveInteger(expected.runId, "expected run ID"),
    runAttempt: positiveInteger(expected.runAttempt, "expected run attempt"),
    serverUrl: strictHttpsOrigin(expected.serverUrl, "GitHub server URL"),
    requireSuccess: expected.requireSuccess === true,
  });
}

export function verifyDesktopProducerRun(run, expectedInput) {
  const expected = normalizeExpected(expectedInput);
  const startedAt = timestamp(run?.run_started_at, "producer run_started_at");
  const updatedAt = timestamp(run?.updated_at, "producer updated_at");
  const conclusion = run?.conclusion ?? null;
  const statusValid = expected.requireSuccess
    ? run?.status === "completed" && conclusion === "success"
    : run?.status === "in_progress" && conclusion === null;
  if (
    positiveInteger(run?.id, "producer run ID") !== expected.runId ||
    positiveInteger(run?.run_attempt, "producer run attempt") !==
      expected.runAttempt ||
    run?.head_sha !== expected.commitSha ||
    run?.head_branch !== "main" ||
    run?.path !== DESKTOP_PRODUCER_WORKFLOW ||
    run?.event !== "workflow_dispatch" ||
    run?.head_repository?.full_name !== expected.repository ||
    !statusValid ||
    updatedAt < startedAt
  ) {
    fail(
      "producer REST run is not the exact protected-main Desktop workflow attempt",
    );
  }
  return Object.freeze({ ...expected, startedAt, updatedAt });
}

export function verifyDesktopAttestation(
  results,
  run,
  expectedInput,
  nowMs = Date.now(),
) {
  const expected = verifyDesktopProducerRun(run, expectedInput);
  if (!Number.isFinite(nowMs)) {
    fail("verification clock is invalid");
  }
  if (!Array.isArray(results) || results.length < 1 || results.length > 32) {
    fail("verified attestation output must be a bounded non-empty array");
  }
  const repositoryUri = `${expected.serverUrl}/${expected.repository}`;
  const signerUri = `${repositoryUri}/${DESKTOP_PRODUCER_WORKFLOW}@${MAIN_REF}`;
  const invocationUri = `${repositoryUri}/actions/runs/${expected.runId}/attempts/${expected.runAttempt}`;
  const matches = results.filter((result) => {
    const certificate = result?.verificationResult?.signature?.certificate;
    if (
      typeof certificate?.certificateIssuer !== "string" ||
      certificate.certificateIssuer.length < 1 ||
      certificate.certificateIssuer.length > 512 ||
      certificate.issuer !== OIDC_ISSUER ||
      certificate.subjectAlternativeName !== signerUri ||
      certificate.runnerEnvironment !== "github-hosted" ||
      certificate.sourceRepositoryURI !== repositoryUri ||
      certificate.sourceRepositoryRef !== MAIN_REF ||
      certificate.sourceRepositoryDigest !== expected.commitSha ||
      certificate.buildSignerURI !== signerUri ||
      certificate.buildSignerDigest !== expected.commitSha ||
      certificate.buildTrigger !== "workflow_dispatch" ||
      certificate.runInvocationURI !== invocationUri
    ) {
      return false;
    }
    const verifiedTimestamps = result?.verificationResult?.verifiedTimestamps;
    if (
      !Array.isArray(verifiedTimestamps) ||
      verifiedTimestamps.length < 1 ||
      verifiedTimestamps.length > 32
    ) {
      return false;
    }
    return verifiedTimestamps.every((entry) => {
      if (
        typeof entry?.type !== "string" ||
        entry.type.length < 1 ||
        typeof entry?.uri !== "string" ||
        entry.uri.length < 1
      ) {
        return false;
      }
      let trustedAt;
      try {
        trustedAt = timestamp(
          entry.timestamp,
          "verified attestation timestamp",
        );
      } catch {
        return false;
      }
      return (
        trustedAt >= expected.startedAt - CLOCK_SKEW_MS &&
        (!expected.requireSuccess ||
          trustedAt <= expected.updatedAt + CLOCK_SKEW_MS) &&
        trustedAt <= nowMs + CLOCK_SKEW_MS &&
        nowMs - trustedAt <= MAX_ATTESTATION_AGE_MS
      );
    });
  });
  if (matches.length !== 1) {
    fail(
      "exactly one attestation certificate must bind hosted main and the exact producer attempt",
    );
  }
  return matches[0];
}

export function readDesktopTrustJson(file, name = "trust JSON") {
  const resolved = path.resolve(required(file, name));
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
      stat.nlink !== 1 ||
      (stat.mode & 0o222) !== 0
    ) {
      fail(
        `${name} must be a bounded, read-only, non-hardlinked regular JSON file`,
      );
    }
    return JSON.parse(fs.readFileSync(descriptor, "utf8"));
  } catch (error) {
    if (error?.code === "CC_DESKTOP_WORKFLOW_TRUST_INVALID") {
      throw error;
    }
    fail(`${name} cannot be read safely: ${error?.message || error}`);
  } finally {
    if (descriptor !== undefined) {
      fs.closeSync(descriptor);
    }
  }
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
      Object.hasOwn(options, name)
    ) {
      fail("arguments must be unique --name value pairs");
    }
    options[name] = value;
  }
  return { command, options };
}

function expectedFromOptions(options) {
  const requireSuccess = required(
    options["--require-success"],
    "--require-success",
  );
  if (requireSuccess !== "true" && requireSuccess !== "false") {
    fail("--require-success must be true or false");
  }
  return {
    commitSha: required(options["--commit"], "--commit"),
    repository: required(options["--repository"], "--repository"),
    runId: required(options["--run-id"], "--run-id"),
    runAttempt: required(options["--run-attempt"], "--run-attempt"),
    serverUrl: required(options["--server-url"], "--server-url"),
    requireSuccess: requireSuccess === "true",
  };
}

function main() {
  const { command, options } = parseArguments(process.argv.slice(2));
  const expected = expectedFromOptions(options);
  const run = readDesktopTrustJson(options["--run"], "--run");
  if (command === "verify-run") {
    verifyDesktopProducerRun(run, expected);
    process.stdout.write(
      `Verified Desktop producer run ${expected.runId} attempt ${expected.runAttempt}\n`,
    );
    return;
  }
  if (command === "verify-attestation") {
    verifyDesktopAttestation(
      readDesktopTrustJson(options["--attestation"], "--attestation"),
      run,
      expected,
    );
    process.stdout.write(
      `Verified Desktop attestation for run ${expected.runId} attempt ${expected.runAttempt}\n`,
    );
    return;
  }
  fail("unsupported command");
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${error?.code ? `${error.code}: ` : ""}${error?.message || error}\n`,
    );
    process.exitCode = 1;
  }
}

#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MCP_LIFECYCLE_PROFILE_TEST_IDS,
  MCP_LIFECYCLE_PROFILE_THRESHOLDS,
  MCP_LIFECYCLE_PROFILE_VERSION,
  runMcpLifecycleProfile,
} from "./mcp-lifecycle-profile.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "../../..");
const CLI_ROOT = path.join(REPOSITORY_ROOT, "packages", "cli");
const require = createRequire(import.meta.url);
const VITEST_CLI_PATH = path.resolve(
  path.dirname(require.resolve("vitest/package.json")),
  "vitest.mjs",
);
const FRAGMENT_SCHEMA =
  "chainlesschain.claude-code-increment-audit-fragment.v1";
const AGGREGATE_SCHEMA =
  "chainlesschain.claude-code-increment-audit-fragment-set.v1";
const COMMITMENT_ID = "MCP-LIFECYCLE";
const PROFILE_VERSION = MCP_LIFECYCLE_PROFILE_VERSION;
const THRESHOLDS = MCP_LIFECYCLE_PROFILE_THRESHOLDS;
const TEST_IDS = MCP_LIFECYCLE_PROFILE_TEST_IDS;
const REQUIRED_OPERATING_SYSTEMS = Object.freeze(["linux", "macos", "windows"]);
const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const GITHUB_RUN_ID_PATTERN = /^[1-9][0-9]{0,31}$/u;
const GITHUB_JOB_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u;
const GITHUB_WORKFLOW_REF_PATTERN =
  /^(?<repository>[^\s/]+\/[^\s/]+)\/(?<workflowPath>\.github\/workflows\/[^@\s]+\.ya?ml)@(?<workflowRef>refs\/[^\s]+|[a-f0-9]{40})$/u;
const FRAGMENT_KEYS = Object.freeze([
  "commitmentId",
  "disposition",
  "headSha",
  "measurements",
  "os",
  "outcome",
  "producerDigests",
  "profileVersion",
  "runtime",
  "schema",
  "source",
  "testIds",
  "thresholds",
]);
const RUNTIME_KEYS = Object.freeze(["arch", "name", "version"]);
const SOURCE_KEYS = Object.freeze([
  "artifactName",
  "jobId",
  "runId",
  "workflowId",
]);
const PRODUCER_FILES = Object.freeze([
  ".github/workflows/cli-ci.yml",
  ".github/workflows/cli-reliability-soak.yml",
  "packages/cli/scripts/mcp-lifecycle-profile.mjs",
  "packages/cli/scripts/mcp-lifecycle-profile-child.mjs",
  "packages/cli/scripts/verify-mcp-lifecycle-increments.mjs",
  "packages/cli/src/harness/mcp-client.js",
  "packages/cli/src/lib/mcp-lifecycle-authority.js",
  "packages/cli/src/lib/durable-security-store.js",
  "packages/cli/src/lib/with-file-lock.js",
  "packages/cli/src/lib/mcp-oauth.js",
  "packages/cli/src/lib/mcp-tls.js",
  "packages/cli/src/lib/mcp-headers-helper.js",
  "packages/cli/src/lib/mcp-headers-helper-trust.js",
  "packages/cli/src/runtime/mcp-config.js",
  "packages/cli/__tests__/unit/mcp-lifecycle-authority.test.js",
  "packages/cli/__tests__/unit/mcp-lifecycle-increments.test.js",
  "packages/cli/__tests__/unit/mcp-lifecycle-profile.test.js",
  "packages/cli/__tests__/unit/verify-mcp-lifecycle-increments.test.js",
  "packages/cli/__tests__/unit/mcp-oauth.test.js",
  "packages/cli/__tests__/unit/mcp-client-headers-helper.test.js",
  "packages/cli/__tests__/unit/mcp-client-rpc-error-sanitization.test.js",
  "packages/cli/__tests__/unit/mcp-headers-helper-runner.test.js",
  "packages/cli/__tests__/unit/ide-hot-reconnect.test.js",
]);
const MCP_WORKFLOW_FILES = new Set([
  ".github/workflows/cli-ci.yml",
  ".github/workflows/cli-reliability-soak.yml",
]);
const REGRESSION_TEST_FILES = Object.freeze([
  "__tests__/unit/mcp-lifecycle-authority.test.js",
  "__tests__/unit/mcp-lifecycle-increments.test.js",
  "__tests__/unit/mcp-oauth.test.js",
  "__tests__/unit/mcp-client-headers-helper.test.js",
  "__tests__/unit/mcp-client-rpc-error-sanitization.test.js",
  "__tests__/unit/mcp-headers-helper-runner.test.js",
  "__tests__/unit/ide-hot-reconnect.test.js",
  "__tests__/unit/verify-mcp-lifecycle-increments.test.js",
]);

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function exactCommit(value) {
  const commit = String(value || "").trim();
  assert.match(commit, SHA_PATTERN);
  return commit;
}

function currentHead() {
  return exactCommit(
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
    }),
  );
}

function runtimeOs(platform = process.platform) {
  if (platform === "win32" || platform === "windows") return "windows";
  if (platform === "darwin" || platform === "macos") return "macos";
  if (platform === "linux") return "linux";
  throw new Error(`unsupported operating system: ${platform}`);
}

function writeJson(filePath, value) {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
  const temporary = `${resolved}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, canonicalJson(value), {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(temporary, resolved);
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readProducerAtCommit(headSha, relativePath) {
  const objectName = `${headSha}:${relativePath}`;
  const objectType = execFileSync("git", ["cat-file", "-t", objectName], {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  assert.equal(
    objectType,
    "blob",
    `${relativePath} must be a file at exact head ${headSha}`,
  );
  return execFileSync("git", ["cat-file", "blob", objectName], {
    cwd: REPOSITORY_ROOT,
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function exactTreeProducerDigests(
  headSha,
  readProducer = readProducerAtCommit,
) {
  return Object.fromEntries(
    PRODUCER_FILES.map((relativePath) => [
      relativePath,
      sha256(readProducer(headSha, relativePath)),
    ]),
  );
}

function verifyExactHeadSources(headSha, producerDigests) {
  assert.deepEqual(
    Object.keys(producerDigests),
    [...PRODUCER_FILES],
    "producer digest keys must exactly match the canonical producer set",
  );
  for (const relativePath of PRODUCER_FILES) {
    const workingBytes = fs.readFileSync(
      path.join(REPOSITORY_ROOT, relativePath),
    );
    assert.equal(
      sha256(workingBytes),
      producerDigests[relativePath],
      `${relativePath} must match the exact evidence commit`,
    );
  }
}

function runRequiredTests() {
  const started = performance.now();
  const result = spawnSync(
    process.execPath,
    [VITEST_CLI_PATH, "run", ...REGRESSION_TEST_FILES],
    {
      cwd: CLI_ROOT,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
      maxBuffer: 32 * 1024 * 1024,
      timeout: 180_000,
      windowsHide: true,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `MCP lifecycle required tests failed (${result.status}):\n${String(result.stdout || "").slice(-8_000)}\n${String(result.stderr || "").slice(-8_000)}`,
    );
  }
  return {
    durationMs: Number((performance.now() - started).toFixed(3)),
    fileCount: REGRESSION_TEST_FILES.length,
  };
}

function assertExactKeys(value, keys, label) {
  assert.ok(
    value && typeof value === "object" && !Array.isArray(value),
    `${label} must be an object`,
  );
  assert.deepEqual(
    Object.keys(value).sort(),
    [...keys].sort(),
    `${label} must contain exactly ${keys.join(", ")}`,
  );
}

function sourceText(value, label, maximumLength) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.equal(value, value.trim(), `${label} cannot have outer whitespace`);
  assert.ok(
    value.length > 0 && value.length <= maximumLength,
    `${label} length is invalid`,
  );
  assert.doesNotMatch(value, /[\u0000-\u001f\u007f]/u, `${label} is invalid`);
  return value;
}

function githubWorkflowIdentity(workflowId) {
  const normalized = sourceText(workflowId, "source.workflowId", 512);
  const match = GITHUB_WORKFLOW_REF_PATTERN.exec(normalized);
  assert.ok(match, "source.workflowId must be a GitHub workflow ref");
  assert.ok(
    MCP_WORKFLOW_FILES.has(match.groups.workflowPath),
    "source.workflowId must identify an MCP lifecycle producer workflow",
  );
  return match.groups;
}

function validateSource(source, headSha, { requireGitHubSource = false } = {}) {
  assertExactKeys(source, SOURCE_KEYS, "fragment.source");
  const workflowId = sourceText(source.workflowId, "source.workflowId", 512);
  const runId = sourceText(source.runId, "source.runId", 32);
  const jobId = sourceText(source.jobId, "source.jobId", 128);
  const artifactName = sourceText(
    source.artifactName,
    "source.artifactName",
    255,
  );
  assert.match(jobId, GITHUB_JOB_ID_PATTERN);
  assert.equal(/[\\/]/u.test(artifactName), false);
  assert.ok(
    artifactName.includes(headSha),
    "source.artifactName must bind the exact evidence commit",
  );
  if (requireGitHubSource) {
    githubWorkflowIdentity(workflowId);
    assert.match(runId, GITHUB_RUN_ID_PATTERN);
    for (const [field, value] of Object.entries({
      workflowId,
      runId,
      jobId,
      artifactName,
    })) {
      assert.notEqual(
        value.toLowerCase(),
        "local",
        `source.${field} cannot use local provenance`,
      );
    }
  }
  return { workflowId, runId, jobId, artifactName };
}

function validateRequiredWorkflowBinding({
  environment = process.env,
  headSha,
  producerDigests,
  readProducer = readProducerAtCommit,
}) {
  assert.equal(
    environment.GITHUB_ACTIONS,
    "true",
    "required MCP lifecycle evidence must be produced by GitHub Actions",
  );
  const workflowSha = exactCommit(environment.GITHUB_WORKFLOW_SHA);
  assert.equal(
    workflowSha,
    headSha,
    "required workflow bytes must come from the exact evidence commit",
  );
  const identity = githubWorkflowIdentity(environment.GITHUB_WORKFLOW_REF);
  assert.equal(
    sourceText(environment.GITHUB_REPOSITORY, "GITHUB_REPOSITORY", 256),
    identity.repository,
    "GITHUB_WORKFLOW_REF repository must match GITHUB_REPOSITORY",
  );
  assert.deepEqual(
    Object.keys(producerDigests),
    [...PRODUCER_FILES],
    "required producer digests must use the exact canonical Git-tree set",
  );
  const workflowDigest = producerDigests[identity.workflowPath];
  assert.match(workflowDigest || "", DIGEST_PATTERN);
  assert.equal(
    sha256(readProducer(workflowSha, identity.workflowPath)),
    workflowDigest,
    "GITHUB_WORKFLOW_SHA must resolve to the attested workflow blob",
  );
  return { ...identity, workflowSha, workflowDigest };
}

function workflowSource(
  artifactName,
  headSha,
  {
    required = false,
    environment = process.env,
    producerDigests = null,
    readProducer = readProducerAtCommit,
  } = {},
) {
  const normalizedArtifactName = String(
    artifactName ||
      environment.CC_MCP_LIFECYCLE_ARTIFACT_NAME ||
      `local-mcp-lifecycle-${headSha}`,
  ).trim();
  assert.ok(normalizedArtifactName);
  const source = {
    workflowId:
      environment.GITHUB_WORKFLOW_REF || environment.GITHUB_WORKFLOW || "local",
    runId: environment.GITHUB_RUN_ID || "local",
    jobId: environment.GITHUB_JOB || "local",
    artifactName: normalizedArtifactName,
  };
  validateSource(source, headSha, { requireGitHubSource: required });
  if (required) {
    validateRequiredWorkflowBinding({
      environment,
      headSha,
      producerDigests,
      readProducer,
    });
  }
  return source;
}

function assertMeasurements(thresholds, measurements) {
  assert.deepEqual(thresholds, MCP_LIFECYCLE_PROFILE_THRESHOLDS);
  assert.equal(
    measurements.disabledOutboundCount,
    thresholds.disabledOutboundCount,
  );
  assert.equal(measurements.rpcOrderExact, thresholds.rpcOrderExact);
  assert.equal(
    measurements.authenticationRefreshesPerRejection,
    thresholds.authenticationRefreshesPerRejection,
  );
  assert.equal(
    measurements.reconnectFlightsPerServer,
    thresholds.reconnectFlightsPerServer,
  );
  assert.ok(
    measurements.maxRecoveryLatencyMs <= thresholds.maxRecoveryLatencyMs,
  );
  assert.equal(
    measurements.duplicateCallbacksAccepted,
    thresholds.duplicateCallbacksAccepted,
  );
  assert.equal(
    measurements.staleCallbacksAccepted,
    thresholds.staleCallbacksAccepted,
  );
  assert.equal(measurements.lostCallbacks, thresholds.lostCallbacks);
  assert.equal(
    measurements.revokedTokenResurrections,
    thresholds.revokedTokenResurrections,
  );
  assert.equal(
    measurements.invalidTlsOutboundCount,
    thresholds.invalidTlsOutboundCount,
  );
  assert.equal(measurements.logSecretHits, thresholds.logSecretHits);
  assert.equal(measurements.helperTimeoutMs, thresholds.helperTimeoutMs);
  assert.equal(
    measurements.helperMaxOutputBytes,
    thresholds.helperMaxOutputBytes,
  );
  assert.equal(measurements.helperMaxHeaders, thresholds.helperMaxHeaders);
  assert.equal(
    measurements.helperMaxHeaderValueBytes,
    thresholds.helperMaxHeaderValueBytes,
  );
  assert.equal(measurements.rpcRegistered, measurements.rpcSettled);
  assert.ok(measurements.rpcRegistered > 0);
  assert.ok(measurements.rpcRecoveredAfterRestart >= 1);
  assert.equal(measurements.crossProcessRestartTakeovers, 1);
  assert.ok(measurements.distinctTlsIdentityDigests >= 2);
  assert.ok(measurements.tlsIdentityRotations >= 1);
  assert.ok(measurements.mtlsAuthorizedConnections >= 2);
  assert.ok(measurements.invalidTlsMaterialRejected >= 1);
  assert.equal(measurements.invalidTlsLifecycleFailed, 1);
  assert.ok(measurements.staleCallbacksRejected >= 1);
  assert.ok(measurements.duplicateCallbacksRejected >= 1);
  assert.equal(measurements.expiredTokenRefreshRequests, 1);
  assert.equal(measurements.revokeRefreshRequests, 1);
  assert.equal(measurements.idpRevokedRefreshRequests, 1);
  assert.equal(measurements.protocolBoundaryFailures, 2);
  assert.equal(measurements.invalidProtocolPostInitializeRequests, 0);
  assert.ok(measurements.lifecycleReceiptCount > 0);
  assert.ok(measurements.initializeCount >= 2);
  assert.ok(measurements.subscriptionRestoreCount >= 1);
  for (const field of [
    "maxRecoveryLatencyMs",
    "hotReconnectLatencyMs",
    "restartRecoveryLatencyMs",
    "inFlightRestartLatencyMs",
    "crossProcessRestartLatencyMs",
  ]) {
    assert.ok(Number.isFinite(measurements[field]) && measurements[field] >= 0);
  }
  assert.ok(
    Number.isFinite(measurements.regressionTestDurationMs) &&
      measurements.regressionTestDurationMs >= 0,
  );
  assert.equal(
    measurements.regressionTestFileCount,
    REGRESSION_TEST_FILES.length,
  );
  assert.match(measurements.lifecycleReceiptDigest, /^sha256:[a-f0-9]{64}$/u);
}

async function produceEvidence({
  releaseCommit,
  output,
  artifactName,
  required = false,
  environment = process.env,
}) {
  const headSha = exactCommit(releaseCommit);
  assert.equal(currentHead(), headSha, "release commit must equal git HEAD");
  const producerDigests = exactTreeProducerDigests(headSha);
  verifyExactHeadSources(headSha, producerDigests);
  const source = workflowSource(artifactName, headSha, {
    required,
    environment,
    producerDigests,
  });
  const regression = runRequiredTests();
  const profile = await runMcpLifecycleProfile();
  const measurements = {
    ...profile.measurements,
    regressionTestDurationMs: regression.durationMs,
    regressionTestFileCount: regression.fileCount,
  };
  assertMeasurements(profile.thresholds, measurements);
  assert.equal(
    currentHead(),
    headSha,
    "git HEAD changed while producing MCP lifecycle evidence",
  );
  verifyExactHeadSources(headSha, producerDigests);
  const fragment = {
    schema: FRAGMENT_SCHEMA,
    commitmentId: COMMITMENT_ID,
    headSha,
    os: runtimeOs(),
    runtime: {
      name: "node",
      version: process.version,
      arch: process.arch,
    },
    profileVersion: profile.profileVersion,
    thresholds: profile.thresholds,
    measurements,
    testIds: profile.testIds,
    producerDigests,
    disposition: required ? "required" : "advisory",
    source,
    outcome: "passed",
  };
  validateFragment(fragment, headSha, producerDigests, {
    allowAdvisory: !required,
    requireWorkflowSource: required,
  });
  if (output) writeJson(output, fragment);
  return fragment;
}

function evidenceFiles(directory) {
  const root = path.resolve(directory);
  assert.equal(fs.existsSync(root), true, "evidence directory must exist");
  const rootStat = fs.lstatSync(root);
  assert.equal(
    rootStat.isSymbolicLink(),
    false,
    "evidence cannot be a symlink",
  );
  assert.equal(
    rootStat.isDirectory(),
    true,
    "evidence root must be a directory",
  );
  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name);
      const stat = fs.lstatSync(candidate);
      assert.equal(
        stat.isSymbolicLink(),
        false,
        "MCP lifecycle evidence cannot contain symlinks",
      );
      if (stat.isDirectory()) pending.push(candidate);
      else if (stat.isFile() && entry.name.endsWith(".json")) {
        files.push(candidate);
      }
    }
  }
  return files.sort();
}

function validateFragment(
  fragment,
  headSha,
  producerDigests,
  { allowAdvisory = false, requireWorkflowSource = false } = {},
) {
  assertExactKeys(fragment, FRAGMENT_KEYS, "MCP lifecycle fragment");
  assert.equal(fragment.schema, FRAGMENT_SCHEMA);
  assert.equal(fragment.commitmentId, COMMITMENT_ID);
  assert.equal(fragment.headSha, headSha);
  assert.ok(REQUIRED_OPERATING_SYSTEMS.includes(fragment.os));
  assertExactKeys(fragment.runtime, RUNTIME_KEYS, "fragment.runtime");
  assert.equal(fragment.runtime.name, "node");
  assert.match(fragment.runtime.version, /^v\d+\.\d+\.\d+$/u);
  assert.ok(typeof fragment.runtime.arch === "string" && fragment.runtime.arch);
  assert.equal(fragment.profileVersion, MCP_LIFECYCLE_PROFILE_VERSION);
  assert.ok(fragment.thresholds && Object.keys(fragment.thresholds).length > 0);
  assert.ok(
    fragment.measurements && Object.keys(fragment.measurements).length > 0,
  );
  assert.deepEqual(fragment.testIds, MCP_LIFECYCLE_PROFILE_TEST_IDS);
  assert.equal(new Set(fragment.testIds).size, fragment.testIds.length);
  assert.deepEqual(Object.keys(producerDigests), [...PRODUCER_FILES]);
  assert.deepEqual(Object.keys(fragment.producerDigests), [...PRODUCER_FILES]);
  for (const digest of Object.values(fragment.producerDigests)) {
    assert.match(digest, DIGEST_PATTERN);
  }
  assert.deepEqual(fragment.producerDigests, producerDigests);
  if (fragment.disposition === "advisory") {
    assert.equal(allowAdvisory, true, "advisory evidence is non-qualifying");
  } else {
    assert.equal(fragment.disposition, "required");
  }
  assert.equal(fragment.outcome, "passed");
  validateSource(fragment.source, headSha, {
    requireGitHubSource:
      requireWorkflowSource || fragment.disposition === "required",
  });
  assertMeasurements(fragment.thresholds, fragment.measurements);
}

function aggregateEvidenceEntries({
  entries,
  headSha,
  producerDigests,
  allowAdvisory = false,
  expectedSource = null,
}) {
  assert.equal(
    entries.length,
    REQUIRED_OPERATING_SYSTEMS.length,
    "exactly one canonical MCP lifecycle fragment is required per OS",
  );
  const byOs = new Map();
  const artifactNames = new Set();
  for (const entry of entries) {
    assert.equal(
      path.basename(entry.file),
      "mcp-lifecycle-audit-fragment.json",
      "MCP lifecycle evidence must use the canonical fragment filename",
    );
    assert.equal(
      entry.bytes.toString("utf8"),
      canonicalJson(entry.value),
      "MCP lifecycle fragment JSON must use canonical producer encoding",
    );
    validateFragment(entry.value, headSha, producerDigests, {
      allowAdvisory,
      requireWorkflowSource: true,
    });
    assert.ok(
      !byOs.has(entry.value.os),
      `duplicate ${entry.value.os} fragment`,
    );
    assert.ok(
      !artifactNames.has(entry.value.source.artifactName),
      `duplicate artifact source ${entry.value.source.artifactName}`,
    );
    assert.equal(
      path.basename(path.dirname(entry.file)),
      entry.value.source.artifactName,
      "fragment source artifactName must match its downloaded artifact directory",
    );
    artifactNames.add(entry.value.source.artifactName);
    byOs.set(entry.value.os, entry);
  }
  assert.deepEqual(
    [...byOs.keys()].sort(),
    [...REQUIRED_OPERATING_SYSTEMS].sort(),
  );
  const dispositions = new Set(
    [...byOs.values()].map(({ value }) => value.disposition),
  );
  assert.equal(
    dispositions.size,
    1,
    "MCP lifecycle disposition differs across operating systems",
  );
  const disposition = byOs.get("linux").value.disposition;
  if (!allowAdvisory) assert.equal(disposition, "required");
  for (const field of ["workflowId", "runId"]) {
    assert.equal(
      new Set([...byOs.values()].map(({ value }) => value.source[field])).size,
      1,
      `MCP lifecycle ${field} differs across operating systems`,
    );
  }
  const baseline = byOs.get("linux").value;
  if (expectedSource) {
    assert.equal(
      baseline.source.workflowId,
      expectedSource.workflowId,
      "MCP lifecycle fragments must come from the current aggregate workflow",
    );
    assert.equal(
      baseline.source.runId,
      expectedSource.runId,
      "MCP lifecycle fragments must come from the current aggregate run",
    );
  }
  for (const { value } of byOs.values()) {
    assert.equal(value.profileVersion, baseline.profileVersion);
    assert.deepEqual(value.thresholds, baseline.thresholds);
    assert.deepEqual(value.testIds, baseline.testIds);
    assert.deepEqual(value.producerDigests, baseline.producerDigests);
  }
  return {
    schema: AGGREGATE_SCHEMA,
    commitmentId: COMMITMENT_ID,
    headSha,
    profileVersion: baseline.profileVersion,
    disposition,
    outcome: "passed",
    operatingSystems: [...REQUIRED_OPERATING_SYSTEMS],
    thresholds: baseline.thresholds,
    testIds: baseline.testIds,
    producerDigests,
    fragments: REQUIRED_OPERATING_SYSTEMS.map((operatingSystem) => {
      const entry = byOs.get(operatingSystem);
      return {
        operatingSystem,
        digest: sha256(entry.bytes),
        source: entry.value.source,
        runtime: entry.value.runtime,
      };
    }),
  };
}

function verifyEvidenceSet({
  evidenceDir,
  releaseCommit,
  output,
  allowAdvisory = false,
  environment = process.env,
}) {
  const headSha = exactCommit(releaseCommit);
  assert.equal(currentHead(), headSha, "release commit must equal git HEAD");
  const producerDigests = exactTreeProducerDigests(headSha);
  verifyExactHeadSources(headSha, producerDigests);
  let expectedSource = null;
  if (environment.GITHUB_ACTIONS === "true") {
    const workflowId = sourceText(
      environment.GITHUB_WORKFLOW_REF,
      "GITHUB_WORKFLOW_REF",
      512,
    );
    githubWorkflowIdentity(workflowId);
    const runId = sourceText(environment.GITHUB_RUN_ID, "GITHUB_RUN_ID", 32);
    assert.match(runId, GITHUB_RUN_ID_PATTERN);
    expectedSource = { workflowId, runId };
  }
  const entries = evidenceFiles(path.resolve(evidenceDir))
    .map((file) => ({ file, bytes: fs.readFileSync(file) }))
    .map((entry) => ({
      ...entry,
      value: JSON.parse(entry.bytes.toString("utf8")),
    }));
  const aggregate = aggregateEvidenceEntries({
    entries,
    headSha,
    producerDigests,
    allowAdvisory,
    expectedSource,
  });
  if (aggregate.disposition === "required") {
    validateRequiredWorkflowBinding({
      environment,
      headSha,
      producerDigests,
    });
  }
  assert.equal(
    currentHead(),
    headSha,
    "git HEAD changed while aggregating MCP lifecycle evidence",
  );
  verifyExactHeadSources(headSha, producerDigests);
  if (output) writeJson(output, aggregate);
  return aggregate;
}

function parseArgs(argv) {
  const options = { allowAdvisory: false, required: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--required") options.required = true;
    else if (argument === "--allow-advisory") options.allowAdvisory = true;
    else if (argument === "--release-commit")
      options.releaseCommit = argv[++index];
    else if (argument === "--output") options.output = argv[++index];
    else if (argument === "--artifact-name")
      options.artifactName = argv[++index];
    else if (argument === "--verify-evidence-dir") {
      options.evidenceDir = argv[++index];
    } else throw new Error(`unknown argument: ${argument}`);
  }
  assert.equal(
    options.required && options.allowAdvisory,
    false,
    "--required and --allow-advisory cannot be combined",
  );
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = options.evidenceDir
      ? verifyEvidenceSet(options)
      : await produceEvidence(options);
    process.stdout.write(
      `MCP lifecycle ${result.outcome}: ${result.headSha}, ${result.testIds.length} required test ids\n`,
    );
  } catch (error) {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  }
}

export {
  AGGREGATE_SCHEMA,
  COMMITMENT_ID,
  FRAGMENT_SCHEMA,
  PROFILE_VERSION,
  PRODUCER_FILES,
  REQUIRED_OPERATING_SYSTEMS,
  TEST_IDS,
  THRESHOLDS,
  aggregateEvidenceEntries,
  assertMeasurements,
  exactTreeProducerDigests,
  produceEvidence,
  validateFragment,
  validateRequiredWorkflowBinding,
  verifyEvidenceSet,
  workflowSource,
};

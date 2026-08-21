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
const REQUIRED_OPERATING_SYSTEMS = Object.freeze(["linux", "macos", "windows"]);
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

function sha256File(relativePath) {
  return sha256(fs.readFileSync(path.join(REPOSITORY_ROOT, relativePath)));
}

function exactCommit(value) {
  const commit = String(value || "")
    .trim()
    .toLowerCase();
  assert.match(commit, /^[a-f0-9]{40}$/u);
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

function expectedProducerDigests() {
  return Object.fromEntries(
    PRODUCER_FILES.map((relativePath) => [
      relativePath,
      sha256File(relativePath),
    ]),
  );
}

function verifyExactHeadSources(headSha) {
  for (const relativePath of PRODUCER_FILES) {
    const workingBytes = fs.readFileSync(
      path.join(REPOSITORY_ROOT, relativePath),
    );
    const committedBytes = execFileSync(
      "git",
      ["show", `${headSha}:${relativePath}`],
      { cwd: REPOSITORY_ROOT, maxBuffer: 32 * 1024 * 1024 },
    );
    assert.equal(
      sha256(workingBytes),
      sha256(committedBytes),
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

function workflowSource(artifactName, headSha) {
  const normalizedArtifactName = String(
    artifactName ||
      process.env.CC_MCP_LIFECYCLE_ARTIFACT_NAME ||
      `local-mcp-lifecycle-${headSha}`,
  ).trim();
  assert.ok(normalizedArtifactName);
  return {
    workflowId:
      process.env.GITHUB_WORKFLOW_REF || process.env.GITHUB_WORKFLOW || "local",
    runId: process.env.GITHUB_RUN_ID || "local",
    jobId: process.env.GITHUB_JOB || "local",
    artifactName: normalizedArtifactName,
  };
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

async function produceEvidence({ releaseCommit, output, artifactName }) {
  const headSha = exactCommit(releaseCommit);
  assert.equal(currentHead(), headSha, "release commit must equal git HEAD");
  verifyExactHeadSources(headSha);
  const regression = runRequiredTests();
  const profile = await runMcpLifecycleProfile();
  const measurements = {
    ...profile.measurements,
    regressionTestDurationMs: regression.durationMs,
    regressionTestFileCount: regression.fileCount,
  };
  assertMeasurements(profile.thresholds, measurements);
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
    producerDigests: expectedProducerDigests(),
    disposition: "required",
    source: workflowSource(artifactName, headSha),
    outcome: "passed",
  };
  if (output) writeJson(output, fragment);
  return fragment;
}

function evidenceFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...evidenceFiles(candidate));
    else if (entry.name.endsWith(".json")) files.push(candidate);
  }
  return files;
}

function validateFragment(
  fragment,
  headSha,
  producerDigests,
  { requireWorkflowSource = false } = {},
) {
  assert.equal(fragment.schema, FRAGMENT_SCHEMA);
  assert.equal(fragment.commitmentId, COMMITMENT_ID);
  assert.equal(fragment.headSha, headSha);
  assert.ok(REQUIRED_OPERATING_SYSTEMS.includes(fragment.os));
  assert.equal(fragment.runtime?.name, "node");
  assert.match(fragment.runtime?.version || "", /^v\d+\.\d+\.\d+/u);
  assert.ok(
    typeof fragment.runtime?.arch === "string" && fragment.runtime.arch,
  );
  assert.equal(fragment.profileVersion, MCP_LIFECYCLE_PROFILE_VERSION);
  assert.ok(fragment.thresholds && Object.keys(fragment.thresholds).length > 0);
  assert.ok(
    fragment.measurements && Object.keys(fragment.measurements).length > 0,
  );
  assert.deepEqual(fragment.testIds, MCP_LIFECYCLE_PROFILE_TEST_IDS);
  assert.equal(new Set(fragment.testIds).size, fragment.testIds.length);
  assert.deepEqual(fragment.producerDigests, producerDigests);
  assert.equal(fragment.disposition, "required");
  assert.equal(fragment.outcome, "passed");
  for (const field of ["workflowId", "runId", "jobId", "artifactName"]) {
    assert.ok(typeof fragment.source?.[field] === "string");
    assert.ok(fragment.source[field].trim());
    if (requireWorkflowSource) assert.notEqual(fragment.source[field], "local");
  }
  assert.ok(!/[\\/]/u.test(fragment.source.artifactName));
  assert.ok(fragment.source.artifactName.includes(headSha));
  if (requireWorkflowSource) assert.match(fragment.source.runId, /^\d+$/u);
  assertMeasurements(fragment.thresholds, fragment.measurements);
}

function aggregateEvidenceEntries({ entries, headSha, producerDigests }) {
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
    const pathSegments = path.resolve(entry.file).split(path.sep);
    assert.ok(
      pathSegments.includes(entry.value.source.artifactName),
      "fragment source artifactName must match its downloaded artifact directory",
    );
    artifactNames.add(entry.value.source.artifactName);
    byOs.set(entry.value.os, entry);
  }
  assert.deepEqual(
    [...byOs.keys()].sort(),
    [...REQUIRED_OPERATING_SYSTEMS].sort(),
  );
  const baseline = byOs.get("linux").value;
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
    disposition: "required",
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

function verifyEvidenceSet({ evidenceDir, releaseCommit, output }) {
  const headSha = exactCommit(releaseCommit);
  assert.equal(currentHead(), headSha, "release commit must equal git HEAD");
  verifyExactHeadSources(headSha);
  const producerDigests = expectedProducerDigests();
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
  });
  if (output) writeJson(output, aggregate);
  return aggregate;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--release-commit") options.releaseCommit = argv[++index];
    else if (argument === "--output") options.output = argv[++index];
    else if (argument === "--artifact-name")
      options.artifactName = argv[++index];
    else if (argument === "--verify-evidence-dir") {
      options.evidenceDir = argv[++index];
    } else throw new Error(`unknown argument: ${argument}`);
  }
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
  PRODUCER_FILES,
  REQUIRED_OPERATING_SYSTEMS,
  aggregateEvidenceEntries,
  assertMeasurements,
  produceEvidence,
  validateFragment,
  verifyEvidenceSet,
};

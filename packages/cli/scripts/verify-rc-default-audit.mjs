#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  REMOTE_CONTROL_DEFAULT_SCOPES,
  buildDirectPairingUri,
  isLoopbackBindHost,
  parseDirectPairingUri,
  resolveRemoteControlOptions,
  resolveRemoteControlWsUrl,
  writeRemoteControlState,
} from "../src/lib/remote-control.js";

export const RC_DEFAULT_FRAGMENT_SCHEMA =
  "chainlesschain.claude-code-increment-audit-fragment.v1";
export const RC_DEFAULT_AGGREGATE_SCHEMA =
  "chainlesschain.rc-default-audit-aggregate.v1";
export const RC_DEFAULT_PROFILE_VERSION = "rc-default/security-v1";
export const RC_DEFAULT_COMMITMENT_ID = "RC-DEFAULT";
export const RC_DEFAULT_REQUIRED_OSES = Object.freeze([
  "linux",
  "macos",
  "windows",
]);

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "../../..");
const CLI_ROOT = path.join(REPOSITORY_ROOT, "packages", "cli");
const REQUIRED_NODE_VERSION = "v22.12.0";
const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;

export const RC_DEFAULT_THRESHOLDS = Object.freeze({
  passiveRemoteStateWritesMaximum: 0,
  defaultNonLoopbackExposureMaximum: 0,
  defaultPrivilegedScopeCountMaximum: 0,
  lanWithoutOptInAcceptedMaximum: 0,
  projectWideningAcceptedMaximum: 0,
  privilegedScopeWithoutOptInAcceptedMaximum: 0,
  disabledConfigurationStartsMaximum: 0,
  persistentSecretHitsMaximum: 0,
  contractTestExitCodeMaximum: 0,
  explicitLanOptInsMinimum: 1,
  explicitApproveOptInsMinimum: 1,
  explicitInterruptOptInsMinimum: 1,
  pairingTokenBytesMinimum: 16,
  contractTestFilesMinimum: 3,
  contractTestDurationMsMaximum: 180_000,
});

export const RC_DEFAULT_TEST_IDS = Object.freeze([
  "rc-default/passive-cli-does-not-start-bridge",
  "rc-default/default-loopback-only",
  "rc-default/lan-requires-explicit-opt-in",
  "rc-default/privileged-scopes-require-separate-opt-in",
  "rc-default/project-config-cannot-widen",
  "rc-default/pairing-token-is-volatile-only",
  "rc-default/durable-membership-and-challenge-resume",
  "rc-default/duplicate-stale-and-revoked-device-fail-closed",
  "rc-default/crash-ledger-restore",
  "rc-default/actions-artifact-secret-scan-zero",
]);

export const RC_DEFAULT_PRODUCER_FILES = Object.freeze([
  ".github/workflows/cli-ci.yml",
  ".github/workflows/ide-roadmap-safety.yml",
  "packages/cli/scripts/verify-rc-default-audit.mjs",
  "packages/cli/src/commands/remote-control.js",
  "packages/cli/src/lib/remote-control.js",
  "packages/cli/src/lib/remote-approval-bridge.js",
  "packages/cli/src/harness/remote-session-registry.js",
  "packages/cli/__tests__/integration/remote-control-start.test.js",
  "packages/cli/__tests__/unit/remote-control-lib.test.js",
  "packages/cli/__tests__/unit/remote-approval-start.test.js",
  "packages/cli/__tests__/unit/rc-default-audit.test.js",
]);

const CONTRACT_TEST_FILES = Object.freeze([
  "__tests__/integration/remote-control-start.test.js",
  "__tests__/unit/remote-control-lib.test.js",
  "__tests__/unit/remote-approval-start.test.js",
]);

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function exactCommit(value, label = "head SHA") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  assert.match(normalized, SHA_PATTERN, label);
  return normalized;
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

function currentHead() {
  return exactCommit(
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
    }),
  );
}

function producerDigests() {
  return Object.fromEntries(
    RC_DEFAULT_PRODUCER_FILES.map((relativePath) => [
      relativePath,
      sha256(fs.readFileSync(path.join(REPOSITORY_ROOT, relativePath))),
    ]),
  );
}

function verifyExactHeadSources(headSha, digests = producerDigests()) {
  assert.deepEqual(Object.keys(digests), [...RC_DEFAULT_PRODUCER_FILES]);
  for (const relativePath of RC_DEFAULT_PRODUCER_FILES) {
    assert.match(digests[relativePath] || "", DIGEST_PATTERN);
    const committed = execFileSync(
      "git",
      ["show", `${headSha}:${relativePath}`],
      { cwd: REPOSITORY_ROOT, maxBuffer: 32 * 1024 * 1024 },
    );
    assert.equal(
      digests[relativePath],
      sha256(committed),
      `${relativePath} does not match exact head ${headSha}`,
    );
  }
}

function attempt(callback) {
  try {
    return { accepted: true, value: callback() };
  } catch (error) {
    return { accepted: false, error };
  }
}

function countSecretHits(value, secrets) {
  const serialized = typeof value === "string" ? value : canonicalJson(value);
  return secrets.reduce(
    (count, secret) => count + (secret && serialized.includes(secret) ? 1 : 0),
    0,
  );
}

function runPassiveCliProbe(root) {
  const isolatedHome = path.join(root, "home");
  fs.mkdirSync(isolatedHome, { recursive: true, mode: 0o700 });
  const started = performance.now();
  const result = spawnSync(
    process.execPath,
    [path.join(CLI_ROOT, "bin", "chainlesschain.js"), "--help"],
    {
      cwd: CLI_ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: isolatedHome,
        USERPROFILE: isolatedHome,
        CC_REMOTE_CONTROL_TOKEN: "",
        CC_REMOTE_SESSION_RELAY_URL: "",
      },
      maxBuffer: 16 * 1024 * 1024,
      timeout: 30_000,
      windowsHide: true,
    },
  );
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const stateDirectory = path.join(
    isolatedHome,
    ".chainlesschain",
    "remote-control",
  );
  const stateWrites = fs.existsSync(stateDirectory)
    ? fs.readdirSync(stateDirectory).filter((name) => name.endsWith(".json"))
        .length
    : 0;
  return {
    stateWrites,
    durationMs: Number((performance.now() - started).toFixed(3)),
  };
}

function runContractTests() {
  const started = performance.now();
  const result = spawnSync(
    process.execPath,
    [
      "node_modules/vitest/vitest.mjs",
      "run",
      ...CONTRACT_TEST_FILES,
      "--config",
      "vitest.config.js",
    ],
    {
      cwd: CLI_ROOT,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
      maxBuffer: 32 * 1024 * 1024,
      timeout: RC_DEFAULT_THRESHOLDS.contractTestDurationMsMaximum,
      windowsHide: true,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `RC-DEFAULT contract tests failed (${result.status}):\n${String(result.stdout || "").slice(-8_000)}\n${String(result.stderr || "").slice(-8_000)}`,
    );
  }
  return {
    exitCode: result.status,
    fileCount: CONTRACT_TEST_FILES.length,
    durationMs: Number((performance.now() - started).toFixed(3)),
  };
}

export function runRcDefaultCampaign({ runTests = true } = {}) {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "chainlesschain-rc-default-audit-"),
  );
  try {
    const passive = runPassiveCliProbe(temporaryRoot);
    const defaultToken = "rc-default-volatile-token-0123456789abcdef";
    const defaultOptions = resolveRemoteControlOptions({
      flags: { token: defaultToken },
      env: {},
      config: {},
    });
    const projectWidened = resolveRemoteControlOptions({
      flags: { token: defaultToken },
      env: {},
      config: {
        remoteControl: {
          enabled: true,
          host: "0.0.0.0",
          allowLan: true,
          scopes: ["observe", "prompt", "approve", "interrupt"],
          token: "project-token-must-be-ignored",
        },
      },
    });
    const lanWithoutOptIn = attempt(() =>
      resolveRemoteControlOptions({
        flags: { host: "0.0.0.0", token: defaultToken },
        env: {},
        config: {},
      }),
    );
    const approveWithoutOptIn = attempt(() =>
      resolveRemoteControlOptions({
        flags: { scopes: "observe,approve", token: defaultToken },
        env: {},
        config: {},
      }),
    );
    const interruptWithoutOptIn = attempt(() =>
      resolveRemoteControlOptions({
        flags: { scopes: "observe,interrupt", token: defaultToken },
        env: {},
        config: {},
      }),
    );
    const disabledConfiguration = attempt(() =>
      resolveRemoteControlOptions({
        flags: { token: defaultToken },
        env: {},
        config: { remoteControl: false },
      }),
    );
    const explicitLan = resolveRemoteControlOptions({
      flags: { allowLan: true, host: "0.0.0.0", token: defaultToken },
      env: {},
      config: {},
    });
    const explicitApprove = resolveRemoteControlOptions({
      flags: { allowApprove: true, token: defaultToken },
      env: {},
      config: {},
    });
    const explicitInterrupt = resolveRemoteControlOptions({
      flags: { allowInterrupt: true, token: defaultToken },
      env: {},
      config: {},
    });
    const pairingUri = buildDirectPairingUri({
      wsUrl: resolveRemoteControlWsUrl(
        { host: explicitLan.host, port: explicitLan.port, allowLan: true },
        { lanAddress: "192.168.50.10" },
      ),
      serverToken: defaultToken,
      remoteSessionId: "rc-default-audit-remote-session",
      agentSessionId: "rc-default-audit-agent-session",
      pairingToken: defaultToken,
      scopes: explicitApprove.scopes,
    });
    const parsedPairing = parseDirectPairingUri(pairingUri);
    assert.equal(parsedPairing.serverToken, defaultToken);
    assert.equal(parsedPairing.pairingToken, defaultToken);

    const stateDirectory = path.join(temporaryRoot, "state");
    const stateFile = writeRemoteControlState(
      {
        port: explicitLan.port,
        pid: process.pid,
        host: explicitLan.host,
        exposure: "lan",
        scopes: explicitLan.scopes,
        token: defaultToken,
        serverToken: defaultToken,
        pairingToken: defaultToken,
        pairingUri,
      },
      { dir: stateDirectory },
    );
    const stateText = fs.readFileSync(stateFile, "utf8");
    const projectWideningAccepted =
      !isLoopbackBindHost(projectWidened.host) ||
      projectWidened.scopes.some((scope) =>
        ["approve", "interrupt"].includes(scope),
      ) ||
      projectWidened.token !== defaultToken
        ? 1
        : 0;
    const contract = runTests
      ? runContractTests()
      : { exitCode: 0, fileCount: CONTRACT_TEST_FILES.length, durationMs: 0 };
    const measurements = {
      passiveRemoteStateWrites: passive.stateWrites,
      passiveCliDurationMs: passive.durationMs,
      defaultNonLoopbackExposureCount:
        isLoopbackBindHost(defaultOptions.host) && !defaultOptions.exposesLan
          ? 0
          : 1,
      defaultPrivilegedScopeCount: defaultOptions.scopes.filter((scope) =>
        ["approve", "interrupt"].includes(scope),
      ).length,
      defaultScopeCount: defaultOptions.scopes.length,
      lanWithoutOptInAcceptedCount: lanWithoutOptIn.accepted ? 1 : 0,
      projectWideningAcceptedCount: projectWideningAccepted,
      privilegedScopeWithoutOptInAcceptedCount:
        Number(approveWithoutOptIn.accepted) +
        Number(interruptWithoutOptIn.accepted),
      disabledConfigurationStartsCount: disabledConfiguration.accepted ? 1 : 0,
      explicitLanOptInsAccepted: Number(
        explicitLan.exposesLan && explicitLan.allowLan,
      ),
      explicitApproveOptInsAccepted: Number(
        explicitApprove.scopes.includes("approve"),
      ),
      explicitInterruptOptInsAccepted: Number(
        explicitInterrupt.scopes.includes("interrupt"),
      ),
      pairingTokenBytes: Buffer.byteLength(parsedPairing.pairingToken, "utf8"),
      pairingUriCreatedCount: Number(pairingUri.startsWith("chainlesschain:")),
      persistentSecretHits: countSecretHits(stateText, [
        defaultToken,
        pairingUri,
        "project-token-must-be-ignored",
      ]),
      projectWideningWarnings: projectWidened.warnings.length,
      contractTestExitCode: contract.exitCode,
      contractTestFiles: contract.fileCount,
      contractTestDurationMs: contract.durationMs,
    };
    assertRcDefaultMeasurements(measurements);
    return measurements;
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

export function assertRcDefaultMeasurements(measurements) {
  assert.equal(
    measurements.passiveRemoteStateWrites,
    RC_DEFAULT_THRESHOLDS.passiveRemoteStateWritesMaximum,
  );
  assert.equal(
    measurements.defaultNonLoopbackExposureCount,
    RC_DEFAULT_THRESHOLDS.defaultNonLoopbackExposureMaximum,
  );
  assert.equal(
    measurements.defaultPrivilegedScopeCount,
    RC_DEFAULT_THRESHOLDS.defaultPrivilegedScopeCountMaximum,
  );
  assert.equal(
    measurements.lanWithoutOptInAcceptedCount,
    RC_DEFAULT_THRESHOLDS.lanWithoutOptInAcceptedMaximum,
  );
  assert.equal(
    measurements.projectWideningAcceptedCount,
    RC_DEFAULT_THRESHOLDS.projectWideningAcceptedMaximum,
  );
  assert.equal(
    measurements.privilegedScopeWithoutOptInAcceptedCount,
    RC_DEFAULT_THRESHOLDS.privilegedScopeWithoutOptInAcceptedMaximum,
  );
  assert.equal(
    measurements.disabledConfigurationStartsCount,
    RC_DEFAULT_THRESHOLDS.disabledConfigurationStartsMaximum,
  );
  assert.equal(
    measurements.persistentSecretHits,
    RC_DEFAULT_THRESHOLDS.persistentSecretHitsMaximum,
  );
  assert.equal(
    measurements.contractTestExitCode,
    RC_DEFAULT_THRESHOLDS.contractTestExitCodeMaximum,
  );
  assert.ok(
    measurements.explicitLanOptInsAccepted >=
      RC_DEFAULT_THRESHOLDS.explicitLanOptInsMinimum,
  );
  assert.ok(
    measurements.explicitApproveOptInsAccepted >=
      RC_DEFAULT_THRESHOLDS.explicitApproveOptInsMinimum,
  );
  assert.ok(
    measurements.explicitInterruptOptInsAccepted >=
      RC_DEFAULT_THRESHOLDS.explicitInterruptOptInsMinimum,
  );
  assert.ok(
    measurements.pairingTokenBytes >=
      RC_DEFAULT_THRESHOLDS.pairingTokenBytesMinimum,
  );
  assert.ok(
    measurements.contractTestFiles >=
      RC_DEFAULT_THRESHOLDS.contractTestFilesMinimum,
  );
  assert.ok(
    measurements.contractTestDurationMs <=
      RC_DEFAULT_THRESHOLDS.contractTestDurationMsMaximum,
  );
  assert.deepEqual(REMOTE_CONTROL_DEFAULT_SCOPES, ["observe", "prompt"]);
}

function boundedSourceValue(value, label) {
  const text = String(value || "").trim();
  assert.match(text, /^[A-Za-z0-9][A-Za-z0-9._:/@ -]{0,511}$/u, label);
  return text;
}

function evidenceSource({ artifactName, required }) {
  const source = {
    workflowId: boundedSourceValue(
      process.env.GITHUB_WORKFLOW_REF || "local",
      "workflowId",
    ),
    runId: boundedSourceValue(process.env.GITHUB_RUN_ID || "local", "runId"),
    jobId: boundedSourceValue(
      process.env.GITHUB_JOB || `local-${runtimeOs()}`,
      "jobId",
    ),
    artifactName: boundedSourceValue(
      artifactName || `local-rc-default-${runtimeOs()}`,
      "artifactName",
    ),
  };
  if (required) {
    assert.equal(process.env.GITHUB_ACTIONS, "true");
    assert.notEqual(source.workflowId, "local");
    assert.notEqual(source.runId, "local");
    assert.match(source.workflowId, /\.github\/workflows\/(?:cli-ci|ide-roadmap-safety)\.yml@/u);
  }
  return source;
}

export function buildRcDefaultFragment({
  headSha,
  osName = runtimeOs(),
  required = false,
  source,
  measurements,
  digests,
}) {
  const fragment = {
    schema: RC_DEFAULT_FRAGMENT_SCHEMA,
    commitmentId: RC_DEFAULT_COMMITMENT_ID,
    headSha: exactCommit(headSha),
    os: runtimeOs(osName),
    runtime: {
      name: "node",
      version: process.version,
      arch: process.arch,
    },
    profileVersion: RC_DEFAULT_PROFILE_VERSION,
    thresholds: { ...RC_DEFAULT_THRESHOLDS },
    measurements: { ...measurements },
    testIds: [...RC_DEFAULT_TEST_IDS],
    producerDigests: { ...digests },
    disposition: required ? "required" : "advisory",
    outcome: "passed",
    source: { ...source },
  };
  normalizeRcDefaultFragment(fragment, {
    expectedHead: fragment.headSha,
    required,
  });
  return fragment;
}

export function normalizeRcDefaultFragment(
  fragment,
  { expectedHead, required = true } = {},
) {
  assert.deepEqual(Object.keys(fragment), [
    "schema",
    "commitmentId",
    "headSha",
    "os",
    "runtime",
    "profileVersion",
    "thresholds",
    "measurements",
    "testIds",
    "producerDigests",
    "disposition",
    "outcome",
    "source",
  ]);
  assert.equal(fragment.schema, RC_DEFAULT_FRAGMENT_SCHEMA);
  assert.equal(fragment.commitmentId, RC_DEFAULT_COMMITMENT_ID);
  assert.equal(fragment.headSha, exactCommit(expectedHead || fragment.headSha));
  assert.ok(RC_DEFAULT_REQUIRED_OSES.includes(fragment.os));
  assert.deepEqual(fragment.runtime, {
    name: "node",
    version: fragment.runtime.version,
    arch: fragment.runtime.arch,
  });
  assert.match(fragment.runtime.version, /^v\d+\.\d+\.\d+$/u);
  assert.ok(fragment.runtime.arch);
  assert.equal(fragment.profileVersion, RC_DEFAULT_PROFILE_VERSION);
  assert.deepEqual(fragment.thresholds, RC_DEFAULT_THRESHOLDS);
  assertRcDefaultMeasurements(fragment.measurements);
  assert.deepEqual(fragment.testIds, RC_DEFAULT_TEST_IDS);
  assert.deepEqual(Object.keys(fragment.producerDigests), [
    ...RC_DEFAULT_PRODUCER_FILES,
  ]);
  for (const digest of Object.values(fragment.producerDigests)) {
    assert.match(digest, DIGEST_PATTERN);
  }
  assert.equal(fragment.outcome, "passed");
  assert.equal(fragment.disposition, required ? "required" : "advisory");
  assert.deepEqual(Object.keys(fragment.source), [
    "workflowId",
    "runId",
    "jobId",
    "artifactName",
  ]);
  if (required) {
    assert.notEqual(fragment.source.workflowId, "local");
    assert.notEqual(fragment.source.runId, "local");
  }
  return fragment;
}

function parseArguments(argv) {
  const options = { required: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--required") {
      options.required = true;
      continue;
    }
    if (!argument.startsWith("--") || index + 1 >= argv.length) {
      throw new Error(`invalid argument: ${argument}`);
    }
    options[
      argument
        .slice(2)
        .replace(/-([a-z])/gu, (_, character) => character.toUpperCase())
    ] = argv[++index];
  }
  return options;
}

function recursivelyReadJson(directory) {
  const values = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      values.push(...recursivelyReadJson(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      try {
        values.push({ path: entryPath, value: JSON.parse(fs.readFileSync(entryPath, "utf8")) });
      } catch {
        // Other safety artifacts use different schemas and are ignored here.
      }
    }
  }
  return values;
}

export function aggregateRcDefaultFragments({
  evidenceDirectory,
  headSha,
}) {
  const expectedHead = exactCommit(headSha);
  const fragments = recursivelyReadJson(path.resolve(evidenceDirectory))
    .map((entry) => entry.value)
    .filter(
      (value) =>
        value?.schema === RC_DEFAULT_FRAGMENT_SCHEMA &&
        value?.commitmentId === RC_DEFAULT_COMMITMENT_ID,
    )
    .map((fragment) =>
      normalizeRcDefaultFragment(fragment, {
        expectedHead,
        required: true,
      }),
    );
  assert.equal(
    fragments.length,
    RC_DEFAULT_REQUIRED_OSES.length,
    "RC-DEFAULT aggregate requires exactly one fragment per OS",
  );
  const byOs = new Map();
  for (const fragment of fragments) {
    assert.ok(!byOs.has(fragment.os), `duplicate RC-DEFAULT OS: ${fragment.os}`);
    verifyExactHeadSources(expectedHead, fragment.producerDigests);
    byOs.set(fragment.os, fragment);
  }
  assert.deepEqual([...byOs.keys()].sort(), [...RC_DEFAULT_REQUIRED_OSES].sort());
  const baseline = byOs.get("linux") || fragments[0];
  for (const fragment of fragments) {
    assert.equal(fragment.profileVersion, baseline.profileVersion);
    assert.deepEqual(fragment.thresholds, baseline.thresholds);
    assert.deepEqual(fragment.testIds, baseline.testIds);
  }
  return {
    schema: RC_DEFAULT_AGGREGATE_SCHEMA,
    commitmentId: RC_DEFAULT_COMMITMENT_ID,
    headSha: expectedHead,
    profileVersion: baseline.profileVersion,
    thresholds: baseline.thresholds,
    operatingSystems: [...RC_DEFAULT_REQUIRED_OSES],
    disposition: "required",
    outcome: "passed",
    fragments: RC_DEFAULT_REQUIRED_OSES.map((osName) => byOs.get(osName)),
  };
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  assert.ok(options.output, "--output is required");
  const headSha = exactCommit(options.releaseCommit || currentHead());
  assert.equal(currentHead(), headSha, "checked-out HEAD must equal release commit");
  if (options.verifyEvidenceDir) {
    writeJson(
      options.output,
      aggregateRcDefaultFragments({
        evidenceDirectory: options.verifyEvidenceDir,
        headSha,
      }),
    );
    return;
  }
  if (options.required) {
    assert.equal(process.version, REQUIRED_NODE_VERSION);
  }
  const measurements = runRcDefaultCampaign({ runTests: true });
  const digests = producerDigests();
  verifyExactHeadSources(headSha, digests);
  const source = evidenceSource({
    artifactName: options.artifactName,
    required: options.required,
  });
  const fragment = buildRcDefaultFragment({
    headSha,
    required: options.required,
    source,
    measurements,
    digests,
  });
  assert.equal(countSecretHits(fragment, ["rc-default-volatile-token-0123456789abcdef"]), 0);
  writeJson(options.output, fragment);
}

const isEntrypoint =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(SCRIPT_PATH).href;
if (isEntrypoint) main();

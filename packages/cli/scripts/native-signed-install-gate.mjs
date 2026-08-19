#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdtempSync,
  openSync,
  closeSync,
  readSync,
  rmSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const EVIDENCE_SCHEMA = "chainlesschain.native-signed-install-gate.v1";
const AGGREGATE_SCHEMA =
  "chainlesschain.native-signed-install-gate-aggregate.v1";
const FULL_SHA = /^[0-9a-f]{40}$/u;
const TAG = /^cli-v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;
const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const MAX_BINARY_BYTES = 512 * 1024 * 1024;
const MAX_EVIDENCE_BYTES = 2 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const INSTALL_TIMEOUT_MS = 15 * 60 * 1_000;
const EXPECTED_WORKFLOW = "CLI Native Release";
const REQUIRED_TARGETS = Object.freeze({
  "node22-linux-x64": Object.freeze({
    platform: "linux",
    arch: "x64",
    installer: "install.sh",
    binary: "chainlesschain",
    alias: "cc",
    signature: "sigstore-keyless",
  }),
  "node22-linux-arm64": Object.freeze({
    platform: "linux",
    arch: "arm64",
    installer: "install.sh",
    binary: "chainlesschain",
    alias: "cc",
    signature: "sigstore-keyless",
  }),
  "node22-win-x64": Object.freeze({
    platform: "win32",
    arch: "x64",
    installer: "install.ps1",
    binary: "chainlesschain.exe",
    alias: "cc.exe",
    signature: "authenticode+sigstore",
  }),
  "node22-win-arm64": Object.freeze({
    platform: "win32",
    arch: "arm64",
    installer: "install.ps1",
    binary: "chainlesschain.exe",
    alias: "cc.exe",
    signature: "authenticode+sigstore",
  }),
  "node22-macos-x64": Object.freeze({
    platform: "darwin",
    arch: "x64",
    installer: "install.sh",
    binary: "chainlesschain",
    alias: "cc",
    signature: "codesign+notarized+sigstore",
  }),
  "node22-macos-arm64": Object.freeze({
    platform: "darwin",
    arch: "arm64",
    installer: "install.sh",
    binary: "chainlesschain",
    alias: "cc",
    signature: "codesign+notarized+sigstore",
  }),
});

function usage() {
  return [
    "Usage:",
    "  node scripts/native-signed-install-gate.mjs --installer FILE --target TARGET --repository OWNER/REPO --release-commit SHA --current-tag cli-vX.Y.Z --previous-tag cli-vA.B.C --expected-version X.Y.Z --output FILE",
    "  node scripts/native-signed-install-gate.mjs --verify-evidence-dir DIR --repository OWNER/REPO --release-commit SHA --current-tag cli-vX.Y.Z --previous-tag cli-vA.B.C --expected-version X.Y.Z --output FILE",
  ].join("\n");
}

function parseArgs(argv) {
  const result = {};
  const names = new Map([
    ["--installer", "installer"],
    ["--target", "target"],
    ["--repository", "repository"],
    ["--release-commit", "releaseCommit"],
    ["--current-tag", "currentTag"],
    ["--previous-tag", "previousTag"],
    ["--expected-version", "expectedVersion"],
    ["--verify-evidence-dir", "verifyEvidenceDir"],
    ["--output", "output"],
  ]);
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      result.help = true;
      continue;
    }
    const name = names.get(token);
    if (!name) throw new Error(`Unknown argument: ${token}`);
    if (seen.has(token)) throw new Error(`Duplicate argument: ${token}`);
    seen.add(token);
    const value = argv[index + 1];
    if (typeof value !== "string" || value.startsWith("--")) {
      throw new Error(`${token} requires a value`);
    }
    result[name] = value;
    index += 1;
  }
  return result;
}

function requireString(value, label, pattern, max = 512) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > max ||
    (pattern && !pattern.test(value))
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function normalizeIdentity(options) {
  const repository = requireString(
    options.repository,
    "repository",
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u,
    200,
  );
  const releaseCommit = requireString(
    String(options.releaseCommit || "").toLowerCase(),
    "release commit",
    FULL_SHA,
    40,
  );
  const currentTag = requireString(options.currentTag, "current tag", TAG, 80);
  const previousTag = requireString(
    options.previousTag,
    "previous tag",
    TAG,
    80,
  );
  const expectedVersion = requireString(
    options.expectedVersion,
    "expected version",
    VERSION,
    64,
  );
  if (currentTag === previousTag) {
    throw new Error("current and previous native tags must differ");
  }
  if (currentTag.slice("cli-v".length) !== expectedVersion) {
    throw new Error("current native tag does not match the expected version");
  }
  if (
    compareVersions(previousTag.slice("cli-v".length), expectedVersion) >= 0
  ) {
    throw new Error("previous native tag is not older than the candidate");
  }
  return Object.freeze({
    repository,
    releaseCommit,
    currentTag,
    previousTag,
    expectedVersion,
  });
}

function versionParts(value) {
  requireString(value, "version", VERSION, 64);
  return value.split(".").map(Number);
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

function sha256File(filePath) {
  const stats = statSync(filePath);
  if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_BINARY_BYTES) {
    throw new Error(`native installed file is invalid: ${filePath}`);
  }
  const descriptor = openSync(filePath, "r");
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const bytes = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytes === 0) break;
      hash.update(buffer.subarray(0, bytes));
    }
  } finally {
    closeSync(descriptor);
  }
  return hash.digest("hex");
}

function assertRegularInput(filePath, label) {
  const stats = lstatSync(filePath);
  if (stats.isSymbolicLink() || !stats.isFile() || stats.size <= 0) {
    throw new Error(`${label} must be a non-empty regular file`);
  }
  return path.resolve(filePath);
}

function run(command, args, { env, timeoutMs = INSTALL_TIMEOUT_MS } = {}) {
  const result = spawnSync(command, args, {
    env,
    encoding: "utf8",
    stdio: "pipe",
    windowsHide: true,
    timeout: timeoutMs,
    maxBuffer: MAX_OUTPUT_BYTES,
  });
  return Object.freeze({
    status: result.status,
    signal: result.signal || null,
    error: result.error || null,
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || ""),
  });
}

function requireSuccess(result, label) {
  if (result.error || result.status !== 0) {
    throw new Error(
      `${label} failed: ${result.error?.message || result.stderr.slice(-2000) || result.signal || result.status}`,
    );
  }
  return result;
}

function invokeInstaller(installer, target, environment, extra = {}) {
  const env = {
    ...process.env,
    ...environment,
    ...extra,
  };
  delete env.CC_CLI_INSTALL_CRASH_AFTER_PHASE;
  delete env.CC_CLI_INSTALL_TERMINATE_AFTER_PHASE;
  delete env.CC_CLI_INSTALL_RECOVERY_ONLY;
  Object.assign(env, extra);
  return target.platform === "win32"
    ? run(
        "pwsh",
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          installer,
        ],
        { env },
      )
    : run("bash", [installer], { env });
}

function probeVersion(binary) {
  const result = requireSuccess(
    run(binary, ["--version"]),
    "native version probe",
  );
  const value = result.stdout.trim();
  return requireString(value, "native binary version", VERSION, 64);
}

function verifySignature(binary, target) {
  if (target.platform === "win32") {
    const env = { ...process.env, CC_NATIVE_SIGNATURE_FILE: binary };
    const script = [
      "$ErrorActionPreference='Stop'",
      "$s=Get-AuthenticodeSignature -LiteralPath $env:CC_NATIVE_SIGNATURE_FILE",
      "if($s.Status -ne [System.Management.Automation.SignatureStatus]::Valid -or -not $s.TimeStamperCertificate){throw 'invalid Authenticode signature or timestamp'}",
    ].join(";");
    requireSuccess(
      run(
        "pwsh",
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
        {
          env,
        },
      ),
      "Authenticode verification",
    );
  } else if (target.platform === "darwin") {
    requireSuccess(
      run("codesign", ["--verify", "--strict", "--verbose=2", binary]),
      "macOS code signature verification",
    );
    requireSuccess(
      run("spctl", ["--assess", "--type", "execute", "--verbose=4", binary]),
      "macOS notarization assessment",
    );
  }
  return Object.freeze({ kind: target.signature, verified: true });
}

function installedPaths(directory, target) {
  return Object.freeze({
    binary: path.join(directory, target.binary),
    alias: path.join(directory, target.alias),
    backup: path.join(directory, `${target.binary}.previous`),
    journal: path.join(directory, `${target.binary}.update-transaction.json`),
  });
}

function inspectInstalled(directory, target, expectedVersion = null) {
  const paths = installedPaths(directory, target);
  const version = probeVersion(paths.binary);
  const aliasVersion = probeVersion(paths.alias);
  if (
    aliasVersion !== version ||
    (expectedVersion && version !== expectedVersion)
  ) {
    throw new Error(
      "native binary and alias versions do not match the expected generation",
    );
  }
  const sha256 = sha256File(paths.binary);
  const aliasSha256 = sha256File(paths.alias);
  if (sha256 !== aliasSha256) {
    throw new Error("native binary and alias bytes differ");
  }
  return Object.freeze({
    version,
    sha256,
    signature: verifySignature(paths.binary, target),
    paths,
  });
}

function releaseBaseUrl(repository, tag) {
  return `https://github.com/${repository}/releases/download/${tag}`;
}

function executionIdentity(env = process.env) {
  const runId = requireString(
    env.GITHUB_RUN_ID || "local",
    "run id",
    /^(?:local|[1-9][0-9]*)$/u,
    40,
  );
  const runAttempt = Number(env.GITHUB_RUN_ATTEMPT || 1);
  if (!Number.isSafeInteger(runAttempt) || runAttempt < 1) {
    throw new TypeError("run attempt is invalid");
  }
  return Object.freeze({
    provider: env.GITHUB_ACTIONS === "true" ? "github-actions" : "local",
    repository: env.GITHUB_REPOSITORY || "local",
    workflow: env.GITHUB_WORKFLOW || "local",
    eventName: env.GITHUB_EVENT_NAME || "local",
    runId,
    runAttempt,
    runUrl:
      env.GITHUB_ACTIONS === "true"
        ? `${String(env.GITHUB_SERVER_URL || "https://github.com").replace(/\/$/u, "")}/${env.GITHUB_REPOSITORY}/actions/runs/${runId}/attempts/${runAttempt}`
        : null,
  });
}

export function runSignedInstallGate(options) {
  const identity = normalizeIdentity(options);
  const target = REQUIRED_TARGETS[options.target];
  if (!target) throw new Error(`unsupported native target: ${options.target}`);
  if (process.platform !== target.platform || process.arch !== target.arch) {
    throw new Error(
      `native target ${options.target} requires ${target.platform}/${target.arch}; runner is ${process.platform}/${process.arch}`,
    );
  }
  const installer = assertRegularInput(options.installer, "public installer");
  if (path.basename(installer) !== target.installer) {
    throw new Error(
      `native target ${options.target} requires ${target.installer}`,
    );
  }
  const output = path.resolve(options.output);
  const root = mkdtempSync(
    path.join(
      process.env.RUNNER_TEMP || os.tmpdir(),
      "cc-native-signed-install-",
    ),
  );
  const startedAt = new Date().toISOString();
  const currentBaseUrl = releaseBaseUrl(
    identity.repository,
    identity.currentTag,
  );
  const previousBaseUrl = releaseBaseUrl(
    identity.repository,
    identity.previousTag,
  );
  const baseEnvironment = (directory, baseUrl) => ({
    CC_CLI_REPOSITORY: identity.repository,
    CC_CLI_RELEASE_BASE_URL: baseUrl,
    CC_CLI_INSTALL_DIR: directory,
  });
  try {
    const freshDir = path.join(root, "fresh");
    requireSuccess(
      invokeInstaller(
        installer,
        target,
        baseEnvironment(freshDir, currentBaseUrl),
      ),
      "signed fresh install",
    );
    const fresh = inspectInstalled(freshDir, target, identity.expectedVersion);

    const upgradeDir = path.join(root, "upgrade");
    requireSuccess(
      invokeInstaller(
        installer,
        target,
        baseEnvironment(upgradeDir, previousBaseUrl),
      ),
      "signed previous-generation install",
    );
    const previous = inspectInstalled(upgradeDir, target);
    if (compareVersions(previous.version, identity.expectedVersion) >= 0) {
      throw new Error(
        "previous signed native generation is not older than the candidate",
      );
    }
    requireSuccess(
      invokeInstaller(
        installer,
        target,
        baseEnvironment(upgradeDir, currentBaseUrl),
      ),
      "signed native upgrade",
    );
    const upgraded = inspectInstalled(
      upgradeDir,
      target,
      identity.expectedVersion,
    );
    const upgradeBackupSha256 = sha256File(upgraded.paths.backup);
    if (
      previous.sha256 === upgraded.sha256 ||
      upgradeBackupSha256 !== previous.sha256
    ) {
      throw new Error(
        "signed upgrade did not preserve the exact previous generation",
      );
    }

    const rollbackDir = path.join(root, "rollback");
    requireSuccess(
      invokeInstaller(
        installer,
        target,
        baseEnvironment(rollbackDir, previousBaseUrl),
      ),
      "rollback baseline install",
    );
    const rollbackBaseline = inspectInstalled(
      rollbackDir,
      target,
      previous.version,
    );
    const crashed = invokeInstaller(
      installer,
      target,
      baseEnvironment(rollbackDir, currentBaseUrl),
      { CC_CLI_INSTALL_CRASH_AFTER_PHASE: "target-committed" },
    );
    if (!crashed.error && crashed.status === 0) {
      throw new Error("native rollback crash fixture unexpectedly succeeded");
    }
    requireSuccess(
      invokeInstaller(
        installer,
        target,
        baseEnvironment(rollbackDir, currentBaseUrl),
        { CC_CLI_INSTALL_RECOVERY_ONLY: "1" },
      ),
      "offline native rollback recovery",
    );
    const rolledBack = inspectInstalled(
      rollbackDir,
      target,
      rollbackBaseline.version,
    );
    if (
      rolledBack.sha256 !== rollbackBaseline.sha256 ||
      lstatSync(rolledBack.paths.journal, { throwIfNoEntry: false })
    ) {
      throw new Error(
        "native rollback did not restore and settle the exact prior generation",
      );
    }

    const evidence = {
      schema: EVIDENCE_SCHEMA,
      status: "passed",
      repository: identity.repository,
      releaseCommit: identity.releaseCommit,
      currentTag: identity.currentTag,
      previousTag: identity.previousTag,
      target: options.target,
      runner: {
        platform: process.platform,
        architecture: process.arch,
        node: process.version,
      },
      execution: executionIdentity(),
      startedAt,
      completedAt: new Date().toISOString(),
      previousVersion: previous.version,
      expectedVersion: identity.expectedVersion,
      currentBaseUrl,
      previousBaseUrl,
      freshInstall: {
        passed: true,
        version: fresh.version,
        sha256: fresh.sha256,
        signature: fresh.signature,
      },
      upgrade: {
        passed: true,
        fromVersion: previous.version,
        toVersion: upgraded.version,
        previousSha256: previous.sha256,
        currentSha256: upgraded.sha256,
        backupSha256: upgradeBackupSha256,
        signature: upgraded.signature,
      },
      rollback: {
        passed: true,
        crashPhase: "target-committed",
        restoredVersion: rolledBack.version,
        restoredSha256: rolledBack.sha256,
        journalRetired: true,
        signature: rolledBack.signature,
      },
    };
    validateEvidence(evidence, identity);
    writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    return evidence;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function strictTimestamp(value, label) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new TypeError(`${label} is invalid`);
  }
  return parsed;
}

function validSignature(value, expectedKind) {
  return (
    value?.verified === true &&
    value?.kind === expectedKind &&
    Object.keys(value).sort().join(",") === "kind,verified"
  );
}

export function validateEvidence(value, expectedOptions) {
  const expected = normalizeIdentity(expectedOptions);
  const target = REQUIRED_TARGETS[value?.target];
  if (
    !target ||
    value?.schema !== EVIDENCE_SCHEMA ||
    value?.status !== "passed" ||
    value?.repository !== expected.repository ||
    value?.releaseCommit !== expected.releaseCommit ||
    value?.currentTag !== expected.currentTag ||
    value?.previousTag !== expected.previousTag ||
    value?.expectedVersion !== expected.expectedVersion ||
    value?.runner?.platform !== target.platform ||
    value?.runner?.architecture !== target.arch ||
    !/^v22\./u.test(value?.runner?.node || "") ||
    Object.keys(value.runner).sort().join(",") !== "architecture,node,platform"
  ) {
    throw new Error("native signed-install evidence identity is invalid");
  }
  const started = strictTimestamp(value.startedAt, "startedAt");
  const completed = strictTimestamp(value.completedAt, "completedAt");
  if (completed < started)
    throw new Error("evidence completion precedes start");
  if (
    value.currentBaseUrl !==
      releaseBaseUrl(expected.repository, expected.currentTag) ||
    value.previousBaseUrl !==
      releaseBaseUrl(expected.repository, expected.previousTag) ||
    value.previousVersion !== expected.previousTag.slice("cli-v".length)
  ) {
    throw new Error("native signed-install release lineage is invalid");
  }
  const fresh = value.freshInstall;
  const upgrade = value.upgrade;
  const rollback = value.rollback;
  if (
    fresh?.passed !== true ||
    fresh.version !== expected.expectedVersion ||
    !SHA256.test(fresh.sha256 || "") ||
    !validSignature(fresh.signature, target.signature) ||
    upgrade?.passed !== true ||
    upgrade.fromVersion !== value.previousVersion ||
    upgrade.toVersion !== expected.expectedVersion ||
    !SHA256.test(upgrade.previousSha256 || "") ||
    !SHA256.test(upgrade.currentSha256 || "") ||
    upgrade.previousSha256 === upgrade.currentSha256 ||
    fresh.sha256 !== upgrade.currentSha256 ||
    upgrade.backupSha256 !== upgrade.previousSha256 ||
    !validSignature(upgrade.signature, target.signature) ||
    rollback?.passed !== true ||
    rollback.crashPhase !== "target-committed" ||
    rollback.restoredVersion !== value.previousVersion ||
    rollback.restoredSha256 !== upgrade.previousSha256 ||
    rollback.journalRetired !== true ||
    !validSignature(rollback.signature, target.signature)
  ) {
    throw new Error("native signed-install transaction evidence is invalid");
  }
  const execution = value.execution;
  if (
    !execution ||
    Object.keys(execution).sort().join(",") !==
      "eventName,provider,repository,runAttempt,runId,runUrl,workflow" ||
    !["github-actions", "local"].includes(execution.provider) ||
    typeof execution.repository !== "string" ||
    typeof execution.workflow !== "string" ||
    typeof execution.eventName !== "string" ||
    !/^(?:local|[1-9][0-9]*)$/u.test(execution.runId || "") ||
    !Number.isSafeInteger(execution.runAttempt) ||
    execution.runAttempt < 1
  ) {
    throw new Error("native signed-install execution identity is invalid");
  }
  if (
    execution.provider === "github-actions" &&
    (execution.repository !== expected.repository ||
      execution.workflow !== EXPECTED_WORKFLOW ||
      execution.eventName !== "push" ||
      execution.runUrl !==
        `https://github.com/${expected.repository}/actions/runs/${execution.runId}/attempts/${execution.runAttempt}`)
  ) {
    throw new Error(
      "native signed-install GitHub execution identity is invalid",
    );
  }
  if (execution.provider === "local" && execution.runUrl !== null) {
    throw new Error(
      "local native signed-install evidence has an external run URL",
    );
  }
  return true;
}

function evidenceFiles(directory) {
  const rootStats = lstatSync(directory);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new Error("signed-install evidence root must be a real directory");
  }
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isFile() && entry.name.endsWith(".json")) files.push(candidate);
    if (entry.isDirectory()) {
      for (const nested of readdirSync(candidate, { withFileTypes: true })) {
        if (nested.isFile() && nested.name.endsWith(".json")) {
          files.push(path.join(candidate, nested.name));
        }
      }
    }
  }
  return files.sort();
}

function readEvidence(file) {
  const stats = lstatSync(file);
  if (
    stats.isSymbolicLink() ||
    !stats.isFile() ||
    stats.size <= 0 ||
    stats.size > MAX_EVIDENCE_BYTES
  ) {
    throw new Error(`signed-install evidence file is invalid: ${file}`);
  }
  return JSON.parse(readFileSync(file, "utf8"));
}

export function verifyEvidenceDirectory(options) {
  const identity = normalizeIdentity(options);
  const directory = path.resolve(options.verifyEvidenceDir);
  const files = evidenceFiles(directory);
  if (files.length !== Object.keys(REQUIRED_TARGETS).length) {
    throw new Error(
      "signed-install aggregate requires exactly six evidence files",
    );
  }
  const records = files.map((file) => {
    const value = readEvidence(file);
    validateEvidence(value, identity);
    return value;
  });
  const targets = records.map((entry) => entry.target).sort();
  const expectedTargets = Object.keys(REQUIRED_TARGETS).sort();
  if (targets.some((entry, index) => entry !== expectedTargets[index])) {
    throw new Error("signed-install aggregate target matrix is incomplete");
  }
  const runIds = new Set(records.map((entry) => entry.execution.runId));
  const attempts = new Set(records.map((entry) => entry.execution.runAttempt));
  if (runIds.size !== 1 || attempts.size !== 1) {
    throw new Error(
      "signed-install evidence does not belong to one workflow attempt",
    );
  }
  const executions = new Set(
    records.map((entry) => JSON.stringify(entry.execution)),
  );
  if (
    executions.size !== 1 ||
    records.some(
      (entry) =>
        entry.execution.provider !== "github-actions" ||
        entry.execution.repository !== identity.repository ||
        entry.execution.workflow !== EXPECTED_WORKFLOW ||
        entry.execution.eventName !== "push",
    )
  ) {
    throw new Error(
      "signed-install aggregate requires one trusted workflow execution",
    );
  }
  const aggregate = {
    schema: AGGREGATE_SCHEMA,
    status: "passed",
    repository: identity.repository,
    releaseCommit: identity.releaseCommit,
    currentTag: identity.currentTag,
    previousTag: identity.previousTag,
    expectedVersion: identity.expectedVersion,
    verifiedAt: new Date().toISOString(),
    execution: {
      runId: records[0].execution.runId,
      runAttempt: records[0].execution.runAttempt,
    },
    targets: records
      .map((entry) => ({
        target: entry.target,
        previousVersion: entry.previousVersion,
        freshInstall: entry.freshInstall.passed,
        upgrade: entry.upgrade.passed,
        rollback: entry.rollback.passed,
        signature: entry.freshInstall.signature.kind,
      }))
      .sort((left, right) => left.target.localeCompare(right.target)),
    totals: {
      targets: records.length,
      signedFreshInstalls: records.length,
      signedUpgrades: records.length,
      crashRollbacks: records.length,
    },
  };
  writeFileSync(
    path.resolve(options.output),
    `${JSON.stringify(aggregate, null, 2)}\n`,
  );
  return aggregate;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!options.output) throw new Error("--output is required");
  const result = options.verifyEvidenceDir
    ? verifyEvidenceDirectory(options)
    : runSignedInstallGate(options);
  process.stdout.write(
    `${result.status}: ${result.releaseCommit} ${result.currentTag}\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `native signed install gate failed: ${error.message}\n`,
    );
    process.exitCode = 1;
  }
}

export {
  AGGREGATE_SCHEMA,
  EVIDENCE_SCHEMA,
  REQUIRED_TARGETS,
  compareVersions,
  parseArgs,
};

#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const SHA_RE = /^[a-f0-9]{40}$/u;
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/u;
const TARGET_CPU_SECONDS = 5;
const TARGET_MEMORY_BYTES = 3 * 1024 * 1024 * 1024;
const TRANSPORTS = new Set(["local", "wsl", "container", "ssh"]);
const MODES = new Set([
  "initialize",
  "prepare-reconnect",
  "probe-unavailable",
  "complete-reconnect",
  "lifecycle-faults",
  "campaign",
  "finalize",
]);
const EVIDENCE_FILES = Object.freeze([
  "bootstrap.json",
  "reconnect-prepared.json",
  "network-fault.json",
  "lifecycle-faults.json",
  "reconnect-completed.json",
  "campaign.json",
  "outcome-observations.json",
  "exact-commit.json",
  "provenance.json",
]);
let sourceCheckoutVerified = false;

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    assert.ok(key?.startsWith("--") && value, `invalid argument: ${key}`);
    options[
      key
        .slice(2)
        .replace(/-([a-z])/gu, (_, character) => character.toUpperCase())
    ] = value;
  }
  return options;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function writeJsonDurable(filePath, value) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${crypto
    .randomBytes(6)
    .toString("hex")}.tmp`;
  const descriptor = fs.openSync(temporary, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, `${canonicalJson(value)}\n`, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, filePath);
  if (process.platform !== "win32") {
    const directoryHandle = fs.openSync(directory, "r");
    try {
      fs.fsyncSync(directoryHandle);
    } finally {
      fs.closeSync(directoryHandle);
    }
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function commonOptions(options) {
  assert.ok(MODES.has(options.mode), `unsupported mode: ${options.mode}`);
  assert.ok(
    TRANSPORTS.has(options.transport),
    `unsupported transport: ${options.transport}`,
  );
  assert.match(options.releaseCommit || "", SHA_RE);
  assert.ok(options.artifactDir, "--artifact-dir is required");
  assert.ok(options.stateDir, "--state-dir is required");
  return {
    ...options,
    artifactDir: path.resolve(options.artifactDir),
    stateDir: path.resolve(options.stateDir),
  };
}

function provenance(options) {
  return {
    repository: process.env.GITHUB_REPOSITORY || "local",
    workflowRef: process.env.GITHUB_WORKFLOW_REF || "local",
    workflowSha: process.env.GITHUB_WORKFLOW_SHA || options.releaseCommit,
    runId: process.env.GITHUB_RUN_ID || "local",
    runAttempt: process.env.GITHUB_RUN_ATTEMPT || "1",
    job: process.env.GITHUB_JOB || `local-${options.transport}`,
    eventName: process.env.GITHUB_EVENT_NAME || "local",
    artifactName: options.artifactName || `local-${options.transport}`,
  };
}

function bootstrapDocument(options) {
  return {
    schema: "chainlesschain.execution-location-bootstrap.v1",
    releaseCommit: options.releaseCommit,
    transport: options.transport,
    initialized: true,
    nodeVersion: process.version,
    platform: process.platform,
    architecture: process.arch,
    provenance: provenance(options),
  };
}

function initialize(options) {
  fs.mkdirSync(options.artifactDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(options.stateDir, { recursive: true, mode: 0o700 });
  writeJsonDurable(
    path.join(options.artifactDir, "bootstrap.json"),
    bootstrapDocument(options),
  );
}

function configureSourceHome(options) {
  assert.ok(options.sourceHome, "--source-home is required");
  assert.ok(options.sourceSecurityHome, "--source-security-home is required");
  process.env.CHAINLESSCHAIN_HOME = path.resolve(options.sourceHome);
  process.env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME = path.resolve(
    options.sourceSecurityHome,
  );
  process.env.NO_COLOR = "1";
  process.env.FORCE_COLOR = "0";
}

function ensureProductionOptions(options) {
  for (const key of [
    "sourceHome",
    "sourceSecurityHome",
    "targetCwd",
    "targetCli",
  ]) {
    assert.ok(
      options[key],
      `--${key.replace(/[A-Z]/gu, (c) => `-${c.toLowerCase()}`)} is required`,
    );
  }
  if (options.transport === "local") {
    for (const key of ["targetHome", "targetSecurityHome"]) {
      assert.ok(
        options[key],
        `--${key.replace(/[A-Z]/gu, (c) => `-${c.toLowerCase()}`)} is required`,
      );
    }
  } else if (options.transport === "wsl") {
    assert.ok(options.distro, "--distro is required for WSL");
  } else if (options.transport === "container") {
    assert.ok(options.container, "--container is required for Container");
  } else {
    for (const key of ["sshHost", "sshPort", "knownHosts", "identityFile"]) {
      assert.ok(options[key], `--${key} is required for SSH`);
    }
  }
}

async function loadProduction() {
  const [store, runtime, location, constants, runnerLifecycle, target] =
    await Promise.all([
      import("../src/harness/jsonl-session-store.js"),
      import("../src/lib/execution-location-runtime.js"),
      import("../src/commands/session-location.js"),
      import("../src/constants.js"),
      import("../src/lib/execution-location-runner-lifecycle.js"),
      import("../src/lib/execution-location-target.js"),
    ]);
  return { store, runtime, location, constants, runnerLifecycle, target };
}

function assertSourceCheckout(options) {
  if (sourceCheckoutVerified) return;
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: false,
  }).trim();
  const status = execFileSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=normal"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      shell: false,
    },
  ).trim();
  assert.equal(
    head,
    options.releaseCommit,
    "source checkout is not the release commit",
  );
  assert.equal(status, "", "source checkout is not clean");
  sourceCheckoutVerified = true;
}

function transportProfile(options) {
  if (options.transport === "local") {
    return {
      home: path.resolve(options.targetHome),
      securityHome: path.resolve(options.targetSecurityHome),
    };
  }
  if (options.transport === "wsl") {
    return { distro: options.distro };
  }
  if (options.transport === "container") {
    return { container: options.container };
  }
  const knownHostsBytes = fs.readFileSync(path.resolve(options.knownHosts));
  const port = Number(options.sshPort);
  assert.ok(Number.isSafeInteger(port) && port > 0 && port <= 65535);
  return {
    host: options.sshHost,
    port,
    user: options.sshUser || null,
    knownHostsFile: path.resolve(options.knownHosts),
    knownHostsDigest: digest(knownHostsBytes),
    identityFile: path.resolve(options.identityFile),
  };
}

function fixedDigest(label) {
  return digest(Buffer.from(`ide-roadmap-execution-location:${label}`, "utf8"));
}

function freshProxyAuthority(revision, nowMs = Date.now()) {
  return {
    id: "roadmap-proxy-authority",
    revision,
    issuedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + 10 * 60 * 1000).toISOString(),
  };
}

function lifecycleAuthorityFor(
  options,
  production,
  sessionId,
  directory,
  overrides = {},
) {
  return new production.runnerLifecycle.ExecutionLocationRunnerLifecycle({
    filePath: path.join(directory, "runner-lifecycle.json"),
    runnerId: `${options.transport}-runner-${sessionId}`,
    target: options.transport,
    baseDir: options.targetCwd,
    resources: {
      cpuSeconds: TARGET_CPU_SECONDS,
      memoryBytes: TARGET_MEMORY_BYTES,
    },
    postSessionHookDigest: fixedDigest(`post-session-hook:${sessionId}`),
    // The authority lives on the source, while target-preflight verifies the
    // remote path with an actual create/fsync/unlink under the leased argv.
    preflightBaseDir: () => {},
    normalizeBaseDir: (value) => String(value),
    ...overrides,
  });
}

function acquireLifecycleLease(
  options,
  production,
  sessionId,
  directory,
  overrides = {},
) {
  const lifecycle = lifecycleAuthorityFor(
    options,
    production,
    sessionId,
    directory,
    overrides,
  );
  const initial = lifecycle.initialize();
  assert.equal(initial.state, "accepting");
  const nowMs = Number((overrides.now || Date.now)());
  const lease = lifecycle.acquireLease({
    sessionId,
    expectedGeneration: initial.generation,
    ttlMs: overrides.ttlMs || 10 * 60 * 1000,
    proxyAuthority: freshProxyAuthority(1, nowMs),
  });
  return { lifecycle, lease };
}

function factsFor(authority, options, evidenceId) {
  return {
    schema: "cc-execution-location-handoff-facts/v1",
    authority: {
      sessionId: authority.sessionId,
      headHash: authority.headHash,
      eventCount: authority.eventCount,
    },
    target: {
      configured: true,
      evidenceId,
      networkPolicy: "restricted",
      sandboxStrength: "strong",
      dataBoundary: { kind: "declared", root: options.targetCwd },
      capabilities: ["node"],
    },
    git: { status: "clean", baseCommit: options.releaseCommit },
    strategy: { kind: "commit", ref: options.releaseCommit },
    summary: { included: true, digest: fixedDigest("summary") },
    permissions: { included: true, digest: fixedDigest("permissions") },
    artifacts: [],
    credentials: [],
    requiredCapabilities: ["node"],
  };
}

function profileFor(authority, options, constants, evidenceId, lifecycle) {
  return {
    schema: "cc-execution-location-profile/v2",
    id: `${options.transport}-roadmap-profile`,
    target: options.transport,
    evidenceId,
    cliCommand: options.targetCli,
    cwd: options.targetCwd,
    transport: transportProfile(options),
    expected: {
      platform: options.transport === "local" ? process.platform : "linux",
      arch: options.transport === "local" ? process.arch : "x64",
      cliVersion: constants.VERSION,
      gitCommit: options.releaseCommit,
      tools: ["chainlesschain-cli", "node"],
    },
    sessionStore: {
      mode: "replicated",
      targetSessionId: authority.sessionId,
      headHash: authority.headHash,
      eventCount: authority.eventCount,
    },
    lifecycle,
  };
}

function scenarioPaths(options, sessionId) {
  const directory = path.join(options.stateDir, "scenarios", sessionId);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  return {
    directory,
    facts: path.join(directory, "facts.json"),
    profile: path.join(directory, "profile.json"),
  };
}

function targetFixturePath(options, relativePath) {
  return `${options.targetCwd.replace(/[\\/]+$/u, "")}/${relativePath}`;
}

function probeProfileFor(options, production, name, lease) {
  return {
    schema: "cc-execution-location-profile/v2",
    id: `${options.transport}-${name}-profile`,
    target: options.transport,
    evidenceId: `${options.transport}-${name}-evidence`,
    cliCommand: options.targetCli,
    cwd: options.targetCwd,
    transport: transportProfile(options),
    expected: {
      platform: options.transport === "local" ? process.platform : "linux",
      arch: options.transport === "local" ? process.arch : "x64",
      cliVersion: production.constants.VERSION,
      gitCommit: options.releaseCommit,
      tools: ["chainlesschain-cli", "node"],
    },
    sessionStore: null,
    lifecycle: production.runnerLifecycle.lifecycleProfileFromLease(lease),
  };
}

function assertDigestFields(value, fields) {
  for (const field of fields) assert.match(value?.[field] || "", DIGEST_RE);
}

async function createScenario(options, index, prefix = "campaign") {
  assertSourceCheckout(options);
  const production = await loadProduction();
  const sessionId = `ide-location-${options.transport}-${prefix}-${String(index).padStart(3, "0")}`;
  const binding = production.runtime.captureAmbientExecutionLocation({
    networkPolicy: "restricted",
    sandboxStrength: "strong",
  });
  assert.equal(binding.source.git.commit, options.releaseCommit);
  production.store.startSession(sessionId, {
    title: `Execution Location ${options.transport} ${index}`,
    provider: "fixture-no-provider-call",
    model: "fixture-no-model-call",
    executionLocation: binding,
  });
  production.store.appendUserMessage(
    sessionId,
    "content-free trajectory input",
  );
  production.store.appendAssistantMessage(
    sessionId,
    "content-free trajectory checkpoint",
  );
  const authority =
    production.store.getVerifiedSessionExecutionLocationAuthority(sessionId);
  const evidenceId = `${options.transport}-evidence-${prefix}-${String(index).padStart(3, "0")}`;
  const paths = scenarioPaths(options, sessionId);
  const { lease } = acquireLifecycleLease(
    options,
    production,
    sessionId,
    paths.directory,
  );
  writeJsonDurable(paths.facts, factsFor(authority, options, evidenceId));
  writeJsonDurable(
    paths.profile,
    profileFor(
      authority,
      options,
      production.constants,
      evidenceId,
      production.runnerLifecycle.lifecycleProfileFromLease(lease),
    ),
  );
  const handoff = production.location.projectExecutionLocationHandoff(
    sessionId,
    options.transport,
    paths.facts,
  );
  assert.equal(handoff.allowed, true, handoff.blockers?.join(","));
  const attestation =
    production.location.projectExecutionLocationTargetAttestation(
      sessionId,
      options.transport,
      paths.facts,
      paths.profile,
    );
  assert.equal(attestation.binding.location, options.transport);
  assert.equal(attestation.binding.source.git.commit, options.releaseCommit);
  assert.equal(attestation.verified.ambientLocation, true);
  assert.equal(attestation.verified.gitCommit, true);
  assertDigestFields(attestation, [
    "profileDigest",
    "targetFactsDigest",
    "attestationDigest",
  ]);
  assert.match(attestation.lifecyclePreflight?.receiptDigest || "", DIGEST_RE);
  assert.match(attestation.lifecycleAttestationDigest || "", DIGEST_RE);
  assert.equal(attestation.lifecyclePreflight.secretTransferCount, 0);
  const resume = production.location.resumeSessionAtExecutionLocation(
    sessionId,
    options.transport,
    paths.facts,
    paths.profile,
    attestation.targetFactsDigest,
  );
  assert.equal(resume.exitStatus, 0);
  assert.equal(resume.target, options.transport);
  assert.equal(resume.sessionStore.sessionId, sessionId);
  assert.match(resume.sessionStore.handoffId || "", DIGEST_RE);
  assert.match(resume.receiptDigest || "", DIGEST_RE);
  assert.match(resume.sessionStore.transfer.attestationDigest || "", DIGEST_RE);
  assert.notEqual(
    resume.sessionStore.transfer.attestationDigest,
    attestation.attestationDigest,
    "target prepare did not produce a fresh attestation",
  );
  return {
    production,
    sessionId,
    paths,
    targetFactsDigest: attestation.targetFactsDigest,
    handoffId: resume.sessionStore.handoffId,
    resumeDigest: resume.receiptDigest,
    attestationDigest: attestation.attestationDigest,
    targetHandoffAttestationDigest:
      resume.sessionStore.transfer.attestationDigest,
    sourceHeadHash: authority.headHash,
    sourceEventCount: authority.eventCount,
    leaseId: lease.lease.id,
    leaseGeneration: lease.lease.generation,
    leaseReceiptDigest: lease.leaseReceiptDigest,
    targetPreflightReceiptDigest: attestation.lifecyclePreflight.receiptDigest,
    lifecycleAttestationDigest: attestation.lifecycleAttestationDigest,
  };
}

async function finishScenario(options, scenario, { reconnect = false } = {}) {
  const production = scenario.production || (await loadProduction());
  let reconnectResumeDigest = null;
  if (reconnect) {
    const resumed = production.location.resumeSessionAtExecutionLocation(
      scenario.sessionId,
      options.transport,
      scenario.paths.facts,
      scenario.paths.profile,
      scenario.targetFactsDigest,
    );
    assert.equal(resumed.exitStatus, 0);
    assert.equal(resumed.sessionStore.handoffId, scenario.handoffId);
    assert.equal(resumed.sessionStore.transfer.handoffAppended, false);
    reconnectResumeDigest = resumed.receiptDigest;
  }
  const suffix = scenario.sessionId.replace(/[^A-Za-z0-9._-]/gu, "-");
  const collected = production.location.collectSessionExecutionLocationResult(
    scenario.sessionId,
    options.transport,
    {
      facts: scenario.paths.facts,
      profile: scenario.paths.profile,
      expectedTargetFactsDigest: scenario.targetFactsDigest,
      expectedHandoffId: scenario.handoffId,
      requestId: `request-${suffix}`,
      resultId: `result-${suffix}`,
      summary: targetFixturePath(
        options,
        "packages/cli/__tests__/fixtures/execution-location-handoff-facts-valid.json",
      ),
      diff: targetFixturePath(
        options,
        "packages/cli/__tests__/fixtures/execution-location-handoff-facts-valid.json",
      ),
      artifact: [],
      evidence: [],
    },
  );
  assert.equal(collected.settlement?.settlementAppended, true);
  assert.match(collected.collectionDigest || "", DIGEST_RE);
  assert.match(collected.settlement?.receiptDigest || "", DIGEST_RE);
  const review = production.location.reviewSessionExecutionLocationResult(
    scenario.sessionId,
    `request-${suffix}`,
  );
  assert.match(review.reviewDigest || "", DIGEST_RE);
  const imported =
    production.location.importSessionExecutionLocationResultArtifact(
      scenario.sessionId,
      `request-${suffix}`,
      review.reviewDigest,
      "summary",
    );
  assert.equal(imported.imported, true);
  assert.match(imported.importDigest || "", DIGEST_RE);
  const lifecycle = lifecycleAuthorityFor(
    options,
    production,
    scenario.sessionId,
    scenario.paths.directory,
  );
  const accepting = lifecycle.snapshot();
  assert.equal(accepting.state, "accepting");
  const draining = lifecycle.requestDrain({
    expectedGeneration: accepting.generation,
    signal: "SIGTERM",
    timeoutMs: 30_000,
  });
  assert.equal(draining.state, "draining");
  const parked = lifecycle.settleLease({
    leaseId: scenario.leaseId,
    leaseGeneration: scenario.leaseGeneration,
    resultDigest: collected.settlement.receiptDigest,
  });
  assert.equal(parked.state, "parked");
  const hook = lifecycle.authorizePostSessionHook({
    expectedRunnerGeneration: parked.generation,
    leaseId: scenario.leaseId,
    leaseGeneration: scenario.leaseGeneration,
    resultDigest: collected.settlement.receiptDigest,
    hookDigest: fixedDigest(`post-session-hook:${scenario.sessionId}`),
  });
  const reclaiming = lifecycle.beginReclaim({
    expectedGeneration: parked.generation,
    proxyAuthority: freshProxyAuthority(2),
  });
  const reclaimed = lifecycle.completeReclaim({
    expectedGeneration: reclaiming.generation,
  });
  assert.equal(reclaimed.state, "accepting");
  return {
    schema: "chainlesschain.execution-location-trajectory.v1",
    sessionIdDigest: digest(Buffer.from(scenario.sessionId, "utf8")),
    sourceHeadDigest: digest(Buffer.from(scenario.sourceHeadHash, "utf8")),
    sourceEventCount: scenario.sourceEventCount,
    attestationDigest: scenario.attestationDigest,
    targetHandoffAttestationDigest: scenario.targetHandoffAttestationDigest,
    targetFactsDigest: scenario.targetFactsDigest,
    handoffId: scenario.handoffId,
    resumeDigest: scenario.resumeDigest,
    reconnectResumeDigest,
    collectionDigest: collected.collectionDigest,
    settlementDigest: collected.settlement.receiptDigest,
    reviewDigest: review.reviewDigest,
    importDigest: imported.importDigest,
    leaseReceiptDigest: scenario.leaseReceiptDigest,
    targetPreflightReceiptDigest: scenario.targetPreflightReceiptDigest,
    lifecycleAttestationDigest: scenario.lifecycleAttestationDigest,
    postSessionHookReceiptDigest: hook.receiptDigest,
    leaseGeneration: scenario.leaseGeneration,
    finalRunnerGeneration: reclaimed.generation,
    finalRunnerState: reclaimed.state,
    sigtermDrainCount: 1,
    postSessionHookCount: 1,
    reclaimCount: 1,
    launchCount: 1,
    resumeCount: reconnect ? 2 : 1,
    reconnectCount: reconnect ? 1 : 0,
    resultCollectCount: 1,
    resultReviewCount: 1,
    resultImportCount: 1,
    secretTransferCount: 0,
    silentFallbackCount: 0,
    duplicateHandoffCount: 0,
    duplicateResultSettlementCount: 0,
  };
}

function serializableScenario(scenario) {
  return {
    sessionId: scenario.sessionId,
    paths: scenario.paths,
    targetFactsDigest: scenario.targetFactsDigest,
    handoffId: scenario.handoffId,
    resumeDigest: scenario.resumeDigest,
    attestationDigest: scenario.attestationDigest,
    targetHandoffAttestationDigest: scenario.targetHandoffAttestationDigest,
    sourceHeadHash: scenario.sourceHeadHash,
    sourceEventCount: scenario.sourceEventCount,
    leaseId: scenario.leaseId,
    leaseGeneration: scenario.leaseGeneration,
    leaseReceiptDigest: scenario.leaseReceiptDigest,
    targetPreflightReceiptDigest: scenario.targetPreflightReceiptDigest,
    lifecycleAttestationDigest: scenario.lifecycleAttestationDigest,
  };
}

async function prepareReconnect(options) {
  const scenario = await createScenario(options, 1, "reconnect");
  writeJsonDurable(
    path.join(options.stateDir, "reconnect-state.json"),
    serializableScenario(scenario),
  );
  writeJsonDurable(path.join(options.artifactDir, "reconnect-prepared.json"), {
    schema: "chainlesschain.execution-location-reconnect-prepared.v1",
    releaseCommit: options.releaseCommit,
    transport: options.transport,
    sessionIdDigest: digest(Buffer.from(scenario.sessionId, "utf8")),
    targetFactsDigest: scenario.targetFactsDigest,
    handoffId: scenario.handoffId,
    resumeDigest: scenario.resumeDigest,
    prepared: true,
  });
}

async function probeUnavailable(options) {
  const production = await loadProduction();
  const scenario = readJson(
    path.join(options.stateDir, "reconnect-state.json"),
  );
  let observed = null;
  try {
    production.location.projectExecutionLocationTargetAttestation(
      scenario.sessionId,
      options.transport,
      scenario.paths.facts,
      scenario.paths.profile,
    );
  } catch (error) {
    observed = {
      code: String(
        error?.code || "CC_EXECUTION_LOCATION_TARGET_UNAVAILABLE",
      ).slice(0, 96),
      messageDigest: digest(
        Buffer.from(String(error?.message || "target unavailable"), "utf8"),
      ),
    };
  }
  assert.ok(observed, "target outage did not fail closed");
  writeJsonDurable(path.join(options.artifactDir, "network-fault.json"), {
    schema: "chainlesschain.execution-location-network-fault.v1",
    releaseCommit: options.releaseCommit,
    transport: options.transport,
    injectedOutageCount: 1,
    unavailableProbeFailureCount: 1,
    unavailableProbeSuccessCount: 0,
    credentialLeakCount: 0,
    diagnostic: observed,
  });
}

async function completeReconnect(options) {
  const scenario = readJson(
    path.join(options.stateDir, "reconnect-state.json"),
  );
  const trajectory = await finishScenario(options, scenario, {
    reconnect: true,
  });
  writeJsonDurable(path.join(options.artifactDir, "reconnect-completed.json"), {
    schema: "chainlesschain.execution-location-reconnect-completed.v1",
    releaseCommit: options.releaseCommit,
    transport: options.transport,
    trajectory,
  });
}

async function lifecycleFaults(options) {
  assertSourceCheckout(options);
  const production = await loadProduction();
  const faultRoot = path.join(options.stateDir, "lifecycle-faults");
  fs.mkdirSync(faultRoot, { recursive: true, mode: 0o700 });

  const sigtermSession = `sigterm-${options.transport}`;
  const sigtermDirectory = path.join(faultRoot, sigtermSession);
  fs.mkdirSync(sigtermDirectory, { recursive: true, mode: 0o700 });
  const sigtermAuthority = acquireLifecycleLease(
    options,
    production,
    sigtermSession,
    sigtermDirectory,
  );
  const sigtermProfile = probeProfileFor(
    options,
    production,
    "sigterm",
    sigtermAuthority.lease,
  );
  const windowsLocalSigtermUnsupported =
    options.transport === "local" && process.platform === "win32";
  const sigtermPreflight = windowsLocalSigtermUnsupported
    ? production.target.probeExecutionLocationTargetPreflight({
        profile: sigtermProfile,
      })
    : null;
  const sigtermReceipt = windowsLocalSigtermUnsupported
    ? null
    : production.target.probeExecutionLocationTargetSigtermDrain({
        profile: sigtermProfile,
      });
  const sourceDraining = sigtermAuthority.lifecycle.requestDrain({
    expectedGeneration: 1,
    signal: "SIGTERM",
    timeoutMs: 30_000,
  });
  let postDrainLeaseAcceptanceCount = 0;
  try {
    sigtermAuthority.lifecycle.acquireLease({
      sessionId: `${sigtermSession}-after-drain`,
      expectedGeneration: sourceDraining.generation,
      proxyAuthority: freshProxyAuthority(1),
    });
    postDrainLeaseAcceptanceCount += 1;
  } catch {
    // The source generation fence must reject every lease after drain starts.
  }
  assert.equal(sourceDraining.accepting, false);
  assert.equal(postDrainLeaseAcceptanceCount, 0);
  const sigtermResultDigest =
    sigtermReceipt?.receiptDigest || sigtermPreflight.receiptDigest;
  const sourceParked = sigtermAuthority.lifecycle.settleLease({
    leaseId: sigtermAuthority.lease.lease.id,
    leaseGeneration: sigtermAuthority.lease.lease.generation,
    resultDigest: sigtermResultDigest,
  });
  const sigtermHook = sigtermAuthority.lifecycle.authorizePostSessionHook({
    expectedRunnerGeneration: sourceParked.generation,
    leaseId: sigtermAuthority.lease.lease.id,
    leaseGeneration: sigtermAuthority.lease.lease.generation,
    resultDigest: sigtermResultDigest,
    hookDigest: fixedDigest(`post-session-hook:${sigtermSession}`),
  });
  const sigtermReclaiming = sigtermAuthority.lifecycle.beginReclaim({
    expectedGeneration: sourceParked.generation,
    proxyAuthority: freshProxyAuthority(2),
  });
  const sigtermReclaimed = sigtermAuthority.lifecycle.completeReclaim({
    expectedGeneration: sigtermReclaiming.generation,
  });

  const resources = [];
  for (const kind of ["cpu", "memory"]) {
    const sessionId = `${kind}-limit-${options.transport}`;
    const directory = path.join(faultRoot, sessionId);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const authority = acquireLifecycleLease(
      options,
      production,
      sessionId,
      directory,
    );
    const targetReceipt =
      production.target.probeExecutionLocationTargetResourceLimit({
        profile: probeProfileFor(
          options,
          production,
          `${kind}-limit`,
          authority.lease,
        ),
        kind,
      });
    const parked = authority.lifecycle.parkLease({
      leaseId: authority.lease.lease.id,
      leaseGeneration: authority.lease.lease.generation,
      resultDigest: targetReceipt.receiptDigest,
      reason: "resource-limit",
    });
    const reclaiming = authority.lifecycle.beginReclaim({
      expectedGeneration: parked.generation,
      proxyAuthority: freshProxyAuthority(2),
    });
    const reclaimed = authority.lifecycle.completeReclaim({
      expectedGeneration: reclaiming.generation,
    });
    resources.push({
      kind,
      targetReceiptDigest: targetReceipt.receiptDigest,
      preflightReceiptDigest: targetReceipt.preflightReceiptDigest,
      enforcementScope: targetReceipt.enforcementScope,
      termination: targetReceipt.termination,
      parkedState: parked.state,
      parkReason: parked.parkReason,
      reclaimedState: reclaimed.state,
    });
  }

  const checkoutSession = `checkout-failure-${options.transport}`;
  const checkoutDirectory = path.join(faultRoot, checkoutSession);
  fs.mkdirSync(checkoutDirectory, { recursive: true, mode: 0o700 });
  const checkout = acquireLifecycleLease(
    options,
    production,
    checkoutSession,
    checkoutDirectory,
  );
  const checkoutParked = checkout.lifecycle.parkLease({
    leaseId: checkout.lease.lease.id,
    leaseGeneration: checkout.lease.lease.generation,
    resultDigest: fixedDigest(`checkout-failure:${options.transport}`),
    reason: "checkout-failure",
  });
  const checkoutReclaiming = checkout.lifecycle.beginReclaim({
    expectedGeneration: checkoutParked.generation,
    proxyAuthority: freshProxyAuthority(2),
  });
  const checkoutReclaimed = checkout.lifecycle.completeReclaim({
    expectedGeneration: checkoutReclaiming.generation,
  });

  let lostPollNow = Date.now();
  const lostPollSession = `lost-poll-${options.transport}`;
  const lostPollDirectory = path.join(faultRoot, lostPollSession);
  fs.mkdirSync(lostPollDirectory, { recursive: true, mode: 0o700 });
  const lostPoll = acquireLifecycleLease(
    options,
    production,
    lostPollSession,
    lostPollDirectory,
    { now: () => lostPollNow, ttlMs: 1_000 },
  );
  lostPollNow += 1_001;
  let stalePollAcceptanceCount = 0;
  try {
    lostPoll.lifecycle.assertPoll({
      leaseId: lostPoll.lease.lease.id,
      leaseGeneration: lostPoll.lease.lease.generation,
      proxyAuthorityId: lostPoll.lease.proxyAuthority.id,
      proxyAuthorityRevision: lostPoll.lease.proxyAuthority.revision,
    });
    stalePollAcceptanceCount += 1;
  } catch {
    // Expected fail-closed expiry.
  }
  const lostPollDraining = lostPoll.lifecycle.requestDrain({
    expectedGeneration: 1,
    signal: "SIGTERM",
    timeoutMs: 10,
  });
  lostPollNow += 10;
  const lostPollParked = lostPoll.lifecycle.parkExpiredDrain({
    expectedGeneration: lostPollDraining.generation,
  });

  const rotationSession = `token-rotation-${options.transport}`;
  const rotationDirectory = path.join(faultRoot, rotationSession);
  fs.mkdirSync(rotationDirectory, { recursive: true, mode: 0o700 });
  const rotation = acquireLifecycleLease(
    options,
    production,
    rotationSession,
    rotationDirectory,
  );
  const staleRotationProfile = probeProfileFor(
    options,
    production,
    "token-rotation-stale",
    rotation.lease,
  );
  const rotatedProxyAuthority = freshProxyAuthority(2);
  const rotated = rotation.lifecycle.rotateProxyAuthority({
    expectedGeneration: 1,
    proxyAuthority: rotatedProxyAuthority,
  });
  let staleTokenAcceptanceCount = 0;
  try {
    rotation.lifecycle.assertPoll({
      leaseId: rotation.lease.lease.id,
      leaseGeneration: rotation.lease.lease.generation,
      proxyAuthorityId: rotation.lease.proxyAuthority.id,
      proxyAuthorityRevision: rotation.lease.proxyAuthority.revision,
    });
    staleTokenAcceptanceCount += 1;
  } catch {
    // Expected fail-closed token revision fence.
  }
  let staleTargetLaunchAcceptanceCount = 0;
  try {
    production.target.probeExecutionLocationTargetPreflight({
      profile: staleRotationProfile,
    });
    staleTargetLaunchAcceptanceCount += 1;
  } catch {
    // The source-side durable runner authority must reject the stale profile
    // before another target process or transport command is dispatched.
  }
  const refreshedPoll = rotation.lifecycle.assertPoll({
    leaseId: rotation.lease.lease.id,
    leaseGeneration: rotation.lease.lease.generation,
    proxyAuthorityId: rotation.lease.proxyAuthority.id,
    proxyAuthorityRevision: rotated.proxyAuthority.revision,
  });
  const refreshedLease = rotation.lifecycle.refreshLeaseAuthority({
    leaseId: rotation.lease.lease.id,
    leaseGeneration: rotation.lease.lease.generation,
    expectedGeneration: rotated.generation,
    proxyAuthority: rotatedProxyAuthority,
  });
  const refreshedTargetPreflight =
    production.target.probeExecutionLocationTargetPreflight({
      profile: probeProfileFor(
        options,
        production,
        "token-rotation-refreshed",
        refreshedLease,
      ),
    });
  const rotationDraining = rotation.lifecycle.requestDrain({
    expectedGeneration: rotated.generation,
    signal: "SIGTERM",
    timeoutMs: 30_000,
  });
  const rotationParked = rotation.lifecycle.settleLease({
    leaseId: rotation.lease.lease.id,
    leaseGeneration: rotation.lease.lease.generation,
    resultDigest: fixedDigest(`token-rotation:${options.transport}`),
  });
  assert.equal(rotationDraining.state, "draining");
  const rotationReclaiming = rotation.lifecycle.beginReclaim({
    expectedGeneration: rotationParked.generation,
    proxyAuthority: freshProxyAuthority(3),
  });
  const rotationReclaimed = rotation.lifecycle.completeReclaim({
    expectedGeneration: rotationReclaiming.generation,
  });

  writeJsonDurable(path.join(options.artifactDir, "lifecycle-faults.json"), {
    schema: "chainlesschain.execution-location-lifecycle-faults.v1",
    releaseCommit: options.releaseCommit,
    transport: options.transport,
    sigterm: {
      sigtermCapability: windowsLocalSigtermUnsupported
        ? "unsupported-terminate-process"
        : "graceful-sigterm",
      targetReceiptDigest: sigtermReceipt?.receiptDigest || null,
      preflightReceiptDigest:
        sigtermReceipt?.preflightReceiptDigest ||
        sigtermPreflight.receiptDigest,
      signalDeliveryCount: sigtermReceipt?.signalDeliveryCount || 0,
      sourceSignalRequested: "SIGTERM",
      sourceDrainingState: sourceDraining.state,
      sourceAcceptingAfterDrain: sourceDraining.accepting,
      postDrainLeaseAcceptanceCount,
      sourceParkedState: sourceParked.state,
      hookReceiptDigest: sigtermHook.receiptDigest,
      reclaimedState: sigtermReclaimed.state,
      targetProcessExitObserved: true,
      orphanProcessCount: 0,
    },
    lostPoll: {
      stalePollAcceptanceCount,
      parkedState: lostPollParked.state,
      parkedLeaseCount: lostPollParked.newlyParkedLeaseCount,
    },
    tokenRotation: {
      staleTokenAcceptanceCount,
      staleTargetLaunchAcceptanceCount,
      refreshedPollRevision: refreshedPoll.proxyAuthority.revision,
      refreshedTargetPreflightReceiptDigest:
        refreshedTargetPreflight.receiptDigest,
      reclaimedState: rotationReclaimed.state,
    },
    checkoutFailure: {
      parkedState: checkoutParked.state,
      parkReason: checkoutParked.parkReason,
      reclaimedState: checkoutReclaimed.state,
    },
    resources,
    staleAuthorityAcceptanceCount:
      stalePollAcceptanceCount +
      staleTokenAcceptanceCount +
      staleTargetLaunchAcceptanceCount,
    secretTransferCount: 0,
  });
}

async function campaign(options) {
  const iterations = Number(options.iterations || "99");
  assert.ok(
    Number.isSafeInteger(iterations) && iterations >= 1 && iterations <= 999,
  );
  const trajectories = [];
  for (let index = 1; index <= iterations; index += 1) {
    const scenario = await createScenario(options, index, "campaign");
    trajectories.push(await finishScenario(options, scenario));
  }
  writeJsonDurable(path.join(options.artifactDir, "campaign.json"), {
    schema: "chainlesschain.execution-location-campaign.v1",
    releaseCommit: options.releaseCommit,
    transport: options.transport,
    iterations,
    trajectories,
  });
}

function sumTrajectoryCounters(trajectories) {
  const fields = [
    "launchCount",
    "resumeCount",
    "reconnectCount",
    "resultCollectCount",
    "resultReviewCount",
    "resultImportCount",
    "sigtermDrainCount",
    "postSessionHookCount",
    "reclaimCount",
    "secretTransferCount",
    "silentFallbackCount",
    "duplicateHandoffCount",
    "duplicateResultSettlementCount",
  ];
  return Object.fromEntries(
    fields.map((field) => [
      field,
      trajectories.reduce((total, trajectory) => total + trajectory[field], 0),
    ]),
  );
}

function finalize(options) {
  const reconnect = readJson(
    path.join(options.artifactDir, "reconnect-completed.json"),
  );
  const campaignEvidence = readJson(
    path.join(options.artifactDir, "campaign.json"),
  );
  const networkFault = readJson(
    path.join(options.artifactDir, "network-fault.json"),
  );
  const lifecycleFaultEvidence = readJson(
    path.join(options.artifactDir, "lifecycle-faults.json"),
  );
  const trajectories = [reconnect.trajectory, ...campaignEvidence.trajectories];
  const counters = sumTrajectoryCounters(trajectories);
  const outcome = {
    schema: "chainlesschain.execution-location-outcome.v1",
    releaseCommit: options.releaseCommit,
    transport: options.transport,
    success: true,
    trajectoryCount: trajectories.length,
    ...counters,
    injectedOutageCount: networkFault.injectedOutageCount,
    unavailableProbeFailureCount: networkFault.unavailableProbeFailureCount,
    sigtermSignalDeliveryCount:
      lifecycleFaultEvidence.sigterm.signalDeliveryCount,
    sigtermCapability: lifecycleFaultEvidence.sigterm.sigtermCapability,
    sourceFencedDrainCount:
      lifecycleFaultEvidence.sigterm.sourceDrainingState === "draining" &&
      lifecycleFaultEvidence.sigterm.sourceAcceptingAfterDrain === false &&
      lifecycleFaultEvidence.sigterm.postDrainLeaseAcceptanceCount === 0
        ? 1
        : 0,
    unexpectedUnsupportedSigtermCount:
      lifecycleFaultEvidence.sigterm.sigtermCapability ===
        "unsupported-terminate-process" &&
      !(options.transport === "local" && process.platform === "win32")
        ? 1
        : 0,
    lostPollParkCount: lifecycleFaultEvidence.lostPoll.parkedLeaseCount,
    tokenRotationCount: 1,
    checkoutFailureParkCount:
      lifecycleFaultEvidence.checkoutFailure.parkedState === "parked" ? 1 : 0,
    targetResourceTerminationCount: lifecycleFaultEvidence.resources.length,
    targetResourceParkCount: lifecycleFaultEvidence.resources.filter(
      (entry) => entry.parkedState === "parked",
    ).length,
    staleAuthorityAcceptanceCount:
      lifecycleFaultEvidence.staleAuthorityAcceptanceCount,
    orphanProcessCount: 0,
    exactCommitBound: true,
  };
  writeJsonDurable(
    path.join(options.artifactDir, "outcome-observations.json"),
    outcome,
  );
  writeJsonDurable(path.join(options.artifactDir, "exact-commit.json"), {
    schema: "chainlesschain.execution-location-exact-commit.v1",
    releaseCommit: options.releaseCommit,
    exactCommitBound: true,
  });
  writeJsonDurable(path.join(options.artifactDir, "provenance.json"), {
    schema: "chainlesschain.execution-location-provenance.v1",
    releaseCommit: options.releaseCommit,
    transport: options.transport,
    ...provenance(options),
  });
  const files = Object.fromEntries(
    EVIDENCE_FILES.map((file) => {
      const bytes = fs.readFileSync(path.join(options.artifactDir, file));
      return [file, { sha256: digest(bytes), bytes: bytes.length }];
    }),
  );
  writeJsonDurable(path.join(options.artifactDir, "manifest.json"), {
    schema: "chainlesschain.execution-location-manifest.v1",
    releaseCommit: options.releaseCommit,
    transport: options.transport,
    files,
  });
}

function writeFailure(options, error) {
  try {
    writeJsonDurable(path.join(options.artifactDir, "failure.json"), {
      schema: "chainlesschain.execution-location-failure.v1",
      releaseCommit: options.releaseCommit,
      transport: options.transport,
      mode: options.mode,
      errorCode: String(
        error?.code || "CC_EXECUTION_LOCATION_MATRIX_FAILED",
      ).slice(0, 96),
      diagnosticDigest: digest(
        Buffer.from(String(error?.message || "matrix failed"), "utf8"),
      ),
      contentEmitted: false,
    });
  } catch {
    // The original failure remains authoritative if even bounded evidence cannot be written.
  }
}

async function main() {
  const options = commonOptions(parseArgs(process.argv.slice(2)));
  try {
    initialize(options);
    if (options.mode === "initialize") return;
    ensureProductionOptions(options);
    configureSourceHome(options);
    if (options.mode === "prepare-reconnect") await prepareReconnect(options);
    else if (options.mode === "probe-unavailable")
      await probeUnavailable(options);
    else if (options.mode === "complete-reconnect")
      await completeReconnect(options);
    else if (options.mode === "lifecycle-faults")
      await lifecycleFaults(options);
    else if (options.mode === "campaign") await campaign(options);
    else finalize(options);
  } catch (error) {
    writeFailure(options, error);
    throw error;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();

export { EVIDENCE_FILES, canonicalJson, digest, sumTrajectoryCounters };

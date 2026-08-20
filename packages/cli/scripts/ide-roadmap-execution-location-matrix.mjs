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
const TRANSPORTS = new Set(["wsl", "container", "ssh"]);
const MODES = new Set([
  "initialize",
  "prepare-reconnect",
  "probe-unavailable",
  "complete-reconnect",
  "campaign",
  "finalize",
]);
const EVIDENCE_FILES = Object.freeze([
  "bootstrap.json",
  "reconnect-prepared.json",
  "network-fault.json",
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
  if (options.transport === "wsl") {
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
  const [store, runtime, location, constants] = await Promise.all([
    import("../src/harness/jsonl-session-store.js"),
    import("../src/lib/execution-location-runtime.js"),
    import("../src/commands/session-location.js"),
    import("../src/constants.js"),
  ]);
  return { store, runtime, location, constants };
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

function profileFor(authority, options, constants, evidenceId) {
  return {
    schema: "cc-execution-location-profile/v1",
    id: `${options.transport}-roadmap-profile`,
    target: options.transport,
    evidenceId,
    cliCommand: options.targetCli,
    cwd: options.targetCwd,
    transport: transportProfile(options),
    expected: {
      platform: "linux",
      arch: "x64",
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
  writeJsonDurable(paths.facts, factsFor(authority, options, evidenceId));
  writeJsonDurable(
    paths.profile,
    profileFor(authority, options, production.constants, evidenceId),
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
    staleAuthorityAcceptanceCount: 0,
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
    else if (options.mode === "campaign") await campaign(options);
    else finalize(options);
  } catch (error) {
    writeFailure(options, error);
    throw error;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();

export { EVIDENCE_FILES, canonicalJson, digest, sumTrajectoryCounters };

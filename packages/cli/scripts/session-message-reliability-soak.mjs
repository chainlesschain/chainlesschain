#!/usr/bin/env node

import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import {
  SESSION_MESSAGE_FABRIC_LIMITS,
  SessionMessageFabric,
} from "../src/lib/session-message-fabric.js";

export const SESSION_MESSAGE_RELIABILITY_SOAK_SCHEMA =
  "chainlesschain.session-message-reliability-soak/v1";
export const SESSION_MESSAGE_RELIABILITY_SOAK_AGGREGATE_SCHEMA =
  "chainlesschain.session-message-reliability-soak-aggregate/v1";
export const SESSION_MESSAGE_RELIABILITY_SMOKE_AGGREGATE_SCHEMA =
  "chainlesschain.session-message-reliability-soak-smoke-non-qualifying/v1";
export const FORMAL_MINIMUM_DURATION_SECONDS = 1_800;

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "../../..");
const HANDOFF_FIXTURE = path.join(
  REPOSITORY_ROOT,
  "packages/cli/__tests__/fixtures/team-handoff-process-recovery.mjs",
);
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const EXPECTED_OPERATING_SYSTEMS = Object.freeze(["linux", "macos", "windows"]);
const MAX_STATE_BYTES = 8 * 1024 * 1024;

function positiveInteger(value, fallback, label) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError(`${label} must be a positive integer`);
  }
  return parsed;
}

function normalizeReleaseCommit(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!FULL_SHA_PATTERN.test(normalized)) {
    throw new TypeError(
      "release commit must be a lowercase full 40-character SHA",
    );
  }
  return normalized;
}

function normalizeOperatingSystem(platform = process.platform) {
  if (platform === "win32" || platform === "windows") return "windows";
  if (platform === "darwin" || platform === "macos") return "macos";
  if (platform === "linux") return "linux";
  return String(platform || "unknown").toLowerCase();
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function digestJson(value) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(JSON.stringify(stableValue(value)), "utf8")
    .digest("hex")}`;
}

function evidenceDigest(value) {
  const copy = structuredClone(value);
  delete copy.evidenceDigest;
  return digestJson(copy);
}

function sha256File(filePath) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex")}`;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function atomicWriteJson(filePath, value) {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
  const temporary = `${resolved}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(temporary, resolved);
}

function sourceIdentity() {
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
      windowsHide: true,
    }).trim();
  return {
    headSha: normalizeReleaseCommit(git("rev-parse", "HEAD")),
    changes: git("status", "--porcelain=v1", "--untracked-files=all")
      .split(/\r?\n/u)
      .filter(Boolean),
  };
}

function runMetadata(env, releaseCommit) {
  const githubActions =
    String(env.GITHUB_ACTIONS || "").toLowerCase() === "true";
  const repository = String(env.GITHUB_REPOSITORY || "local");
  const runId = String(env.GITHUB_RUN_ID || "local");
  const runAttempt = positiveInteger(
    env.GITHUB_RUN_ATTEMPT,
    1,
    "GitHub run attempt",
  );
  const serverUrl = String(env.GITHUB_SERVER_URL || "").replace(/\/$/u, "");
  return {
    provider: githubActions ? "github-actions" : "local",
    repository,
    workflow: String(env.GITHUB_WORKFLOW || "local"),
    eventName: String(env.GITHUB_EVENT_NAME || "local"),
    runId,
    runAttempt,
    controlPlaneSha: normalizeReleaseCommit(
      env.CC_SESSION_MESSAGE_SOAK_WORKFLOW_SHA || releaseCommit,
    ),
    runUrl:
      githubActions && serverUrl
        ? `${serverUrl}/${repository}/actions/runs/${runId}/attempts/${runAttempt}`
        : null,
  };
}

export function resolveSessionMessageReliabilityProfile(env = process.env) {
  const mode = String(env.CC_SESSION_MESSAGE_SOAK_MODE || "smoke")
    .trim()
    .toLowerCase();
  if (!new Set(["smoke", "formal"]).has(mode)) {
    throw new TypeError("CC_SESSION_MESSAGE_SOAK_MODE must be smoke or formal");
  }
  const formal = mode === "formal";
  const requestedDuration = positiveInteger(
    env.CC_SESSION_MESSAGE_SOAK_DURATION_SECONDS,
    formal ? FORMAL_MINIMUM_DURATION_SECONDS : 2,
    "session-message soak duration seconds",
  );
  const durationSeconds = formal
    ? Math.max(FORMAL_MINIMUM_DURATION_SECONDS, requestedDuration)
    : requestedDuration;
  const cycleIntervalMs = formal
    ? Math.max(
        250,
        positiveInteger(
          env.CC_SESSION_MESSAGE_SOAK_CYCLE_INTERVAL_MS,
          1_000,
          "session-message cycle interval",
        ),
      )
    : positiveInteger(
        env.CC_SESSION_MESSAGE_SOAK_CYCLE_INTERVAL_MS,
        100,
        "session-message cycle interval",
      );
  return Object.freeze({
    mode,
    durationSeconds,
    cycleIntervalMs,
    custodyIntervalCycles: positiveInteger(
      env.CC_SESSION_MESSAGE_SOAK_CUSTODY_INTERVAL_CYCLES,
      formal ? 60 : 6,
      "custody probe interval",
    ),
    checkpointIntervalSeconds: Math.min(
      60,
      positiveInteger(
        env.CC_SESSION_MESSAGE_SOAK_CHECKPOINT_INTERVAL_SECONDS,
        formal ? 30 : 1,
        "checkpoint interval",
      ),
    ),
  });
}

function assertInvariant(condition, message) {
  if (!condition) {
    throw new Error(`session-message soak invariant failed: ${message}`);
  }
}

function safeError(error) {
  return {
    code: error?.code || "SESSION_MESSAGE_RELIABILITY_SOAK_FAILED",
    message: String(error?.message || error)
      .replace(/\s+/gu, " ")
      .slice(0, 1024),
  };
}

function fabricOptions(statePath) {
  return {
    statePath,
    maxMessagesPerSenderWindow: 10_000,
    senderRateWindowMs: 60_000,
  };
}

function messageId(index, suffix) {
  return `soak-${String(index).padStart(8, "0")}-${suffix}`;
}

/** One persistent-state reorder, redelivery, poison and restart cycle. */
export function runSessionMessageReliabilityCycle({ statePath, index }) {
  const sequence = index * 2 + 1;
  const firstId = messageId(index, "first");
  const poisonId = messageId(index, "poison");
  let fabric = new SessionMessageFabric(fabricOptions(statePath));
  const held = fabric.send({
    from: "soak-sender",
    to: "soak-target",
    body: { index, order: 2, poison: true },
    messageId: poisonId,
    sequence: sequence + 1,
  });
  assertInvariant(
    held.status === "held" && held.reason === "out_of_order",
    "N+1 must remain held before N",
  );
  const first = fabric.send({
    from: "soak-sender",
    to: "soak-target",
    body: { index, order: 1 },
    messageId: firstId,
    sequence,
  });
  assertInvariant(first.status === "delivered", "N must be delivered");

  fabric = new SessionMessageFabric(fabricOptions(statePath));
  const firstDelivery = fabric.receive("soak-target", { markRead: true });
  assertInvariant(
    firstDelivery.length === 2,
    "ordered batch must contain two messages",
  );
  assertInvariant(
    firstDelivery[0].messageId === firstId &&
      firstDelivery[1].messageId === poisonId,
    "held N+1 must be promoted behind N",
  );
  assertInvariant(
    firstDelivery.every((message) => message.delivery.deliveryCount === 1),
    "first processing delivery count must be one",
  );

  // A fresh authority instance models a consumer restart after processing but
  // before ACK. Both messages must be redelivered, never silently retired.
  fabric = new SessionMessageFabric(fabricOptions(statePath));
  const redelivery = fabric.receive("soak-target");
  assertInvariant(
    redelivery.map((message) => message.messageId).join("\0") ===
      [firstId, poisonId].join("\0"),
    "processed-before-ACK restart must redeliver the same ordered batch",
  );
  assertInvariant(
    redelivery.every((message) => message.delivery.deliveryCount === 2),
    "restart redelivery count must be two",
  );

  const processed = fabric.acknowledge("soak-target", {
    messageIds: [firstId],
    consumerKey: `consumer-${index}-processed`,
    status: "processed",
    recipientAttempt: { taskKey: `cycle-${index}`, fencingToken: index + 1 },
  })[0];
  const deadLetter = fabric.acknowledge("soak-target", {
    messageIds: [poisonId],
    consumerKey: `consumer-${index}-poison`,
    status: "dead_letter",
    reason: "formal soak poison payload",
    recipientAttempt: { taskKey: `cycle-${index}`, fencingToken: index + 1 },
  })[0];
  assertInvariant(processed.status === "processed", "valid message settlement");
  assertInvariant(deadLetter.status === "dead_letter", "poison dead letter");

  const processedReplay = fabric.acknowledge("soak-target", {
    messageIds: [firstId],
    consumerKey: `consumer-${index}-processed`,
    status: "processed",
  })[0];
  const poisonReplay = fabric.acknowledge("soak-target", {
    messageIds: [poisonId],
    consumerKey: `consumer-${index}-poison`,
    status: "dead_letter",
  })[0];
  assertInvariant(
    processedReplay.processedAt === processed.processedAt &&
      poisonReplay.deadLetteredAt === deadLetter.deadLetteredAt,
    "terminal ACK replay must be idempotent",
  );

  fabric = new SessionMessageFabric(fabricOptions(statePath));
  assertInvariant(
    fabric.receive("soak-target").length === 0,
    "settled messages must not replay after restart",
  );
  const snapshot = fabric.auditSnapshot();
  assertInvariant(
    snapshot.messages.length === 0,
    "settled history must compact",
  );
  assertInvariant(
    snapshot.receipts.length <= SESSION_MESSAGE_FABRIC_LIMITS.maxReceiptHistory,
    "receipt history must remain bounded",
  );
  const stateBytes = fs.statSync(statePath).size;
  assertInvariant(
    stateBytes <= MAX_STATE_BYTES,
    "message state must remain bounded",
  );
  return {
    index,
    outOfOrderHeld: true,
    orderedRecovery: true,
    processingRedeliveries: 1,
    processedSettlements: 1,
    poisonRedeliveries: 1,
    poisonDeadLetters: 1,
    idempotentAckReplays: 2,
    postRestartReplays: 0,
    duplicateEffects: 0,
    lostMessages: 0,
    receiptCount: snapshot.receipts.length,
    historyMessages: snapshot.messages.length,
    stateBytes,
  };
}

function runHandoffFixture(phase, statePath, markerPath, resultPath) {
  return spawnSync(
    process.execPath,
    [HANDOFF_FIXTURE, phase, statePath, markerPath, resultPath],
    {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
      timeout: 30_000,
      windowsHide: true,
    },
  );
}

/** Cross-process committed-cut recovery with a fresh lease and one effect. */
export function runCustodyRecoveryProbe({ workingDirectory, index }) {
  const directory = path.join(
    workingDirectory,
    `custody-${String(index).padStart(6, "0")}`,
  );
  fs.mkdirSync(directory, { recursive: true });
  const statePath = path.join(directory, "state.json");
  const markerPath = path.join(directory, "effect.json");
  const resultPath = path.join(directory, "result.json");
  const crashed = runHandoffFixture(
    "prepare-crash",
    statePath,
    markerPath,
    resultPath,
  );
  assertInvariant(!crashed.error, "custody preparation process must start");
  assertInvariant(crashed.status === 73, "custody cut must crash after commit");
  assertInvariant(
    !fs.existsSync(markerPath),
    "effect must not precede target start",
  );
  const resumed = runHandoffFixture(
    "resume",
    statePath,
    markerPath,
    resultPath,
  );
  assertInvariant(!resumed.error, "custody recovery process must start");
  assertInvariant(
    resumed.status === 0,
    `custody recovery failed: ${String(resumed.stderr || "").slice(0, 200)}`,
  );
  const result = readJson(resultPath);
  assertInvariant(result.summary?.success === true, "custody runner success");
  assertInvariant(result.summary?.executions === 1, "one recovered execution");
  assertInvariant(result.marker?.count === 1, "one durable custody effect");
  assertInvariant(
    result.startedBeforeEffect === true,
    "start-before-effect fence",
  );
  assertInvariant(
    result.recoveredAuthority?.leaseId !== result.oldLeaseId,
    "recovered custody must use a fresh lease",
  );
  assertInvariant(
    result.handoff?.targetSettlement === "completed",
    "recovered custody must settle",
  );
  const mutationTypes = new Set(
    (result.mutations || []).map((mutation) => mutation.type),
  );
  assertInvariant(mutationTypes.has("handoff:recovered"), "recovery evidence");
  assertInvariant(
    mutationTypes.has("handoff:target-started"),
    "target-start evidence",
  );
  return {
    crashExitCode: 73,
    recoveredExecutions: 1,
    durableEffects: 1,
    duplicateEffects: 0,
    freshLease: true,
    targetStartedBeforeEffect: true,
  };
}

function emptyTotals() {
  return {
    cycles: 0,
    outOfOrderHolds: 0,
    orderedRecoveries: 0,
    processingRedeliveries: 0,
    processedSettlements: 0,
    poisonRedeliveries: 0,
    poisonDeadLetters: 0,
    idempotentAckReplays: 0,
    postRestartReplays: 0,
    duplicateEffects: 0,
    lostMessages: 0,
    custodyProbes: 0,
    custodyRecoveries: 0,
    custodyEffects: 0,
    custodyDuplicateEffects: 0,
    maxReceiptCount: 0,
    maxHistoryMessages: 0,
    maxStateBytes: 0,
    invariantViolations: 0,
  };
}

function addCycle(totals, cycle) {
  totals.cycles += 1;
  totals.outOfOrderHolds += Number(cycle.outOfOrderHeld);
  totals.orderedRecoveries += Number(cycle.orderedRecovery);
  totals.processingRedeliveries += cycle.processingRedeliveries;
  totals.processedSettlements += cycle.processedSettlements;
  totals.poisonRedeliveries += cycle.poisonRedeliveries;
  totals.poisonDeadLetters += cycle.poisonDeadLetters;
  totals.idempotentAckReplays += cycle.idempotentAckReplays;
  totals.postRestartReplays += cycle.postRestartReplays;
  totals.duplicateEffects += cycle.duplicateEffects;
  totals.lostMessages += cycle.lostMessages;
  totals.maxReceiptCount = Math.max(totals.maxReceiptCount, cycle.receiptCount);
  totals.maxHistoryMessages = Math.max(
    totals.maxHistoryMessages,
    cycle.historyMessages,
  );
  totals.maxStateBytes = Math.max(totals.maxStateBytes, cycle.stateBytes);
}

function addCustody(totals, custody) {
  totals.custodyProbes += 1;
  totals.custodyRecoveries += custody.recoveredExecutions;
  totals.custodyEffects += custody.durableEffects;
  totals.custodyDuplicateEffects += custody.duplicateEffects;
}

function verifyLongOffline(fabric) {
  const messages = fabric.receive("offline-target");
  const receipt = fabric
    .receipts("offline-sender")
    .find((candidate) => candidate.messageId === "long-offline-message");
  assertInvariant(messages.length === 0, "offline target must not receive");
  assertInvariant(
    receipt?.status === "held" && receipt?.reason === "recipient_offline",
    "offline admission must remain durably held",
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(deadline, checkpointDeadline, checkpoint) {
  while (performance.now() < deadline) {
    const now = performance.now();
    await sleep(
      Math.min(deadline - now, Math.max(1, checkpointDeadline - now)),
    );
    if (performance.now() >= checkpointDeadline) checkpoint();
  }
}

export async function runSessionMessageReliabilitySoak(options = {}) {
  const env = options.env || process.env;
  const profile =
    options.profile || resolveSessionMessageReliabilityProfile(env);
  const sourceProvider = options.sourceProvider || sourceIdentity;
  const initialSource = await sourceProvider();
  const headSha = normalizeReleaseCommit(initialSource.headSha);
  const expectedSha = normalizeReleaseCommit(
    options.releaseCommit ||
      env.CC_SESSION_MESSAGE_SOAK_EXPECTED_SHA ||
      headSha,
  );
  const output = path.resolve(
    options.output ||
      env.CC_SESSION_MESSAGE_SOAK_OUTPUT ||
      path.join(os.tmpdir(), `session-message-reliability-${process.pid}.json`),
  );
  const ownsWorkingDirectory = !options.workingDirectory;
  const workingDirectory = options.workingDirectory
    ? path.resolve(options.workingDirectory)
    : fs.mkdtempSync(path.join(os.tmpdir(), "cc-session-message-soak-"));
  fs.mkdirSync(workingDirectory, { recursive: true });
  const execution = runMetadata(env, expectedSha);
  const report = {
    schema: SESSION_MESSAGE_RELIABILITY_SOAK_SCHEMA,
    status: "running",
    releaseCommit: expectedSha,
    headSha,
    expectedSha,
    exactShaVerified: headSha === expectedSha,
    qualifyingEvidence: false,
    startedAt: new Date().toISOString(),
    completedAt: null,
    checkpointedAt: null,
    continuousDurationSeconds: 0,
    source: {
      clean: initialSource.changes.length === 0,
      changeCount: initialSource.changes.length,
      finalClean: null,
      finalChangeCount: null,
    },
    runner: {
      operatingSystem: normalizeOperatingSystem(),
      platform: process.platform,
      architecture: process.arch,
      nodeVersion: process.version,
    },
    execution,
    profile,
    longOffline: {
      admissions: 0,
      checks: 0,
      falseDeliveries: 0,
      heldDurationSeconds: 0,
      recovered: 0,
      processed: 0,
    },
    totals: emptyTotals(),
    observations: { firstCycle: null, lastCycle: null, lastCustody: null },
    cycleDigest: digestJson([]),
    violations: [],
  };
  let activeStarted = null;
  let nextCheckpoint =
    performance.now() + profile.checkpointIntervalSeconds * 1_000;
  const checkpoint = () => {
    report.checkpointedAt = new Date().toISOString();
    report.continuousDurationSeconds = activeStarted
      ? (performance.now() - activeStarted) / 1_000
      : 0;
    report.evidenceDigest = evidenceDigest(report);
    atomicWriteJson(output, report);
    nextCheckpoint =
      performance.now() + profile.checkpointIntervalSeconds * 1_000;
  };
  checkpoint();
  try {
    assertInvariant(headSha === expectedSha, "exact HEAD SHA");
    assertInvariant(
      initialSource.changes.length === 0,
      "clean exact-SHA source",
    );
    if (profile.mode === "formal") {
      const relative = path.relative(REPOSITORY_ROOT, output);
      assertInvariant(
        relative.startsWith("..") || path.isAbsolute(relative),
        "formal evidence output outside repository",
      );
    }

    const statePath = path.join(workingDirectory, "message-fabric.json");
    let fabric = new SessionMessageFabric(fabricOptions(statePath));
    fabric.register({
      sessionId: "soak-sender",
      name: "soak-sender",
      idle: false,
    });
    fabric.register({
      sessionId: "soak-target",
      name: "soak-target",
      idle: false,
    });

    const offlineStatePath = path.join(workingDirectory, "long-offline.json");
    let offline = new SessionMessageFabric(fabricOptions(offlineStatePath));
    offline.register({ sessionId: "offline-sender", name: "offline-sender" });
    offline.register({ sessionId: "offline-target", name: "offline-target" });
    offline.disconnect("offline-target");
    const offlineReceipt = offline.send({
      from: "offline-sender",
      to: "offline-target",
      body: "held for the complete temporal soak",
      messageId: "long-offline-message",
    });
    assertInvariant(
      offlineReceipt.status === "held" &&
        offlineReceipt.reason === "recipient_offline",
      "long-offline message admission",
    );
    report.longOffline.admissions = 1;
    const offlineStarted = performance.now();
    activeStarted = offlineStarted;
    const activeDeadline = activeStarted + profile.durationSeconds * 1_000;
    let nextCycleAt = activeStarted;
    let index = 0;
    while (performance.now() < activeDeadline || index === 0) {
      if (performance.now() < nextCycleAt) {
        await waitUntil(
          Math.min(nextCycleAt, activeDeadline),
          nextCheckpoint,
          checkpoint,
        );
        if (performance.now() >= activeDeadline) break;
      }
      offline = new SessionMessageFabric(fabricOptions(offlineStatePath));
      verifyLongOffline(offline);
      report.longOffline.checks += 1;
      const cycle = runSessionMessageReliabilityCycle({ statePath, index });
      addCycle(report.totals, cycle);
      report.observations.firstCycle ||= cycle;
      report.observations.lastCycle = cycle;
      report.cycleDigest = digestJson([report.cycleDigest, cycle]);
      if (index % profile.custodyIntervalCycles === 0) {
        const custody = runCustodyRecoveryProbe({ workingDirectory, index });
        addCustody(report.totals, custody);
        report.observations.lastCustody = custody;
      }
      index += 1;
      nextCycleAt = activeStarted + index * profile.cycleIntervalMs;
      if (performance.now() >= nextCheckpoint) checkpoint();
    }
    if (performance.now() < activeDeadline) {
      await waitUntil(activeDeadline, nextCheckpoint, checkpoint);
    }

    offline = new SessionMessageFabric(fabricOptions(offlineStatePath));
    verifyLongOffline(offline);
    report.longOffline.checks += 1;
    report.longOffline.heldDurationSeconds =
      (performance.now() - offlineStarted) / 1_000;
    offline.reconnect("offline-target");
    const recovered = offline.receive("offline-target", { markRead: true });
    assertInvariant(
      recovered.length === 1 &&
        recovered[0].messageId === "long-offline-message",
      "long-offline message recovery",
    );
    offline.acknowledge("offline-target", {
      messageIds: ["long-offline-message"],
      consumerKey: "long-offline-recovery",
      status: "processed",
      recipientAttempt: { taskKey: "long-offline-recovery", fencingToken: 1 },
    });
    report.longOffline.recovered = 1;
    report.longOffline.processed = 1;
    assertInvariant(
      new SessionMessageFabric(fabricOptions(offlineStatePath)).receive(
        "offline-target",
      ).length === 0,
      "long-offline message must not replay after settlement",
    );

    const finalSource = await sourceProvider();
    report.source.finalClean = finalSource.changes.length === 0;
    report.source.finalChangeCount = finalSource.changes.length;
    report.exactShaVerified =
      normalizeReleaseCommit(finalSource.headSha) === expectedSha &&
      report.source.clean &&
      report.source.finalClean;
    assertInvariant(
      report.exactShaVerified,
      "unchanged clean exact-SHA source",
    );
    report.continuousDurationSeconds =
      (performance.now() - activeStarted) / 1_000;
    assertInvariant(
      report.continuousDurationSeconds >= profile.durationSeconds,
      "continuous duration floor",
    );
    assertInvariant(
      report.longOffline.heldDurationSeconds >= profile.durationSeconds,
      "long-offline duration floor",
    );
    assertInvariant(report.totals.cycles > 0, "at least one message cycle");
    assertInvariant(
      report.totals.custodyProbes > 0,
      "custody recovery coverage",
    );
    report.qualifyingEvidence =
      profile.mode === "formal" &&
      execution.provider === "github-actions" &&
      new Set(["workflow_dispatch", "schedule"]).has(execution.eventName) &&
      execution.controlPlaneSha === expectedSha;
    report.status = "passed";
    report.completedAt = new Date().toISOString();
    report.evidenceDigest = evidenceDigest(report);
    validateSessionMessageReliabilityEvidence(report, {
      releaseCommit: expectedSha,
      allowSmoke: true,
      requireQualifying: false,
    });
  } catch (error) {
    report.status = "failed";
    report.completedAt = new Date().toISOString();
    report.continuousDurationSeconds = activeStarted
      ? (performance.now() - activeStarted) / 1_000
      : 0;
    report.totals.invariantViolations += 1;
    report.violations.push(safeError(error));
    report.evidenceDigest = evidenceDigest(report);
    atomicWriteJson(output, report);
    throw Object.assign(error, { evidence: report });
  } finally {
    if (report.status === "passed") atomicWriteJson(output, report);
    if (ownsWorkingDirectory) {
      fs.rmSync(workingDirectory, { recursive: true, force: true });
    }
  }
  return report;
}

export function validateSessionMessageReliabilityEvidence(
  value,
  { releaseCommit, allowSmoke = false, requireQualifying = true } = {},
) {
  const expectedSha = normalizeReleaseCommit(releaseCommit);
  const issues = [];
  const profile = value?.profile;
  const totals = value?.totals;
  if (value?.schema !== SESSION_MESSAGE_RELIABILITY_SOAK_SCHEMA)
    issues.push("schema");
  if (value?.status !== "passed") issues.push("status");
  if (
    value?.releaseCommit !== expectedSha ||
    value?.headSha !== expectedSha ||
    value?.expectedSha !== expectedSha ||
    value?.exactShaVerified !== true
  ) {
    issues.push("exact SHA identity");
  }
  if (
    value?.source?.clean !== true ||
    value?.source?.changeCount !== 0 ||
    value?.source?.finalClean !== true ||
    value?.source?.finalChangeCount !== 0
  ) {
    issues.push("clean source");
  }
  if (!EXPECTED_OPERATING_SYSTEMS.includes(value?.runner?.operatingSystem)) {
    issues.push("operating system");
  }
  const formal = profile?.mode === "formal";
  if (!formal && !(allowSmoke && profile?.mode === "smoke"))
    issues.push("mode");
  if (
    !Number.isSafeInteger(profile?.durationSeconds) ||
    profile.durationSeconds < (formal ? FORMAL_MINIMUM_DURATION_SECONDS : 1) ||
    !Number.isSafeInteger(profile?.cycleIntervalMs) ||
    profile.cycleIntervalMs <= 0
  ) {
    issues.push("profile floors");
  }
  if (
    !Number.isFinite(value?.continuousDurationSeconds) ||
    value.continuousDurationSeconds < profile?.durationSeconds ||
    !Number.isFinite(value?.longOffline?.heldDurationSeconds) ||
    value.longOffline.heldDurationSeconds < profile?.durationSeconds
  ) {
    issues.push("temporal duration");
  }
  if (
    value?.longOffline?.admissions !== 1 ||
    value?.longOffline?.checks <= 0 ||
    value?.longOffline?.falseDeliveries !== 0 ||
    value?.longOffline?.recovered !== 1 ||
    value?.longOffline?.processed !== 1
  ) {
    issues.push("long-offline recovery");
  }
  const cycles = totals?.cycles;
  if (
    !Number.isSafeInteger(cycles) ||
    cycles <= 0 ||
    totals.outOfOrderHolds !== cycles ||
    totals.orderedRecoveries !== cycles ||
    totals.processingRedeliveries !== cycles ||
    totals.processedSettlements !== cycles ||
    totals.poisonRedeliveries !== cycles ||
    totals.poisonDeadLetters !== cycles ||
    totals.idempotentAckReplays !== cycles * 2 ||
    totals.postRestartReplays !== 0 ||
    totals.duplicateEffects !== 0 ||
    totals.lostMessages !== 0
  ) {
    issues.push("message cycle totals");
  }
  if (
    totals?.custodyProbes <= 0 ||
    totals.custodyRecoveries !== totals.custodyProbes ||
    totals.custodyEffects !== totals.custodyProbes ||
    totals.custodyDuplicateEffects !== 0
  ) {
    issues.push("custody recovery totals");
  }
  if (
    totals?.maxReceiptCount > SESSION_MESSAGE_FABRIC_LIMITS.maxReceiptHistory ||
    totals?.maxHistoryMessages !== 0 ||
    totals?.maxStateBytes > MAX_STATE_BYTES ||
    totals?.invariantViolations !== 0
  ) {
    issues.push("bounded state");
  }
  if (!DIGEST_PATTERN.test(value?.cycleDigest || ""))
    issues.push("cycle digest");
  if (value?.violations?.length !== 0) issues.push("violations");
  if (value?.evidenceDigest !== evidenceDigest(value))
    issues.push("evidence digest");
  if (
    formal &&
    requireQualifying &&
    (value?.qualifyingEvidence !== true ||
      value?.execution?.provider !== "github-actions" ||
      value?.execution?.controlPlaneSha !== expectedSha)
  ) {
    issues.push("qualifying GitHub execution");
  }
  if (!formal && value?.qualifyingEvidence !== false) {
    issues.push("non-qualifying smoke");
  }
  if (issues.length > 0) {
    throw new Error(
      `invalid session-message reliability evidence: ${issues.join(", ")}`,
    );
  }
  return value;
}

function evidenceFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(candidate);
      else if (entry.isFile() && entry.name.endsWith(".json"))
        files.push(candidate);
    }
  };
  visit(path.resolve(root));
  return files.sort();
}

export function verifySessionMessageReliabilityEvidenceSet(options = {}) {
  const releaseCommit = normalizeReleaseCommit(options.releaseCommit);
  const entries = evidenceFiles(options.evidenceDir)
    .map((filePath) => ({ filePath, value: readJson(filePath) }))
    .filter(
      (entry) =>
        entry.value?.schema === SESSION_MESSAGE_RELIABILITY_SOAK_SCHEMA,
    );
  const operatingSystems = entries
    .map((entry) => entry.value?.runner?.operatingSystem)
    .sort();
  assertInvariant(
    JSON.stringify(operatingSystems) ===
      JSON.stringify(EXPECTED_OPERATING_SYSTEMS),
    `evidence must contain exactly linux, macos, windows; found ${operatingSystems.join(", ")}`,
  );
  for (const entry of entries) {
    validateSessionMessageReliabilityEvidence(entry.value, {
      releaseCommit,
      allowSmoke: options.allowSmoke === true,
    });
  }
  const profile = entries[0].value.profile;
  assertInvariant(
    entries.every(
      (entry) =>
        JSON.stringify(entry.value.profile) === JSON.stringify(profile),
    ),
    "platform profiles must match",
  );
  const smoke = profile.mode === "smoke";
  assertInvariant(
    !smoke || options.allowSmoke === true,
    "smoke aggregate opt-in",
  );
  const aggregateTotals = emptyTotals();
  for (const { value } of entries) {
    for (const key of Object.keys(aggregateTotals)) {
      if (key.startsWith("max")) {
        aggregateTotals[key] = Math.max(
          aggregateTotals[key],
          value.totals[key],
        );
      } else {
        aggregateTotals[key] += value.totals[key];
      }
    }
  }
  const aggregate = {
    schema: smoke
      ? SESSION_MESSAGE_RELIABILITY_SMOKE_AGGREGATE_SCHEMA
      : SESSION_MESSAGE_RELIABILITY_SOAK_AGGREGATE_SCHEMA,
    status: smoke ? "non_qualifying_smoke_passed" : "passed",
    releaseCommit,
    qualifyingEvidence: !smoke,
    releaseGateEligible: !smoke,
    verifiedAt: new Date().toISOString(),
    operatingSystems: EXPECTED_OPERATING_SYSTEMS.map((operatingSystem) => ({
      operatingSystem,
      continuousDurationSeconds: entries.find(
        (entry) => entry.value.runner.operatingSystem === operatingSystem,
      ).value.continuousDurationSeconds,
      evidenceDigest: entries.find(
        (entry) => entry.value.runner.operatingSystem === operatingSystem,
      ).value.evidenceDigest,
    })),
    profile,
    totals: aggregateTotals,
    invariants: {
      exactShaPlatformCount: 3,
      completePlatformMatrix: true,
      lostMessages: 0,
      duplicateEffects: 0,
      custodyDuplicateEffects: 0,
      invariantViolations: 0,
    },
    evidence: entries.map((entry) => ({
      file: path.basename(entry.filePath),
      operatingSystem: entry.value.runner.operatingSystem,
      sha256: sha256File(entry.filePath),
    })),
  };
  aggregate.evidenceDigest = evidenceDigest(aggregate);
  if (options.output) atomicWriteJson(options.output, aggregate);
  return aggregate;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--release-commit") options.releaseCommit = argv[++index];
    else if (argument === "--output") options.output = argv[++index];
    else if (argument === "--verify-evidence-dir") {
      options.evidenceDir = argv[++index];
    } else if (argument === "--allow-smoke") options.allowSmoke = true;
    else throw new TypeError(`unknown argument: ${argument}`);
  }
  return options;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.evidenceDir) {
      const aggregate = verifySessionMessageReliabilityEvidenceSet(options);
      process.stdout.write(
        `verified session-message ${aggregate.profile.mode} matrix for ${aggregate.releaseCommit}: ${aggregate.totals.cycles} cycles\n`,
      );
    } else {
      const report = await runSessionMessageReliabilitySoak(options);
      process.stdout.write(
        `session-message reliability soak passed on ${report.runner.operatingSystem}: ${report.totals.cycles} cycles over ${report.continuousDurationSeconds.toFixed(3)} seconds${report.qualifyingEvidence ? "" : " (non-qualifying smoke)"}\n`,
      );
    }
  } catch (error) {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  }
}

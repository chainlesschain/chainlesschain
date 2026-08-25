#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  SESSION_MESSAGE_FABRIC_ERROR_CODES,
  SESSION_MESSAGE_FABRIC_LIMITS,
  SessionMessageFabric,
} from "../src/lib/session-message-fabric.js";
import { buildSessionProjection } from "../src/lib/session-projection.js";
import { withFileLock } from "../src/lib/with-file-lock.js";
import { TeamSessionMessageAdapter } from "../src/lib/agent-team/team-session-message-adapter.js";

export const SESSION_MESSAGE_FABRIC_EVIDENCE_SCHEMA =
  "chainlesschain.claude-code-increment-audit-fragment.v1";
export const SESSION_MESSAGE_FABRIC_AGGREGATE_SCHEMA =
  "chainlesschain.xsession-audit-aggregate.v1";
export const SESSION_MESSAGE_FABRIC_PROFILE = "claude-2.1.224-238-xsession/v2";
export const REQUIRED_PROCESS_COUNT = 32;
export const REQUIRED_OPERATING_SYSTEMS = Object.freeze([
  "linux",
  "macos",
  "windows",
]);

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "../../..");
const TEAM_PROCESS_FIXTURE = path.join(
  REPOSITORY_ROOT,
  "packages/cli/__tests__/fixtures/team-session-message-process.mjs",
);
const REQUIRE = createRequire(import.meta.url);
const VSCODE_PROJECTION_PATH =
  "packages/vscode-extension/src/sessions-workbench.js";
const JETBRAINS_PROJECTION_PATH =
  "packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/SessionProjection.java";
export const REQUIRED_THRESHOLDS = Object.freeze({
  processCount: REQUIRED_PROCESS_COUNT,
  maxPendingPerRecipient: SESSION_MESSAGE_FABRIC_LIMITS.maxPendingPerRecipient,
  maxMessageBytes: SESSION_MESSAGE_FABRIC_LIMITS.maxMessageBytes,
  maxProcessMatrixMs: 60_000,
  maxRecoveryMs: 10_000,
  maxStateBytes: 32 * 1024 * 1024,
  maxCoordinatorRssDeltaBytes: 256 * 1024 * 1024,
  idleNotificationsPerWatch: 1,
  historyLeaks: 0,
  duplicateDeliveries: 0,
  projectionRejects: 0,
});
export const SOURCE_FILES = Object.freeze([
  "packages/cli/scripts/verify-session-message-fabric.mjs",
  "packages/cli/src/lib/session-message-fabric.js",
  "packages/cli/src/lib/agent-team/team-session-message-adapter.js",
  "packages/cli/src/lib/agent-team/team-runner.js",
  "packages/cli/src/commands/team.js",
  "packages/cli/__tests__/fixtures/team-session-message-process.mjs",
  "packages/cli/src/lib/session-projection.js",
  "packages/cli/src/lib/with-file-lock.js",
  VSCODE_PROJECTION_PATH,
  "packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/MiniJson.java",
  JETBRAINS_PROJECTION_PATH,
  "packages/jetbrains-plugin/src/test/java/com/chainlesschain/ide/SessionProjectionAuditProbe.java",
  ".github/workflows/cli-ci.yml",
  ".github/workflows/cli-reliability-soak.yml",
]);
export const TEST_IDS = Object.freeze([
  "xsession/32-process-admission",
  "xsession/queue-101-full",
  "xsession/aggregate-pending-byte-cap",
  "xsession/256-kib-plus-one-rejected",
  "xsession/out-of-order-promotion",
  "xsession/duplicate-idempotency",
  "xsession/restart-durable-inbox",
  "xsession/policy-accept-hold-refuse",
  "xsession/offline-admission-not-delivery",
  "xsession/disconnect-reconnect",
  "xsession/process-crash-restart-idempotency",
  "xsession/unknown-commit-retry-idempotency",
  "xsession/registration-epoch-no-history-leak",
  "xsession/delivered-refused-full-expired-receipts",
  "team/session-fabric-offline-process-recovery",
  "team/session-fabric-processed-before-ack",
  "team/session-fabric-poison-dead-letter",
  "team/session-fabric-cross-process-rate-limit",
  "xsession/notify-when-idle-once",
  "xsession/vscode-real-projection-parser",
  "xsession/jetbrains-real-projection-parser",
]);

function sha256File(filePath) {
  return sha256Bytes(fs.readFileSync(filePath));
}

function sha256Bytes(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function runtimeOs() {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "macos";
  return "linux";
}

function sourceDigests() {
  const digests = Object.fromEntries(
    SOURCE_FILES.map((relativePath) => [
      relativePath,
      sha256File(path.join(REPOSITORY_ROOT, relativePath)),
    ]),
  );
  assert.match(
    fs.readFileSync(path.join(REPOSITORY_ROOT, VSCODE_PROJECTION_PATH), "utf8"),
    /parseMessagingSummary/u,
  );
  assert.match(
    fs.readFileSync(
      path.join(REPOSITORY_ROOT, JETBRAINS_PROJECTION_PATH),
      "utf8",
    ),
    /MessagingSummary/u,
  );
  return digests;
}

function verifyExactHeadSources(headSha) {
  for (const relativePath of SOURCE_FILES) {
    const committed = execFileSync(
      "git",
      ["show", `${headSha}:${relativePath}`],
      { cwd: REPOSITORY_ROOT, maxBuffer: 16 * 1024 * 1024 },
    );
    assert.equal(
      sha256Bytes(committed),
      sha256File(path.join(REPOSITORY_ROOT, relativePath)),
      `${relativePath} must match the exact evidence commit`,
    );
  }
}

function exactCommit(value) {
  const commit = String(value || "")
    .trim()
    .toLowerCase();
  assert.match(commit, /^[a-f0-9]{40}$/u);
  return commit;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(path.resolve(filePath)), {
    recursive: true,
    mode: 0o700,
  });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function boundedSourceValue(value, fallback, label) {
  const text = String(value || fallback || "").trim();
  assert.match(text, /^[A-Za-z0-9][A-Za-z0-9._:/@ -]{0,255}$/u, label);
  return text;
}

function evidenceSource(overrides = {}) {
  return {
    workflowId: boundedSourceValue(
      overrides.workflowId || process.env.CC_XSESSION_WORKFLOW_ID,
      "local",
      "workflowId",
    ),
    runId: boundedSourceValue(
      overrides.runId || process.env.CC_XSESSION_RUN_ID,
      "local",
      "runId",
    ),
    jobId: boundedSourceValue(
      overrides.jobId || process.env.CC_XSESSION_JOB_ID,
      `local-${runtimeOs()}`,
      "jobId",
    ),
    artifactName: boundedSourceValue(
      overrides.artifactName || process.env.CC_XSESSION_ARTIFACT_NAME,
      `local-xsession-${runtimeOs()}`,
      "artifactName",
    ),
  };
}

function executableSibling(command, sibling) {
  if (process.env.JAVA_HOME) {
    const candidate = path.join(
      process.env.JAVA_HOME,
      "bin",
      process.platform === "win32" ? `${sibling}.exe` : sibling,
    );
    if (fs.existsSync(candidate)) return candidate;
  }
  const locator = process.platform === "win32" ? "where.exe" : "which";
  const resolved = execFileSync(locator, [command], { encoding: "utf8" })
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .find(Boolean);
  assert.ok(
    resolved,
    `${command} is required for the JetBrains projection probe`,
  );
  const candidate = path.join(
    path.dirname(fs.realpathSync(resolved)),
    process.platform === "win32" ? `${sibling}.exe` : sibling,
  );
  return fs.existsSync(candidate) ? candidate : sibling;
}

function childExit(args, expectedCode) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT_PATH, ...args], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === expectedCode) resolve({ code, signal, stdout, stderr });
      else {
        reject(
          new Error(
            `session fabric child failed (${signal || code}): ${stderr.slice(0, 2_000)}`,
          ),
        );
      }
    });
  });
}

function workerProcess(statePath, index) {
  const fabric = new SessionMessageFabric({ statePath, lockTimeoutMs: 30_000 });
  const name = `worker-${String(index).padStart(2, "0")}`;
  fabric.register({
    sessionId: `session-${index}`,
    machineId: `process-${index}`,
    name,
  });
  const receipt = fabric.send({
    from: name,
    to: "collector",
    body: { process: index },
    messageId: `process-message-${index}`,
  });
  assert.equal(receipt.status, "delivered");
}

function crashAfterDurableSend(statePath) {
  const fabric = new SessionMessageFabric({ statePath, lockTimeoutMs: 30_000 });
  const receipt = fabric.send({
    from: "crash-sender",
    to: "crash-target",
    body: "committed before abrupt process exit",
    messageId: "crash-retry-message",
  });
  assert.equal(receipt.status, "delivered");
  // Synchronous atomic persistence and fsync have completed, but no success
  // response crosses the process boundary.  The caller must safely retry the
  // same idempotency key after observing this abnormal exit.
  process.exit(91);
}

function recoveryWorker(statePath) {
  const fabric = new SessionMessageFabric({ statePath, lockTimeoutMs: 30_000 });
  const inbox = fabric.inbox("crash-target");
  process.stdout.write(
    JSON.stringify({
      count: inbox.length,
      messageIds: inbox.map((message) => message.messageId),
      receiptStatuses: fabric
        .receipts("crash-sender")
        .map((receipt) => receipt.status),
    }),
  );
}

function spawnWorker(statePath, index) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [SCRIPT_PATH, "--worker", statePath, String(index)],
      {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else {
        reject(
          new Error(
            `session fabric worker ${index} failed (${signal || code}): ${stderr.slice(0, 2_000)}`,
          ),
        );
      }
    });
  });
}

async function runProcessMatrix(directory, processCount) {
  const statePath = path.join(directory, "multiprocess-state.json");
  const fabric = new SessionMessageFabric({ statePath, lockTimeoutMs: 30_000 });
  fabric.register({
    sessionId: "collector-session",
    machineId: "collector-machine",
    name: "collector",
  });
  const rssBefore = process.memoryUsage().rss;
  const startedAt = performance.now();
  await Promise.all(
    Array.from({ length: processCount }, (_, index) =>
      spawnWorker(statePath, index + 1),
    ),
  );
  const elapsedMs = performance.now() - startedAt;
  const coordinatorRssDeltaBytes = Math.max(
    0,
    process.memoryUsage().rss - rssBefore,
  );
  const restarted = new SessionMessageFabric({ statePath });
  const inbox = restarted.inbox("collector");
  assert.equal(inbox.length, processCount);
  assert.equal(
    new Set(inbox.map((message) => message.messageId)).size,
    processCount,
  );
  assert.equal(restarted.projection().endpoints.length, processCount + 1);
  const admittedStateBytes = fs.statSync(statePath).size;
  restarted.inbox("collector", { acknowledge: true });
  const settledStateBytes = fs.statSync(statePath).size;
  const stateBytes = Math.max(admittedStateBytes, settledStateBytes);
  assert.ok(elapsedMs <= REQUIRED_THRESHOLDS.maxProcessMatrixMs);
  assert.ok(stateBytes <= REQUIRED_THRESHOLDS.maxStateBytes);
  assert.ok(
    coordinatorRssDeltaBytes <= REQUIRED_THRESHOLDS.maxCoordinatorRssDeltaBytes,
  );
  return {
    processCount,
    delivered: inbox.length,
    elapsedMs,
    stateBytes,
    admittedStateBytes,
    settledStateBytes,
    coordinatorRssDeltaBytes,
  };
}

function runFunctionalMatrix(directory) {
  let now = 10_000;
  const statePath = path.join(directory, "functional-state.json");
  const fabric = new SessionMessageFabric({ statePath, now: () => now });
  fabric.register({ sessionId: "sender-session", name: "sender" });
  fabric.register({
    sessionId: "target-session",
    machineId: "host-b",
    name: "target",
    idle: false,
  });

  const outOfOrder = fabric.send({
    from: "sender",
    to: "target",
    body: "second",
    messageId: "ordered-2",
    sequence: 2,
  });
  assert.equal(outOfOrder.status, "held");
  const first = fabric.send({
    from: "sender",
    to: "target",
    body: "first",
    messageId: "ordered-1",
    sequence: 1,
  });
  assert.equal(first.status, "delivered");
  assert.deepEqual(
    fabric.inbox("target").map((message) => message.body),
    ["first", "second"],
  );
  assert.deepEqual(
    fabric.send({
      from: "sender",
      to: "target",
      body: "first",
      messageId: "ordered-1",
      sequence: 1,
    }),
    first,
  );
  fabric.inbox("target", { acknowledge: true });

  fabric.setPolicy("target", "hold");
  assert.equal(
    fabric.send({
      from: "sender",
      to: "target",
      body: "held",
      messageId: "policy-held",
      sequence: 3,
    }).status,
    "held",
  );
  fabric.setPolicy("target", "accept");
  assert.equal(fabric.inbox("target")[0].body, "held");
  fabric.inbox("target", { acknowledge: true });
  fabric.setPolicy("target", "refuse");
  assert.equal(
    fabric.send({
      from: "sender",
      to: "target",
      body: "refused",
      messageId: "policy-refused",
      sequence: 4,
    }).status,
    "refused",
  );

  fabric.setPolicy("target", "accept");
  fabric.disconnect("target");
  assert.equal(
    fabric.send({
      from: "sender",
      to: "target",
      body: "offline",
      messageId: "offline-delivery",
      sequence: 5,
    }).status,
    "held",
  );
  const offlineAdmission = fabric
    .receipts("sender")
    .find((receipt) => receipt.messageId === "offline-delivery");
  assert.equal(offlineAdmission.status, "held");
  assert.equal(offlineAdmission.reason, "recipient_offline");
  const restarted = new SessionMessageFabric({ statePath, now: () => now });
  restarted.reconnect("target");
  assert.equal(restarted.inbox("target")[0].body, "offline");
  restarted.inbox("target", { acknowledge: true });

  restarted.send({
    from: "sender",
    to: "target",
    body: "idle",
    messageId: "idle-notification",
    sequence: 6,
    notifyWhenIdle: true,
  });
  restarted.inbox("target", { acknowledge: true });
  now += 1;
  assert.equal(restarted.setIdle("target", true).notifications, 1);
  assert.equal(restarted.setIdle("target", true).notifications, 0);

  restarted.setIdle("target", false);
  restarted.send({
    from: "sender",
    to: "target",
    body: "old epoch",
    messageId: "old-epoch",
    sequence: 7,
  });
  const oldEpoch = restarted
    .projection()
    .endpoints.find((endpoint) => endpoint.name === "target").epoch;
  restarted.unregister("target");
  const replacement = restarted.register({
    sessionId: "target-session",
    machineId: "host-b",
    name: "target",
  });
  assert.notEqual(replacement.epoch, oldEpoch);
  assert.deepEqual(restarted.inbox("target"), []);

  const queue = new SessionMessageFabric({
    statePath: path.join(directory, "queue-state.json"),
  });
  queue.register({ sessionId: "queue-sender", name: "queue-sender" });
  queue.register({ sessionId: "queue-target", name: "queue-target" });
  for (
    let index = 1;
    index <= SESSION_MESSAGE_FABRIC_LIMITS.maxPendingPerRecipient;
    index += 1
  ) {
    assert.equal(
      queue.send({
        from: "queue-sender",
        to: "queue-target",
        body: index,
        messageId: `queue-${index}`,
      }).status,
      "delivered",
    );
  }
  const full = queue.send({
    from: "queue-sender",
    to: "queue-target",
    body: 101,
    messageId: "queue-101",
  });
  assert.equal(full.status, "full");
  const queueStateBytes = fs.statSync(queue.statePath).size;
  assert.ok(queueStateBytes <= REQUIRED_THRESHOLDS.maxStateBytes);

  const byteQueue = new SessionMessageFabric({
    statePath: path.join(directory, "byte-queue-state.json"),
    maxPendingBytes: 1_000,
  });
  byteQueue.register({ sessionId: "byte-sender", name: "byte-sender" });
  byteQueue.register({ sessionId: "byte-target", name: "byte-target" });
  assert.equal(
    byteQueue.send({
      from: "byte-sender",
      to: "byte-target",
      body: "x".repeat(500),
      messageId: "byte-1",
    }).status,
    "delivered",
  );
  assert.equal(
    byteQueue.send({
      from: "byte-sender",
      to: "byte-target",
      body: "y".repeat(500),
      messageId: "byte-2",
    }).status,
    "full",
  );

  const envelopeOverhead = Buffer.byteLength(
    JSON.stringify({ subject: null, body: "" }),
    "utf8",
  );
  const oversizedBody = "x".repeat(
    SESSION_MESSAGE_FABRIC_LIMITS.maxMessageBytes + 1 - envelopeOverhead,
  );
  let oversizeBytes = 0;
  assert.throws(
    () =>
      queue.send({
        from: "queue-sender",
        to: "queue-target",
        body: oversizedBody,
      }),
    (error) => {
      oversizeBytes = error?.messageBytes || 0;
      return (
        error?.code === SESSION_MESSAGE_FABRIC_ERROR_CODES.MESSAGE_TOO_LARGE
      );
    },
  );
  assert.equal(
    oversizeBytes,
    SESSION_MESSAGE_FABRIC_LIMITS.maxMessageBytes + 1,
  );

  let expiryNow = 50_000;
  const expiry = new SessionMessageFabric({
    statePath: path.join(directory, "expiry-state.json"),
    now: () => expiryNow,
  });
  expiry.register({ sessionId: "expiry-sender", name: "expiry-sender" });
  expiry.register({
    sessionId: "expiry-target",
    name: "expiry-target",
    policy: "hold",
  });
  expiry.send({
    from: "expiry-sender",
    to: "expiry-target",
    body: "expire",
    messageId: "expiry-message",
    ttlMs: 10,
  });
  expiryNow += 11;
  assert.equal(expiry.receipts("expiry-sender")[0].status, "expired");

  const statuses = new Set([
    ...restarted.receipts("sender").map((receipt) => receipt.status),
    full.status,
    ...expiry.receipts("expiry-sender").map((receipt) => receipt.status),
  ]);
  assert.deepEqual([...statuses].sort(), [
    "delivered",
    "expired",
    "full",
    "refused",
  ]);
  const projection = restarted.projection();
  const targetProjection = projection.endpoints.find(
    (endpoint) => endpoint.sessionId === "target-session",
  );
  assert.equal(projection.authority, "cli");
  assert.equal(targetProjection.unread, 0);
  assert.equal(targetProjection.held, 0);
  assert.equal(targetProjection.policy, "accept");

  return {
    queueCapacity: SESSION_MESSAGE_FABRIC_LIMITS.maxPendingPerRecipient,
    queueStateBytes,
    aggregatePendingByteCaps: 1,
    oversizeBytes,
    receiptStatuses: [...statuses].sort(),
    offlineAdmissions: 1,
    offlineFalseDeliveries: 0,
    idleNotifications: 1,
    noHistoryLeak: true,
    projectionEndpoints: projection.endpoints.length,
  };
}

async function runCrashRecoveryMatrix(directory) {
  const statePath = path.join(directory, "crash-state.json");
  const fabric = new SessionMessageFabric({ statePath, lockTimeoutMs: 30_000 });
  fabric.register({ sessionId: "crash-sender", name: "crash-sender" });
  fabric.register({ sessionId: "crash-target", name: "crash-target" });

  const startedAt = performance.now();
  await childExit(["--crash-after-send", statePath], 91);
  const recoveredRaw = execFileSync(
    process.execPath,
    [SCRIPT_PATH, "--recover-after-crash", statePath],
    { encoding: "utf8", maxBuffer: 1024 * 1024 },
  );
  const recovered = JSON.parse(recoveredRaw);
  assert.deepEqual(recovered, {
    count: 1,
    messageIds: ["crash-retry-message"],
    receiptStatuses: ["delivered"],
  });
  const retry = new SessionMessageFabric({ statePath }).send({
    from: "crash-sender",
    to: "crash-target",
    body: "committed before abrupt process exit",
    messageId: "crash-retry-message",
  });
  assert.equal(retry.status, "delivered");
  assert.equal(
    new SessionMessageFabric({ statePath }).inbox("crash-target").length,
    1,
  );

  const uncertainPath = path.join(directory, "unknown-commit-state.json");
  const initial = new SessionMessageFabric({ statePath: uncertainPath });
  initial.register({ sessionId: "uncertain-sender", name: "uncertain-sender" });
  initial.register({ sessionId: "uncertain-target", name: "uncertain-target" });
  let failAfterCommit = true;
  const uncertain = new SessionMessageFabric({
    statePath: uncertainPath,
    lock: (filePath, task, options) =>
      withFileLock(
        filePath,
        () => {
          const result = task();
          if (failAfterCommit) {
            failAfterCommit = false;
            throw Object.assign(
              new Error("injected response loss after commit"),
              {
                code: "EIO",
              },
            );
          }
          return result;
        },
        options,
      ),
  });
  assert.throws(
    () =>
      uncertain.send({
        from: "uncertain-sender",
        to: "uncertain-target",
        body: "unknown commit",
        messageId: "unknown-commit-message",
      }),
    (error) =>
      error?.code === SESSION_MESSAGE_FABRIC_ERROR_CODES.STATE_UNAVAILABLE,
  );
  const reconciled = new SessionMessageFabric({ statePath: uncertainPath });
  assert.equal(
    reconciled.send({
      from: "uncertain-sender",
      to: "uncertain-target",
      body: "unknown commit",
      messageId: "unknown-commit-message",
    }).status,
    "delivered",
  );
  assert.equal(reconciled.inbox("uncertain-target").length, 1);

  const recoveryMs = performance.now() - startedAt;
  assert.ok(recoveryMs <= REQUIRED_THRESHOLDS.maxRecoveryMs);
  return {
    crashExitCode: 91,
    crashRecoveredMessages: 1,
    unknownCommitRetries: 1,
    duplicateDeliveries: 0,
    recoveryMs,
  };
}

function runTeamAdapterMatrix(directory) {
  const statePath = path.join(directory, "team-message-state.json");
  const teamId = "team_state_evidence";
  const adapter = new TeamSessionMessageAdapter({
    statePath,
    teamId,
    recipients: ["teammate-1", "teammate-2"],
    maxMessagesPerSenderWindow: 2,
    senderRateWindowMs: 60_000,
  });
  adapter.setRecipientState("teammate-2", "idle");
  const offline = adapter.send({
    from: "coordinator",
    to: "teammate-2",
    body: "offline recovery",
    idempotencyKey: "evidence-offline",
  });
  assert.equal(adapter.peek("teammate-2").length, 0);
  const recovered = JSON.parse(
    execFileSync(
      process.execPath,
      [TEAM_PROCESS_FIXTURE, "recover", statePath, teamId],
      { encoding: "utf8", maxBuffer: 1024 * 1024 },
    ),
  );
  assert.deepEqual(recovered, { messages: [offline.id], pending: 0 });

  const poison = adapter.send({
    from: "coordinator",
    to: "teammate-2",
    body: { invalid: true },
    idempotencyKey: "evidence-poison",
  });
  assert.equal(
    adapter.receive("teammate-2", { markRead: true })[0].id,
    poison.id,
  );
  adapter.acknowledge("teammate-2", {
    messageIds: [poison.id],
    consumerKey: "poison-evidence",
    status: "dead_letter",
    reason: "schema rejected",
  });

  const rateBase = {
    from: "teammate-1",
    to: "teammate-2",
    senderAttempt: { taskKey: "rate-task" },
  };
  adapter.send({
    ...rateBase,
    body: "first",
    idempotencyKey: "process-rate-1",
  });
  adapter.send({
    ...rateBase,
    body: "second",
    idempotencyKey: "process-rate-2",
  });
  const limited = JSON.parse(
    execFileSync(
      process.execPath,
      [TEAM_PROCESS_FIXTURE, "rate", statePath, teamId],
      { encoding: "utf8", maxBuffer: 1024 * 1024 },
    ),
  );
  assert.equal(limited.admitted, false);
  assert.ok(limited.retryAfterMs > 0);
  const snapshot = adapter.snapshot();
  assert.ok(
    snapshot.receipts.some(
      ([, receipt]) =>
        receipt.messageId === offline.id && receipt.status === "processed",
    ),
  );
  assert.ok(
    snapshot.receipts.some(
      ([, receipt]) =>
        receipt.messageId === poison.id && receipt.status === "dead_letter",
    ),
  );
  return {
    teamOfflineAdmissions: 1,
    teamOfflineFalseDeliveries: 0,
    teamProcessedRecoveries: 1,
    teamPoisonDeadLetters: 1,
    teamCrossProcessRateLimits: 1,
    teamMaxPendingBytes: snapshot.limits.maxTotalBytes,
  };
}

function runDualIdeProjectionContract(directory) {
  const projection = buildSessionProjection({
    generatedAt: "2026-08-21T00:00:00.000Z",
    local: [
      {
        id: "projection-session",
        title: "Projection contract",
        workspace: REPOSITORY_ROOT,
        updated_at: "2026-08-21 00:00:00",
      },
    ],
    sessionMessageFabric: {
      revision: 11,
      endpoints: [
        {
          sessionId: "projection-session",
          name: "projection-target",
          address: "cc-session://host-b/@projection-target?epoch=epoch-11",
          policy: "hold",
          online: false,
          idle: false,
          unread: 1,
          held: 1,
        },
      ],
    },
  });
  const serialized = JSON.stringify(projection);
  const projectionPath = path.join(directory, "session-projection.json");
  fs.writeFileSync(projectionPath, serialized, "utf8");

  const { parseSessionProjection } = REQUIRE(
    path.join(REPOSITORY_ROOT, VSCODE_PROJECTION_PATH),
  );
  const vscode = parseSessionProjection(serialized);
  assert.equal(vscode.connected, true);
  assert.equal(vscode.rows.length, 1);
  assert.deepEqual(vscode.rows[0].messaging, {
    authority: "cli",
    registered: true,
    revision: 11,
    unread: 1,
    held: 1,
    endpoints: [
      {
        name: "projection-target",
        address: "cc-session://host-b/@projection-target?epoch=epoch-11",
        policy: "hold",
        online: false,
        idle: false,
        unread: 1,
        held: 1,
      },
    ],
  });

  const classes = path.join(directory, "jetbrains-projection-classes");
  fs.mkdirSync(classes, { recursive: true });
  const javac = executableSibling("javac", "javac");
  const java = executableSibling("javac", "java");
  const javaSources = [
    "packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/MiniJson.java",
    JETBRAINS_PROJECTION_PATH,
    "packages/jetbrains-plugin/src/test/java/com/chainlesschain/ide/SessionProjectionAuditProbe.java",
  ].map((relativePath) => path.join(REPOSITORY_ROOT, relativePath));
  execFileSync(javac, ["-encoding", "UTF-8", "-d", classes, ...javaSources], {
    cwd: REPOSITORY_ROOT,
    maxBuffer: 4 * 1024 * 1024,
  });
  const jetbrains = JSON.parse(
    execFileSync(
      java,
      [
        "-cp",
        classes,
        "com.chainlesschain.ide.SessionProjectionAuditProbe",
        projectionPath,
      ],
      { encoding: "utf8", maxBuffer: 1024 * 1024 },
    ),
  );
  assert.deepEqual(jetbrains, {
    connected: true,
    sessions: 1,
    endpoints: 1,
    unread: 1,
    held: 1,
  });
  const javaVersion = execFileSync(javac, ["-version"], {
    encoding: "utf8",
  }).trim();
  return {
    vscode: { sessions: vscode.rows.length, endpoints: 1 },
    jetbrains,
    javaVersion: javaVersion.split(/\r?\n/u)[0],
    projectionRejects: 0,
  };
}

export async function produceSessionMessageFabricEvidence({
  releaseCommit,
  output,
  processCount = REQUIRED_PROCESS_COUNT,
  verifyGitHead = true,
  source = {},
} = {}) {
  const headSha = exactCommit(releaseCommit);
  if (verifyGitHead) {
    const current = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      cwd: path.resolve(path.dirname(SCRIPT_PATH), "../../.."),
    })
      .trim()
      .toLowerCase();
    assert.equal(current, headSha, "release commit must equal exact Git HEAD");
    verifyExactHeadSources(headSha);
  }
  assert.equal(
    processCount,
    REQUIRED_PROCESS_COUNT,
    "required evidence must use 32 processes",
  );
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-session-message-evidence-"),
  );
  try {
    const processMatrix = await runProcessMatrix(directory, processCount);
    const functional = runFunctionalMatrix(directory);
    const recovery = await runCrashRecoveryMatrix(directory);
    const teamAdapter = runTeamAdapterMatrix(directory);
    const ideProjection = runDualIdeProjectionContract(directory);
    const evidence = {
      schema: SESSION_MESSAGE_FABRIC_EVIDENCE_SCHEMA,
      commitmentId: "XSESSION",
      headSha,
      os: runtimeOs(),
      runtime: {
        name: "node",
        version: process.version,
        arch: process.arch,
      },
      profileVersion: SESSION_MESSAGE_FABRIC_PROFILE,
      thresholds: { ...REQUIRED_THRESHOLDS },
      measurements: {
        ...processMatrix,
        ...functional,
        ...recovery,
        ...teamAdapter,
        ideProjection,
        historyLeaks: 0,
      },
      testIds: [...TEST_IDS],
      producerDigests: sourceDigests(),
      disposition: "required",
      source: evidenceSource(source),
      outcome: "passed",
    };
    if (output) writeJson(output, evidence);
    return evidence;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function evidenceFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...evidenceFiles(target));
    else if (entry.isFile() && entry.name.endsWith(".json")) files.push(target);
  }
  return files;
}

export function aggregateSessionMessageFabricEvidence({
  evidenceDir,
  releaseCommit,
  output,
  verifyGitHead = true,
  source = {},
} = {}) {
  const headSha = exactCommit(releaseCommit);
  if (verifyGitHead) {
    const current = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      cwd: REPOSITORY_ROOT,
    })
      .trim()
      .toLowerCase();
    assert.equal(
      current,
      headSha,
      "aggregate commit must equal exact Git HEAD",
    );
    verifyExactHeadSources(headSha);
  }
  const expectedProducerDigests = sourceDigests();
  const rows = [];
  for (const filePath of evidenceFiles(path.resolve(evidenceDir))) {
    const serialized = fs.readFileSync(filePath);
    let candidate;
    try {
      candidate = JSON.parse(serialized.toString("utf8"));
    } catch {
      continue;
    }
    if (candidate?.schema !== SESSION_MESSAGE_FABRIC_EVIDENCE_SCHEMA) continue;
    assert.equal(candidate.commitmentId, "XSESSION");
    assert.equal(candidate.profileVersion, SESSION_MESSAGE_FABRIC_PROFILE);
    assert.equal(candidate.headSha, headSha);
    assert.deepEqual(candidate.producerDigests, expectedProducerDigests);
    assert.deepEqual(candidate.thresholds, REQUIRED_THRESHOLDS);
    assert.equal(candidate.disposition, "required");
    assert.equal(candidate.outcome, "passed");
    assert.deepEqual(Object.keys(candidate.runtime).sort(), [
      "arch",
      "name",
      "version",
    ]);
    assert.equal(candidate.runtime.name, "node");
    assert.match(candidate.runtime.version, /^v22\./u);
    assert.match(candidate.runtime.arch, /^(?:arm64|x64)$/u);
    assert.deepEqual(Object.keys(candidate.source).sort(), [
      "artifactName",
      "jobId",
      "runId",
      "workflowId",
    ]);
    assert.deepEqual(candidate.testIds, TEST_IDS);
    assert.equal(candidate.measurements.processCount, REQUIRED_PROCESS_COUNT);
    assert.equal(candidate.measurements.delivered, REQUIRED_PROCESS_COUNT);
    assert.equal(candidate.measurements.historyLeaks, 0);
    assert.equal(candidate.measurements.duplicateDeliveries, 0);
    assert.equal(candidate.measurements.offlineFalseDeliveries, 0);
    assert.equal(candidate.measurements.idleNotifications, 1);
    assert.equal(candidate.measurements.crashRecoveredMessages, 1);
    assert.equal(candidate.measurements.unknownCommitRetries, 1);
    assert.equal(candidate.measurements.teamOfflineFalseDeliveries, 0);
    assert.equal(candidate.measurements.teamProcessedRecoveries, 1);
    assert.equal(candidate.measurements.teamPoisonDeadLetters, 1);
    assert.equal(candidate.measurements.teamCrossProcessRateLimits, 1);
    assert.equal(candidate.measurements.aggregatePendingByteCaps, 1);
    assert.equal(candidate.measurements.teamMaxPendingBytes, 4 * 1024 * 1024);
    assert.equal(candidate.measurements.ideProjection.projectionRejects, 0);
    assert.equal(candidate.measurements.ideProjection.vscode.endpoints, 1);
    assert.equal(candidate.measurements.ideProjection.jetbrains.endpoints, 1);
    assert.ok(
      candidate.measurements.elapsedMs <=
        REQUIRED_THRESHOLDS.maxProcessMatrixMs,
    );
    assert.ok(
      candidate.measurements.recoveryMs <= REQUIRED_THRESHOLDS.maxRecoveryMs,
    );
    assert.ok(
      candidate.measurements.stateBytes <= REQUIRED_THRESHOLDS.maxStateBytes,
    );
    assert.ok(
      candidate.measurements.queueStateBytes <=
        REQUIRED_THRESHOLDS.maxStateBytes,
    );
    assert.deepEqual(candidate.measurements.receiptStatuses, [
      "delivered",
      "expired",
      "full",
      "refused",
    ]);
    rows.push({ candidate, digest: sha256Bytes(serialized) });
  }
  assert.equal(rows.length, REQUIRED_OPERATING_SYSTEMS.length);
  assert.deepEqual(
    rows.map((row) => row.candidate.os).sort(),
    [...REQUIRED_OPERATING_SYSTEMS].sort(),
  );
  assert.equal(
    new Set(rows.map((row) => row.candidate.os)).size,
    REQUIRED_OPERATING_SYSTEMS.length,
  );
  assert.equal(
    new Set(rows.map((row) => row.candidate.source.artifactName)).size,
    REQUIRED_OPERATING_SYSTEMS.length,
  );
  assert.equal(new Set(rows.map((row) => row.candidate.source.runId)).size, 1);
  const aggregateSource = evidenceSource(source);
  const aggregate = {
    schema: SESSION_MESSAGE_FABRIC_AGGREGATE_SCHEMA,
    commitmentId: "XSESSION",
    headSha,
    profileVersion: SESSION_MESSAGE_FABRIC_PROFILE,
    operatingSystems: [...REQUIRED_OPERATING_SYSTEMS],
    runtimes: Object.fromEntries(
      rows.map(({ candidate }) => [candidate.os, candidate.runtime]),
    ),
    thresholds: { ...REQUIRED_THRESHOLDS },
    measurements: {
      requiredFragments: rows.length,
      passedFragments: rows.length,
      historyLeaks: 0,
      duplicateDeliveries: 0,
      projectionRejects: 0,
    },
    testIds: [...TEST_IDS],
    producerDigests: expectedProducerDigests,
    fragmentDigests: Object.fromEntries(
      rows.map(({ candidate, digest }) => [candidate.os, digest]),
    ),
    disposition: "required",
    source: aggregateSource,
    fragments: rows
      .map(({ candidate, digest }) => ({
        os: candidate.os,
        runtime: candidate.runtime,
        measurements: candidate.measurements,
        source: candidate.source,
        digest,
      }))
      .sort((left, right) => left.os.localeCompare(right.os)),
  };
  if (output) writeJson(output, aggregate);
  return aggregate;
}

function optionValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

async function main(args) {
  if (args[0] === "--worker") {
    workerProcess(path.resolve(args[1]), Number(args[2]));
    return;
  }
  if (args[0] === "--crash-after-send") {
    crashAfterDurableSend(path.resolve(args[1]));
    return;
  }
  if (args[0] === "--recover-after-crash") {
    recoveryWorker(path.resolve(args[1]));
    return;
  }
  const releaseCommit = optionValue(args, "--release-commit");
  const output = optionValue(args, "--output");
  const evidenceDir = optionValue(args, "--verify-evidence-dir");
  if (evidenceDir) {
    aggregateSessionMessageFabricEvidence({
      evidenceDir,
      releaseCommit,
      output,
    });
    return;
  }
  await produceSessionMessageFabricEvidence({ releaseCommit, output });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(SCRIPT_PATH)
) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `session message fabric verification failed: ${error.message}\n`,
    );
    process.exitCode = 1;
  });
}

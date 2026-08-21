#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  SESSION_MESSAGE_FABRIC_ERROR_CODES,
  SESSION_MESSAGE_FABRIC_LIMITS,
  SessionMessageFabric,
} from "../src/lib/session-message-fabric.js";

export const SESSION_MESSAGE_FABRIC_EVIDENCE_SCHEMA =
  "chainlesschain.session-message-fabric-evidence/v1";
export const SESSION_MESSAGE_FABRIC_AGGREGATE_SCHEMA =
  "chainlesschain.session-message-fabric-evidence-aggregate/v1";
export const SESSION_MESSAGE_FABRIC_PROFILE = "claude-2.1.224-238-xsession/v1";
export const REQUIRED_PROCESS_COUNT = 32;
export const REQUIRED_OPERATING_SYSTEMS = Object.freeze([
  "linux",
  "macos",
  "windows",
]);

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "../../..");
const SOURCE_FILES = Object.freeze({
  fabric: "packages/cli/src/lib/session-message-fabric.js",
  projection: "packages/cli/src/lib/session-projection.js",
  vscodeProjection: "packages/vscode-extension/src/sessions-workbench.js",
  jetbrainsProjection:
    "packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/SessionProjection.java",
});
const TEST_IDS = Object.freeze([
  "xsession/32-process-admission",
  "xsession/queue-101-full",
  "xsession/256-kib-plus-one-rejected",
  "xsession/out-of-order-promotion",
  "xsession/duplicate-idempotency",
  "xsession/restart-durable-inbox",
  "xsession/policy-accept-hold-refuse",
  "xsession/disconnect-reconnect",
  "xsession/registration-epoch-no-history-leak",
  "xsession/delivered-refused-full-expired-receipts",
  "xsession/notify-when-idle-once",
  "xsession/dual-ide-projection-contract",
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
    Object.entries(SOURCE_FILES).map(([name, relativePath]) => [
      name,
      sha256File(path.join(REPOSITORY_ROOT, relativePath)),
    ]),
  );
  assert.match(
    fs.readFileSync(
      path.join(REPOSITORY_ROOT, SOURCE_FILES.vscodeProjection),
      "utf8",
    ),
    /parseMessagingSummary/u,
  );
  assert.match(
    fs.readFileSync(
      path.join(REPOSITORY_ROOT, SOURCE_FILES.jetbrainsProjection),
      "utf8",
    ),
    /MessagingSummary/u,
  );
  return digests;
}

function verifyExactHeadSources(headSha) {
  const relativePaths = [
    "packages/cli/scripts/verify-session-message-fabric.mjs",
    ...Object.values(SOURCE_FILES),
  ];
  for (const relativePath of relativePaths) {
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
  const startedAt = performance.now();
  await Promise.all(
    Array.from({ length: processCount }, (_, index) =>
      spawnWorker(statePath, index + 1),
    ),
  );
  const elapsedMs = performance.now() - startedAt;
  const restarted = new SessionMessageFabric({ statePath });
  const inbox = restarted.inbox("collector");
  assert.equal(inbox.length, processCount);
  assert.equal(
    new Set(inbox.map((message) => message.messageId)).size,
    processCount,
  );
  assert.equal(restarted.projection().endpoints.length, processCount + 1);
  restarted.inbox("collector", { acknowledge: true });
  return { processCount, delivered: inbox.length, elapsedMs };
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
    "delivered",
  );
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
    oversizeBytes,
    receiptStatuses: [...statuses].sort(),
    idleNotifications: 1,
    noHistoryLeak: true,
    projectionEndpoints: projection.endpoints.length,
  };
}

export async function produceSessionMessageFabricEvidence({
  releaseCommit,
  output,
  processCount = REQUIRED_PROCESS_COUNT,
  verifyGitHead = true,
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
    const evidence = {
      schema: SESSION_MESSAGE_FABRIC_EVIDENCE_SCHEMA,
      profile: SESSION_MESSAGE_FABRIC_PROFILE,
      headSha,
      os: runtimeOs(),
      runtime: process.version,
      producerDigest: sha256File(SCRIPT_PATH),
      sourceDigests: sourceDigests(),
      generatedAt: new Date().toISOString(),
      required: true,
      testIds: [...TEST_IDS],
      thresholds: {
        processCount: REQUIRED_PROCESS_COUNT,
        maxPendingPerRecipient:
          SESSION_MESSAGE_FABRIC_LIMITS.maxPendingPerRecipient,
        maxMessageBytes: SESSION_MESSAGE_FABRIC_LIMITS.maxMessageBytes,
        idleNotificationsPerWatch: 1,
        historyLeaks: 0,
      },
      measurements: {
        ...processMatrix,
        ...functional,
        historyLeaks: 0,
      },
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
} = {}) {
  const headSha = exactCommit(releaseCommit);
  const producerDigest = sha256File(SCRIPT_PATH);
  const expectedSourceDigests = sourceDigests();
  const rows = [];
  for (const filePath of evidenceFiles(path.resolve(evidenceDir))) {
    let candidate;
    try {
      candidate = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      continue;
    }
    if (candidate?.schema !== SESSION_MESSAGE_FABRIC_EVIDENCE_SCHEMA) continue;
    assert.equal(candidate.profile, SESSION_MESSAGE_FABRIC_PROFILE);
    assert.equal(candidate.headSha, headSha);
    assert.equal(candidate.producerDigest, producerDigest);
    assert.deepEqual(candidate.sourceDigests, expectedSourceDigests);
    assert.equal(candidate.required, true);
    assert.deepEqual(candidate.testIds, TEST_IDS);
    assert.equal(candidate.measurements.processCount, REQUIRED_PROCESS_COUNT);
    assert.equal(candidate.measurements.delivered, REQUIRED_PROCESS_COUNT);
    assert.equal(candidate.measurements.historyLeaks, 0);
    assert.equal(candidate.measurements.idleNotifications, 1);
    assert.deepEqual(candidate.measurements.receiptStatuses, [
      "delivered",
      "expired",
      "full",
      "refused",
    ]);
    rows.push(candidate);
  }
  assert.equal(rows.length, REQUIRED_OPERATING_SYSTEMS.length);
  assert.deepEqual(
    rows.map((row) => row.os).sort(),
    [...REQUIRED_OPERATING_SYSTEMS].sort(),
  );
  const aggregate = {
    schema: SESSION_MESSAGE_FABRIC_AGGREGATE_SCHEMA,
    profile: SESSION_MESSAGE_FABRIC_PROFILE,
    headSha,
    producerDigest,
    sourceDigests: expectedSourceDigests,
    required: true,
    operatingSystems: [...REQUIRED_OPERATING_SYSTEMS],
    testIds: [...TEST_IDS],
    evidence: rows
      .map((row) => ({
        os: row.os,
        runtime: row.runtime,
        generatedAt: row.generatedAt,
        measurements: row.measurements,
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

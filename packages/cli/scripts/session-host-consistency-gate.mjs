#!/usr/bin/env node

/**
 * Same-process conformance gate for the CLI session-host projection.
 *
 * This deliberately does not claim a cross-process lease, an independent
 * anti-rollback anchor, bounded transcript IO, or power-loss durability.  It
 * proves the narrower contract used by the current host adapters: given one
 * fully verified and index-anchored JSONL sample, the canonical reader, the
 * background attach seam, the WebSocket resume seam, and an independently
 * rebuilt projection agree on the same content-free revision and MCP recovery
 * authority.  A damaged sample must be rejected before a host resumes it.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

import { readBackgroundAttachSessionSnapshot } from "../src/commands/background-session.js";
import { handleSessionResume } from "../src/gateways/ws/session-protocol.js";
import {
  createSessionMcpLedgerSink,
  loadMcpLedgerRecovery,
} from "../src/lib/mcp-call-ledger-store.js";
import {
  projectSessionHostObservation,
  readSessionHostResumeState,
} from "../src/lib/session-host-snapshot.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIR, "../../..");
const RESULT_SCHEMA = "cc-cli-session-host-consistency-result/v1";
const MIB = 1024 ** 2;
const GATE_SOURCE_PATHS = [
  ".github/workflows/cli-session-host-consistency.yml",
  ".github/actions/setup-node-deps/action.yml",
  "package.json",
  "package-lock.json",
  "packages/cli/package.json",
  "packages/cli/src/harness/jsonl-session-store.js",
  "packages/cli/src/harness/session-list-index.js",
  "packages/cli/src/harness/transcript-integrity.js",
  "packages/cli/src/lib/session-host-snapshot.js",
  "packages/cli/src/lib/mcp-call-ledger.js",
  "packages/cli/src/lib/mcp-call-ledger-store.js",
  "packages/cli/src/lib/mcp-recovery-adjudication.js",
  "packages/cli/src/lib/background-session-transport.js",
  "packages/cli/src/commands/background-session.js",
  "packages/cli/src/repl/agent-repl.js",
  "packages/cli/src/runtime/headless-runner.js",
  "packages/cli/src/gateways/ws/session-protocol.js",
  "packages/cli/scripts/session-host-consistency-gate.mjs",
  "packages/cli/__tests__/unit/session-host-consistency-gate.test.js",
];

const LIMITATIONS = Object.freeze([
  "same-process adapter conformance only",
  "no cross-process head lease or fencing proof",
  "no independent anti-rollback anchor proof",
  "no bounded-resume-IO or long-session performance proof",
  "no fsync, power-loss, or remote-host durability proof",
]);

function git(...args) {
  return execFileSync("git", args, {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 16 * MIB,
  }).trim();
}

function gitSucceeds(...args) {
  try {
    execFileSync("git", args, {
      cwd: REPOSITORY_ROOT,
      stdio: "ignore",
    });
    return true;
  } catch (error) {
    if (error?.status === 1) return false;
    throw error;
  }
}

function exactRepositoryState() {
  const trackedPorcelain = git("status", "--porcelain", "--untracked-files=no");
  const sourcePathsTracked = GATE_SOURCE_PATHS.every((filePath) =>
    gitSucceeds("ls-files", "--error-unmatch", "--", filePath),
  );
  const sourcePathsUnmodified = gitSucceeds(
    "diff",
    "--quiet",
    "HEAD",
    "--",
    ...GATE_SOURCE_PATHS,
  );
  return {
    commitSha: git("rev-parse", "HEAD").toLowerCase(),
    treeSha: git("rev-parse", "HEAD^{tree}").toLowerCase(),
    trackedWorktreeDirty: trackedPorcelain.length > 0,
    gateSourcePathsExact: sourcePathsTracked && sourcePathsUnmodified,
  };
}

function outputPath() {
  return (
    process.env.CC_SESSION_HOST_CONSISTENCY_OUTPUT ||
    join(
      tmpdir(),
      `cli-session-host-consistency-${process.platform}-${process.pid}.json`,
    )
  );
}

function writeResult(filePath, result) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

function publicSnapshot(snapshot) {
  return JSON.parse(JSON.stringify(snapshot));
}

function createWsHarness(sessionId, staleMessage) {
  const sent = [];
  const emitted = [];
  let resumeCalls = 0;
  const session = {
    id: sessionId,
    type: "agent",
    messages: [{ role: "user", content: staleMessage }],
  };
  const server = {
    _send(_ws, event) {
      sent.push(event);
    },
    emit(_type, event) {
      emitted.push(event);
    },
    sessionHandlers: new Map([[sessionId, {}]]),
    sessionManager: {
      resumeSession(id) {
        resumeCalls += 1;
        return id === sessionId ? session : null;
      },
    },
    resumeRecoveryDependencies: {
      loadSideEffectLedger: () => ({ ops: [] }),
    },
  };
  return {
    server,
    sent,
    emitted,
    session,
    resumeCalls: () => resumeCalls,
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function startedMcpRecord(sessionId) {
  return {
    schemaVersion: 1,
    ledgerId: "host-consistency-ledger-1",
    sessionId,
    turnId: "host-consistency-turn-1",
    toolName: "mcp__repo__publish",
    serverName: "repo",
    inputDigest: `sha256:${"a".repeat(64)}`,
    inputBytes: 37,
    effectContract: { effect: "write" },
    resourceScopes: [],
    networkScopes: [],
    prewritePolicy: "fail-closed",
    prewritePersistence: "pending",
    status: "started",
    startedAt: "2026-08-02T00:00:00.000Z",
    settledAt: null,
    outputSummary: null,
    outputDigest: null,
    errorSummary: null,
  };
}

async function runVerifiedHostScenario(store, home) {
  process.env.CHAINLESSCHAIN_HOME = home;
  const sessionId = "session-host-consistency-verified";
  const secrets = {
    title: "SESSION_HOST_TITLE_SECRET_6e490b",
    user: "SESSION_HOST_USER_SECRET_914ffd",
    assistant: "SESSION_HOST_ASSISTANT_SECRET_294c3a",
    stale: "SESSION_HOST_STALE_SECRET_bae793",
  };

  store.startSession(sessionId, {
    title: secrets.title,
    provider: "host-consistency",
    model: "fixture",
  });
  store.appendUserMessage(sessionId, secrets.user);
  store.appendAssistantMessage(sessionId, secrets.assistant);
  const sink = createSessionMcpLedgerSink(sessionId);
  await sink(startedMcpRecord(sessionId), { phase: "started" });

  // This is the exact helper consumed by the headless resume path.
  const headlessState = readSessionHostResumeState(sessionId);
  assert(
    headlessState?.snapshot?.verified === true,
    "headless sample unverified",
  );

  // Exercise the actual background attach projection seam.
  const backgroundSnapshot = readBackgroundAttachSessionSnapshot({ sessionId });
  assert(backgroundSnapshot?.verified === true, "background sample unverified");

  // Exercise the actual WebSocket resume seam.  Raw history belongs only to
  // its authenticated direct response; runtime-bus evidence stays content-free.
  const wsHarness = createWsHarness(sessionId, secrets.stale);
  await handleSessionResume(
    wsHarness.server,
    "host-consistency-resume",
    {},
    {
      sessionId,
    },
  );
  const wsResponse = wsHarness.sent.find(
    (event) => event?.type === "session.resumed",
  );
  const wsRuntime = wsHarness.emitted.find(
    (event) => event?.type === "session:resume",
  );
  const wsSnapshot = wsResponse?.payload?.sessionSnapshot;
  assert(wsSnapshot?.verified === true, "WebSocket sample unverified");
  assert(
    wsHarness.resumeCalls() === 1,
    "WebSocket session did not resume once",
  );
  assert(
    wsResponse.payload.history.some(
      (message) => message.content === secrets.user,
    ),
    "WebSocket did not replace stale history from canonical JSONL",
  );
  assert(
    !wsResponse.payload.history.some(
      (message) => message.content === secrets.stale,
    ),
    "WebSocket retained stale host history",
  );

  // Independently rebuild the public observation through the store and MCP
  // adapters instead of reusing the canonical reader's private return values.
  const events = store.readVerifiedEvents(sessionId);
  const rebuiltSnapshot = projectSessionHostObservation({
    sessionId,
    events,
    messages: store.rebuildMessages(sessionId),
    recovery: loadMcpLedgerRecovery(sessionId),
  });

  const observations = {
    headless: publicSnapshot(headlessState.snapshot),
    background: publicSnapshot(backgroundSnapshot),
    websocket: publicSnapshot(wsSnapshot),
    rebuiltAdapter: publicSnapshot(rebuiltSnapshot),
  };
  const revisions = Object.values(observations).map(
    (snapshot) => snapshot.revision,
  );
  const heads = Object.values(observations).map(
    (snapshot) => snapshot.head.hash,
  );
  assert(new Set(revisions).size === 1, "host snapshot revisions diverged");
  assert(new Set(heads).size === 1, "host snapshot heads diverged");
  assert(
    observations.headless.terminalState.mcpCalls.outcomeUnknown === 1,
    "unsettled MCP recovery authority was not projected",
  );

  const publicEvidence = JSON.stringify({ observations, wsRuntime });
  for (const secret of Object.values(secrets)) {
    assert(
      !publicEvidence.includes(secret),
      "public host evidence leaked content",
    );
  }
  assert(
    Array.isArray(wsRuntime?.payload?.record?.history) &&
      wsRuntime.payload.record.history.length === 0,
    "runtime resume record exposed transcript history",
  );

  return {
    pass: true,
    sessionId,
    adapterScope: ["headless", "background", "websocket", "rebuiltAdapter"],
    commonRevision: revisions[0],
    commonHeadHash: heads[0],
    messageCount: observations.headless.messages.length,
    mcpRecovery: observations.headless.recoveryAuthority,
    terminalState: observations.headless.terminalState,
    contentFreeControlPlane: true,
    staleHostHistoryReplaced: true,
  };
}

async function runTamperScenario(store, home) {
  process.env.CHAINLESSCHAIN_HOME = home;
  const sessionId = "session-host-consistency-tampered";
  const original = "SESSION_HOST_TAMPER_ORIGINAL_73fe9c";
  const forged = "SESSION_HOST_TAMPER_FORGED___73fe9c";
  const stale = "SESSION_HOST_TAMPER_STALE_0c91f7";
  store.startSession(sessionId, { title: "tamper fixture" });
  store.appendUserMessage(sessionId, original);
  const transcript = store.sessionPath(sessionId);
  const before = readFileSync(transcript, "utf8");
  assert(before.includes(original), "tamper fixture content was not written");
  writeFileSync(transcript, before.replace(original, forged), "utf8");

  const resumeState = readSessionHostResumeState(sessionId);
  assert(resumeState?.snapshot?.verified === false, "tamper was not rejected");
  assert(resumeState.messages === null, "tampered messages were returned");
  assert(resumeState.recovery === null, "tampered recovery was returned");

  const backgroundSnapshot = readBackgroundAttachSessionSnapshot({ sessionId });
  assert(
    backgroundSnapshot?.verified === false,
    "background tamper projection was not fail-closed",
  );

  const wsHarness = createWsHarness(sessionId, stale);
  await handleSessionResume(
    wsHarness.server,
    "host-consistency-tamper",
    {},
    {
      sessionId,
    },
  );
  const wsError = wsHarness.sent.at(-1);
  assert(wsError?.type === "error", "WebSocket tamper did not return an error");
  assert(
    wsError?.payload?.code === "CC_SESSION_HOST_SNAPSHOT_UNVERIFIED",
    "WebSocket tamper returned the wrong error code",
  );
  assert(wsHarness.resumeCalls() === 0, "WebSocket resumed a tampered session");
  assert(
    wsHarness.emitted.length === 0,
    "tampered resume emitted runtime state",
  );

  const publicEvidence = JSON.stringify({
    snapshot: resumeState.snapshot,
    wsError,
  });
  for (const secret of [original, forged, stale]) {
    assert(!publicEvidence.includes(secret), "tamper evidence leaked content");
  }

  return {
    pass: true,
    sessionId,
    errorCode: wsError.payload.code,
    snapshot: publicSnapshot(resumeState.snapshot),
    backgroundRefused: backgroundSnapshot.verified === false,
    websocketRefusedBeforeResume: wsHarness.resumeCalls() === 0,
    contentFreeFailureEvidence: true,
  };
}

export async function runSessionHostConsistencyGate() {
  const started = performance.now();
  const resultFile = outputPath();
  const previousHome = process.env.CHAINLESSCHAIN_HOME;
  const result = {
    schema: RESULT_SCHEMA,
    startedAt: new Date().toISOString(),
    status: "running",
    exactSha: null,
    expectedSha:
      String(process.env.CC_SESSION_HOST_CONSISTENCY_EXPECTED_SHA || "")
        .trim()
        .toLowerCase() || null,
    treeSha: null,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    proofScope: "same-process-host-adapter-conformance",
    limitations: [...LIMITATIONS],
    scenarios: {},
    violations: [],
  };
  let root = null;
  try {
    const repository = exactRepositoryState();
    result.exactSha = repository.commitSha;
    result.treeSha = repository.treeSha;
    result.trackedWorktreeDirty = repository.trackedWorktreeDirty;
    result.gateSourcePathsExact = repository.gateSourcePathsExact;
    if (!/^[0-9a-f]{40,64}$/.test(repository.commitSha)) {
      result.violations.push("could not resolve an exact commit SHA");
    }
    if (result.expectedSha && result.expectedSha !== repository.commitSha) {
      result.violations.push(
        "gate checkout does not match its expected exact SHA",
      );
    }
    if (
      result.expectedSha &&
      (repository.trackedWorktreeDirty || !repository.gateSourcePathsExact)
    ) {
      result.violations.push(
        "exact-SHA gate requires committed gate sources and a clean tracked worktree",
      );
    }
    if (result.expectedSha && result.violations.length > 0) {
      throw new Error("session-host provenance validation failed");
    }

    root = mkdtempSync(join(tmpdir(), "cc-session-host-consistency-"));
    const store = await import("../src/harness/jsonl-session-store.js");

    const runScenario = async (name, task) => {
      const scenarioStarted = performance.now();
      try {
        result.scenarios[name] = await task();
      } catch (error) {
        result.scenarios[name] = {
          pass: false,
          error: {
            name: error?.name || "Error",
            code: error?.code || null,
            message: String(error?.message || error),
          },
          violations: [String(error?.message || error)],
        };
      }
      result.scenarios[name].durationMs = performance.now() - scenarioStarted;
    };

    await runScenario("verifiedHostAgreement", () =>
      runVerifiedHostScenario(store, join(root, "verified-home")),
    );
    await runScenario("tamperRefusal", () =>
      runTamperScenario(store, join(root, "tamper-home")),
    );

    for (const [name, scenario] of Object.entries(result.scenarios)) {
      if (scenario.pass !== true)
        result.violations.push(`${name} did not pass`);
    }
    result.status = result.violations.length === 0 ? "passed" : "failed";
  } catch (error) {
    result.status = "failed";
    result.violations.push(String(error?.message || error));
    result.fatalError = {
      name: error?.name || "Error",
      code: error?.code || null,
      message: String(error?.message || error),
      stack: error?.stack || null,
    };
  } finally {
    if (previousHome === undefined) delete process.env.CHAINLESSCHAIN_HOME;
    else process.env.CHAINLESSCHAIN_HOME = previousHome;
    if (root && existsSync(root)) {
      try {
        rmSync(root, { recursive: true, force: true });
      } catch (error) {
        result.status = "failed";
        result.violations.push(
          `session-host fixture cleanup failed: ${String(error?.message || error)}`,
        );
      }
    }
    result.completedAt = new Date().toISOString();
    result.durationMs = performance.now() - started;
    writeResult(resultFile, result);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(`session host consistency artifact: ${resultFile}\n`);
  }
  if (result.status !== "passed") process.exitCode = 1;
  return result;
}

const invokedAsScript =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) await runSessionHostConsistencyGate();

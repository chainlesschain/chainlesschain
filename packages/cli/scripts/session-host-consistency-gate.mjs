#!/usr/bin/env node

/**
 * CLI session-host projection and per-request WS claim fencing gate.
 *
 * This deliberately does not claim a general session lease, an independent
 * anti-rollback anchor, bounded transcript IO, or power-loss durability. It
 * proves the narrower contract used by the current host adapters: given one
 * fully verified and index-anchored JSONL sample, the REPL admission seam, the
 * headless runner, authenticated background attach, WebSocket resume, and an
 * independently rebuilt projection agree on the same content-free revision
 * and MCP recovery authority. A damaged sample must be rejected before any
 * host side effect or state transition. A separate two-process fixture proves
 * that one request id has one durable owner before model/tool execution.
 */

import { execFileSync, spawn } from "node:child_process";
import {
  appendFileSync,
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
import { PassThrough } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";

import { interactiveAttach } from "../src/commands/background-session.js";
import { WSAgentHandler } from "../src/gateways/ws/ws-agent-handler.js";
import { handleSessionResume } from "../src/gateways/ws/session-protocol.js";
import { startBackgroundSessionServer } from "../src/lib/background-session-transport.js";
import {
  createSessionMcpLedgerSink,
  loadMcpLedgerRecovery,
} from "../src/lib/mcp-call-ledger-store.js";
import { projectSessionHostObservation } from "../src/lib/session-host-snapshot.js";
import {
  commitPreparedReplJsonlResume,
  prepareReplJsonlResumeCandidate,
} from "../src/repl/agent-repl.js";
import { runAgentHeadless } from "../src/runtime/headless-runner.js";
import { runAgentHeadlessStream } from "../src/runtime/headless-stream.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIR, "../../..");
const WS_CLAIM_RACE_WORKER = resolve(
  SCRIPT_DIR,
  "../__tests__/fixtures/session-host-ws-claim-race-worker.mjs",
);
const RESULT_SCHEMA = "cc-cli-session-host-consistency-result/v1";
const MIB = 1024 ** 2;
const GATE_SOURCE_PATHS = [
  ".github/workflows/cli-session-host-consistency.yml",
  ".github/actions/setup-node-deps/action.yml",
  "docs/cli/PROCESS_SPAWN_INVENTORY.generated.md",
  "package.json",
  "package-lock.json",
  "packages/cli/package.json",
  "packages/cli/src/harness/jsonl-session-store.js",
  "packages/cli/src/harness/session-index.js",
  "packages/cli/src/harness/session-list-index.js",
  "packages/cli/src/harness/transcript-integrity.js",
  "packages/cli/src/lib/jsonl-session-store.js",
  "packages/cli/src/lib/session-host-snapshot.js",
  "packages/cli/src/lib/agent-session-export.js",
  "packages/cli/src/lib/session-budget-runtime.js",
  "packages/cli/src/lib/session-resource-budget.js",
  "packages/cli/src/lib/mcp-call-ledger.js",
  "packages/cli/src/lib/mcp-call-ledger-store.js",
  "packages/cli/src/lib/mcp-recovery-adjudication.js",
  "packages/cli/src/lib/background-session-transport.js",
  "packages/cli/src/commands/background-session.js",
  "packages/cli/src/repl/agent-repl.js",
  "packages/cli/src/runtime/headless-runner.js",
  "packages/cli/src/runtime/headless-stream.js",
  "packages/cli/src/gateways/ws/session-protocol.js",
  "packages/cli/src/gateways/ws/ws-agent-handler.js",
  "packages/cli/scripts/session-host-consistency-gate.mjs",
  "packages/cli/__tests__/fixtures/session-host-ws-claim-race-worker.mjs",
  "packages/cli/__tests__/unit/jsonl-session-store.test.js",
  "packages/cli/__tests__/unit/ws-agent-handler.test.js",
  "packages/cli/__tests__/unit/agent-session-export.test.js",
  "packages/cli/__tests__/unit/agent-repl.test.js",
  "packages/cli/__tests__/unit/mcp-call-ledger-store.test.js",
  "packages/cli/__tests__/unit/headless-runner-mcp-ledger.test.js",
  "packages/cli/__tests__/unit/headless-stream.test.js",
  "packages/cli/__tests__/unit/headless-stream-cost-replay.test.js",
  "packages/cli/__tests__/unit/headless-stream-resume.test.js",
  "packages/cli/__tests__/unit/headless-stream-resume-roles.test.js",
  "packages/cli/__tests__/unit/headless-stream-side-effects.test.js",
  "packages/cli/__tests__/integration/ws-bridge-side-effect-resume.test.js",
  "packages/cli/__tests__/unit/remote-session-protocol.test.js",
  "packages/cli/__tests__/unit/session-host-streaming-resume.test.js",
  "packages/cli/__tests__/unit/session-index.test.js",
  "packages/cli/__tests__/unit/session-list-index.test.js",
  "packages/cli/__tests__/unit/session-host-consistency-gate.test.js",
];

const LIMITATIONS = Object.freeze([
  "host adapter agreement is same-process conformance",
  "no general cross-process session lease beyond per-request WS claim fencing",
  "no independent anti-rollback anchor proof",
  "no bounded-resume-IO or long-session performance proof",
  "no 1GB cold-process p95 or RSS evidence",
  "per-request claim and settlement verification remains O(N) under the writer lock",
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

function startWsClaimWorker(args, home) {
  const child = spawn(process.execPath, [WS_CLAIM_RACE_WORKER, ...args], {
    cwd: REPOSITORY_ROOT,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CHAINLESSCHAIN_HOME: home },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const done = new Promise((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => {
      child.kill();
      rejectPromise(new Error("WS claim child process timed out"));
    }, 30_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      rejectPromise(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      resolvePromise({ code, signal, stdout, stderr });
    });
  });
  return { child, done };
}

async function waitForPaths(paths, label) {
  const deadline = Date.now() + 15_000;
  while (!paths.every((filePath) => existsSync(filePath))) {
    if (Date.now() >= deadline) {
      throw new Error(`${label} readiness timed out`);
    }
    await delay(5);
  }
}

function childJson(result, label) {
  assert(
    result.code === 0,
    `${label} exited ${result.code ?? result.signal}: ${result.stderr}`,
  );
  const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  try {
    return JSON.parse(lines.at(-1) || "");
  } catch (cause) {
    throw new Error(`${label} emitted no valid result: ${result.stdout}`, {
      cause,
    });
  }
}

function publicSnapshot(snapshot) {
  return JSON.parse(JSON.stringify(snapshot));
}

function createWsHarness(sessionId, staleMessage, systemPrompt) {
  const sent = [];
  const emitted = [];
  let resumeCalls = 0;
  const session = {
    id: sessionId,
    type: "agent",
    provider: "host-consistency",
    model: "fixture",
    projectRoot: process.cwd(),
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: staleMessage },
    ],
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

async function observeAuthenticatedBackgroundAttach(sessionId, home) {
  const id = `bg-host-consistency-${process.pid}-${Date.now()}`;
  const token = `host-consistency-token-${process.pid}`;
  const transport = await startBackgroundSessionServer({
    id,
    dir: home,
    token,
    onPrompt: () => ({ queued: 1 }),
    getStatus: () => ({ id, phase: "idle", turn: 1 }),
  });
  const input = new PassThrough();
  const output = new PassThrough();
  let snapshot = null;
  try {
    input.end("/detach\n");
    await interactiveAttach(
      id,
      {
        id,
        sessionId,
        status: "running",
        phase: "idle",
        transport: { pipe: transport.pipePath, token },
      },
      {
        input,
        output,
        lines: 1,
        onSessionSnapshot(value) {
          snapshot = value;
        },
      },
    );
    return snapshot;
  } finally {
    await transport.close();
  }
}

function headlessDependencies(store, observations = {}) {
  return {
    sessionExists: store.sessionExists,
    readVerifiedEvents: store.readVerifiedEvents,
    rebuildMessages: store.rebuildMessages,
    readEvents: store.readEvents,
    verifySession: store.verifySession,
    getLastSessionId: () => null,
    startSession: () => null,
    appendUserMessage: () => {},
    appendAssistantMessage: () => {},
    appendTokenUsage: () => {},
    appendToolCallCompact: () => {},
    appendLlmRetryCompact: () => {},
    appendCompactEvent: () => {},
    appendEvent: () => true,
    appendAuthorityEvent: () => true,
    writeOut: (value) => {
      observations.output = observations.output || [];
      observations.output.push(String(value));
    },
    writeErr: () => {},
    bootstrap: async () => {
      observations.bootstrap = (observations.bootstrap || 0) + 1;
      return { db: null };
    },
    executeHooksV2Event: async () => {
      observations.hooks = (observations.hooks || 0) + 1;
      return { ok: true };
    },
    resolveSlashMacro: async () => {
      observations.slashMacro = (observations.slashMacro || 0) + 1;
      return null;
    },
    resolveAgentMcp: async () => {
      observations.mcp = (observations.mcp || 0) + 1;
      return null;
    },
    getApprovalGate: async () => ({
      setSessionPolicy() {},
      setConfirmer() {},
      async decide() {
        return { decision: "allow", via: "gate", policy: "gate" };
      },
    }),
    agentLoop: async function* (messages, options) {
      observations.model = (observations.model || 0) + 1;
      observations.messages = messages;
      observations.loopOptions = options;
      yield { type: "response-complete", content: "gate response" };
      yield { type: "run-ended", reason: "complete" };
    },
  };
}

function createHandlerInteraction() {
  const events = [];
  return {
    events,
    interaction: {
      emit(type, payload) {
        events.push({ type, payload });
      },
    },
  };
}

function assertAlternatingUserAssistant(messages, label) {
  assert(messages.length % 2 === 0, `${label} has an incomplete role pair`);
  for (let index = 0; index < messages.length; index += 1) {
    const expected = index % 2 === 0 ? "user" : "assistant";
    assert(
      messages[index]?.role === expected,
      `${label} role ${index} is not ${expected}`,
    );
  }
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
    compactSummary: "SESSION_HOST_COMPACT_SUMMARY_SECRET_6d9a73",
    stale: "SESSION_HOST_STALE_SECRET_bae793",
    system: "SESSION_HOST_SYSTEM_SECRET_4e96cd",
    restartSystem: "SESSION_HOST_RESTART_SYSTEM_SECRET_20baf1",
    wsUser: "SESSION_HOST_WS_USER_SECRET_30ebc2",
    wsAssistant: "SESSION_HOST_WS_ASSISTANT_SECRET_3aebbf",
  };

  store.startSession(sessionId, {
    title: secrets.title,
    provider: "host-consistency",
    model: "fixture",
  });
  store.appendUserMessage(sessionId, secrets.user);
  store.appendAssistantMessage(sessionId, secrets.assistant);
  store.appendCompactEvent(sessionId, {
    strategy: "host-consistency-fixture",
    messages: [
      { role: "system", content: secrets.compactSummary },
      { role: "user", content: secrets.user },
      { role: "assistant", content: secrets.assistant },
    ],
  });
  const sink = createSessionMcpLedgerSink(sessionId);
  await sink(startedMcpRecord(sessionId), { phase: "started" });

  // Exercise the real REPL admission capability. It reads the canonical
  // transcript once and binds messages + MCP authority to that same head.
  const replCandidate = prepareReplJsonlResumeCandidate(sessionId);
  assert(
    replCandidate?.ok && replCandidate.sessionSnapshot?.verified === true,
    "REPL sample unverified",
  );

  // Exercise the actual headless entrypoint, while keeping persistence writes
  // inert so all adapters observe the same admitted fixture head.
  const headlessObservations = {};
  const headlessResult = await runAgentHeadless(
    {
      prompt: "continue verified fixture",
      resume: sessionId,
      outputFormat: "json",
      cwd: REPOSITORY_ROOT,
      slashMacros: false,
      expandFileRefs: false,
    },
    headlessDependencies(store, headlessObservations),
  );
  const headlessSnapshot =
    headlessObservations.loopOptions?.sessionHostSnapshot || null;
  assert(headlessResult.exitCode === 0, "headless entrypoint failed");
  assert(headlessSnapshot?.verified === true, "headless sample unverified");
  assert(headlessObservations.model === 1, "headless model seam did not run");
  assert(
    headlessObservations.messages?.[0]?.role === "system" &&
      headlessObservations.messages[0].content !== secrets.compactSummary,
    "headless fresh host system prompt did not lead model input",
  );
  assert(
    headlessObservations.messages.filter(
      (message) => message?.content === secrets.compactSummary,
    ).length === 1,
    "headless model input lost or duplicated the canonical system summary",
  );
  assert(
    !headlessObservations.output.join("\n").includes(secrets.compactSummary),
    "headless machine output exposed the canonical system summary",
  );

  // Exercise the authenticated interactive background attach, not its reader
  // helper in isolation.
  const backgroundSnapshot = await observeAuthenticatedBackgroundAttach(
    sessionId,
    home,
  );
  assert(backgroundSnapshot?.verified === true, "background sample unverified");

  // Exercise the actual WebSocket resume seam.  Raw history belongs only to
  // its authenticated direct response; runtime-bus evidence stays content-free.
  const wsHarness = createWsHarness(sessionId, secrets.stale, secrets.system);
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
  assert(
    wsHarness.session.messages[0]?.content === secrets.system,
    "WebSocket resume lost the host-owned system prompt",
  );
  assert(
    wsHarness.session.messages.filter(
      (message) => message?.content === secrets.compactSummary,
    ).length === 1,
    "WebSocket private resume state lost or duplicated the canonical system summary",
  );
  assert(
    !JSON.stringify(wsResponse.payload.history).includes(secrets.compactSummary),
    "WebSocket direct history exposed canonical system context",
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
    repl: publicSnapshot(replCandidate.sessionSnapshot),
    headless: publicSnapshot(headlessSnapshot),
    backgroundAttach: publicSnapshot(backgroundSnapshot),
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

  // A real WS turn must synchronously write through to the canonical JSONL.
  // A fresh host then resumes the new head, proving restart cannot lose or
  // overwrite the accepted turn.
  const handlerEvents = [];
  let handlerModelMessages = null;
  const handler = new WSAgentHandler({
    session: wsHarness.session,
    interaction: {
      emit(type, payload) {
        handlerEvents.push({ type, payload });
      },
    },
    agentLoop: async function* (messages) {
      handlerModelMessages = structuredClone(messages);
      yield { type: "response-complete", content: secrets.wsAssistant };
      yield { type: "run-ended", reason: "complete" };
    },
  });
  await handler.handleMessage(secrets.wsUser, "host-consistency-turn");
  assert(
    handlerEvents.some((event) => event.type === "response-complete"),
    "WebSocket production handler did not complete a turn",
  );
  assert(
    handlerModelMessages?.[0]?.content === secrets.system,
    "WebSocket fresh host system prompt did not lead model input",
  );
  assert(
    handlerModelMessages.filter(
      (message) => message?.content === secrets.compactSummary,
    ).length === 1,
    "WebSocket model input lost or duplicated the canonical system summary",
  );
  assert(
    wsHarness.session.messages.filter(
      (message) => message?.content === secrets.compactSummary,
    ).length === 1,
    "WebSocket settlement refresh lost or duplicated the canonical system summary",
  );
  assert(
    !JSON.stringify(handlerEvents).includes(secrets.compactSummary),
    "WebSocket response events exposed canonical system context",
  );

  const restartHarness = createWsHarness(
    sessionId,
    secrets.stale,
    secrets.restartSystem,
  );
  await handleSessionResume(
    restartHarness.server,
    "host-consistency-restart",
    {},
    { sessionId },
  );
  const restartResponse = restartHarness.sent.find(
    (event) => event?.type === "session.resumed",
  );
  assert(
    restartHarness.session.messages[0]?.content === secrets.restartSystem,
    "restart resume lost its host-owned system prompt",
  );
  assert(
    restartHarness.session.messages.filter(
      (message) => message?.content === secrets.compactSummary,
    ).length === 1,
    "restart resume lost or duplicated the canonical system summary",
  );
  assert(
    !JSON.stringify(restartResponse.payload.history).includes(
      secrets.compactSummary,
    ),
    "restart response history exposed canonical system context",
  );
  assert(
    restartResponse.payload.history.some(
      (message) => message.content === secrets.wsUser,
    ) &&
      restartResponse.payload.history.some(
        (message) => message.content === secrets.wsAssistant,
      ),
    "restart resume lost the synchronously persisted WebSocket turn",
  );
  assert(
    restartResponse.payload.sessionSnapshot.revision !== wsSnapshot.revision,
    "WebSocket turn did not advance the canonical session revision",
  );

  const restartRuntime = restartHarness.emitted.find(
    (event) => event?.type === "session:resume",
  );
  const publicEvidence = JSON.stringify({
    observations,
    wsRuntime,
    restartRuntime,
  });
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
    adapterScope: [
      "repl",
      "headless",
      "backgroundAttach",
      "websocket",
      "rebuiltAdapter",
    ],
    commonRevision: revisions[0],
    commonHeadHash: heads[0],
    messageCount: observations.headless.messages.length,
    mcpRecovery: observations.headless.recoveryAuthority,
    terminalState: observations.headless.terminalState,
    contentFreeControlPlane: true,
    staleHostHistoryReplaced: true,
    hostSystemPromptPreserved: true,
    canonicalSystemSummaryPreserved: true,
    canonicalSystemSummaryContentFree: true,
    websocketRestartRoundTrip: true,
  };
}

async function runWsAtomicTurnScenario(store, home) {
  process.env.CHAINLESSCHAIN_HOME = home;
  const sessionId = "session-host-consistency-ws-atomic";
  const systemPrompt = "WS_ATOMIC_SYSTEM_PRIVATE_8b4bc1";
  const failedInputs = [
    "WS_ATOMIC_THROW_USER_PRIVATE_97e09b",
    "WS_ATOMIC_EMPTY_USER_PRIVATE_e97e80",
    "WS_ATOMIC_APPEND_FAIL_USER_PRIVATE_f0f309",
  ];
  store.startSession(sessionId, {
    title: "WS atomic turn fixture",
    provider: "host-consistency",
    model: "fixture",
  });

  const resumeHarness = async (label) => {
    const harness = createWsHarness(
      sessionId,
      `WS_ATOMIC_STALE_${label}`,
      systemPrompt,
    );
    await handleSessionResume(
      harness.server,
      `ws-atomic-resume-${label}`,
      {},
      { sessionId },
    );
    assert(
      harness.sent.some((event) => event?.type === "session.resumed"),
      `WS atomic ${label} resume failed`,
    );
    return harness;
  };

  const initialMessages = store.rebuildMessages(sessionId);

  const throwHarness = await resumeHarness("throw");
  const throwInteraction = createHandlerInteraction();
  /* eslint-disable require-yield -- deterministic failure before first event */
  const throwHandler = new WSAgentHandler({
    session: throwHarness.session,
    interaction: throwInteraction.interaction,
    agentLoop: async function* () {
      throw new Error("synthetic model failure");
    },
  });
  /* eslint-enable require-yield */
  await throwHandler.handleMessage(failedInputs[0], "req-throw-1");

  const emptyHarness = await resumeHarness("empty");
  const emptyInteraction = createHandlerInteraction();
  const emptyHandler = new WSAgentHandler({
    session: emptyHarness.session,
    interaction: emptyInteraction.interaction,
    agentLoop: async function* () {
      yield { type: "response-complete", content: "" };
      yield { type: "run-ended", reason: "complete" };
    },
  });
  await emptyHandler.handleMessage(failedInputs[1], "req-empty-1");

  const appendFailHarness = await resumeHarness("append-fail");
  const appendFailInteraction = createHandlerInteraction();
  const appendFailHandler = new WSAgentHandler({
    session: appendFailHarness.session,
    interaction: appendFailInteraction.interaction,
    canonicalSessionStore: {
      settleWsTurnClaim() {
        const error = new Error("synthetic settlement append uncertainty");
        error.code = "CC_WS_TURN_SETTLEMENT_UNKNOWN";
        error.commitState = "unknown";
        throw error;
      },
    },
    agentLoop: async function* () {
      yield {
        type: "response-complete",
        content: "WS_ATOMIC_APPEND_FAIL_ASSISTANT_PRIVATE_5107c9",
      };
    },
  });
  await appendFailHandler.handleMessage(failedInputs[2], "req-append-fail-1");

  assert(
    JSON.stringify(store.rebuildMessages(sessionId)) ===
      JSON.stringify(initialMessages),
    "failed/empty/append-failed WS turns polluted canonical history",
  );
  const throwState = store.readVerifiedWsTurnState(sessionId, "req-throw-1");
  const emptyState = store.readVerifiedWsTurnState(sessionId, "req-empty-1");
  const appendFailureState = store.readVerifiedWsTurnState(
    sessionId,
    "req-append-fail-1",
  );
  assert(
    throwState.status === "failed" && emptyState.status === "failed",
    "model throw/empty response did not durably settle failure",
  );
  assert(
    appendFailureState.status === "pending",
    "outcome-unknown settlement was automatically retried or taken over",
  );

  let idempotentModelCalls = 0;
  const retryHarness = await resumeHarness("idempotent");
  const retryInteraction = createHandlerInteraction();
  const retryHandler = new WSAgentHandler({
    session: retryHarness.session,
    interaction: retryInteraction.interaction,
    agentLoop: async function* () {
      idempotentModelCalls += 1;
      yield {
        type: "response-complete",
        content: "WS_ATOMIC_IDEMPOTENT_ASSISTANT_PRIVATE_c80aac",
      };
    },
  });
  await retryHandler.handleMessage(
    "WS_ATOMIC_IDEMPOTENT_USER_PRIVATE_ddf386",
    "req-idempotent-1",
  );
  await retryHandler.handleMessage(
    "WS_ATOMIC_IDEMPOTENT_USER_PRIVATE_ddf386",
    "req-idempotent-1",
  );
  assert(idempotentModelCalls === 1, "same request id reran the model turn");

  let casClaimCalls = 0;
  const casHarness = await resumeHarness("cas");
  const casInteraction = createHandlerInteraction();
  const casHandler = new WSAgentHandler({
    session: casHarness.session,
    interaction: casInteraction.interaction,
    canonicalSessionStore: {
      claimWsTurnIfHead(...args) {
        casClaimCalls += 1;
        if (casClaimCalls === 1) {
          const error = new Error("synthetic stale head");
          error.code = "SESSION_REVISION_STALE";
          throw error;
        }
        return store.claimWsTurnIfHead(...args);
      },
    },
    agentLoop: async function* () {
      yield {
        type: "response-complete",
        content: "WS_ATOMIC_CAS_ASSISTANT_PRIVATE_9c29c2",
      };
    },
  });
  await casHandler.handleMessage(
    "WS_ATOMIC_CAS_USER_PRIVATE_2dc3c0",
    "req-cas-1",
  );
  assert(
    casClaimCalls === 2,
    "stale-head claim CAS did not retry exactly once",
  );

  const [concurrentHarnessA, concurrentHarnessB] = await Promise.all([
    resumeHarness("concurrent-a"),
    resumeHarness("concurrent-b"),
  ]);
  const concurrentInteractionA = createHandlerInteraction();
  const concurrentInteractionB = createHandlerInteraction();
  const concurrentHandlerA = new WSAgentHandler({
    session: concurrentHarnessA.session,
    interaction: concurrentInteractionA.interaction,
    agentLoop: async function* () {
      await Promise.resolve();
      yield {
        type: "response-complete",
        content: "WS_ATOMIC_CONCURRENT_ASSISTANT_A_PRIVATE_ba40f4",
      };
    },
  });
  const concurrentHandlerB = new WSAgentHandler({
    session: concurrentHarnessB.session,
    interaction: concurrentInteractionB.interaction,
    agentLoop: async function* () {
      yield {
        type: "response-complete",
        content: "WS_ATOMIC_CONCURRENT_ASSISTANT_B_PRIVATE_1e8edb",
      };
    },
  });
  await Promise.all([
    concurrentHandlerA.handleMessage(
      "WS_ATOMIC_CONCURRENT_USER_A_PRIVATE_ec7117",
      "req-concurrent-a",
    ),
    concurrentHandlerB.handleMessage(
      "WS_ATOMIC_CONCURRENT_USER_B_PRIVATE_b153ca",
      "req-concurrent-b",
    ),
  ]);

  const events = store.readVerifiedEvents(sessionId);
  const wsTurns = events.filter((event) => event.type === "ws_turn");
  const claims = events.filter((event) => event.type === "ws_turn_claim");
  const completedTurns = wsTurns.filter(
    (event) => event.data?.outcome === "completed",
  );
  const failedTurns = wsTurns.filter(
    (event) => event.data?.outcome === "failed",
  );
  assert(
    completedTurns.length === 4,
    "canonical WS turns were not exactly-once",
  );
  assert(failedTurns.length === 2, "canonical WS failures were not settled");
  assert(
    claims.length === 7,
    "canonical WS claims were not durable exactly once",
  );
  assert(
    new Set(claims.map((event) => event.data.requestId)).size === 7,
    "canonical WS request claims were duplicated",
  );
  const projected = store.rebuildMessages(sessionId);
  assertAlternatingUserAssistant(projected, "canonical WS projection");
  for (const failedInput of failedInputs) {
    assert(
      !projected.some((message) => message.content === failedInput),
      "failed canonical WS input survived projection",
    );
  }

  const restartHarness = await resumeHarness("restart");
  const restartResponse = restartHarness.sent.find(
    (event) => event?.type === "session.resumed",
  );
  assertAlternatingUserAssistant(
    restartResponse.payload.history,
    "restarted WS history",
  );
  assert(
    JSON.stringify(restartResponse.payload.history) ===
      JSON.stringify(projected),
    "restart projection diverged from canonical WS history",
  );
  const runtimeResume = restartHarness.emitted.find(
    (event) => event?.type === "session:resume",
  );
  assert(
    runtimeResume?.payload?.record?.history?.length === 0,
    "WS atomic restart leaked history onto the runtime bus",
  );

  return {
    pass: true,
    sessionId,
    atomicEventCount: completedTurns.length,
    claimEventCount: claims.length,
    failedSettlementCount: failedTurns.length,
    projectedMessageCount: projected.length,
    modelThrowDidNotPersist: true,
    emptyResponseDidNotPersist: true,
    appendFailureDidNotPersist: true,
    sameRequestExactlyOnce: idempotentModelCalls === 1,
    casRetried: casClaimCalls === 2,
    concurrentHandlersSerialized: true,
    roleAlternatingAfterRestart: true,
    contentFreeRuntimeBus: true,
  };
}

async function runWsCrossProcessClaimScenario(store, home) {
  process.env.CHAINLESSCHAIN_HOME = home;
  mkdirSync(home, { recursive: true });
  const controlDir = join(home, "claim-race-control");
  mkdirSync(controlDir, { recursive: true });

  const sessionId = "session-host-consistency-ws-cross-process";
  const requestId = "req-cross-process-1";
  const userMessage = "WS_CROSS_PROCESS_USER_PRIVATE_8ac521";
  store.startSession(sessionId, {
    title: "WS cross-process claim fixture",
    provider: "host-consistency",
    model: "fixture",
  });
  const barrierPath = join(controlDir, "race.release");
  const raceEffectsPath = join(controlDir, "race.effects");
  const readyA = join(controlDir, "race-a.ready");
  const readyB = join(controlDir, "race-b.ready");
  const workerA = startWsClaimWorker(
    [
      "race-a",
      sessionId,
      requestId,
      userMessage,
      readyA,
      barrierPath,
      raceEffectsPath,
      "race",
    ],
    home,
  );
  const workerB = startWsClaimWorker(
    [
      "race-b",
      sessionId,
      requestId,
      userMessage,
      readyB,
      barrierPath,
      raceEffectsPath,
      "race",
    ],
    home,
  );
  await waitForPaths([readyA, readyB], "WS cross-process claim workers");
  writeFileSync(barrierPath, "release\n", "utf8");
  const [rawA, rawB] = await Promise.all([workerA.done, workerB.done]);
  const results = [
    childJson(rawA, "WS claim worker A"),
    childJson(rawB, "WS claim worker B"),
  ];
  const modelCalls = results.reduce(
    (total, result) => total + Number(result.modelCalls || 0),
    0,
  );
  const toolCalls = results.reduce(
    (total, result) => total + Number(result.toolCalls || 0),
    0,
  );
  assert(
    modelCalls === 1,
    "cross-process request executed the model more than once",
  );
  assert(
    toolCalls === 1,
    "cross-process request executed the tool more than once",
  );
  const effectLines = readFileSync(raceEffectsPath, "utf8")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  assert(
    effectLines.filter((line) => line.startsWith("model:")).length === 1,
    "cross-process model side-effect evidence was not exactly-once",
  );
  assert(
    effectLines.filter((line) => line.startsWith("tool:")).length === 1,
    "cross-process tool side-effect evidence was not exactly-once",
  );
  assert(
    results.filter((result) =>
      result.emitted.some((event) => event.type === "response-pending"),
    ).length === 1,
    "competing WS child did not return the durable pending state",
  );
  assert(
    results.filter((result) =>
      result.emitted.some((event) => event.type === "response-complete"),
    ).length === 1,
    "durable WS claim owner did not produce exactly one completion",
  );
  const raceEvents = store.readVerifiedEvents(sessionId);
  assert(
    raceEvents.filter((event) => event.type === "ws_turn_claim").length === 1,
    "cross-process request wrote multiple durable claims",
  );
  assert(
    raceEvents.filter(
      (event) =>
        event.type === "ws_turn" && event.data?.outcome === "completed",
    ).length === 1,
    "cross-process request wrote multiple durable settlements",
  );
  assertAlternatingUserAssistant(
    store.rebuildMessages(sessionId),
    "cross-process WS projection",
  );

  const crashSessionId = "session-host-consistency-ws-claim-crash";
  const crashRequestId = "req-crash-owner-1";
  const crashUser = "WS_CLAIM_CRASH_USER_PRIVATE_329f4a";
  store.startSession(crashSessionId, {
    title: "WS claim crash fixture",
    provider: "host-consistency",
    model: "fixture",
  });
  const crashBarrier = join(controlDir, "crash.release");
  const crashEffectsPath = join(controlDir, "crash.effects");
  const crashReady = join(controlDir, "crash-owner.ready");
  const crashOwner = startWsClaimWorker(
    [
      "crash-owner",
      crashSessionId,
      crashRequestId,
      crashUser,
      crashReady,
      crashBarrier,
      crashEffectsPath,
      "crash-after-claim",
    ],
    home,
  );
  await waitForPaths([crashReady], "WS claim crash owner");
  writeFileSync(crashBarrier, "release\n", "utf8");
  const crashResult = await crashOwner.done;
  assert(
    crashResult.code === 73,
    `WS claim crash owner exited ${crashResult.code ?? crashResult.signal}`,
  );
  assert(
    store.readVerifiedWsTurnState(crashSessionId, crashRequestId).status ===
      "pending",
    "crashed claim owner did not leave durable pending authority",
  );

  const recoveryReady = join(controlDir, "crash-recovery.ready");
  const recovery = startWsClaimWorker(
    [
      "crash-recovery",
      crashSessionId,
      crashRequestId,
      crashUser,
      recoveryReady,
      crashBarrier,
      crashEffectsPath,
      "race",
    ],
    home,
  );
  await waitForPaths([recoveryReady], "WS claim crash recovery");
  const recoveryResult = childJson(
    await recovery.done,
    "WS claim crash recovery",
  );
  assert(
    recoveryResult.modelCalls === 0 && recoveryResult.toolCalls === 0,
    "crashed pending claim was automatically taken over",
  );
  assert(
    recoveryResult.emitted.some(
      (event) =>
        event.type === "response-pending" &&
        event.code === "CC_WS_TURN_PENDING",
    ),
    "crashed pending claim did not return adjudication-required state",
  );

  const replacementReady = join(controlDir, "replacement.ready");
  const replacement = startWsClaimWorker(
    [
      "replacement",
      crashSessionId,
      "req-after-crash-new-id",
      crashUser,
      replacementReady,
      crashBarrier,
      crashEffectsPath,
      "race",
    ],
    home,
  );
  await waitForPaths([replacementReady], "WS replacement request");
  const replacementResult = childJson(
    await replacement.done,
    "WS replacement request",
  );
  assert(
    replacementResult.modelCalls === 1 && replacementResult.toolCalls === 1,
    "new request id could not proceed after an abandoned claim",
  );
  assert(
    store.readVerifiedWsTurnState(crashSessionId, crashRequestId).status ===
      "pending",
    "new request id silently adjudicated the abandoned claim",
  );

  return {
    pass: true,
    sessionId,
    modelCalls,
    toolCalls,
    durableClaimCount: 1,
    durableSettlementCount: 1,
    competingHandlerReturnedPending: true,
    crashedClaimStayedPending: true,
    crashedClaimWasNotTakenOver: true,
    newRequestIdAllowed: true,
  };
}

async function runWsForgedSettlementDuringModelScenario(store, home) {
  process.env.CHAINLESSCHAIN_HOME = home;
  const sessionId = "session-host-consistency-ws-model-tamper";
  const requestId = "req-model-tamper-1";
  const userMessage = "WS_MODEL_TAMPER_USER_PRIVATE_a901d4";
  const forgedAnswer = "WS_MODEL_TAMPER_FORGED_PRIVATE_6bd20e";
  store.startSession(sessionId, {
    title: "WS model-period tamper fixture",
    provider: "host-consistency",
    model: "fixture",
  });
  const harness = createWsHarness(
    sessionId,
    "WS_MODEL_TAMPER_STALE_PRIVATE_38d831",
    "WS_MODEL_TAMPER_SYSTEM_PRIVATE_e35b42",
  );
  await handleSessionResume(
    harness.server,
    "ws-model-tamper-resume",
    {},
    { sessionId },
  );
  const interaction = createHandlerInteraction();
  let modelCalls = 0;
  const handler = new WSAgentHandler({
    session: harness.session,
    interaction: interaction.interaction,
    agentLoop: async function* () {
      modelCalls += 1;
      const claimEvent = store
        .readEvents(sessionId)
        .find((event) => event.type === "ws_turn_claim");
      assert(claimEvent, "model started before the durable WS claim existed");
      const forgedHash = "f".repeat(64);
      appendFileSync(
        store.sessionPath(sessionId),
        `${JSON.stringify({
          type: "ws_turn",
          timestamp: Date.now(),
          data: {
            schemaVersion: 1,
            requestId,
            inputDigest: claimEvent.data.inputDigest,
            opaqueClaimId: claimEvent.data.opaqueClaimId,
            outcome: "completed",
            user: { role: "user", content: userMessage },
            assistant: { role: "assistant", content: forgedAnswer },
          },
          prevHash: "0".repeat(64),
          hash: forgedHash,
        })}\n`,
        "utf8",
      );
      const metaPath = join(home, "sessions", `${sessionId}.meta.json`);
      const meta = JSON.parse(readFileSync(metaPath, "utf8"));
      writeFileSync(
        metaPath,
        `${JSON.stringify({
          ...meta,
          event_count: Number(meta.event_count) + 1,
          message_count: Number(meta.message_count) + 2,
          last_hash: forgedHash,
        })}\n`,
        "utf8",
      );
      yield { type: "response-complete", content: "legitimate answer" };
    },
  });
  await handler.handleMessage(userMessage, requestId);
  assert(modelCalls === 1, "model-period tamper fixture did not run once");
  assert(
    interaction.events.some(
      (event) =>
        event.type === "error" &&
        event.payload.code === "CC_WS_TURN_SETTLEMENT_UNKNOWN",
    ),
    "forged same-request settlement was not rejected fail-closed",
  );
  assert(
    !interaction.events.some((event) => event.type === "response-complete"),
    "forged same-request settlement was returned as a durable response",
  );
  let replayModelCalls = 0;
  const replayInteraction = createHandlerInteraction();
  const replayHandler = new WSAgentHandler({
    session: harness.session,
    interaction: replayInteraction.interaction,
    agentLoop: async function* () {
      replayModelCalls += 1;
      yield { type: "response-complete", content: "must not execute" };
    },
  });
  await replayHandler.handleMessage(userMessage, requestId);
  assert(
    replayModelCalls === 0,
    "tampered same-request authority was automatically replayed",
  );
  assert(
    replayInteraction.events.some(
      (event) =>
        event.type === "error" &&
        event.payload.code === "SESSION_TRANSCRIPT_UNVERIFIED",
    ),
    "tampered same-request authority did not remain fail-closed",
  );

  return {
    pass: true,
    sessionId,
    modelCalls,
    forgedSettlementRejected: true,
    forgedResponseNotReturned: true,
    retryModelCalls: replayModelCalls,
    tamperedRetryRefused: true,
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

  const replCandidate = prepareReplJsonlResumeCandidate(sessionId);
  let replCommitCalls = 0;
  const replCommitted = commitPreparedReplJsonlResume(replCandidate, () => {
    replCommitCalls += 1;
  });
  assert(!replCandidate.ok, "REPL admitted a tampered transcript");
  assert(
    !replCommitted && replCommitCalls === 0,
    "REPL committed tampered state",
  );

  const configPath = join(home, "config.json");
  const headlessObservations = {};
  const headlessResult = await runAgentHeadless(
    {
      prompt: "/config llm.model=forged-model",
      resume: sessionId,
      outputFormat: "json",
      cwd: REPOSITORY_ROOT,
    },
    headlessDependencies(store, headlessObservations),
  );
  assert(headlessResult.exitCode === 1, "headless admitted tampered state");
  assert(
    headlessResult.sessionSnapshot?.verified === false,
    "headless did not expose a content-free refusal snapshot",
  );
  for (const seam of ["bootstrap", "hooks", "slashMacro", "mcp", "model"]) {
    assert(
      Number(headlessObservations[seam] || 0) === 0,
      `headless touched ${seam} before tamper refusal`,
    );
  }
  assert(
    !existsSync(configPath),
    "headless /config wrote before tamper refusal",
  );

  const streamObservations = {};
  const streamOutput = [];
  async function* tamperedStreamInput() {
    streamObservations.input = Number(streamObservations.input || 0) + 1;
    yield `${JSON.stringify({ text: "SESSION_HOST_STREAM_TAMPER_INPUT_7f41d2" })}\n`;
  }
  const streamResult = await runAgentHeadlessStream(
    {
      sessionId,
      cwd: REPOSITORY_ROOT,
      expandFileRefs: false,
    },
    {
      input: tamperedStreamInput(),
      writeOut: (line) => streamOutput.push(line),
      writeErr: () => {},
      sessionExists: store.sessionExists,
      readVerifiedEvents: store.readVerifiedEvents,
      readVerifiedProjection: store.readVerifiedProjection,
      bootstrap: async () => {
        streamObservations.bootstrap =
          Number(streamObservations.bootstrap || 0) + 1;
        return { db: null };
      },
      executeHooksV2Event: async () => {
        streamObservations.hooks = Number(streamObservations.hooks || 0) + 1;
        return { blocked: false, decision: "allow" };
      },
      resolveAgentMcp: async () => {
        streamObservations.mcp = Number(streamObservations.mcp || 0) + 1;
        return null;
      },
      agentLoop: async function* () {
        streamObservations.model = Number(streamObservations.model || 0) + 1;
        yield { type: "response-complete", content: "must not execute" };
      },
      appendUserMessage: () => {
        streamObservations.append = Number(streamObservations.append || 0) + 1;
      },
    },
  );
  assert(streamResult.exitCode === 1, "stream admitted tampered state");
  for (const seam of [
    "input",
    "bootstrap",
    "hooks",
    "mcp",
    "model",
    "append",
  ]) {
    assert(
      Number(streamObservations[seam] || 0) === 0,
      `stream touched ${seam} before tamper refusal`,
    );
  }
  const streamEvidence = streamOutput.join("");
  assert(
    streamEvidence.includes("CC_SESSION_HOST_SNAPSHOT_UNVERIFIED"),
    "stream tamper refusal did not expose the stable error code",
  );
  for (const secret of [
    original,
    forged,
    stale,
    "SESSION_HOST_STREAM_TAMPER_INPUT_7f41d2",
  ]) {
    assert(
      !streamEvidence.includes(secret),
      "stream tamper evidence leaked content",
    );
  }

  let backgroundError = null;
  try {
    await observeAuthenticatedBackgroundAttach(sessionId, home);
  } catch (error) {
    backgroundError = error;
  }
  const backgroundSnapshot = backgroundError?.sessionSnapshot || null;
  assert(
    backgroundError?.code === "CC_SESSION_HOST_SNAPSHOT_UNVERIFIED" &&
      backgroundSnapshot?.verified === false,
    "authenticated background attach did not reject tamper",
  );

  const wsHarness = createWsHarness(sessionId, stale, "tamper-system-prompt");
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
    replSnapshot: replCandidate.sessionSnapshot,
    headlessSnapshot: headlessResult.sessionSnapshot,
    backgroundSnapshot,
    wsError,
  });
  for (const secret of [original, forged, stale]) {
    assert(!publicEvidence.includes(secret), "tamper evidence leaked content");
  }

  return {
    pass: true,
    sessionId,
    errorCode: wsError.payload.code,
    snapshot: publicSnapshot(replCandidate.sessionSnapshot),
    replRefusedBeforeCommit: replCommitCalls === 0,
    headlessRefusedBeforeSideEffects: true,
    streamRefusedBeforeSideEffects: true,
    configWritePrevented: true,
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
    proofScope: "host-adapter-conformance-plus-ws-request-claim-fencing",
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
    await runScenario("wsAtomicTurns", () =>
      runWsAtomicTurnScenario(store, join(root, "ws-atomic-home")),
    );
    await runScenario("wsCrossProcessClaim", () =>
      runWsCrossProcessClaimScenario(store, join(root, "ws-cross-home")),
    );
    await runScenario("wsModelPeriodTamper", () =>
      runWsForgedSettlementDuringModelScenario(
        store,
        join(root, "ws-model-tamper-home"),
      ),
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

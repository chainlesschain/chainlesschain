#!/usr/bin/env node

import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import {
  effectiveBackgroundAgentState,
  hasValidBackgroundAgentStopCleanupProof,
  isSameProcess,
  launchBackgroundAgent,
  readBackgroundAgentLog,
  readBackgroundAgentState,
  removeBackgroundAgent,
  stopBackgroundAgent,
} from "../src/lib/background-agent-supervisor.js";
import {
  BACKGROUND_AGENT_KEEPER_PERSIST_RETRY_TIMEOUT_MS,
  BACKGROUND_AGENT_KEEPER_RETIRE_TIMEOUT_MS,
} from "../src/lib/background-agent-keeper-protocol.js";
import { connectBackgroundSession } from "../src/lib/background-session-transport.js";
import {
  finishAgentWorktree,
  setupAgentWorktree,
} from "../src/lib/agent-worktree.js";
import {
  descendantProcessSnapshot,
  normalizeOperatingSystem,
  resourceCount,
  rssBytes,
} from "./soak-host-metrics.mjs";
import { ioSnapshot } from "./cli-reliability-soak.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIR, "../../..");
export const BACKGROUND_KEEPER_SOAK_RESULT_SCHEMA =
  "chainlesschain.background-agent-keeper-soak.v2";
export const BACKGROUND_KEEPER_SOAK_SMOKE_RESULT_SCHEMA =
  "chainlesschain.background-agent-keeper-soak-smoke.v2";
export const BACKGROUND_KEEPER_SOAK_AGGREGATE_SCHEMA =
  "chainlesschain.background-agent-keeper-soak-aggregate.v2";
export const BACKGROUND_KEEPER_SOAK_SMOKE_AGGREGATE_SCHEMA =
  "chainlesschain.background-agent-keeper-soak-smoke-aggregate.v2";
export const BACKGROUND_KEEPER_SOAK_OPERATING_SYSTEMS = Object.freeze([
  "linux",
  "macos",
  "windows",
]);
const DEFAULT_OUTPUT = join(
  tmpdir(),
  `cc-background-keeper-soak-${process.platform}-${process.pid}.json`,
);
const HARNESS_RESOURCE_SETTLE_MS = 1_000;
export const BACKGROUND_KEEPER_FORMAL_CHECKPOINT_INTERVAL_MS = 5 * 60 * 1_000;
export const BACKGROUND_KEEPER_FORMAL_CHECKPOINT_CYCLES = 1_000;
// The 120s RETIRE contract includes strict preflight/confirmation probes and
// both cleanup persistence windows. A
// worker-disconnect path has one additional 15s final keeper-status write;
// add 5s scheduling margin without widening the independent 30s product gate.
const DEFAULT_CLEANUP_OBSERVER_DEADLINE_MS =
  BACKGROUND_AGENT_KEEPER_RETIRE_TIMEOUT_MS +
  BACKGROUND_AGENT_KEEPER_PERSIST_RETRY_TIMEOUT_MS +
  5_000;

export function createBackgroundKeeperSoakRoot(tempDirectory = tmpdir()) {
  // macOS exposes its temporary directory through /var while the owner-only
  // state policy correctly rejects link traversal. Resolve only the harness's
  // newly-created root so CHAINLESSCHAIN_HOME and the security anchor use the
  // canonical /private/var namespace without weakening secure-fs.
  return realpathSync(
    mkdtempSync(join(tempDirectory, "cc-background-keeper-soak-")),
  );
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(filePath) {
  return sha256(readFileSync(filePath));
}

export function backgroundKeeperSoakDocumentSha256(value) {
  const unsigned = { ...value };
  delete unsigned.integrity;
  return sha256(JSON.stringify(unsigned));
}

export function sealBackgroundKeeperSoakDocument(value) {
  value.integrity = {
    algorithm: "sha256",
    digest: backgroundKeeperSoakDocumentSha256(value),
  };
  return value;
}

function normalizeReleaseCommit(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!/^[0-9a-f]{40,64}$/u.test(normalized)) {
    throw new TypeError("release commit must be a full 40-64 character SHA");
  }
  return normalized;
}

function positiveNumber(value, fallback, label, { integer = false } = {}) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (
    !Number.isFinite(parsed) ||
    parsed <= 0 ||
    (integer && !Number.isSafeInteger(parsed))
  ) {
    throw new TypeError(
      `${label} must be a positive${integer ? " integer" : ""}`,
    );
  }
  return parsed;
}

export function resolveBackgroundKeeperSoakProfile(environment = process.env) {
  const mode = String(environment.CC_BACKGROUND_KEEPER_SOAK_MODE || "smoke")
    .trim()
    .toLowerCase();
  if (!new Set(["smoke", "formal"]).has(mode)) {
    throw new TypeError(
      "CC_BACKGROUND_KEEPER_SOAK_MODE must be smoke or formal",
    );
  }
  const formal = mode === "formal";
  const floor = (value, minimum) => (formal ? Math.max(value, minimum) : value);
  const agents = floor(
    positiveNumber(
      environment.CC_BACKGROUND_KEEPER_SOAK_AGENTS,
      formal ? 20 : 3,
      "agent count",
      { integer: true },
    ),
    formal ? 20 : 2,
  );
  const cleanupDeadlineMs = Math.min(
    30_000,
    positiveNumber(
      environment.CC_BACKGROUND_KEEPER_SOAK_CLEANUP_DEADLINE_MS,
      30_000,
      "cleanup deadline",
      { integer: true },
    ),
  );
  return Object.freeze({
    mode,
    agents,
    durationSeconds: floor(
      positiveNumber(
        environment.CC_BACKGROUND_KEEPER_SOAK_DURATION_SECONDS,
        formal ? 7_200 : 5,
        "duration seconds",
      ),
      formal ? 7_200 : 1,
    ),
    minimumCycles: floor(
      positiveNumber(
        environment.CC_BACKGROUND_KEEPER_SOAK_MIN_CYCLES,
        formal ? 1_000 : 2,
        "minimum cycle count",
        { integer: true },
      ),
      formal ? 1_000 : 1,
    ),
    cleanupDeadlineMs,
    cleanupObserverDeadlineMs: Math.min(
      300_000,
      Math.max(
        positiveNumber(
          environment.CC_BACKGROUND_KEEPER_SOAK_CLEANUP_OBSERVER_DEADLINE_MS,
          formal ? DEFAULT_CLEANUP_OBSERVER_DEADLINE_MS : 60_000,
          "cleanup observer deadline",
          { integer: true },
        ),
        formal ? DEFAULT_CLEANUP_OBSERVER_DEADLINE_MS : cleanupDeadlineMs,
      ),
    ),
    readinessDeadlineMs: Math.min(
      120_000,
      positiveNumber(
        environment.CC_BACKGROUND_KEEPER_SOAK_READINESS_DEADLINE_MS,
        60_000,
        "readiness deadline",
        { integer: true },
      ),
    ),
    maxHarnessRssGrowthMb: positiveNumber(
      environment.CC_BACKGROUND_KEEPER_SOAK_MAX_RSS_GROWTH_MB,
      192,
      "maximum harness RSS growth",
    ),
    maxHarnessResourceGrowth: positiveNumber(
      environment.CC_BACKGROUND_KEEPER_SOAK_MAX_RESOURCE_GROWTH,
      12,
      "maximum harness FD/handle growth",
      { integer: true },
    ),
  });
}

export function shouldWriteBackgroundKeeperCheckpoint({
  mode,
  force = false,
  cycleCount = 0,
  lastCycleCount = 0,
  nowMs,
  lastCheckpointAtMs,
}) {
  if (force || mode !== "formal" || lastCheckpointAtMs == null) return true;
  if (
    !Number.isFinite(nowMs) ||
    !Number.isFinite(lastCheckpointAtMs) ||
    !Number.isFinite(cycleCount) ||
    !Number.isFinite(lastCycleCount) ||
    nowMs < lastCheckpointAtMs ||
    cycleCount < lastCycleCount
  ) {
    return true;
  }
  return (
    cycleCount - lastCycleCount >= BACKGROUND_KEEPER_FORMAL_CHECKPOINT_CYCLES ||
    nowMs - lastCheckpointAtMs >=
      BACKGROUND_KEEPER_FORMAL_CHECKPOINT_INTERVAL_MS
  );
}

export function nearestRankPercentile(values, percentile) {
  const finite = Array.from(values || []).filter(Number.isFinite);
  if (finite.length === 0) return null;
  const sorted = finite.sort((left, right) => left - right);
  const rank = Math.max(
    0,
    Math.min(
      sorted.length - 1,
      Math.ceil((Number(percentile) / 100) * sorted.length) - 1,
    ),
  );
  return sorted[rank];
}

export function summarizeKeeperSoakSamples(samples = []) {
  const cleanup = samples.map((sample) => sample.cleanupMs);
  const durableCleanup = samples.map((sample) => sample.durableCleanupMs);
  const cleanupObservation = samples.map(
    (sample) => sample.cleanupObservationMs,
  );
  const readiness = samples.map((sample) => sample.readinessMs);
  const rss = samples.map((sample) => sample.rssBytes);
  const resources = samples.map((sample) => sample.resourceCount);
  return Object.freeze({
    count: samples.length,
    cleanupP95Ms: nearestRankPercentile(cleanup, 95),
    cleanupMaximumMs: cleanup.length > 0 ? Math.max(...cleanup) : null,
    durableCleanupP95Ms: nearestRankPercentile(durableCleanup, 95),
    durableCleanupMaximumMs:
      durableCleanup.length > 0 ? Math.max(...durableCleanup) : null,
    cleanupObservationP95Ms: nearestRankPercentile(cleanupObservation, 95),
    cleanupObservationMaximumMs:
      cleanupObservation.length > 0 ? Math.max(...cleanupObservation) : null,
    readinessP95Ms: nearestRankPercentile(readiness, 95),
    readinessMaximumMs: readiness.length > 0 ? Math.max(...readiness) : null,
    rssMaximumBytes: rss.filter(Number.isFinite).length
      ? Math.max(...rss.filter(Number.isFinite))
      : null,
    resourceMaximum: resources.filter(Number.isFinite).length
      ? Math.max(...resources.filter(Number.isFinite))
      : null,
  });
}

function atomicWriteJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(temporary, filePath);
}

function git(args, cwd) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${String(result.stderr || "").trim()}`,
    );
  }
  return String(result.stdout || "").trim();
}

function repositoryHead() {
  return git(["rev-parse", "HEAD"], REPOSITORY_ROOT).toLowerCase();
}

function repositoryChanges() {
  const output = git(
    ["status", "--porcelain=v1", "--untracked-files=all"],
    REPOSITORY_ROOT,
  );
  return output ? output.split(/\r?\n/u).filter(Boolean) : [];
}

function initializeFixtureRepository(repository) {
  mkdirSync(repository, { recursive: true });
  git(["init"], repository);
  git(["config", "user.email", "keeper-soak@chainlesschain.local"], repository);
  git(["config", "user.name", "Keeper Soak"], repository);
  writeFileSync(join(repository, "README.md"), "keeper soak fixture\n", "utf8");
  git(["add", "README.md"], repository);
  git(["commit", "-m", "fixture"], repository);
}

function writeFakeAgent(entryPath) {
  const sessionStore = pathToFileURL(
    resolve(SCRIPT_DIR, "../src/harness/jsonl-session-store.js"),
  ).href;
  const sessionLease = pathToFileURL(
    resolve(SCRIPT_DIR, "../src/lib/session-host-lease.js"),
  ).href;
  writeFileSync(
    entryPath,
    [
      'import { appendFileSync } from "node:fs";',
      'import { spawn } from "node:child_process";',
      `import { startSession } from ${JSON.stringify(sessionStore)};`,
      `import { acquireSessionHostLease } from ${JSON.stringify(sessionLease)};`,
      "const args = process.argv.slice(2);",
      "const value = (name) => args[args.indexOf(name) + 1];",
      'const evidence = value("--evidence");',
      'const sessionId = value("--session-id");',
      'const generation = Number(value("--generation"));',
      'const exitAfterMs = Number(value("--exit-after-ms") || 0);',
      'const lease = acquireSessionHostLease(sessionId, { hostKind: "headless" });',
      'startSession(sessionId, { title: "keeper-soak", provider: "test", model: "fake" });',
      "const descendantStartedAt = Date.now();",
      'const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {',
      '  cwd: process.cwd(), stdio: "ignore", windowsHide: true,',
      "});",
      "descendant.unref();",
      "appendFileSync(evidence, `${JSON.stringify({ generation, runtimePid: process.pid, descendantPid: descendant.pid, descendantStartedAt, startedAt: Date.now() })}\\n`);",
      "if (exitAfterMs > 0) {",
      "  setTimeout(() => { lease.release(); process.exit(0); }, exitAfterMs);",
      "} else {",
      "  setInterval(() => {}, 1000);",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
}

export async function pollUntil(
  operation,
  timeoutMs,
  label,
  intervalMs = 50,
  dependencies = {},
) {
  const now = dependencies.now || (() => performance.now());
  const wait =
    dependencies.wait ||
    ((delayMs) =>
      new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs)));
  const deadline = now() + timeoutMs;
  let lastError = null;
  while (now() <= deadline) {
    try {
      const result = await operation();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    const remainingMs = deadline - now();
    if (remainingMs <= 0) break;
    await wait(Math.min(intervalMs, remainingMs));
  }
  // Synchronous Windows host probes can starve this observer. Take one final
  // terminal snapshot, then let persisted timestamps enforce the 30s gate.
  try {
    const result = await operation();
    if (result) return result;
  } catch (error) {
    lastError = error;
  }
  throw new Error(
    `${label} timed out after ${timeoutMs}ms${lastError ? `: ${lastError.message}` : ""}`,
  );
}

export async function confirmKeeperSoakWorktreeRemoval(
  worktree,
  initialRemoval,
  options = {},
) {
  const worktreePath = worktree?.path || worktree?.worktreePath;
  if (!worktreePath) {
    throw new TypeError("keeper soak worktree path is required");
  }
  const pathExists = options.pathExists || existsSync;
  const finish = options.finishAgentWorktree || finishAgentWorktree;
  const timeoutMs = Number.isFinite(Number(options.timeoutMs))
    ? Math.max(1, Number(options.timeoutMs))
    : 30_000;
  const intervalMs = Number.isFinite(Number(options.intervalMs))
    ? Math.max(1, Number(options.intervalMs))
    : 50;
  let latestRemoval = initialRemoval?.worktree ?? initialRemoval ?? null;
  let fallbackAttempts = 0;
  await pollUntil(
    () => {
      // Physical absence is the release invariant. removeBackgroundAgent can
      // legitimately report the idempotent "path already missing" projection
      // when another exact-owned cleanup retired it between probes.
      if (!pathExists(worktreePath)) return true;
      fallbackAttempts += 1;
      // A surviving path is never removed directly. Re-enter the production
      // worktree closer, which revalidates repository registration, branch,
      // base SHA and cleanliness before every destructive attempt.
      latestRemoval = finish(worktree);
      if (latestRemoval?.removed === true && !pathExists(worktreePath)) {
        return true;
      }
      throw new Error(
        `verified worktree cleanup did not retire the path: ${latestRemoval?.reason || "unknown reason"}`,
      );
    },
    timeoutMs,
    `agent worktree ${worktreePath} cleanup`,
    intervalMs,
  );
  return {
    removed: true,
    path: worktreePath,
    initialRemoved: initialRemoval?.worktree?.removed === true,
    fallbackAttempts,
    reason:
      latestRemoval?.reason ||
      (fallbackAttempts === 0 ? "path already absent" : "path retired"),
  };
}

function readEvidence(filePath, generation) {
  if (!existsSync(filePath)) return null;
  for (const line of readFileSync(filePath, "utf8")
    .trim()
    .split(/\r?\n/u)
    .reverse()) {
    if (!line) continue;
    try {
      const record = JSON.parse(line);
      if (Number(record.generation) === generation) return record;
    } catch {
      return null;
    }
  }
  return null;
}

function processIdentities(state, evidence = null) {
  const candidates = [
    [
      "worker",
      state?.workerClaimedPid ?? state?.workerPid ?? state?.pid,
      state?.startedAt,
    ],
    ["worker-wrapper", state?.workerWrapperPid, state?.startedAt],
    ["keeper", state?.keeperPid, state?.keeperStartedAt],
    ["keeper-wrapper", state?.keeperWrapperPid, state?.keeperStartedAt],
    ["agent", state?.agentPid, state?.agentStartedAt],
    ["agent-runtime", state?.agentRuntimePid, state?.agentRuntimeStartedAt],
    [
      "agent-descendant",
      evidence?.descendantPid,
      evidence?.descendantStartedAt,
    ],
  ];
  const seen = new Set();
  return candidates
    .map(([role, value, startedAt]) => ({
      role,
      pid: Number(value),
      startedAt: Number(startedAt),
    }))
    .filter(({ pid }) => {
      if (!Number.isSafeInteger(pid) || pid <= 0 || seen.has(pid)) return false;
      seen.add(pid);
      return true;
    });
}

function processIdentityKey(identity) {
  return `${identity.pid}:${identity.startedAt}`;
}

function ownedIdentityAlive(identity) {
  // Retirement of one exact pid/start-time pair is absorbing. The formal
  // harness intentionally churns thousands of short-lived processes, so a
  // host can reuse the numeric pid immediately after cleanup. Re-probing a
  // previously retired record would then confuse the new process with the old
  // one through the supervisor's intentionally conservative read-only
  // identity tolerance/cache. The product's destructive signal path remains
  // fresh and strict; this flag records that the old identity was already
  // authoritatively observed dead/reused before the next launch batch.
  if (identity?.retired === true) return false;
  return isSameProcess(identity.pid, identity.startedAt);
}

function markKnownIdentitiesRetired(slot, identities) {
  for (const identity of identities) {
    const key = processIdentityKey(identity);
    const known = slot.knownIdentities.get(key);
    if (known) known.retired = true;
  }
}

function sampleProcess(identity) {
  const rss = rssBytes(identity.pid);
  const resource = resourceCount(identity.pid);
  const io = ioSnapshot(identity.pid);
  const descendants = descendantProcessSnapshot(identity.pid);
  return {
    role: identity.role,
    pid: identity.pid,
    rssBytes: rss,
    resourceKind: resource.kind,
    resourceCount: resource.count,
    io,
    descendantSnapshotAvailable: descendants.available,
    descendantCount: descendants.available ? descendants.pids.length : null,
    descendantSource: descendants.source || null,
    descendantReason: descendants.reason || null,
  };
}

function sampleHarnessProcess() {
  const memory = process.memoryUsage();
  return {
    rssBytes: memory.rss,
    heapTotalBytes: memory.heapTotal,
    heapUsedBytes: memory.heapUsed,
    externalBytes: memory.external,
    arrayBuffersBytes: memory.arrayBuffers,
    resource: resourceCount(process.pid),
  };
}

async function waitForReady(slot, profile) {
  const started = performance.now();
  let lastObservation = null;
  let ready;
  try {
    ready = await pollUntil(
      () => {
        const state = readBackgroundAgentState(slot.state.id);
        const evidence = readEvidence(slot.evidencePath, slot.generation);
        lastObservation = {
          state: state
            ? {
                id: state.id,
                status: state.status,
                phase: state.phase || null,
                lostReason: state.lostReason || null,
                workerPid: state.workerPid || null,
                keeperPid: state.keeperPid || null,
                keeperStatus: state.keeperStatus || null,
                keeperError: state.keeperError || null,
                agentPid: state.agentPid || null,
                agentRuntimePid: state.agentRuntimePid || null,
                turnBootstrapStatus: state.turnBootstrapStatus || null,
                turnKeeperStatus: state.turnKeeperStatus || null,
                launchFinalizationUncertain:
                  state.launchFinalizationUncertain === true,
                interactionRecovery: state.interactionRecovery
                  ? {
                      status: state.interactionRecovery.status || null,
                      code: state.interactionRecovery.code || null,
                      message: state.interactionRecovery.message || null,
                    }
                  : null,
              }
            : null,
          evidence: evidence
            ? {
                generation: evidence.generation,
                runtimePid: evidence.runtimePid,
                descendantPid: evidence.descendantPid,
              }
            : null,
        };
        if (
          state?.status === "running" &&
          state.turnBootstrapStatus === "released" &&
          state.turnKeeperStatus === "armed" &&
          Number(state.agentRuntimePid) === Number(evidence?.runtimePid) &&
          Number.isSafeInteger(Number(evidence?.descendantPid))
        ) {
          return { state, evidence };
        }
        return null;
      },
      profile.readinessDeadlineMs,
      `agent ${slot.index} readiness`,
    );
  } catch (error) {
    const state = readBackgroundAgentState(slot.state.id);
    let workerLogTail = null;
    if (state?.logFile && existsSync(state.logFile)) {
      workerLogTail = readFileSync(state.logFile)
        .subarray(-32 * 1024)
        .toString("utf8");
    }
    error.message = `${error.message}; last observation: ${JSON.stringify(lastObservation)}; worker log tail: ${workerLogTail || "<empty>"}`;
    throw error;
  }
  slot.state = ready.state;
  slot.evidence = ready.evidence;
  for (const identity of processIdentities(slot.state, slot.evidence)) {
    if (!Number.isFinite(identity.startedAt) || identity.startedAt <= 0) {
      throw new Error(
        `agent ${slot.index} ${identity.role} omitted a process start anchor`,
      );
    }
    slot.knownIdentities.set(processIdentityKey(identity), {
      ...identity,
      retired: false,
    });
  }
  return performance.now() - started;
}

async function verifyReconnect(slot) {
  const transport = slot.state.transport;
  if (!transport?.pipe || !transport?.token) {
    throw new Error(`agent ${slot.index} did not publish attach transport`);
  }
  const first = await connectBackgroundSession({
    pipePath: transport.pipe,
    token: transport.token,
    timeoutMs: 30_000,
  });
  if (first.hello?.id !== slot.state.id) {
    throw new Error(`agent ${slot.index} first attach binding mismatch`);
  }
  first.close();
  const second = await connectBackgroundSession({
    pipePath: transport.pipe,
    token: transport.token,
    timeoutMs: 30_000,
  });
  if (second.hello?.id !== slot.state.id) {
    throw new Error(`agent ${slot.index} reconnect binding mismatch`);
  }
  second.close();
}

async function launchSlot(slot, fakeAgent, profile) {
  slot.generation += 1;
  slot.evidencePath = join(
    slot.evidenceDirectory,
    `slot-${slot.index}-generation-${slot.generation}.jsonl`,
  );
  const sessionId = `keeper-soak-${process.pid}-${slot.index}-${slot.generation}`;
  const baseArgv = [
    "--evidence",
    slot.evidencePath,
    "--session-id",
    sessionId,
    "--generation",
    String(slot.generation),
  ];
  slot.state = launchBackgroundAgent({
    argv: baseArgv,
    followUpArgv: baseArgv,
    cwd: slot.worktree.path,
    sessionId,
    title: `keeper soak ${slot.index}/${slot.generation}`,
    cliEntry: fakeAgent,
    worktree: slot.worktree,
  });
  slot.launchedIds.push(slot.state.id);
  slot.readinessMs = await waitForReady(slot, profile);
  return slot.readinessMs;
}

export function shouldDeferHardKillCleanupIdentityProbe(state, method) {
  if (method !== "hard-kill") return false;
  return !(
    state?.turnKeeperStatus === "retired" &&
    Number(state.turnKeeperCleanupConfirmedAt) > 0 &&
    Number(state.keeperEndedAt) > 0 &&
    ["worker-disconnected", "closed"].includes(state.keeperStatus)
  );
}

export function hasSettledCooperativeStopCleanup(state) {
  return Boolean(
    state?.status === "stopped" &&
    hasValidBackgroundAgentStopCleanupProof(state),
  );
}

export async function waitForCleanup(
  slot,
  profile,
  startedAt,
  method,
  dependencies = {},
) {
  const readState =
    dependencies.readBackgroundAgentState || readBackgroundAgentState;
  const inspectProcesses = dependencies.processIdentities || processIdentities;
  const identityAlive = dependencies.ownedIdentityAlive || ownedIdentityAlive;
  const stop = dependencies.stopBackgroundAgent || stopBackgroundAgent;
  const readLog = dependencies.readBackgroundAgentLog || readBackgroundAgentLog;
  let observation = null;
  let lastState;
  let lastStopRetryAt = 0;
  const recordObservation = (state, processes) => {
    observation = {
      status: state?.status || null,
      phase: state?.phase || null,
      stopRequestedAt: state?.stopRequestedAt || null,
      stopCleanupConfirmedAt: state?.stopCleanupConfirmedAt || null,
      stopPending: state?.stopPending === true,
      stopPendingReason: state?.stopPendingReason || null,
      launchFinalizationUncertain: state?.launchFinalizationUncertain === true,
      turnLaunchIntent: state?.turnLaunchIntent || null,
      turnLaunchFinalizationUncertain:
        state?.turnLaunchFinalizationUncertain === true,
      turnLaunchTermination: state?.turnLaunchTermination || null,
      turnKeeperStatus: state?.turnKeeperStatus || null,
      turnKeeperCleanupReason: state?.turnKeeperCleanupReason || null,
      turnKeeperCleanupConfirmedAt: state?.turnKeeperCleanupConfirmedAt || null,
      turnKeeperCleanupError: state?.turnKeeperCleanupError || null,
      keeperStatus: state?.keeperStatus || null,
      processes,
    };
  };
  try {
    lastState = await pollUntil(
      () => {
        let state = readState(slot.state.id);
        if (shouldDeferHardKillCleanupIdentityProbe(state, method)) {
          // Twenty concurrent Windows hard-kill slots otherwise serialize
          // hundreds of synchronous WMIC/PowerShell identity probes while
          // their keepers are still performing the bounded cleanup. Wait for
          // the keeper's durable terminal projection first, then verify every
          // exact-owned pid; this preserves the same exit proof without the
          // observer starving the process responsible for producing it.
          recordObservation(
            state,
            inspectProcesses(state || slot.state, slot.evidence).map(
              (identity) => ({ ...identity, alive: null }),
            ),
          );
          return null;
        }
        let identities = inspectProcesses(state || slot.state, slot.evidence);
        let processes = identities.map((identity) => ({
          ...identity,
          alive: identityAlive(identity),
        }));
        let allRetired =
          processes.length > 0 && processes.every(({ alive }) => !alive);
        // Windows identity probes are synchronous and can consume most of the
        // cleanup deadline when 20 slots retire together. The independent
        // keeper can persist `retired` while those probes are running, so do
        // not judge settlement from the pre-probe `armed` snapshot. A single
        // operation is allowed to cross pollUntil's deadline and still return
        // success; refreshing here converts that completed cleanup into the
        // authoritative result instead of reporting a false timeout.
        state = readState(slot.state.id) || state;
        const now = Date.now();
        const stopCleanupSettled = hasSettledCooperativeStopCleanup(state);
        const retryableStopFence = Boolean(
          Number.isFinite(Number(state?.stopRequestedAt)) &&
          Number(state.stopRequestedAt) > 0 &&
          !hasValidBackgroundAgentStopCleanupProof(state),
        );
        if (
          method === "stop" &&
          ((allRetired && state?.status === "running") || retryableStopFence) &&
          !stopCleanupSettled &&
          now - lastStopRetryAt >= 250
        ) {
          // The first bounded stop can legitimately return `stopPending` while
          // a just-signalled tree is still exiting. A running projection is
          // finalized once every exact-owned pid retires. A preexisting stop
          // fence is re-entered even while an exact-owned pid remains live;
          // production re-authorizes every signal from a fresh strict identity
          // probe and owns the eventual confirmation.
          lastStopRetryAt = now;
          state = stop(slot.state.id);
          identities = inspectProcesses(state || slot.state, slot.evidence);
          processes = identities.map((identity) => ({
            ...identity,
            alive: identityAlive(identity),
          }));
          allRetired =
            processes.length > 0 && processes.every(({ alive }) => !alive);
        }
        const keeperSettled =
          method === "hard-kill"
            ? state?.turnKeeperStatus === "retired" &&
              Number(state.turnKeeperCleanupConfirmedAt) > 0
            : hasSettledCooperativeStopCleanup(state);
        recordObservation(state, processes);
        if (
          method === "stop" &&
          allRetired &&
          state?.status !== "stopped" &&
          hasValidBackgroundAgentStopCleanupProof(state)
        ) {
          throw new Error(
            `agent ${slot.index} retained unexpected terminal status ${JSON.stringify(state?.status ?? null)} after stop cleanup proof`,
          );
        }
        if (allRetired && keeperSettled) {
          markKnownIdentitiesRetired(slot, identities);
          return state;
        }
        return null;
      },
      profile.cleanupDeadlineMs,
      `agent ${slot.index} cleanup`,
    );
  } catch (error) {
    const logTail = readLog(slot.state.id, { lines: 40 }).slice(-4_000);
    error.message = `${error.message}; last observation: ${JSON.stringify(observation)}; log tail: ${JSON.stringify(logTail)}`;
    throw error;
  }
  slot.state = lastState;
  return performance.now() - startedAt;
}

export function keeperCleanupTiming(attempt, state, observedAtMonotonicMs) {
  const terminationRequestedAt = Number(attempt?.terminationRequestedAt);
  const terminationStartedAtMonotonicMs = Number(
    attempt?.terminationStartedAtMonotonicMs,
  );
  const cleanupObservationMs =
    Number(observedAtMonotonicMs) - terminationStartedAtMonotonicMs;
  const durableCleanupRequestedAt = Number(
    attempt?.method === "hard-kill"
      ? state?.turnKeeperCleanupRequestedAt
      : state?.stopRequestedAt,
  );
  const cleanupConfirmedAt = Number(
    attempt?.method === "hard-kill"
      ? state?.turnKeeperCleanupConfirmedAt
      : state?.stopCleanupConfirmedAt,
  );
  if (
    ![
      terminationRequestedAt,
      durableCleanupRequestedAt,
      cleanupConfirmedAt,
    ].every((value) => Number.isFinite(value) && value > 0) ||
    durableCleanupRequestedAt < terminationRequestedAt ||
    cleanupConfirmedAt < durableCleanupRequestedAt
  ) {
    const details = {
      id: attempt?.key?.id ?? state?.id ?? null,
      status: state?.status ?? null,
      terminationRequestedAt: attempt?.terminationRequestedAt ?? null,
      durableCleanupRequestedAt:
        attempt?.method === "hard-kill"
          ? (state?.turnKeeperCleanupRequestedAt ?? null)
          : (state?.stopRequestedAt ?? null),
      cleanupConfirmedAt:
        attempt?.method === "hard-kill"
          ? (state?.turnKeeperCleanupConfirmedAt ?? null)
          : (state?.stopCleanupConfirmedAt ?? null),
    };
    throw new Error(
      `agent ${attempt?.key?.slot ?? "unknown"} published invalid ${attempt?.method || "unknown"} cleanup timestamps: ${JSON.stringify(details)}`,
    );
  }
  if (!Number.isFinite(cleanupObservationMs) || cleanupObservationMs < 0) {
    throw new Error(
      `agent ${attempt?.key?.slot ?? "unknown"} produced an invalid cleanup observation duration`,
    );
  }
  return Object.freeze({
    terminationRequestedAt,
    durableCleanupRequestedAt,
    cleanupConfirmedAt,
    cleanupMs: cleanupConfirmedAt - terminationRequestedAt,
    durableCleanupMs: cleanupConfirmedAt - durableCleanupRequestedAt,
    cleanupObservationMs,
  });
}

export function assertKeeperCleanupWithinDeadline(
  sample,
  profile,
  label = "cleanup",
) {
  const deadlineMs = Math.min(Number(profile?.cleanupDeadlineMs), 30_000);
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) {
    throw new Error(`${label} has an invalid cleanup deadline`);
  }
  for (const field of ["durableCleanupMs", "cleanupMs"]) {
    const value = sample?.[field];
    if (!Number.isFinite(value) || value < 0 || value > deadlineMs) {
      throw new Error(
        `${label} ${field} ${Number.isFinite(value) ? `${value}ms` : "is unavailable"} exceeded the ${deadlineMs}ms deadline`,
      );
    }
  }
  if (
    !Number.isFinite(sample?.cleanupObservationMs) ||
    sample.cleanupObservationMs < 0
  ) {
    throw new Error(`${label} cleanupObservationMs is unavailable`);
  }
  return sample;
}

export function prepareSlotTermination(plan, dependencies = {}) {
  const slot = plan?.slot;
  const method = plan?.method;
  if (!slot?.state?.id || !new Set(["hard-kill", "stop"]).has(method)) {
    throw new Error("keeper soak termination plan is invalid");
  }
  const readState =
    dependencies.readBackgroundAgentState || readBackgroundAgentState;
  const inspectProcesses = dependencies.processIdentities || processIdentities;
  const captureMetrics = dependencies.sampleProcess || sampleProcess;
  const state = readState(slot.state.id) || slot.state;
  const identities = inspectProcesses(state, slot.evidence);
  if (identities.length === 0) {
    throw new Error(`agent ${slot.index} has no owned process identity`);
  }
  const sampleIdentity =
    identities.find(
      ({ role }) => role === (slot.index % 2 === 0 ? "keeper" : "worker"),
    ) || identities[0];
  slot.state = state;
  return Object.freeze({
    key: Object.freeze({
      cycle: Number(plan.cycleNumber) || null,
      slot: slot.index,
      generation: slot.generation,
      id: state.id,
    }),
    slot,
    method,
    state,
    metrics: captureMetrics(sampleIdentity),
  });
}

export function triggerSlotTermination(prepared, dependencies = {}) {
  const readState =
    dependencies.readBackgroundAgentState || readBackgroundAgentState;
  const stop = dependencies.stopBackgroundAgent || stopBackgroundAgent;
  const kill = dependencies.kill || process.kill.bind(process);
  const epochNow = dependencies.epochNow || Date.now;
  const monotonicNow = dependencies.monotonicNow || (() => performance.now());
  const state = readState(prepared.key.id) || prepared.state;
  const terminationRequestedAt = epochNow();
  const terminationStartedAtMonotonicMs = monotonicNow();
  let triggerState = state;
  let triggerError = null;
  try {
    if (state.id !== prepared.key.id || state.status !== "running") {
      throw new Error(
        `agent ${prepared.key.slot} changed before termination trigger`,
      );
    }
    if (prepared.method === "hard-kill") {
      const workerPid = Number(state.workerClaimedPid ?? state.workerPid);
      if (!Number.isSafeInteger(workerPid) || workerPid <= 0) {
        throw new Error(`agent ${prepared.key.slot} has no claimed worker pid`);
      }
      kill(workerPid, "SIGKILL");
    } else {
      triggerState = stop(state.id);
    }
  } catch (error) {
    triggerError = error;
  }
  prepared.slot.state = triggerState || state;
  return Object.freeze({
    ...prepared,
    state: triggerState || state,
    terminationRequestedAt,
    terminationStartedAtMonotonicMs,
    terminationDispatchMs: monotonicNow() - terminationStartedAtMonotonicMs,
    triggerError,
  });
}

export async function observeSlotTermination(
  attempt,
  profile,
  dependencies = {},
) {
  const monotonicNow = dependencies.monotonicNow || (() => performance.now());
  const observerDeadlineAtMonotonicMs = Number(
    dependencies.observerDeadlineAtMonotonicMs,
  );
  const observerBudgetMs = Number.isFinite(observerDeadlineAtMonotonicMs)
    ? Math.max(0, observerDeadlineAtMonotonicMs - monotonicNow())
    : profile.cleanupObserverDeadlineMs;
  await waitForCleanup(
    attempt.slot,
    { ...profile, cleanupDeadlineMs: observerBudgetMs },
    attempt.terminationStartedAtMonotonicMs,
    attempt.method,
    dependencies,
  );
  const readState =
    dependencies.readBackgroundAgentState || readBackgroundAgentState;
  const stop = dependencies.stopBackgroundAgent || stopBackgroundAgent;
  const cleanupState =
    effectiveBackgroundAgentState(
      readState(attempt.key.id) || attempt.slot.state,
    ) || attempt.slot.state;
  if (
    cleanupState.turnKeeperCleanupReason !== "worker-disconnected" &&
    attempt.method === "hard-kill"
  ) {
    throw new Error(
      `agent ${attempt.key.slot} keeper recorded ${cleanupState.turnKeeperCleanupReason || "no cleanup reason"}`,
    );
  }
  if (cleanupState.status === "running") stop(attempt.key.id);
  const terminal = readState(attempt.key.id) || cleanupState;
  if (terminal.status === "running") {
    throw new Error(`agent ${attempt.key.slot} remained running after cleanup`);
  }
  const timing = keeperCleanupTiming(attempt, terminal, monotonicNow());
  return Object.freeze({
    ...timing,
    cleanupState: terminal,
    metrics: attempt.metrics,
    triggerError: attempt.triggerError,
  });
}

export async function terminateSlotBatch(plans, profile, dependencies = {}) {
  const prepare =
    dependencies.prepareTermination ||
    ((plan) => prepareSlotTermination(plan, dependencies));
  const trigger =
    dependencies.triggerTermination ||
    ((prepared) => triggerSlotTermination(prepared, dependencies));
  const observe =
    dependencies.observeTermination ||
    ((attempt, _profile, observerDependencies) =>
      observeSlotTermination(attempt, profile, observerDependencies));
  const epochNow = dependencies.epochNow || Date.now;
  const monotonicNow = dependencies.monotonicNow || (() => performance.now());
  const captureObservation = async (attempt, observerDeadlineAtMonotonicMs) => {
    try {
      return {
        status: "fulfilled",
        value: await observe(attempt, profile, {
          ...dependencies,
          observerDeadlineAtMonotonicMs,
        }),
      };
    } catch (reason) {
      return { status: "rejected", reason };
    }
  };

  const prepared = plans.map((plan) => prepare(plan, profile));
  const attempts = new Array(prepared.length);
  const observations = new Array(prepared.length);
  const triggerOrder = prepared
    .map((entry, index) => ({ entry, index }))
    // Hard kills only dispatch one signal and let independent keepers settle.
    // Start that whole cohort before synchronous cooperative stop calls so
    // the formal matrix still exercises concurrent keeper cleanup without
    // charging any slot for another slot's preflight sampling.
    .sort(
      (left, right) =>
        Number(right.entry.method === "hard-kill") -
          Number(left.entry.method === "hard-kill") || left.index - right.index,
    );
  // Bound the serial cooperative-stop phase without starving later healthy
  // stops. Each attempt may use the observer budget from its own trigger, but
  // the batch as a whole gets only one observer budget plus one independent
  // product-cleanup window for each remaining stop. Persistent failures cannot
  // multiply the 140-second observer allowance by the whole cohort.
  const batchObserverStartedAtMonotonicMs = monotonicNow();
  const cooperativeStopCount = prepared.filter(
    (attempt) => attempt.method === "stop",
  ).length;
  const cleanupDeadlineMs = Math.min(
    Number.isFinite(Number(profile.cleanupDeadlineMs)) &&
      Number(profile.cleanupDeadlineMs) > 0
      ? Number(profile.cleanupDeadlineMs)
      : 30_000,
    30_000,
  );
  const batchObserverDeadlineAtMonotonicMs =
    batchObserverStartedAtMonotonicMs +
    profile.cleanupObserverDeadlineMs +
    Math.max(0, cooperativeStopCount - 1) * cleanupDeadlineMs;
  const observerDeadlineFor = (attempt) => {
    const attemptStartedAt = Number(attempt?.terminationStartedAtMonotonicMs);
    const perAttemptDeadline =
      (Number.isFinite(attemptStartedAt)
        ? attemptStartedAt
        : batchObserverStartedAtMonotonicMs) +
      profile.cleanupObserverDeadlineMs;
    return Math.min(perAttemptDeadline, batchObserverDeadlineAtMonotonicMs);
  };
  for (const { entry, index } of triggerOrder) {
    const terminationRequestedAt = epochNow();
    const terminationStartedAtMonotonicMs = monotonicNow();
    try {
      attempts[index] = trigger(entry, profile);
    } catch (triggerError) {
      attempts[index] = Object.freeze({
        ...entry,
        terminationRequestedAt,
        terminationStartedAtMonotonicMs,
        terminationDispatchMs: monotonicNow() - terminationStartedAtMonotonicMs,
        triggerError,
      });
    }
    const attempt = attempts[index];
    const stopRequestedAt = Number(attempt?.state?.stopRequestedAt);
    if (
      attempt?.method === "stop" &&
      Number.isFinite(stopRequestedAt) &&
      stopRequestedAt > 0 &&
      !hasValidBackgroundAgentStopCleanupProof(attempt.state)
    ) {
      // A cooperative stop may return a durable stop fence while its bounded
      // process-exit wait is still pending. On Windows, dispatching the other
      // synchronous stop calls before re-entering that fence can charge their
      // CIM/taskkill work to the first slot's 30-second cleanup measurement.
      // The complete hard-kill cohort has already been dispatched by the sort
      // above. Settle this one fenced stop through the existing strict observer
      // before starting the next cooperative stop; a failed observation is
      // retained while the rest of the batch still gets its cleanup attempt.
      observations[index] = await captureObservation(
        attempt,
        observerDeadlineFor(attempt),
      );
    }
  }
  await Promise.all(
    attempts.map(async (attempt, index) => {
      if (observations[index]) return;
      observations[index] = await captureObservation(
        attempt,
        observerDeadlineFor(attempt),
      );
    }),
  );
  const errors = [
    ...attempts.map((attempt) => attempt?.triggerError).filter(Boolean),
    ...observations
      .filter((observation) => observation.status === "rejected")
      .map((observation) => observation.reason),
  ];
  if (errors.length > 0) {
    throw new AggregateError(
      errors,
      `keeper soak termination batch failed: ${errors
        .map((error) => error?.message || String(error))
        .join("; ")}`,
    );
  }
  return observations.map((observation) => observation.value);
}

async function removeRetiredSlotRecord(slot, keepWorktree) {
  const id = slot.state.id;
  const result = await pollUntil(
    () => {
      try {
        return removeBackgroundAgent(id, { keepWorktree });
      } catch (error) {
        if (error?.code === "BACKGROUND_AGENT_REMOVE_RECOVERY_PENDING") {
          return null;
        }
        throw error;
      }
    },
    30_000,
    `agent ${slot.index} record removal`,
  );
  return result;
}

async function cleanupAfterFailure(slots, profile) {
  const errors = [];
  for (const slot of slots) {
    for (const id of slot.launchedIds) {
      try {
        const state = readBackgroundAgentState(id);
        if (state?.status === "running") stopBackgroundAgent(id);
      } catch (error) {
        errors.push(`stop ${id}: ${error.message}`);
      }
    }
  }
  let processesRetired = false;
  try {
    await pollUntil(
      () => {
        const identities = new Map();
        let recordsTerminal = true;
        for (const slot of slots) {
          for (const [key, identity] of slot.knownIdentities.entries()) {
            identities.set(key, identity);
          }
          for (const id of slot.launchedIds) {
            const state = readBackgroundAgentState(id);
            if (!state) continue;
            if (state.status === "running") {
              recordsTerminal = false;
              try {
                stopBackgroundAgent(id);
              } catch {
                // Preserve the original cleanup error and retry until deadline.
              }
            }
            for (const identity of processIdentities(state, slot.evidence)) {
              identities.set(processIdentityKey(identity), identity);
            }
          }
        }
        return (
          recordsTerminal &&
          [...identities.values()].every(
            (identity) => !ownedIdentityAlive(identity),
          )
        );
      },
      profile.cleanupDeadlineMs,
      "failure cleanup",
    );
    processesRetired = true;
  } catch (error) {
    errors.push(error.message);
  }

  let worktreesRemoved = processesRetired;
  if (processesRetired) {
    for (const slot of slots) {
      for (const id of [...slot.launchedIds].reverse()) {
        try {
          const state = readBackgroundAgentState(id);
          if (!state) continue;
          effectiveBackgroundAgentState(state);
          removeBackgroundAgent(id, { keepWorktree: false });
        } catch (error) {
          errors.push(`remove ${id}: ${error.message}`);
        }
      }
      if (existsSync(slot.worktree.path)) {
        const removal = finishAgentWorktree(slot.worktree);
        if (removal.removed !== true) {
          worktreesRemoved = false;
          errors.push(
            `worktree ${slot.index}: ${removal.reason || "not removed"}`,
          );
        }
      }
    }
  }
  return {
    confirmed: processesRetired && worktreesRemoved,
    processesRetired,
    worktreesRemoved,
    errors,
  };
}

function validateDocumentIntegrity(value, issues) {
  if (
    value?.integrity?.algorithm !== "sha256" ||
    !/^[0-9a-f]{64}$/u.test(String(value?.integrity?.digest || "")) ||
    value.integrity.digest !== backgroundKeeperSoakDocumentSha256(value)
  ) {
    issues.push("integrity digest");
  }
}

function validCleanupEvidence(sample, deadlineMs) {
  const terminationRequestedAt = sample?.terminationRequestedAt;
  const durableCleanupRequestedAt = sample?.durableCleanupRequestedAt;
  const cleanupConfirmedAt = sample?.cleanupConfirmedAt;
  const cleanupMs = sample?.cleanupMs;
  const durableCleanupMs = sample?.durableCleanupMs;
  const cleanupObservationMs = sample?.cleanupObservationMs;
  return Boolean(
    Number.isFinite(terminationRequestedAt) &&
    terminationRequestedAt > 0 &&
    Number.isFinite(durableCleanupRequestedAt) &&
    durableCleanupRequestedAt >= terminationRequestedAt &&
    Number.isFinite(cleanupConfirmedAt) &&
    cleanupConfirmedAt >= durableCleanupRequestedAt &&
    Number.isFinite(cleanupMs) &&
    cleanupMs >= 0 &&
    cleanupMs <= deadlineMs &&
    cleanupMs === cleanupConfirmedAt - terminationRequestedAt &&
    Number.isFinite(durableCleanupMs) &&
    durableCleanupMs >= 0 &&
    durableCleanupMs <= deadlineMs &&
    durableCleanupMs === cleanupConfirmedAt - durableCleanupRequestedAt &&
    Number.isFinite(cleanupObservationMs) &&
    cleanupObservationMs >= 0,
  );
}

function finalSlotCleanupEvidence(slot) {
  return {
    terminationRequestedAt: slot?.finalTerminationRequestedAt,
    durableCleanupRequestedAt: slot?.finalDurableCleanupRequestedAt,
    cleanupConfirmedAt: slot?.finalCleanupConfirmedAt,
    cleanupMs: slot?.finalCleanupMs,
    durableCleanupMs: slot?.finalDurableCleanupMs,
    cleanupObservationMs: slot?.finalCleanupObservationMs,
  };
}

function validateKeeperSoakEvidence(
  value,
  { releaseCommit, allowSmoke = false },
) {
  const issues = [];
  const profile = value?.profile;
  const mode = profile?.mode;
  const formal = mode === "formal";
  const expectedSchema = formal
    ? BACKGROUND_KEEPER_SOAK_RESULT_SCHEMA
    : mode === "smoke"
      ? BACKGROUND_KEEPER_SOAK_SMOKE_RESULT_SCHEMA
      : null;
  const operatingSystem = value?.runner?.operatingSystem;

  validateDocumentIntegrity(value, issues);
  if (value?.schema !== expectedSchema) issues.push("schema");
  if (mode === "smoke" && !allowSmoke) {
    issues.push("non-qualifying smoke is not allowed");
  }
  if (
    value?.qualifyingEvidence !== formal ||
    value?.releaseGateEligible !== formal
  ) {
    issues.push("qualification flags");
  }
  if (
    value?.releaseCommit !== releaseCommit ||
    value?.headSha !== releaseCommit ||
    value?.expectedSha !== releaseCommit
  ) {
    issues.push("exact SHA binding");
  }
  if (value?.exactShaVerified !== true) issues.push("exact SHA verification");
  if (value?.status !== "passed") issues.push("status");
  if (
    value?.source?.clean !== true ||
    value?.source?.changeCount !== 0 ||
    value?.source?.finalClean !== true ||
    value?.source?.finalChangeCount !== 0
  ) {
    issues.push("clean source");
  }
  if (
    !BACKGROUND_KEEPER_SOAK_OPERATING_SYSTEMS.includes(operatingSystem) ||
    normalizeOperatingSystem(value?.platform) !== operatingSystem
  ) {
    issues.push("operating system");
  }

  const minimumAgents = formal ? 20 : 2;
  const minimumDurationSeconds = formal ? 7_200 : 1;
  const minimumCycles = formal ? 1_000 : 1;
  if (
    !Number.isInteger(profile?.agents) ||
    profile.agents < minimumAgents ||
    !Number.isFinite(profile?.durationSeconds) ||
    profile.durationSeconds < minimumDurationSeconds ||
    !Number.isInteger(profile?.minimumCycles) ||
    profile.minimumCycles < minimumCycles ||
    !Number.isInteger(profile?.cleanupDeadlineMs) ||
    profile.cleanupDeadlineMs <= 0 ||
    profile.cleanupDeadlineMs > 30_000 ||
    !Number.isInteger(profile?.cleanupObserverDeadlineMs) ||
    profile.cleanupObserverDeadlineMs <
      (formal
        ? DEFAULT_CLEANUP_OBSERVER_DEADLINE_MS
        : profile.cleanupDeadlineMs) ||
    profile.cleanupObserverDeadlineMs > 300_000 ||
    !Number.isInteger(profile?.readinessDeadlineMs) ||
    profile.readinessDeadlineMs <= 0 ||
    profile.readinessDeadlineMs > (formal ? 120_000 : 60_000) ||
    !Number.isFinite(profile?.maxHarnessRssGrowthMb) ||
    profile.maxHarnessRssGrowthMb <= 0 ||
    profile.maxHarnessRssGrowthMb > 192 ||
    !Number.isInteger(profile?.maxHarnessResourceGrowth) ||
    profile.maxHarnessResourceGrowth <= 0 ||
    profile.maxHarnessResourceGrowth > 12
  ) {
    issues.push("profile floors");
  }
  if (
    !Number.isFinite(value?.continuousDurationSeconds) ||
    value.continuousDurationSeconds < profile?.durationSeconds
  ) {
    issues.push("continuous duration");
  }
  const startedAt = Date.parse(value?.startedAt);
  const finishedAt = Date.parse(value?.finishedAt);
  if (
    !Number.isFinite(startedAt) ||
    !Number.isFinite(finishedAt) ||
    finishedAt < startedAt
  ) {
    issues.push("timestamps");
  }

  if (
    !Array.isArray(value?.slots) ||
    value.slots.length !== profile?.agents ||
    value.slots.some(
      (slot) =>
        slot?.reconnectVerified !== true ||
        slot?.allKnownPidsRetired !== true ||
        slot?.worktreeRemoved !== true ||
        !new Set(["hard-kill", "stop"]).has(slot?.finalMethod) ||
        !validCleanupEvidence(
          finalSlotCleanupEvidence(slot),
          profile?.cleanupDeadlineMs,
        ) ||
        (slot?.finalMethod === "hard-kill" &&
          slot?.finalCleanupReason !== "worker-disconnected"),
    )
  ) {
    issues.push("final PID/worktree cleanup");
  }
  const cycleMethods = new Set(
    Array.isArray(value?.cycles)
      ? value.cycles.map((cycle) => cycle?.method)
      : [],
  );
  if (
    !Array.isArray(value?.cycles) ||
    value.cycles.length < profile?.minimumCycles ||
    !cycleMethods.has("hard-kill") ||
    !cycleMethods.has("stop") ||
    value.cycles.some(
      (cycle, index) =>
        cycle?.cycle !== index + 1 ||
        cycle?.allKnownPidsRetired !== true ||
        cycle?.recordRemoved !== true ||
        !Number.isInteger(cycle?.knownIdentityCount) ||
        cycle.knownIdentityCount <= 0 ||
        !new Set(["hard-kill", "stop"]).has(cycle?.method) ||
        !validCleanupEvidence(cycle, profile?.cleanupDeadlineMs) ||
        (cycle?.method === "hard-kill" &&
          cycle?.cleanupReason !== "worker-disconnected") ||
        !Number.isFinite(cycle?.rssBytes) ||
        cycle?.resourceKind !==
          (operatingSystem === "windows" ? "handle" : "fd") ||
        !Number.isFinite(cycle?.resourceCount),
    )
  ) {
    issues.push("cycle count, metrics or cleanup");
  }
  if (!Array.isArray(value?.violations) || value.violations.length !== 0) {
    issues.push("violations");
  }
  if (value?.failureCleanup != null || value?.fixtureRetainedAt != null) {
    issues.push("failure residue");
  }

  const metrics = value?.metrics;
  const harness = metrics?.harness;
  const beforeRss = harness?.before?.rssBytes;
  const afterRss = harness?.after?.rssBytes;
  const beforeResource = harness?.before?.resource;
  const afterResource = harness?.after?.resource;
  const expectedResourceKind = operatingSystem === "windows" ? "handle" : "fd";
  const rssGrowth =
    Number.isFinite(beforeRss) && Number.isFinite(afterRss)
      ? Math.max(0, afterRss - beforeRss)
      : null;
  const resourceGrowth =
    Number.isFinite(beforeResource?.count) &&
    Number.isFinite(afterResource?.count)
      ? Math.max(0, afterResource.count - beforeResource.count)
      : null;
  if (
    !Number.isFinite(beforeRss) ||
    !Number.isFinite(afterRss) ||
    beforeResource?.kind !== expectedResourceKind ||
    afterResource?.kind !== expectedResourceKind ||
    !Number.isFinite(beforeResource?.count) ||
    !Number.isFinite(afterResource?.count) ||
    harness?.rssGrowthBytes !== rssGrowth ||
    harness?.resourceGrowth !== resourceGrowth ||
    rssGrowth > profile?.maxHarnessRssGrowthMb * 1024 * 1024 ||
    resourceGrowth > profile?.maxHarnessResourceGrowth
  ) {
    issues.push("resource trend");
  }

  if (Array.isArray(value?.cycles) && Array.isArray(value?.slots)) {
    const expectedMetrics = summarizeKeeperSoakSamples([
      ...value.cycles,
      ...value.slots.map((slot) => ({
        cleanupMs: slot.finalCleanupMs,
        durableCleanupMs: slot.finalDurableCleanupMs,
        cleanupObservationMs: slot.finalCleanupObservationMs,
        readinessMs: slot.readinessMs,
        rssBytes: null,
        resourceCount: null,
      })),
    ]);
    const metricKeys = [
      "count",
      "cleanupP95Ms",
      "cleanupMaximumMs",
      "durableCleanupP95Ms",
      "durableCleanupMaximumMs",
      "cleanupObservationP95Ms",
      "cleanupObservationMaximumMs",
      "readinessP95Ms",
      "readinessMaximumMs",
      "rssMaximumBytes",
      "resourceMaximum",
    ];
    if (
      metricKeys.some((key) => metrics?.[key] !== expectedMetrics[key]) ||
      !Number.isFinite(metrics?.rssMaximumBytes) ||
      !Number.isFinite(metrics?.resourceMaximum) ||
      metrics?.cleanupP95Ms > profile?.cleanupDeadlineMs ||
      metrics?.cleanupMaximumMs > profile?.cleanupDeadlineMs ||
      metrics?.durableCleanupP95Ms > profile?.cleanupDeadlineMs ||
      metrics?.durableCleanupMaximumMs > profile?.cleanupDeadlineMs ||
      metrics?.readinessMaximumMs > profile?.readinessDeadlineMs
    ) {
      issues.push("metrics");
    }
  }

  if (issues.length > 0) {
    throw new Error(
      `invalid background Agent keeper soak evidence: ${issues.join(", ")}`,
    );
  }
  return value;
}

export function verifyBackgroundKeeperSoakEvidenceSet(options = {}) {
  const releaseCommit = normalizeReleaseCommit(options.releaseCommit);
  if (!options.evidenceDir) {
    throw new Error(
      "background Agent keeper soak evidence directory is required",
    );
  }
  const evidenceDirectory = resolve(options.evidenceDir);
  const jsonNames = readdirSync(evidenceDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();
  if (jsonNames.length !== BACKGROUND_KEEPER_SOAK_OPERATING_SYSTEMS.length) {
    throw new Error(
      `background Agent keeper soak evidence must contain exactly three JSON files; found ${jsonNames.length}`,
    );
  }

  const entries = jsonNames.map((name) => {
    const filePath = join(evidenceDirectory, name);
    const raw = readFileSync(filePath);
    let value;
    try {
      value = JSON.parse(raw.toString("utf8"));
    } catch (error) {
      throw new Error(
        `could not parse keeper soak evidence ${name}: ${error.message}`,
      );
    }
    return { name, filePath, rawSha256: sha256(raw), value };
  });
  const operatingSystems = entries
    .map((entry) => entry.value?.runner?.operatingSystem)
    .sort();
  if (
    JSON.stringify(operatingSystems) !==
    JSON.stringify(BACKGROUND_KEEPER_SOAK_OPERATING_SYSTEMS)
  ) {
    throw new Error(
      `background Agent keeper soak evidence must contain exactly linux, macos, windows; found ${operatingSystems.join(", ")}`,
    );
  }
  const modes = [
    ...new Set(entries.map((entry) => entry.value?.profile?.mode)),
  ];
  if (modes.length !== 1 || !new Set(["formal", "smoke"]).has(modes[0])) {
    throw new Error(
      `background Agent keeper soak evidence mixes or omits profile modes: ${modes.join(", ")}`,
    );
  }
  const mode = modes[0];
  const allowSmoke = options.allowSmoke === true;
  if (mode === "smoke" && !allowSmoke) {
    throw new Error(
      "background Agent keeper aggregate requires formal evidence; pass --allow-smoke only for a non-qualifying PR aggregate",
    );
  }
  for (const entry of entries) {
    validateKeeperSoakEvidence(entry.value, { releaseCommit, allowSmoke });
  }
  const profileJson = JSON.stringify(entries[0].value.profile);
  if (
    entries.some((entry) => JSON.stringify(entry.value.profile) !== profileJson)
  ) {
    throw new Error(
      "background Agent keeper soak profiles differ across operating systems",
    );
  }
  if (entries.some((entry) => sha256File(entry.filePath) !== entry.rawSha256)) {
    throw new Error(
      "background Agent keeper soak evidence changed during verification",
    );
  }

  entries.sort(
    (left, right) =>
      BACKGROUND_KEEPER_SOAK_OPERATING_SYSTEMS.indexOf(
        left.value.runner.operatingSystem,
      ) -
      BACKGROUND_KEEPER_SOAK_OPERATING_SYSTEMS.indexOf(
        right.value.runner.operatingSystem,
      ),
  );
  const formal = mode === "formal";
  const aggregate = {
    schema: formal
      ? BACKGROUND_KEEPER_SOAK_AGGREGATE_SCHEMA
      : BACKGROUND_KEEPER_SOAK_SMOKE_AGGREGATE_SCHEMA,
    result: formal ? "passed" : "non_qualifying_smoke_passed",
    qualifyingEvidence: formal,
    releaseGateEligible: formal,
    releaseCommit,
    headSha: releaseCommit,
    expectedSha: releaseCommit,
    exactShaVerified: true,
    verifiedAt: new Date().toISOString(),
    operatingSystems: [...BACKGROUND_KEEPER_SOAK_OPERATING_SYSTEMS],
    profile: entries[0].value.profile,
    totals: {
      agents: entries.reduce(
        (total, entry) => total + entry.value.profile.agents,
        0,
      ),
      cycles: entries.reduce(
        (total, entry) => total + entry.value.cycles.length,
        0,
      ),
      continuousDurationSeconds: entries.reduce(
        (total, entry) => total + entry.value.continuousDurationSeconds,
        0,
      ),
      violations: 0,
      survivingPids: 0,
      survivingWorktrees: 0,
      resourceTrendViolations: 0,
    },
    evidence: entries.map((entry) => ({
      file: entry.name,
      operatingSystem: entry.value.runner.operatingSystem,
      durationSeconds: entry.value.continuousDurationSeconds,
      agents: entry.value.profile.agents,
      cycles: entry.value.cycles.length,
      violations: 0,
      survivingPids: 0,
      survivingWorktrees: 0,
      resourceTrendViolations: 0,
      sha256: entry.rawSha256,
      documentDigest: entry.value.integrity.digest,
    })),
  };
  sealBackgroundKeeperSoakDocument(aggregate);
  if (options.output) atomicWriteJson(options.output, aggregate);
  return aggregate;
}

async function main() {
  const profile = resolveBackgroundKeeperSoakProfile();
  const headSha = repositoryHead();
  const expectedShaCandidate = String(
    process.env.CC_BACKGROUND_KEEPER_SOAK_EXPECTED_SHA || "",
  )
    .trim()
    .toLowerCase();
  const expectedSha = expectedShaCandidate
    ? normalizeReleaseCommit(expectedShaCandidate)
    : null;
  if (profile.mode === "formal" && !expectedSha) {
    throw new Error("formal keeper soak requires an exact expected SHA");
  }
  const sourceChanges = repositoryChanges();
  if (expectedSha && expectedSha !== headSha) {
    throw new Error(
      `exact SHA mismatch: expected ${expectedSha}, got ${headSha}`,
    );
  }
  if (expectedSha && sourceChanges.length > 0) {
    throw new Error(
      `exact SHA source verification refused ${sourceChanges.length} worktree change(s)`,
    );
  }

  const output = process.env.CC_BACKGROUND_KEEPER_SOAK_OUTPUT || DEFAULT_OUTPUT;
  const started = performance.now();
  const root = createBackgroundKeeperSoakRoot();
  const repository = join(root, "repository");
  const evidenceDirectory = join(root, "evidence");
  const backgroundDirectory = join(root, "background-agents");
  const home = join(root, "home");
  const securityAnchorHome = join(root, "security-anchors");
  const fakeAgent = join(root, "fake-background-agent.mjs");
  mkdirSync(evidenceDirectory, { recursive: true });
  mkdirSync(securityAnchorHome, { recursive: true });
  initializeFixtureRepository(repository);
  writeFakeAgent(fakeAgent);

  const previousHome = process.env.CHAINLESSCHAIN_HOME;
  const previousSecurityAnchorHome =
    process.env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME;
  const previousBackgroundDirectory = process.env.CC_BACKGROUND_AGENTS_DIR;
  process.env.CHAINLESSCHAIN_HOME = home;
  process.env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME = securityAnchorHome;
  process.env.CC_BACKGROUND_AGENTS_DIR = backgroundDirectory;

  const harnessBefore = sampleHarnessProcess();
  const report = {
    schema:
      profile.mode === "formal"
        ? BACKGROUND_KEEPER_SOAK_RESULT_SCHEMA
        : BACKGROUND_KEEPER_SOAK_SMOKE_RESULT_SCHEMA,
    status: "running",
    qualifyingEvidence: profile.mode === "formal",
    releaseGateEligible: profile.mode === "formal",
    releaseCommit: headSha,
    headSha,
    expectedSha,
    exactShaVerified:
      Boolean(expectedSha) && expectedSha === headSha && !sourceChanges.length,
    source: {
      clean: sourceChanges.length === 0,
      changeCount: sourceChanges.length,
      finalClean: null,
      finalChangeCount: null,
    },
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    runner: {
      operatingSystem: normalizeOperatingSystem(),
      platform: process.platform,
      architecture: process.arch,
      nodeVersion: process.version,
    },
    profile,
    startedAt: new Date().toISOString(),
    slots: [],
    cycles: [],
    violations: [],
  };
  let lastCheckpointAtMs = null;
  let lastCheckpointCycleCount = 0;
  const checkpoint = ({ force = false } = {}) => {
    const nowMs = performance.now();
    const cycleCount = report.cycles.length;
    if (
      !shouldWriteBackgroundKeeperCheckpoint({
        mode: profile.mode,
        force,
        cycleCount,
        lastCycleCount: lastCheckpointCycleCount,
        nowMs,
        lastCheckpointAtMs,
      })
    ) {
      return false;
    }
    sealBackgroundKeeperSoakDocument(report);
    atomicWriteJson(output, report);
    lastCheckpointAtMs = nowMs;
    lastCheckpointCycleCount = cycleCount;
    return true;
  };
  checkpoint({ force: true });

  const slots = [];
  let signal = null;
  let fixtureCleanupAllowed = false;
  const onSignal = (received) => {
    signal = received;
  };
  process.once("SIGINT", () => onSignal("SIGINT"));
  process.once("SIGTERM", () => onSignal("SIGTERM"));
  if (process.platform === "win32") {
    process.once("SIGBREAK", () => onSignal("SIGBREAK"));
  }

  try {
    for (let index = 0; index < profile.agents; index += 1) {
      const worktree = setupAgentWorktree({
        cwd: repository,
        now: new Date(Date.now() + index * 1_000),
      });
      slots.push({
        index,
        worktree,
        evidenceDirectory,
        evidencePath: null,
        evidence: null,
        generation: 0,
        state: null,
        knownIdentities: new Map(),
        launchedIds: [],
      });
    }

    await Promise.all(
      slots.map((slot) => launchSlot(slot, fakeAgent, profile)),
    );
    await Promise.all(slots.map((slot) => verifyReconnect(slot)));
    report.slots = slots.map((slot, index) => ({
      index: slot.index,
      worktreePath: slot.worktree.path,
      readinessMs: slots[index].readinessMs,
      reconnectVerified: true,
    }));
    checkpoint({ force: true });

    const deadline = Date.now() + profile.durationSeconds * 1_000;
    let cycle = 0;
    while (Date.now() < deadline || cycle < profile.minimumCycles) {
      if (signal) throw new Error(`soak interrupted by ${signal}`);
      const remainingRequired = Math.max(0, profile.minimumCycles - cycle);
      const batchSize =
        Date.now() < deadline
          ? slots.length
          : Math.min(slots.length, remainingRequired);
      const plans = Array.from({ length: batchSize }, (_, offset) => {
        const cycleNumber = cycle + offset + 1;
        return {
          cycleNumber,
          slot: slots[(cycle + offset) % slots.length],
          method: (cycleNumber - 1) % 2 === 0 ? "hard-kill" : "stop",
        };
      });
      const terminated = await terminateSlotBatch(plans, profile);
      const removals = await Promise.all(
        plans.map(({ slot }) => removeRetiredSlotRecord(slot, true)),
      );
      const samples = plans.map((plan, index) => {
        const { cycleNumber, slot, method } = plan;
        const settlement = terminated[index];
        const removal = removals[index];
        return {
          cycle: cycleNumber,
          slot: slot.index,
          generation: slot.generation,
          method,
          readinessMs: slot.readinessMs,
          cleanupMs: settlement.cleanupMs,
          durableCleanupMs: settlement.durableCleanupMs,
          cleanupObservationMs: settlement.cleanupObservationMs,
          terminationRequestedAt: settlement.terminationRequestedAt,
          durableCleanupRequestedAt: settlement.durableCleanupRequestedAt,
          cleanupReason: settlement.cleanupState.turnKeeperCleanupReason,
          cleanupConfirmedAt: settlement.cleanupConfirmedAt,
          knownIdentityCount: slot.knownIdentities.size,
          allKnownPidsRetired: [...slot.knownIdentities.values()].every(
            (identity) => !ownedIdentityAlive(identity),
          ),
          recordRemoved: removal.removed === true,
          worktreeRetained: existsSync(slot.worktree.path),
          ...(settlement.metrics || {}),
        };
      });
      report.cycles.push(...samples);
      for (const sample of samples) {
        assertKeeperCleanupWithinDeadline(
          sample,
          profile,
          `cycle ${sample.cycle}`,
        );
        if (!sample.allKnownPidsRetired) {
          throw new Error(`cycle ${sample.cycle} retained an owned pid`);
        }
      }
      const restartReadiness = await Promise.all(
        plans.map(({ slot }) => launchSlot(slot, fakeAgent, profile)),
      );
      for (let index = 0; index < samples.length; index += 1) {
        samples[index].restartReadinessMs = restartReadiness[index];
      }
      await Promise.all(plans.map(({ slot }) => verifyReconnect(slot)));
      cycle += plans.length;
      checkpoint();
    }

    const finalPlans = slots.map((slot, index) => ({
      slot,
      method: index % 2 === 0 ? "hard-kill" : "stop",
    }));
    const finalSettlements = await terminateSlotBatch(finalPlans, profile);
    for (let index = 0; index < slots.length; index += 1) {
      const slot = slots[index];
      const settlement = finalSettlements[index];
      const removal = await removeRetiredSlotRecord(slot, false);
      const worktreeRemoval = await confirmKeeperSoakWorktreeRemoval(
        slot.worktree,
        removal,
        { timeoutMs: profile.cleanupDeadlineMs },
      );
      report.slots[index] = {
        ...report.slots[index],
        finalMethod: finalPlans[index].method,
        finalCleanupMs: settlement.cleanupMs,
        finalDurableCleanupMs: settlement.durableCleanupMs,
        finalCleanupObservationMs: settlement.cleanupObservationMs,
        finalTerminationRequestedAt: settlement.terminationRequestedAt,
        finalDurableCleanupRequestedAt: settlement.durableCleanupRequestedAt,
        finalCleanupConfirmedAt: settlement.cleanupConfirmedAt,
        finalCleanupReason: settlement.cleanupState.turnKeeperCleanupReason,
        allKnownPidsRetired: [...slot.knownIdentities.values()].every(
          (identity) => !ownedIdentityAlive(identity),
        ),
        worktreeRemoved: worktreeRemoval.removed,
        worktreeRemovalReason: worktreeRemoval.reason,
        worktreeRemovalFallbackAttempts: worktreeRemoval.fallbackAttempts,
      };
    }
    for (const slot of report.slots) {
      assertKeeperCleanupWithinDeadline(
        {
          cleanupMs: slot.finalCleanupMs,
          durableCleanupMs: slot.finalDurableCleanupMs,
          cleanupObservationMs: slot.finalCleanupObservationMs,
        },
        profile,
        `agent ${slot.index} final cleanup`,
      );
    }

    // The final Windows identity/CIM sweep is synchronous. It can prove every
    // child dead before libuv gets a turn to deliver the corresponding close
    // callbacks, so an immediate process-handle sample counts already-retired
    // worker/keeper handles as growth. Drain one bounded event-loop interval;
    // the unchanged resource cap still rejects handles that remain open.
    await new Promise((resolvePromise) =>
      setTimeout(resolvePromise, HARNESS_RESOURCE_SETTLE_MS),
    );
    const harnessAfter = sampleHarnessProcess();
    const allSamples = [
      ...report.cycles,
      ...report.slots.map((slot) => ({
        cleanupMs: slot.finalCleanupMs,
        durableCleanupMs: slot.finalDurableCleanupMs,
        cleanupObservationMs: slot.finalCleanupObservationMs,
        readinessMs: slot.readinessMs,
        rssBytes: null,
        resourceCount: null,
      })),
    ];
    report.metrics = {
      ...summarizeKeeperSoakSamples(allSamples),
      harness: {
        before: harnessBefore,
        after: harnessAfter,
        rssGrowthBytes: Math.max(
          0,
          harnessAfter.rssBytes - harnessBefore.rssBytes,
        ),
        resourceGrowth:
          Number.isFinite(harnessAfter.resource.count) &&
          Number.isFinite(harnessBefore.resource.count)
            ? Math.max(
                0,
                harnessAfter.resource.count - harnessBefore.resource.count,
              )
            : null,
      },
    };
    if (report.metrics.cleanupMaximumMs > profile.cleanupDeadlineMs) {
      report.violations.push("cleanup maximum exceeded the owned deadline");
    }
    if (report.metrics.durableCleanupMaximumMs > profile.cleanupDeadlineMs) {
      report.violations.push(
        "durable cleanup maximum exceeded the owned deadline",
      );
    }
    if (
      report.metrics.harness.rssGrowthBytes >
      profile.maxHarnessRssGrowthMb * 1024 * 1024
    ) {
      report.violations.push("harness RSS growth exceeded the configured cap");
    }
    if (
      Number.isFinite(report.metrics.harness.resourceGrowth) &&
      report.metrics.harness.resourceGrowth > profile.maxHarnessResourceGrowth
    ) {
      report.violations.push(
        "harness FD/handle growth exceeded the configured cap",
      );
    }
    if (report.slots.some((slot) => !slot.allKnownPidsRetired)) {
      report.violations.push("one or more owned process identities survived");
    }
    if (report.slots.some((slot) => !slot.worktreeRemoved)) {
      report.violations.push("one or more clean background worktrees survived");
    }
    fixtureCleanupAllowed = report.slots.every(
      (slot) => slot.allKnownPidsRetired && slot.worktreeRemoved,
    );
    report.status = report.violations.length === 0 ? "passed" : "failed";
  } catch (error) {
    report.status = "failed";
    report.violations.push(error?.stack || error?.message || String(error));
    report.failureCleanup = await cleanupAfterFailure(slots, profile);
    fixtureCleanupAllowed = report.failureCleanup.confirmed;
    if (!fixtureCleanupAllowed) {
      report.violations.push(
        "failure cleanup could not confirm process and worktree retirement",
      );
    }
  } finally {
    if (previousHome === undefined) delete process.env.CHAINLESSCHAIN_HOME;
    else process.env.CHAINLESSCHAIN_HOME = previousHome;
    if (previousSecurityAnchorHome === undefined) {
      delete process.env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME;
    } else {
      process.env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME =
        previousSecurityAnchorHome;
    }
    if (previousBackgroundDirectory === undefined) {
      delete process.env.CC_BACKGROUND_AGENTS_DIR;
    } else {
      process.env.CC_BACKGROUND_AGENTS_DIR = previousBackgroundDirectory;
    }
    const finalSourceChanges = repositoryChanges();
    report.source.finalClean = finalSourceChanges.length === 0;
    report.source.finalChangeCount = finalSourceChanges.length;
    if (expectedSha && finalSourceChanges.length > 0) {
      report.status = "failed";
      report.violations.push(
        `exact SHA final source verification refused ${finalSourceChanges.length} worktree change(s)`,
      );
    }
    report.continuousDurationSeconds =
      Math.round((performance.now() - started) * 1_000) / 1_000_000;
    report.finishedAt = new Date().toISOString();
    checkpoint({ force: true });
    if (fixtureCleanupAllowed) {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        try {
          rmSync(root, { recursive: true, force: true });
          break;
        } catch (error) {
          if (attempt === 39) {
            report.status = "failed";
            report.violations.push(`fixture cleanup failed: ${error.message}`);
            checkpoint({ force: true });
            break;
          }
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
        }
      }
    } else {
      report.fixtureRetainedAt = root;
      checkpoint({ force: true });
    }
  }
  process.stdout.write(
    `${JSON.stringify({ status: report.status, output })}\n`,
  );
  process.exit(report.status === "passed" ? 0 : 1);
}

const invoked =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invoked) {
  try {
    const options = {};
    for (let index = 2; index < process.argv.length; index += 1) {
      const argument = process.argv[index];
      if (argument === "--verify-evidence-dir") {
        options.evidenceDir = process.argv[++index];
      } else if (argument === "--release-commit") {
        options.releaseCommit = process.argv[++index];
      } else if (argument === "--output") {
        options.output = process.argv[++index];
      } else if (argument === "--allow-smoke") {
        options.allowSmoke = true;
      } else {
        throw new Error(`unknown argument: ${argument}`);
      }
    }
    if (options.evidenceDir) {
      const aggregate = verifyBackgroundKeeperSoakEvidenceSet(options);
      process.stdout.write(
        `verified background Agent keeper ${aggregate.profile.mode} ${aggregate.releaseCommit}: ${aggregate.totals.cycles} cycles across linux, macos, windows; ${aggregate.releaseGateEligible ? "release-gate eligible" : "non-qualifying smoke only"}\n`,
      );
    } else {
      if (
        options.releaseCommit ||
        options.output ||
        options.allowSmoke === true
      ) {
        throw new Error(
          "aggregate verification options require --verify-evidence-dir",
        );
      }
      await main();
    }
  } catch (error) {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  }
}

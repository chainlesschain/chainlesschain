#!/usr/bin/env node

import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
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
  isSameProcess,
  launchBackgroundAgent,
  readBackgroundAgentState,
  removeBackgroundAgent,
  stopBackgroundAgent,
} from "../src/lib/background-agent-supervisor.js";
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
  "chainlesschain.background-agent-keeper-soak.v1";
export const BACKGROUND_KEEPER_SOAK_SMOKE_RESULT_SCHEMA =
  "chainlesschain.background-agent-keeper-soak-smoke.v1";
export const BACKGROUND_KEEPER_SOAK_AGGREGATE_SCHEMA =
  "chainlesschain.background-agent-keeper-soak-aggregate.v1";
export const BACKGROUND_KEEPER_SOAK_SMOKE_AGGREGATE_SCHEMA =
  "chainlesschain.background-agent-keeper-soak-smoke-aggregate.v1";
export const BACKGROUND_KEEPER_SOAK_OPERATING_SYSTEMS = Object.freeze([
  "linux",
  "macos",
  "windows",
]);
const DEFAULT_OUTPUT = join(
  tmpdir(),
  `cc-background-keeper-soak-${process.platform}-${process.pid}.json`,
);

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
    cleanupDeadlineMs: Math.min(
      60_000,
      positiveNumber(
        environment.CC_BACKGROUND_KEEPER_SOAK_CLEANUP_DEADLINE_MS,
        30_000,
        "cleanup deadline",
        { integer: true },
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
  const readiness = samples.map((sample) => sample.readinessMs);
  const rss = samples.map((sample) => sample.rssBytes);
  const resources = samples.map((sample) => sample.resourceCount);
  return Object.freeze({
    count: samples.length,
    cleanupP95Ms: nearestRankPercentile(cleanup, 95),
    cleanupMaximumMs: cleanup.length > 0 ? Math.max(...cleanup) : null,
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

async function pollUntil(operation, timeoutMs, label, intervalMs = 50) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() <= deadline) {
    try {
      const result = await operation();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) =>
      setTimeout(resolvePromise, intervalMs),
    );
  }
  throw new Error(
    `${label} timed out after ${timeoutMs}ms${lastError ? `: ${lastError.message}` : ""}`,
  );
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

function ownedIdentityAlive(identity) {
  return isSameProcess(identity.pid, identity.startedAt);
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

async function waitForReady(slot, profile) {
  const started = performance.now();
  const ready = await pollUntil(
    () => {
      const state = readBackgroundAgentState(slot.state.id);
      const evidence = readEvidence(slot.evidencePath, slot.generation);
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
  slot.state = ready.state;
  slot.evidence = ready.evidence;
  for (const identity of processIdentities(slot.state, slot.evidence)) {
    if (!Number.isFinite(identity.startedAt) || identity.startedAt <= 0) {
      throw new Error(
        `agent ${slot.index} ${identity.role} omitted a process start anchor`,
      );
    }
    slot.knownIdentities.set(`${identity.pid}:${identity.startedAt}`, identity);
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

async function waitForCleanup(slot, profile, startedAt, method) {
  let observation = null;
  let lastState;
  try {
    lastState = await pollUntil(
      () => {
        const state = readBackgroundAgentState(slot.state.id);
        const identities = processIdentities(
          state || slot.state,
          slot.evidence,
        );
        const processes = identities.map((identity) => ({
          ...identity,
          alive: ownedIdentityAlive(identity),
        }));
        const allRetired = processes.every(({ alive }) => !alive);
        const keeperSettled =
          method === "hard-kill"
            ? state?.turnKeeperStatus === "retired" &&
              Number(state.turnKeeperCleanupConfirmedAt) > 0
            : state?.status === "stopped";
        observation = {
          status: state?.status || null,
          phase: state?.phase || null,
          turnKeeperStatus: state?.turnKeeperStatus || null,
          turnKeeperCleanupReason: state?.turnKeeperCleanupReason || null,
          turnKeeperCleanupConfirmedAt:
            state?.turnKeeperCleanupConfirmedAt || null,
          keeperStatus: state?.keeperStatus || null,
          processes,
        };
        return allRetired && keeperSettled ? state : null;
      },
      profile.cleanupDeadlineMs,
      `agent ${slot.index} cleanup`,
    );
  } catch (error) {
    error.message = `${error.message}; last observation: ${JSON.stringify(observation)}`;
    throw error;
  }
  slot.state = lastState;
  return performance.now() - startedAt;
}

async function terminateSlot(slot, profile, method) {
  const state = readBackgroundAgentState(slot.state.id) || slot.state;
  slot.state = state;
  const sampleIdentity =
    processIdentities(state, slot.evidence).find(
      ({ role }) => role === (slot.index % 2 === 0 ? "keeper" : "worker"),
    ) || processIdentities(state, slot.evidence)[0];
  const metrics = sampleIdentity ? sampleProcess(sampleIdentity) : null;
  const started = performance.now();
  if (method === "hard-kill") {
    const workerPid = Number(state.workerClaimedPid ?? state.workerPid);
    if (!Number.isSafeInteger(workerPid) || workerPid <= 0) {
      throw new Error(`agent ${slot.index} has no claimed worker pid`);
    }
    process.kill(workerPid, "SIGKILL");
  } else {
    stopBackgroundAgent(state.id);
  }
  const cleanupMs = await waitForCleanup(slot, profile, started, method);
  const cleanupState =
    effectiveBackgroundAgentState(
      readBackgroundAgentState(state.id) || slot.state,
    ) || slot.state;
  if (
    cleanupState.turnKeeperCleanupReason !== "worker-disconnected" &&
    method === "hard-kill"
  ) {
    throw new Error(
      `agent ${slot.index} keeper recorded ${cleanupState.turnKeeperCleanupReason || "no cleanup reason"}`,
    );
  }
  if (cleanupState.status === "running") stopBackgroundAgent(state.id);
  const terminal = readBackgroundAgentState(state.id) || cleanupState;
  if (terminal.status === "running") {
    throw new Error(`agent ${slot.index} remained running after cleanup`);
  }
  return { cleanupMs, cleanupState: terminal, metrics };
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
              identities.set(`${identity.pid}:${identity.startedAt}`, identity);
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
    !Number.isInteger(profile?.readinessDeadlineMs) ||
    profile.readinessDeadlineMs <= 0 ||
    profile.readinessDeadlineMs > 60_000 ||
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
        slot?.worktreeRemoved !== true,
    )
  ) {
    issues.push("final PID/worktree cleanup");
  }
  if (
    !Array.isArray(value?.cycles) ||
    value.cycles.length < profile?.minimumCycles ||
    value.cycles.some(
      (cycle, index) =>
        cycle?.cycle !== index + 1 ||
        cycle?.allKnownPidsRetired !== true ||
        cycle?.recordRemoved !== true ||
        !Number.isInteger(cycle?.knownIdentityCount) ||
        cycle.knownIdentityCount <= 0 ||
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
        readinessMs: slot.readinessMs,
        rssBytes: null,
        resourceCount: null,
      })),
    ]);
    const metricKeys = [
      "count",
      "cleanupP95Ms",
      "cleanupMaximumMs",
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
  const root = mkdtempSync(join(tmpdir(), "cc-background-keeper-soak-"));
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

  const harnessBefore = {
    rssBytes: process.memoryUsage().rss,
    resource: resourceCount(process.pid),
  };
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
  const checkpoint = () => {
    sealBackgroundKeeperSoakDocument(report);
    atomicWriteJson(output, report);
  };
  checkpoint();

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
    checkpoint();

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
      const terminated = await Promise.all(
        plans.map(({ slot, method }) => terminateSlot(slot, profile, method)),
      );
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
          cleanupReason: settlement.cleanupState.turnKeeperCleanupReason,
          cleanupConfirmedAt:
            settlement.cleanupState.turnKeeperCleanupConfirmedAt || null,
          knownIdentityCount: slot.knownIdentities.size,
          allKnownPidsRetired: [...slot.knownIdentities.values()].every(
            (identity) => !ownedIdentityAlive(identity),
          ),
          recordRemoved: removal.removed === true,
          worktreeRetained: existsSync(slot.worktree.path),
          ...(settlement.metrics || {}),
        };
      });
      for (const sample of samples) {
        report.cycles.push(sample);
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

    const finalSettlements = await Promise.all(
      slots.map((slot, index) =>
        terminateSlot(slot, profile, index % 2 === 0 ? "hard-kill" : "stop"),
      ),
    );
    for (let index = 0; index < slots.length; index += 1) {
      const slot = slots[index];
      const settlement = finalSettlements[index];
      const removal = await removeRetiredSlotRecord(slot, false);
      report.slots[index] = {
        ...report.slots[index],
        finalCleanupMs: settlement.cleanupMs,
        finalCleanupReason: settlement.cleanupState.turnKeeperCleanupReason,
        allKnownPidsRetired: [...slot.knownIdentities.values()].every(
          (identity) => !ownedIdentityAlive(identity),
        ),
        worktreeRemoved:
          removal.worktree?.removed === true && !existsSync(slot.worktree.path),
      };
    }

    const harnessAfter = {
      rssBytes: process.memoryUsage().rss,
      resource: resourceCount(process.pid),
    };
    const allSamples = [
      ...report.cycles,
      ...report.slots.map((slot) => ({
        cleanupMs: slot.finalCleanupMs,
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
    if (report.metrics.cleanupP95Ms > profile.cleanupDeadlineMs) {
      report.violations.push("cleanup p95 exceeded the owned deadline");
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
    checkpoint();
    if (fixtureCleanupAllowed) {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        try {
          rmSync(root, { recursive: true, force: true });
          break;
        } catch (error) {
          if (attempt === 39) {
            report.status = "failed";
            report.violations.push(`fixture cleanup failed: ${error.message}`);
            checkpoint();
            break;
          }
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
        }
      }
    } else {
      report.fixtureRetainedAt = root;
      checkpoint();
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

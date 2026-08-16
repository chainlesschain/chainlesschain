import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn as nativeSpawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  _deps,
  buildFollowUpArgv,
  BackgroundWorkerStartedError,
  cleanupBackgroundAgentWorktree,
  claimBackgroundAgentHeartbeat,
  effectiveBackgroundAgentState,
  isSameProcess,
  isBackgroundWorkerStartedError,
  insertArgumentsBeforeOptionTerminator,
  launchBackgroundAgent,
  listBackgroundAgents,
  logPath,
  mutateBackgroundAgentState,
  normalizeBackgroundAgentTitle,
  readBackgroundAgentLog,
  readBackgroundAgentState,
  removeBackgroundAgent,
  renameBackgroundAgent,
  resumeBackgroundAgent,
  sessionLifecycleState,
  signalBackgroundProcessTree,
  statePath,
  stopBackgroundAgent,
  stopBackgroundAgentChildTree,
  writeBackgroundAgentState as persistBackgroundAgentState,
} from "../../src/lib/background-agent-supervisor.js";
import { BACKGROUND_AGENT_KEEPER_TASKKILL_TIMEOUT_MS } from "../../src/lib/background-agent-keeper-protocol.js";
import {
  BACKGROUND_INTERACTION_JOURNAL_EVENT,
  _deps as interactionJournalDeps,
} from "../../src/lib/background-interaction-journal.js";
import { existsSync } from "node:fs";
import { SESSION_PRESENCE } from "../../src/harness/jsonl-session-store.js";

const writeBackgroundAgentState = (state) =>
  persistBackgroundAgentState(state, { createIfMissing: true });

let dir;
let identityDir;
let previousChainlessChainHome;
let previousSecurityAnchorHome;
const originalSpawn = _deps.spawn;
const originalSpawnSync = _deps.spawnSync;
const originalReadStart = _deps.readProcessStartTimeMs;
const originalReadProcessState = _deps.readProcessState;
const originalReadProcessGroupStates = _deps.readProcessGroupStates;
const originalProcessExitWaitDeadlineMs = _deps.processExitWaitDeadlineMs;
const originalKillTree = _deps.killProcessTree;
const originalKill = _deps.kill;
const originalGetSessionPresence = _deps.getSessionPresence;
const originalTerminateOwnedProcessTree = _deps.terminateOwnedProcessTree;
const originalWithSessionHostRecoveryLease = _deps.withSessionHostRecoveryLease;

// Pids of processes REALLY spawned by a test (via the tracking wrapper installed
// in beforeEach). Only state records that carry one of these pids are reaped in
// afterEach — fixture records with fabricated pids (43210, 777, process.pid…)
// must never be signalled: on a busy CI runner a fabricated pid can be a LIVE
// unrelated process (another vitest worker, a system daemon), and SIGKILLing it
// was one leg of the shard-2/4 "worker-death" flake.
const launchedPids = new Set();

// A real, live, NON-SELF process for stop-flow fixtures: passes the
// isProcessAlive(kill(pid,0)) liveness gate without pointing the kill path at
// the vitest worker itself (the old fixtures used pid=process.pid for
// liveness — and the then-uninterceptable POSIX process.kill in
// stopBackgroundAgent SIGTERMed the worker: the other leg of the flake).
// Spawned through _deps.spawn (the tracking wrapper), so afterEach reaps it
// via the state record that carries its pid.
function spawnSleeperPid() {
  const child = _deps.spawn(
    process.execPath,
    ["-e", "setInterval(()=>{},1000)"],
    {
      detached: process.platform !== "win32",
      stdio: "ignore",
      origin: "test:background-agent-sleeper",
      policy: "allow",
      scope: "test",
      shell: false,
    },
  );
  child.unref();
  return child.pid;
}

// Kill a single recorded pid's whole tree. The real-launch tests here spawn a
// DETACHED worker (its own process group on POSIX) that in turn spawns the
// agent grandchild — a live grandchild left running after the test survives as
// an orphan `node` process. Under the forks pool that orphan outlives the
// vitest worker and trips its terminate deadline ("[vitest-pool]: Timeout
// terminating forks worker … / Worker exited unexpectedly" — the POSIX-only
// unit shard flake; GitHub's post-job "Cleaning up orphan processes" was
// reaping 6 of these, but only AFTER the shard had already gone red).
function reapTree(pid) {
  const target = Number(pid);
  if (!Number.isInteger(target) || target <= 0) return;
  if (target === process.pid) return; // never kill the vitest worker itself
  try {
    if (process.platform === "win32") {
      const result = originalSpawnSync(
        "taskkill",
        ["/PID", String(target), "/T", "/F"],
        {
          windowsHide: true,
          origin: "test:background-agent-reap",
          policy: "allow",
          scope: "test",
          shell: false,
        },
      );
      if (result.error || result.status !== 0) {
        // Restricted Windows runners may deny taskkill even for a process this
        // test created. Terminate the recorded worker/agent directly as the
        // cleanup fallback; reapLaunchedAgents calls this for both generations.
        try {
          process.kill(target, "SIGKILL");
        } catch {
          /* already gone */
        }
      }
    } else {
      // Detached child is a group leader → the negative pid takes the worker
      // AND the agent it spawned in one shot; the direct kill is the fallback
      // for a child that never got its own group.
      try {
        process.kill(-target, "SIGKILL");
      } catch {
        /* no such group */
      }
      try {
        process.kill(target, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
  } catch {
    /* best-effort reap */
  }
}

function isProcessStillAlive(pid) {
  try {
    process.kill(Number(pid), 0);
  } catch {
    return false;
  }
  if (process.platform !== "win32") {
    const state = originalReadProcessState(pid);
    if (state === "Z" || state === "X") return false;
  }
  return true;
}

async function waitForLaunchedProcessesToExit() {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (![...launchedPids].some(isProcessStillAlive)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

// Reap every process a test launched, reading RAW state files directly — never
// via effectiveBackgroundAgentState, whose identity-reclaim path could itself
// SIGKILL process.pid in the pid-reuse fixtures (which record pid=process.pid).
function reapLaunchedAgents(stateDir) {
  let files;
  try {
    files = readdirSync(stateDir);
  } catch {
    return; // dir already gone
  }
  for (const name of files) {
    if (!name.endsWith(".json") || name.includes(".job.")) continue;
    let raw;
    try {
      raw = JSON.parse(readFileSync(join(stateDir, name), "utf8"));
    } catch {
      continue;
    }
    // Only records that belong to a REAL launch (their worker pid came out of
    // the tracking spawn wrapper) get reaped — and then the whole recorded
    // family, including the agent grandchild the worker spawned itself.
    // Fixture records (fabricated pids) are skipped wholesale.
    const isRealLaunch = [raw.pid, raw.workerPid].some((p) =>
      launchedPids.has(Number(p)),
    );
    if (!isRealLaunch) continue;
    for (const pid of [raw.workerPid, raw.agentPid, raw.pid]) reapTree(pid);
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cc-bg-agent-"));
  identityDir = mkdtempSync(join(tmpdir(), "cc-bg-agent-identity-"));
  process.env.CC_BACKGROUND_AGENTS_DIR = dir;
  previousChainlessChainHome = process.env.CHAINLESSCHAIN_HOME;
  const isolatedHome = join(identityDir, "home");
  mkdirSync(isolatedHome, { recursive: true });
  process.env.CHAINLESSCHAIN_HOME = isolatedHome;
  previousSecurityAnchorHome = process.env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME;
  const securityAnchorHome = join(identityDir, "security-anchors");
  mkdirSync(securityAnchorHome, { recursive: true });
  process.env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME = securityAnchorHome;
  // Hermetic pid-identity probe: null = "unknown" → fail-open, i.e. exactly
  // the pre-Gap-1 kill(pid,0) semantics every legacy fixture here assumes.
  // Identity tests inject their own probe explicitly.
  _deps.readProcessStartTimeMs = () => null;
  // Fixture pids do not own process groups. Tests exercising zombie/group
  // behavior override this seam explicitly; keeping legacy fixtures hermetic
  // avoids scanning or depending on unrelated CI-runner processes.
  _deps.readProcessGroupStates = () => [];
  _deps.getSessionPresence = () => SESSION_PRESENCE.ABSENT;
  _deps.withSessionHostRecoveryLease = (_sessionId, task) => task();
  // Hermetic kills: NO unit test in this file may deliver a real signal —
  // stop-flow fixtures record live-looking pids, and before this seam existed
  // the un-interceptable `process.kill` inside stopBackgroundAgent SIGTERMed
  // the vitest worker itself (the fixture recorded pid=process.pid). Tests
  // asserting kill delivery read this spy.
  _deps.kill = vi.fn();
  // Track every REAL spawn so afterEach reaps exactly what a test launched
  // (fake spawns installed by individual tests overwrite this wrapper and
  // their fabricated pids never enter the set).
  _deps.spawn = (...args) => {
    const child = originalSpawn(...args);
    if (child?.pid) launchedPids.add(Number(child.pid));
    return child;
  };
});

afterEach(async () => {
  _deps.spawn = originalSpawn;
  _deps.spawnSync = originalSpawnSync;
  _deps.readProcessStartTimeMs = originalReadStart;
  _deps.readProcessState = originalReadProcessState;
  _deps.readProcessGroupStates = originalReadProcessGroupStates;
  _deps.processExitWaitDeadlineMs = originalProcessExitWaitDeadlineMs;
  _deps.killProcessTree = originalKillTree;
  _deps.kill = originalKill;
  _deps.getSessionPresence = originalGetSessionPresence;
  _deps.terminateOwnedProcessTree = originalTerminateOwnedProcessTree;
  _deps.withSessionHostRecoveryLease = originalWithSessionHostRecoveryLease;
  // Reap real detached worker+agent trees BEFORE removing the state dir (raw
  // state files carry the pids — needed for agent GRANDCHILDREN a real worker
  // spawned itself), then every directly-tracked spawn (covers sleepers whose
  // state record a test already removed, e.g. the --force rm flow).
  reapLaunchedAgents(dir);
  for (const pid of launchedPids) reapTree(pid);
  // On Windows taskkill can return just before the worker releases its cwd and
  // named-pipe handles. Wait for the tracked processes to actually disappear
  // before removing their temporary working directory.
  await waitForLaunchedProcessesToExit();
  launchedPids.clear();
  delete process.env.CC_BACKGROUND_AGENTS_DIR;
  if (previousChainlessChainHome === undefined) {
    delete process.env.CHAINLESSCHAIN_HOME;
  } else {
    process.env.CHAINLESSCHAIN_HOME = previousChainlessChainHome;
  }
  if (previousSecurityAnchorHome === undefined) {
    delete process.env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME;
  } else {
    process.env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME =
      previousSecurityAnchorHome;
  }
  // Windows can keep the worker's former cwd locked for several seconds even
  // after taskkill has completed and the pid no longer exists. Retry only that
  // transient EBUSY; permission/path errors still fail immediately.
  for (const cleanupDir of [dir, identityDir]) {
    for (let attempt = 0; attempt < 150; attempt++) {
      try {
        rmSync(cleanupDir, { recursive: true, force: true });
        break;
      } catch (error) {
        if (error?.code !== "EBUSY" || attempt === 149) throw error;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  }
}, 40_000);

describe("background agent supervisor", () => {
  it("reclaims a strict state lock owned only by a zombie process identity", () => {
    const id = "bg-zombie-lock-owner";
    writeBackgroundAgentState({
      id,
      title: "before",
      status: "running",
      pid: 4242,
    });
    const lockDir = `${statePath(id)}.lock`;
    mkdirSync(lockDir);
    writeFileSync(
      join(lockDir, "owner.json"),
      JSON.stringify({
        pid: process.pid,
        startedAt: Date.now(),
        token: "zombie-lock-owner-token-0001",
      }),
    );
    _deps.readProcessState = vi.fn((pid) =>
      Number(pid) === process.pid ? "Z" : null,
    );

    const mutation = mutateBackgroundAgentState(
      id,
      (current) => ({ ...current, title: "after" }),
      { timeoutMs: 100 },
    );

    expect(mutation).toMatchObject({
      applied: true,
      state: { id, title: "after" },
    });
  });

  it("rejects ephemeral initial and follow-up argv before worker spawn", () => {
    _deps.spawn = vi.fn(() => ({ pid: 43210, unref: vi.fn() }));
    expect(() =>
      launchBackgroundAgent({
        argv: ["agent", "--ephemeral", "-p", "work"],
        cwd: process.cwd(),
        sessionId: "session-ephemeral-initial",
        title: "work",
        followUpArgv: ["agent", "--session", "session-ephemeral-initial"],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "BACKGROUND_EPHEMERAL_UNSUPPORTED" }),
    );
    expect(() =>
      launchBackgroundAgent({
        argv: ["agent", "-p", "work"],
        cwd: process.cwd(),
        sessionId: "session-ephemeral-follow-up",
        title: "work",
        followUpArgv: [
          "agent",
          "--ephemeral",
          "--session",
          "session-ephemeral-follow-up",
        ],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "BACKGROUND_EPHEMERAL_UNSUPPORTED" }),
    );
    expect(_deps.spawn).not.toHaveBeenCalled();
  });

  it.each([SESSION_PRESENCE.MISSING_TRANSCRIPT, SESSION_PRESENCE.TOMBSTONED])(
    "refuses background launch from %s canonical presence",
    (presence) => {
      _deps.getSessionPresence = vi.fn(() => presence);
      _deps.spawn = vi.fn();

      expect(() =>
        launchBackgroundAgent({
          argv: ["agent", "-p", "work"],
          cwd: process.cwd(),
          sessionId: `session-${presence}`,
          title: "work",
        }),
      ).toThrowError(
        expect.objectContaining({
          code: "BACKGROUND_SESSION_BOOTSTRAP_EVIDENCE_INVALID",
          presence,
        }),
      );
      expect(_deps.spawn).not.toHaveBeenCalled();
      expect(readdirSync(dir)).toEqual([]);
    },
  );

  it("launches a detached worker without persisting argv secrets", () => {
    _deps.spawn = vi.fn(() => ({ pid: 43210, unref: vi.fn() }));
    const state = launchBackgroundAgent({
      argv: ["agent", "-p", "work", "--api-key", "secret"],
      cwd: process.cwd(),
      sessionId: "session-test",
      title: "work",
      followUpArgv: [
        "agent",
        "--api-key",
        "secret",
        "--session",
        "session-test",
      ],
    });
    expect(state.status).toBe("running");
    expect(state.pid).toBe(43210);
    expect(state.sessionBootstrapExpected).toBe(true);
    const persistedState = readBackgroundAgentState(state.id);
    expect(persistedState).not.toHaveProperty("argv");
    expect(persistedState.launchProfile).toMatchObject({
      version: 1,
      credentials: { apiKey: "external" },
    });
    expect(persistedState.configFingerprint).toMatch(/^[a-f0-9]{64}$/);
    const persistedJson = readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => readFileSync(join(dir, name), "utf8"))
      .join("\n");
    expect(persistedJson).not.toContain("secret");
    const jobName = readdirSync(dir).find((name) => name.includes(".job."));
    const job = JSON.parse(readFileSync(join(dir, jobName), "utf8"));
    expect(job.argv).toEqual(["agent", "-p", "work"]);
    expect(job.followUpArgv).toEqual(["agent", "--session", "session-test"]);
    expect(job.sessionBootstrapExpected).toBe(true);
    expect(_deps.spawn.mock.calls[0][2].env.CC_API_KEY).toBe("secret");
    expect(_deps.spawn.mock.calls[0][2]).toMatchObject({
      detached: true,
      stdio: ["ignore", expect.any(Number), expect.any(Number)],
      origin: "background-agent:worker",
      policy: "allow",
      scope: "background-agent",
      shell: false,
    });
    expect(_deps.spawn.mock.calls[0][2].stdio[1]).toBe(
      _deps.spawn.mock.calls[0][2].stdio[2],
    );
  });

  it("finalizes the launcher pid from fresh state without erasing a claimed turn", () => {
    const wrapperPid = 43220;
    const workerPid = 43221;
    const agentPid = 43222;
    const turnStartedAt = Date.now();
    let publishedTurn = false;
    _deps.spawn = vi.fn(() => {
      const child = { on: vi.fn(), unref: vi.fn() };
      Object.defineProperty(child, "pid", {
        get() {
          if (!publishedTurn) {
            publishedTurn = true;
            const stateFile = readdirSync(dir).find(
              (name) => name.endsWith(".json") && !name.includes(".job."),
            );
            const id = stateFile.slice(0, -5);
            mutateBackgroundAgentState(id, (current) => ({
              ...current,
              pid: workerPid,
              workerPid,
              workerClaimedPid: workerPid,
              workerClaimedAt: turnStartedAt,
              turnCount: 1,
              agentPid,
              agentStartedAt: turnStartedAt,
              pendingQuestion: {
                requestId: "request-launch-race",
                binding: {
                  backgroundAgentId: id,
                  sessionId: current.sessionId,
                  turnId: "turn-launch-race",
                  toolUseId: "tool-launch-race",
                  sequence: 1,
                },
              },
              interactionRecovery: {
                status: "pending",
                turn: 1,
                workerGeneration: current.workerGeneration,
                startedAt: turnStartedAt,
              },
            }));
          }
          return wrapperPid;
        },
      });
      return child;
    });

    const launched = launchBackgroundAgent({
      argv: ["agent", "-p", "work"],
      cwd: process.cwd(),
      sessionId: "session-launch-race",
      title: "launch race",
    });

    expect(publishedTurn).toBe(true);
    expect(launched).toMatchObject({
      pid: workerPid,
      workerPid,
      workerClaimedPid: workerPid,
      turnCount: 1,
      agentPid,
      agentStartedAt: turnStartedAt,
      launchFinalizationUncertain: false,
      pendingQuestion: { requestId: "request-launch-race" },
      interactionRecovery: {
        status: "pending",
        turn: 1,
        workerGeneration: launched.workerGeneration,
      },
    });
    expect(readBackgroundAgentState(launched.id)).toMatchObject({
      pid: workerPid,
      workerPid,
      workerClaimedPid: workerPid,
      turnCount: 1,
      agentPid,
      agentStartedAt: turnStartedAt,
      launchFinalizationUncertain: false,
      pendingQuestion: { requestId: "request-launch-race" },
      interactionRecovery: {
        status: "pending",
        turn: 1,
        workerGeneration: launched.workerGeneration,
      },
    });
  });

  it("persists only an external marker for an inherited CC_API_KEY", () => {
    const previous = process.env.CC_API_KEY;
    process.env.CC_API_KEY = "environment-api-secret";
    try {
      _deps.spawn = vi.fn(() => ({ pid: 43210, unref: vi.fn() }));
      const state = launchBackgroundAgent({
        argv: ["agent", "-p", "safe task"],
        cwd: process.cwd(),
        sessionId: "session-env-key",
        title: "safe task",
      });
      expect(state.launchProfile.credentials.apiKey).toBe("external");
      const persistedJson = readdirSync(dir)
        .filter((name) => name.endsWith(".json"))
        .map((name) => readFileSync(join(dir, name), "utf8"))
        .join("\n");
      expect(persistedJson).not.toContain("environment-api-secret");
      // No copied env object is needed: Node's default spawn semantics inherit
      // the current environment without serializing it into the job file.
      expect(_deps.spawn.mock.calls[0][2]).not.toHaveProperty("env");
    } finally {
      if (previous === undefined) delete process.env.CC_API_KEY;
      else process.env.CC_API_KEY = previous;
    }
  });

  it("types launcher failures that occur after the detached worker started", () => {
    const finalizeError = new Error("unref failed after spawn");
    _deps.spawn = vi.fn(() => ({
      pid: 43211,
      on: vi.fn(),
      unref: vi.fn(() => {
        throw finalizeError;
      }),
    }));

    let caught = null;
    try {
      launchBackgroundAgent({
        argv: ["agent", "-p", "work"],
        cwd: process.cwd(),
        sessionId: "session-post-spawn-error",
        title: "post spawn error",
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BackgroundWorkerStartedError);
    expect(isBackgroundWorkerStartedError(caught)).toBe(true);
    expect(caught).toMatchObject({
      code: "ERR_BACKGROUND_WORKER_STARTED",
      workerPid: 43211,
      cause: finalizeError,
    });
    expect(caught.backgroundAgentId).toMatch(/^bg-/);
    expect(readBackgroundAgentState(caught.backgroundAgentId)).toMatchObject({
      pid: 43211,
      workerPid: 43211,
      launchFinalizationUncertain: false,
    });
  });

  it("retains job/state when the broker reports a post-spawn sandbox failure", () => {
    let settleTermination;
    _deps.terminateOwnedProcessTree = vi.fn(
      () =>
        new Promise((resolve) => {
          settleTermination = resolve;
        }),
    );
    const brokerError = Object.assign(new Error("post-spawn sandbox failed"), {
      spawnedProcess: { pid: 43212 },
      workspaceTerminationRequested: true,
    });
    _deps.spawn = vi.fn(() => {
      throw brokerError;
    });

    let caught = null;
    try {
      launchBackgroundAgent({
        argv: ["agent", "-p", "work"],
        cwd: process.cwd(),
        sessionId: "session-broker-post-spawn-error",
        title: "broker post spawn error",
      });
    } catch (error) {
      caught = error;
    }

    expect(isBackgroundWorkerStartedError(caught)).toBe(true);
    expect(caught).toMatchObject({
      workerPid: 43212,
      cause: brokerError,
    });
    expect(readBackgroundAgentState(caught.backgroundAgentId)).toMatchObject({
      pid: 43212,
      workerPid: 43212,
      launchFinalizationUncertain: true,
    });
    expect(
      readdirSync(dir).some((name) =>
        name.startsWith(`${caught.backgroundAgentId}.job.`),
      ),
    ).toBe(true);

    settleTermination({
      confirmed: true,
      treeMode: process.platform === "win32" ? "windows-tree" : "posix-group",
      closed: true,
      treeTerminated: true,
    });
    return vi.waitFor(() => {
      expect(readBackgroundAgentState(caught.backgroundAgentId)).toMatchObject({
        status: "failed",
        pid: 43212,
        workerPid: 43212,
        launchFinalizationUncertain: false,
        launchTermination: {
          confirmed: true,
          closed: true,
          treeTerminated: true,
        },
      });
      expect(
        readdirSync(dir).some((name) =>
          name.startsWith(`${caught.backgroundAgentId}.job.`),
        ),
      ).toBe(false);
    });
  });

  it("a worker that finds a terminal state never starts the first turn", async () => {
    const id = "bg-terminal-before-claim";
    const sessionId = "session-terminal-before-claim";
    const marker = join(dir, "turn-started.txt");
    const fakeCli = join(dir, "must-not-run.mjs");
    const jobFile = join(dir, `${id}.job.test.json`);
    const worker = fileURLToPath(
      new URL("../../src/workers/background-agent-worker.js", import.meta.url),
    );
    writeFileSync(
      fakeCli,
      'import { writeFileSync } from "node:fs"; writeFileSync(process.argv[2], "ran");\n',
    );
    writeBackgroundAgentState({
      id,
      sessionId,
      status: "stopped",
      pid: null,
      workerPid: null,
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
      launchFinalizationUncertain: true,
    });
    writeFileSync(
      jobFile,
      JSON.stringify({
        id,
        sessionId,
        title: "terminal before claim",
        cwd: dir,
        argv: [marker],
        cliEntry: fakeCli,
        logFile: logPath(id),
      }),
    );

    const child = nativeSpawn(process.execPath, [worker, jobFile], {
      cwd: dir,
      env: { ...process.env, CC_BACKGROUND_AGENTS_DIR: dir },
      stdio: "ignore",
      windowsHide: true,
    });
    const exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });

    expect(exitCode).toBe(0);
    expect(existsSync(marker)).toBe(false);
    expect(readBackgroundAgentState(id).status).toBe("stopped");
  });

  it("atomically refuses a heartbeat that lost to a terminal writer", () => {
    const id = "bg-terminal-heartbeat-race";
    writeBackgroundAgentState({
      id,
      status: "running",
      pid: null,
      workerPid: null,
      workerGeneration: "generation-a",
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
      launchFinalizationUncertain: true,
    });
    persistBackgroundAgentState({
      ...readBackgroundAgentState(id),
      status: "stopped",
      endedAt: Date.now(),
      stoppedByUser: true,
    });

    const claim = claimBackgroundAgentHeartbeat(id, {
      pid: 43210,
      workerPid: 43210,
      workerGeneration: "generation-a",
    });

    expect(claim.applied).toBe(false);
    expect(claim.state.status).toBe("stopped");
    expect(readBackgroundAgentState(id).status).toBe("stopped");
  });

  it("keeps terminal state absorbing when it linearizes after a heartbeat", () => {
    const id = "bg-heartbeat-terminal-race";
    writeBackgroundAgentState({
      id,
      status: "running",
      pid: null,
      workerPid: null,
      workerGeneration: "generation-b",
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
      launchFinalizationUncertain: true,
    });
    const claim = claimBackgroundAgentHeartbeat(id, {
      pid: 43211,
      workerPid: 43211,
      workerGeneration: "generation-b",
    });
    expect(claim.applied).toBe(true);

    persistBackgroundAgentState({
      ...claim.state,
      status: "stopped",
      endedAt: Date.now(),
      stoppedByUser: true,
    });
    const staleHeartbeat = persistBackgroundAgentState({
      ...claim.state,
      status: "running",
      heartbeatAt: Date.now() + 1,
    });

    expect(staleHeartbeat.status).toBe("stopped");
    expect(readBackgroundAgentState(id).status).toBe("stopped");
  });

  it("rejects a different worker generation and a durable stop fence", () => {
    const id = "bg-worker-generation-fence";
    writeBackgroundAgentState({
      id,
      status: "running",
      pid: null,
      workerPid: null,
      workerClaimedPid: null,
      workerClaimedAt: null,
      workerGeneration: "generation-owner",
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
      launchFinalizationUncertain: true,
    });
    expect(
      claimBackgroundAgentHeartbeat(id, {
        pid: 43212,
        workerPid: 43212,
        workerGeneration: "generation-other",
      }).applied,
    ).toBe(false);
    expect(
      claimBackgroundAgentHeartbeat(id, {
        pid: 43212,
        workerPid: 43212,
        workerGeneration: "generation-owner",
      }).applied,
    ).toBe(true);
    expect(readBackgroundAgentState(id)).toMatchObject({
      workerClaimedPid: 43212,
      workerClaimedAt: expect.any(Number),
    });
    expect(
      claimBackgroundAgentHeartbeat(id, {
        pid: 43213,
        workerPid: 43213,
        workerGeneration: "generation-owner",
      }).applied,
    ).toBe(false);
    mutateBackgroundAgentState(id, (current) => ({
      ...current,
      stopRequestedAt: Date.now(),
    }));
    expect(
      claimBackgroundAgentHeartbeat(id, {
        pid: 43212,
        workerPid: 43212,
        workerGeneration: "generation-owner",
      }).applied,
    ).toBe(false);
  });

  it("keeps turn launch intent durable until its owner resolves the token", () => {
    const id = "bg-turn-intent-monotonic";
    const intent = {
      token: "turn-token-a",
      attempt: 1,
      workerPid: 43212,
      workerGeneration: "generation-owner",
      preparedAt: Date.now(),
    };
    writeBackgroundAgentState({
      id,
      status: "running",
      pid: 43212,
      workerPid: 43212,
      workerClaimedPid: 43212,
      workerGeneration: "generation-owner",
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
      turnLaunchAttempt: 1,
      turnLaunchIntent: intent,
    });

    persistBackgroundAgentState({
      id,
      status: "running",
      pid: 43212,
      workerPid: 43212,
      workerGeneration: "generation-owner",
      startedAt: 1,
      heartbeatAt: Date.now() + 1,
      turnLaunchAttempt: 0,
      turnLaunchIntent: null,
    });
    expect(readBackgroundAgentState(id).turnLaunchIntent).toStrictEqual(intent);

    persistBackgroundAgentState({
      ...readBackgroundAgentState(id),
      status: "stopped",
      stopRequestedAt: Date.now(),
      turnLaunchIntent: null,
      turnLaunchResolution: {
        token: intent.token,
        attempt: intent.attempt,
        outcome: "not-spawned",
        resolvedAt: Date.now(),
      },
      turnLaunchFinalizationUncertain: false,
      turnLaunchTermination: {
        confirmed: true,
        treeMode: "none",
        closed: true,
        treeTerminated: true,
      },
    });
    expect(readBackgroundAgentState(id)).toMatchObject({
      status: "stopped",
      turnLaunchAttempt: 1,
      turnLaunchIntent: null,
      turnLaunchResolution: {
        token: intent.token,
        attempt: 1,
        outcome: "not-spawned",
      },
      turnLaunchFinalizationUncertain: false,
      turnLaunchTermination: { confirmed: true },
    });

    persistBackgroundAgentState({
      ...readBackgroundAgentState(id),
      turnLaunchIntent: intent,
      turnLaunchFinalizationUncertain: true,
      turnLaunchToken: intent.token,
      turnLaunchError: "stale writer",
      turnLaunchTermination: null,
    });
    expect(readBackgroundAgentState(id)).toMatchObject({
      turnLaunchIntent: null,
      turnLaunchFinalizationUncertain: false,
      turnLaunchToken: null,
      turnLaunchError: null,
      turnLaunchTermination: { confirmed: true },
    });
  });

  it("advances spawned turn evidence to terminated and never rolls it back", () => {
    const id = "bg-turn-resolution-monotonic";
    const token = "turn-token-termination";
    writeBackgroundAgentState({
      id,
      status: "running",
      pid: 43212,
      workerPid: 43212,
      workerClaimedPid: 43212,
      workerGeneration: "generation-owner",
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
      turnLaunchAttempt: 1,
      turnLaunchIntent: {
        token,
        attempt: 1,
        workerPid: 43212,
        workerGeneration: "generation-owner",
        preparedAt: Date.now(),
      },
    });
    persistBackgroundAgentState({
      ...readBackgroundAgentState(id),
      agentPid: 43214,
      agentStartedAt: Date.now(),
      turnLaunchIntent: null,
      turnLaunchResolution: {
        token,
        attempt: 1,
        outcome: "spawned",
        agentPid: 43214,
        resolvedAt: Date.now(),
      },
      turnLaunchFinalizationUncertain: true,
      turnLaunchToken: token,
    });
    persistBackgroundAgentState({
      ...readBackgroundAgentState(id),
      status: "failed",
      endedAt: Date.now(),
      turnLaunchIntent: null,
      turnLaunchResolution: {
        token,
        attempt: 1,
        outcome: "terminated",
        agentPid: 43214,
        resolvedAt: Date.now(),
      },
      turnLaunchFinalizationUncertain: false,
      turnLaunchToken: null,
      turnLaunchTermination: {
        confirmed: true,
        treeMode: "windows-tree",
        closed: true,
        treeTerminated: true,
      },
    });
    expect(readBackgroundAgentState(id)).toMatchObject({
      status: "failed",
      turnLaunchResolution: { token, attempt: 1, outcome: "terminated" },
      turnLaunchFinalizationUncertain: false,
      turnLaunchTermination: { confirmed: true },
    });

    persistBackgroundAgentState({
      ...readBackgroundAgentState(id),
      status: "running",
      turnLaunchResolution: {
        token,
        attempt: 1,
        outcome: "spawned",
        agentPid: 43214,
        resolvedAt: Date.now() + 1,
      },
      turnLaunchFinalizationUncertain: true,
      turnLaunchTermination: null,
    });
    expect(readBackgroundAgentState(id)).toMatchObject({
      status: "failed",
      turnLaunchResolution: { outcome: "terminated" },
      turnLaunchFinalizationUncertain: false,
      turnLaunchTermination: { confirmed: true },
    });
  });

  it("keeps keeper and runtime evidence monotonic across stale writers", () => {
    const id = "bg-keeper-projection-monotonic";
    const token = "turn-token-keeper";
    writeBackgroundAgentState({
      id,
      status: "running",
      phase: "turn",
      pid: 43212,
      workerPid: 43212,
      workerClaimedPid: 43212,
      workerGeneration: "generation-owner",
      workerWrapperPid: 43211,
      keeperGeneration: "keeper-generation-owner",
      keeperPid: 43214,
      keeperStartedAt: 10,
      keeperWrapperPid: 43213,
      keeperStatus: "starting",
      keeperHeartbeatAt: 10,
      startedAt: 1,
      heartbeatAt: 20,
      turnLaunchAttempt: 1,
      turnLaunchIntent: null,
      turnLaunchResolution: {
        token,
        attempt: 1,
        outcome: "spawned",
        agentPid: 43215,
        resolvedAt: 20,
      },
      agentPid: 43215,
      agentStartedAt: 20,
      agentRuntimePid: null,
      agentRuntimeStartedAt: null,
      turnBootstrapStatus: "awaiting-ready",
      turnKeeperStatus: "waiting-for-runtime",
    });
    const stale = readBackgroundAgentState(id);

    persistBackgroundAgentState({
      ...stale,
      keeperStatus: "ready",
      keeperHeartbeatAt: 30,
      keeperReadyAt: 30,
      agentRuntimePid: 43216,
      agentRuntimeStartedAt: 20,
      turnBootstrapStatus: "released",
      turnBootstrapCommittedAt: 40,
      turnKeeperStatus: "armed",
      turnKeeperPid: 43214,
      turnKeeperArmedAt: 35,
    });
    persistBackgroundAgentState({
      ...stale,
      title: "stale rename snapshot",
      heartbeatAt: 50,
    });

    expect(readBackgroundAgentState(id)).toMatchObject({
      workerWrapperPid: 43211,
      keeperGeneration: "keeper-generation-owner",
      keeperPid: 43214,
      keeperWrapperPid: 43213,
      keeperStatus: "ready",
      keeperReadyAt: 30,
      agentPid: 43215,
      agentRuntimePid: 43216,
      turnBootstrapStatus: "released",
      turnBootstrapCommittedAt: 40,
      turnKeeperStatus: "armed",
      turnKeeperPid: 43214,
      turnKeeperArmedAt: 35,
    });

    const armed = readBackgroundAgentState(id);
    persistBackgroundAgentState({
      ...armed,
      turnKeeperStatus: "retired",
      turnKeeperCleanupReason: "turn-exited",
      turnKeeperCleanupRequestedAt: 60,
      turnKeeperCleanupConfirmedAt: 70,
    });
    persistBackgroundAgentState({
      ...readBackgroundAgentState(id),
      phase: "idle",
      agentPid: null,
      agentStartedAt: null,
      agentRuntimePid: null,
      agentRuntimeStartedAt: null,
      turnBootstrapStatus: null,
      turnBootstrapCommittedAt: null,
      turnKeeperStatus: null,
      turnKeeperPid: null,
      turnKeeperArmedAt: null,
      turnKeeperCleanupReason: null,
      turnKeeperCleanupRequestedAt: null,
      turnKeeperCleanupConfirmedAt: null,
      turnKeeperCleanupError: null,
    });
    persistBackgroundAgentState({
      ...armed,
      title: "older active snapshot",
      heartbeatAt: 80,
    });

    expect(readBackgroundAgentState(id)).toMatchObject({
      phase: "idle",
      agentPid: null,
      agentRuntimePid: null,
      turnBootstrapStatus: null,
      turnKeeperStatus: null,
      turnKeeperCleanupConfirmedAt: null,
    });

    persistBackgroundAgentState({
      ...readBackgroundAgentState(id),
      status: "completed",
      phase: null,
      transport: null,
      endedAt: 90,
      exitCode: 0,
    });
    expect(readBackgroundAgentState(id)).toMatchObject({
      status: "completed",
      phase: null,
    });
  });

  it("fences stop without signalling while a turn launch intent is unresolved", () => {
    const id = "bg-stop-turn-intent";
    const now = Date.now();
    writeBackgroundAgentState({
      id,
      status: "running",
      pid: process.pid,
      workerPid: process.pid,
      workerClaimedPid: process.pid,
      workerGeneration: "generation-stop-intent",
      startedAt: now,
      heartbeatAt: now,
      turnLaunchAttempt: 1,
      turnLaunchIntent: {
        token: "turn-token-stop",
        attempt: 1,
        workerPid: process.pid,
        workerGeneration: "generation-stop-intent",
        preparedAt: now,
      },
    });

    const stopped = stopBackgroundAgent(id);

    expect(stopped).toMatchObject({
      stopped: false,
      stopPending: true,
      stopPendingReason: "turn-launch-intent",
      phase: "stopping",
    });
    expect(stopped.stopRequestedAt).toEqual(expect.any(Number));
    expect(_deps.kill).not.toHaveBeenCalled();
    expect(readBackgroundAgentState(id)).toMatchObject({
      status: "running",
      phase: "stopping",
      stopRequestedAt: expect.any(Number),
      turnLaunchIntent: { token: "turn-token-stop", attempt: 1 },
    });
  });

  it("does not let the prior idle projection mask a new turn intent", () => {
    const id = "bg-new-turn-after-idle";
    writeBackgroundAgentState({
      id,
      status: "running",
      phase: "idle",
      pid: 43212,
      workerPid: 43212,
      workerClaimedPid: 43212,
      workerGeneration: "generation-owner",
      startedAt: 1,
      heartbeatAt: 10,
      turnLaunchAttempt: 1,
      turnLaunchIntent: null,
      turnLaunchResolution: {
        token: "turn-token-one",
        attempt: 1,
        outcome: "spawned",
        agentPid: 43213,
        resolvedAt: 5,
      },
      agentPid: null,
      agentRuntimePid: null,
      turnBootstrapStatus: null,
      turnKeeperStatus: null,
    });

    persistBackgroundAgentState({
      ...readBackgroundAgentState(id),
      phase: "turn_launching",
      turnLaunchAttempt: 2,
      turnLaunchIntent: {
        token: "turn-token-two",
        attempt: 2,
        workerPid: 43212,
        workerGeneration: "generation-owner",
        preparedAt: 20,
      },
    });

    expect(readBackgroundAgentState(id)).toMatchObject({
      phase: "turn_launching",
      turnLaunchAttempt: 2,
      turnLaunchIntent: { token: "turn-token-two", attempt: 2 },
    });

    persistBackgroundAgentState({
      id,
      status: "running",
      phase: "idle",
      pid: 43212,
      workerPid: 43212,
      workerClaimedPid: 43212,
      workerGeneration: "generation-owner",
      startedAt: 1,
      heartbeatAt: 30,
      turnLaunchAttempt: 1,
      turnLaunchIntent: null,
      turnLaunchResolution: {
        token: "turn-token-one",
        attempt: 1,
        outcome: "spawned",
        agentPid: 43213,
        resolvedAt: 5,
      },
      agentPid: null,
      agentRuntimePid: null,
      turnBootstrapStatus: null,
      turnKeeperStatus: null,
    });
    expect(readBackgroundAgentState(id)).toMatchObject({
      phase: "turn_launching",
      turnLaunchAttempt: 2,
      turnLaunchIntent: { token: "turn-token-two", attempt: 2 },
    });
  });

  it("lets a queued turn replace the prior retired process projection", () => {
    const id = "bg-new-turn-after-retire";
    writeBackgroundAgentState({
      id,
      status: "running",
      phase: "turn",
      pid: 43212,
      workerPid: 43212,
      workerClaimedPid: 43212,
      workerGeneration: "generation-owner",
      startedAt: 1,
      heartbeatAt: 10,
      turnLaunchAttempt: 1,
      turnLaunchIntent: null,
      turnLaunchResolution: {
        token: "turn-token-one",
        attempt: 1,
        outcome: "spawned",
        agentPid: 43213,
        resolvedAt: 5,
      },
      agentPid: 43213,
      agentStartedAt: 5,
      agentRuntimePid: 43214,
      agentRuntimeStartedAt: 5,
      turnBootstrapStatus: "released",
      turnBootstrapCommittedAt: 6,
      turnKeeperStatus: "retired",
      turnKeeperPid: 43215,
      turnKeeperArmedAt: 7,
      turnKeeperCleanupReason: "turn-exited",
      turnKeeperCleanupRequestedAt: 8,
      turnKeeperCleanupConfirmedAt: 9,
    });
    const retiredSnapshot = readBackgroundAgentState(id);
    persistBackgroundAgentState({
      ...retiredSnapshot,
      phase: "turn_launching",
      turnLaunchAttempt: 2,
      turnLaunchIntent: {
        token: "turn-token-two",
        attempt: 2,
        workerPid: 43212,
        workerGeneration: "generation-owner",
        preparedAt: 20,
      },
    });
    persistBackgroundAgentState({
      ...retiredSnapshot,
      title: "stale before second spawn",
      heartbeatAt: 20,
    });
    expect(readBackgroundAgentState(id)).toMatchObject({
      phase: "turn_launching",
      turnLaunchAttempt: 2,
      turnLaunchIntent: { token: "turn-token-two", attempt: 2 },
    });
    persistBackgroundAgentState({
      ...readBackgroundAgentState(id),
      phase: "turn",
      turnLaunchIntent: null,
      turnLaunchResolution: {
        token: "turn-token-two",
        attempt: 2,
        outcome: "spawned",
        agentPid: 43216,
        resolvedAt: 21,
      },
      agentPid: 43216,
      agentStartedAt: 21,
      agentRuntimePid: null,
      agentRuntimeStartedAt: null,
      turnBootstrapStatus: "awaiting-ready",
      turnBootstrapCommittedAt: null,
      turnKeeperStatus: "waiting-for-runtime",
      turnKeeperPid: null,
      turnKeeperArmedAt: null,
      turnKeeperCleanupReason: null,
      turnKeeperCleanupRequestedAt: null,
      turnKeeperCleanupConfirmedAt: null,
      turnKeeperCleanupError: null,
    });

    expect(readBackgroundAgentState(id)).toMatchObject({
      turnLaunchAttempt: 2,
      turnLaunchIntent: null,
      turnLaunchResolution: {
        token: "turn-token-two",
        attempt: 2,
        outcome: "spawned",
      },
      agentPid: 43216,
      agentRuntimePid: null,
      turnBootstrapStatus: "awaiting-ready",
      turnKeeperStatus: "waiting-for-runtime",
      turnKeeperCleanupConfirmedAt: null,
    });

    persistBackgroundAgentState({
      ...retiredSnapshot,
      title: "stale prior-turn snapshot",
      heartbeatAt: 30,
    });
    expect(readBackgroundAgentState(id)).toMatchObject({
      turnLaunchAttempt: 2,
      turnLaunchResolution: {
        token: "turn-token-two",
        attempt: 2,
        outcome: "spawned",
      },
      agentPid: 43216,
      agentRuntimePid: null,
      turnBootstrapStatus: "awaiting-ready",
      turnKeeperStatus: "waiting-for-runtime",
      turnKeeperCleanupConfirmedAt: null,
    });
  });

  it("stale state writers cannot drop the immutable launch profile", () => {
    _deps.spawn = vi.fn(() => ({ pid: 43210, unref: vi.fn() }));
    const launched = launchBackgroundAgent({
      argv: ["agent", "task", "--model", "pinned-model"],
      cwd: process.cwd(),
      sessionId: "session-profile-merge",
      title: "profile merge",
    });
    writeBackgroundAgentState({
      id: launched.id,
      sessionId: launched.sessionId,
      title: launched.title,
      status: "running",
      startedAt: launched.startedAt,
      heartbeatAt: Date.now(),
    });

    const persisted = readBackgroundAgentState(launched.id);
    expect(persisted.launchProfile.llm.model).toBe("pinned-model");
    expect(persisted.configFingerprint).toBe(launched.configFingerprint);
  });

  it("stale writers cannot retarget same-id session identity", () => {
    const id = "bg-immutable-session-identity";
    writeBackgroundAgentState({
      id,
      sessionId: "session-owner",
      cwd: dir,
      logFile: logPath(id),
      status: "running",
      pid: 43216,
      workerPid: 43216,
      startedAt: 123,
      heartbeatAt: 456,
    });

    const written = persistBackgroundAgentState({
      id,
      sessionId: "session-attacker",
      cwd: join(dir, "elsewhere"),
      logFile: join(dir, "other.log"),
      status: "running",
      pid: 43216,
      workerPid: 43216,
      startedAt: 999,
      heartbeatAt: 500,
    });

    expect(written).toMatchObject({
      sessionId: "session-owner",
      cwd: dir,
      logFile: logPath(id),
      startedAt: 123,
      heartbeatAt: 500,
    });
  });

  it("lists sessions newest first and filters terminal states", () => {
    writeBackgroundAgentState({
      id: "bg-old-abc",
      status: "completed",
      startedAt: 1,
      endedAt: 2,
    });
    writeBackgroundAgentState({
      id: "bg-new-def",
      status: "running",
      pid: process.pid,
      startedAt: 3,
    });
    expect(listBackgroundAgents().map((s) => s.id)).toEqual(["bg-new-def"]);
    expect(listBackgroundAgents({ all: true }).map((s) => s.id)).toEqual([
      "bg-new-def",
      "bg-old-abc",
    ]);
  });

  it("attaches the canonical unified lifecycleState to the list feed", () => {
    // running + a live turn → running; a pending approval → waitingApproval.
    writeBackgroundAgentState({
      id: "bg-run-1",
      status: "running",
      pid: process.pid,
      startedAt: 3,
      phase: "turn",
    });
    writeBackgroundAgentState({
      id: "bg-appr-2",
      status: "running",
      pid: process.pid,
      startedAt: 2,
      phase: "idle",
      pendingApprovals: 1,
    });
    writeBackgroundAgentState({
      id: "bg-done-3",
      status: "completed",
      startedAt: 1,
      endedAt: 2,
    });
    const byId = Object.fromEntries(
      listBackgroundAgents({ all: true }).map((s) => [s.id, s.lifecycleState]),
    );
    expect(byId["bg-run-1"]).toBe("running");
    expect(byId["bg-appr-2"]).toBe("waitingApproval");
    expect(byId["bg-done-3"]).toBe("completed");
  });

  it("does NOT leak the derived lifecycleState into the on-disk schema via mutate paths", () => {
    // The rename/pin read-modify-write paths spread effectiveBackgroundAgentState's
    // output back into writeBackgroundAgentState — so lifecycleState must never be
    // baked in there, only attached at the display feed.
    writeBackgroundAgentState({
      id: "bg-mut-1",
      status: "running",
      pid: process.pid,
      startedAt: 3,
      phase: "turn",
    });
    renameBackgroundAgent("bg-mut-1", "renamed", { now: 100 });
    const raw = JSON.parse(readFileSync(statePath("bg-mut-1"), "utf8"));
    expect(raw).not.toHaveProperty("lifecycleState");
    // effectiveBackgroundAgentState (the mutate-path input) is also unenriched.
    expect(
      effectiveBackgroundAgentState(readBackgroundAgentState("bg-mut-1")),
    ).not.toHaveProperty("lifecycleState");
    // but the derived state is still computable on demand.
    expect(sessionLifecycleState(readBackgroundAgentState("bg-mut-1"))).toBe(
      "running",
    );
  });

  it("marks stale-heartbeat running sessions as lost and persists the correction", () => {
    writeBackgroundAgentState({
      id: "bg-stale-abc",
      status: "running",
      pid: process.pid,
      workerPid: process.pid,
      startedAt: 1000,
      heartbeatAt: 1000,
    });

    const sessions = listBackgroundAgents({
      all: true,
      now: 2000,
      heartbeatStaleMs: 100,
    });
    const state = sessions.find((s) => s.id === "bg-stale-abc");

    expect(state.status).toBe("lost");
    expect(state.lostReason).toBe("heartbeat-stale");
    expect(readBackgroundAgentState("bg-stale-abc").status).toBe("lost");
  });

  it("rechecks a stale snapshot under lock before persisting lost", () => {
    const id = "bg-stale-recheck";
    writeBackgroundAgentState({
      id,
      status: "running",
      pid: process.pid,
      workerPid: process.pid,
      startedAt: 1_000,
      heartbeatAt: 1_000,
    });
    const staleSnapshot = readBackgroundAgentState(id);
    persistBackgroundAgentState({
      ...staleSnapshot,
      heartbeatAt: 2_000,
    });

    const effective = effectiveBackgroundAgentState(staleSnapshot, {
      now: 2_050,
      heartbeatStaleMs: 100,
    });

    expect(effective.status).toBe("running");
    expect(effective.heartbeatAt).toBe(2_000);
    expect(readBackgroundAgentState(id).status).toBe("running");
  });

  it("does not mark an uncertain launch lost during its bounded bootstrap grace", () => {
    const state = writeBackgroundAgentState({
      id: "bg-bootstrap-abc",
      sessionId: "session-bootstrap-abc",
      status: "running",
      pid: null,
      workerPid: null,
      startedAt: 1000,
      heartbeatAt: 1000,
      launchFinalizationUncertain: true,
    });

    const effective = effectiveBackgroundAgentState(state, {
      now: 1050,
      heartbeatStaleMs: 100,
    });
    expect(effective).toStrictEqual(state);
    expect(readBackgroundAgentState(state.id).status).toBe("running");

    const expired = effectiveBackgroundAgentState(state, {
      now: 1101,
      heartbeatStaleMs: 100,
      persist: false,
    });
    expect(expired).toMatchObject({
      status: "lost",
      lostReason: "heartbeat-stale",
      launchFinalizationUncertain: true,
    });
  });

  it("refuses worktree cleanup while launch ownership is uncertain", () => {
    const worktreePath = join(dir, "uncertain-worktree");
    mkdirSync(worktreePath);
    expect(() =>
      cleanupBackgroundAgentWorktree({
        id: "bg-uncertain-worktree",
        status: "lost",
        pid: null,
        repoRoot: dir,
        worktreePath,
        baseSha: "a".repeat(40),
        branch: "cc-agent-uncertain",
        launchFinalizationUncertain: true,
      }),
    ).toThrow(/launch finalization is uncertain/i);
    expect(existsSync(worktreePath)).toBe(true);

    expect(() =>
      cleanupBackgroundAgentWorktree({
        id: "bg-uncertain-turn-worktree",
        status: "failed",
        pid: null,
        repoRoot: dir,
        worktreePath,
        baseSha: "a".repeat(40),
        branch: "cc-agent-uncertain-turn",
        turnLaunchFinalizationUncertain: true,
      }),
    ).toThrow(/turn launch finalization is uncertain/i);

    expect(() =>
      cleanupBackgroundAgentWorktree({
        id: "bg-unresolved-turn-intent-worktree",
        status: "stopped",
        pid: null,
        repoRoot: dir,
        worktreePath,
        baseSha: "a".repeat(40),
        branch: "cc-agent-unresolved-turn-intent",
        turnLaunchIntent: { token: "turn-token", attempt: 1 },
      }),
    ).toThrow(/turn launch intent is unresolved/i);
  });

  it.skipIf(process.platform === "win32")(
    "refuses worktree cleanup while a zombie leader group can still execute",
    () => {
      const sleeperPid = spawnSleeperPid();
      const startedAt = Date.now();
      const worktreePath = join(dir, "zombie-live-group-worktree");
      mkdirSync(worktreePath);
      _deps.readProcessState = vi.fn(() => "Z");
      _deps.readProcessGroupStates = vi.fn(() => ["Z", "S"]);
      _deps.readProcessStartTimeMs = vi.fn(() => startedAt);

      expect(() =>
        cleanupBackgroundAgentWorktree({
          id: "bg-zombie-live-group-worktree",
          status: "lost",
          pid: sleeperPid,
          startedAt,
          repoRoot: dir,
          worktreePath,
          baseSha: "a".repeat(40),
          branch: "cc-agent-zombie-live-group",
        }),
      ).toThrow(/active worker process/i);
      expect(existsSync(worktreePath)).toBe(true);
    },
  );

  it("does not stop a stale-heartbeat session even if its pid is alive", () => {
    writeBackgroundAgentState({
      id: "bg-reused-abc",
      status: "running",
      pid: process.pid,
      workerPid: process.pid,
      startedAt: 1000,
      heartbeatAt: 1000,
    });

    const state = effectiveBackgroundAgentState(
      readBackgroundAgentState("bg-reused-abc"),
      { now: 2000, heartbeatStaleMs: 100 },
    );
    expect(state.status).toBe("lost");

    const stopped = stopBackgroundAgent("bg-reused-abc");
    expect(stopped.status).toBe("lost");
    expect(stopped.stopped).toBe(false);
  });

  it("explicitly stops a stale-heartbeat owner when its process identity matches", () => {
    const sleeperPid = spawnSleeperPid();
    const startedAt = Date.now();
    writeBackgroundAgentState({
      id: "bg-stale-explicit-stop",
      status: "lost",
      lostReason: "heartbeat-stale",
      pid: sleeperPid,
      workerPid: sleeperPid,
      startedAt,
      heartbeatAt: startedAt - 300_000,
    });
    _deps.readProcessStartTimeMs = vi.fn(() => startedAt);
    if (process.platform === "win32") {
      _deps.spawnSync = vi.fn((file, args) => {
        process.kill(Number(args[1]), "SIGKILL");
        return { status: 0 };
      });
    } else {
      _deps.kill = vi.fn((pid, signal) => process.kill(pid, signal));
    }

    const stopped = stopBackgroundAgent("bg-stale-explicit-stop");
    expect(stopped).toMatchObject({ status: "stopped", stopped: true });
    expect(stopped.stopRequestedAt).toEqual(expect.any(Number));
  });

  it("fails closed without a destructive process identity anchor", () => {
    const sleeperPid = spawnSleeperPid();
    writeBackgroundAgentState({
      id: "bg-stop-legacy-identity",
      status: "running",
      pid: sleeperPid,
      workerPid: sleeperPid,
      heartbeatAt: Date.now(),
    });
    _deps.spawnSync = vi.fn(() => ({ status: 0 }));

    const stopped = stopBackgroundAgent("bg-stop-legacy-identity");
    expect(stopped).toMatchObject({
      status: "running",
      stopped: false,
      stopPending: true,
      stopPendingReason: "identity-unverifiable",
    });
    expect(_deps.kill).not.toHaveBeenCalled();
    expect(_deps.spawnSync).not.toHaveBeenCalledWith(
      "taskkill",
      expect.any(Array),
      expect.any(Object),
    );
  });

  it("renames a background agent and persists the title", () => {
    writeBackgroundAgentState({
      id: "bg-rename-abc",
      status: "running",
      pid: process.pid,
      startedAt: 1000,
      heartbeatAt: 1100,
      title: "Old title",
    });

    const renamed = renameBackgroundAgent("bg-rename-abc", "  New title  ", {
      now: 2000,
    });

    expect(renamed.title).toBe("New title");
    expect(renamed.renamedAt).toBe(2000);
    expect(readBackgroundAgentState("bg-rename-abc").title).toBe("New title");
  });

  it("rejects empty background agent titles", () => {
    expect(() => normalizeBackgroundAgentTitle("   ")).toThrow(
      /cannot be empty/,
    );
  });

  it("tails logs", () => {
    writeBackgroundAgentState({ id: "bg-log-abc", status: "completed" });
    writeFileSync(logPath("bg-log-abc"), "one\ntwo\nthree\n");
    expect(readBackgroundAgentLog("bg-log-abc", { lines: 2 })).toBe("three\n");
  });

  it("runs the real detached worker and records completion", async () => {
    const workDir = join(dir, "work");
    const isolatedHome = join(dir, "home");
    mkdirSync(workDir);
    const fakeCli = join(dir, "fake-cli.mjs");
    writeFileSync(
      fakeCli,
      'console.log("worker-output"); setTimeout(() => process.exit(0), 50);\n',
    );
    const previousHome = process.env.CHAINLESSCHAIN_HOME;
    let state;
    try {
      process.env.CHAINLESSCHAIN_HOME = isolatedHome;
      state = launchBackgroundAgent({
        argv: [],
        cwd: workDir,
        sessionId: "session-real",
        title: "real worker",
        cliEntry: fakeCli,
      });
    } finally {
      if (previousHome === undefined) {
        delete process.env.CHAINLESSCHAIN_HOME;
      } else {
        process.env.CHAINLESSCHAIN_HOME = previousHome;
      }
    }
    let completed = null;
    let latest = null;
    const completionDeadline = Date.now() + 60_000;
    while (Date.now() < completionDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const current = readBackgroundAgentState(state.id);
      latest = current;
      if (current?.status === "completed") {
        completed = current;
        break;
      }
    }
    if (!completed) {
      throw new Error(
        `real background worker did not complete\nstate=${JSON.stringify(latest)}\nlog=${readBackgroundAgentLog(state.id)}`,
      );
    }
    expect(completed?.exitCode).toBe(0);
    expect(completed?.workerPid).toBe(state.pid);
    expect(Number.isInteger(completed?.agentPid)).toBe(true);
    expect(Number.isInteger(completed?.agentRuntimePid)).toBe(true);
    expect(Number.isInteger(completed?.keeperPid)).toBe(true);
    expect(completed?.turnKeeperStatus).toBe("retired");
    expect(completed?.turnKeeperCleanupConfirmedAt).toEqual(expect.any(Number));
    expect(Number.isFinite(completed?.heartbeatAt)).toBe(true);
    expect(readBackgroundAgentLog(state.id)).toContain("worker-output");
  });

  it("keeps an armed turn contained when the worker is hard-killed", async () => {
    const workDir = join(dir, "hard-kill-work");
    const isolatedHome = join(dir, "hard-kill-home");
    const evidenceFile = join(dir, "hard-kill-pids.json");
    mkdirSync(workDir);
    const fakeCli = join(dir, "fake-cli-hard-kill.mjs");
    writeFileSync(
      fakeCli,
      [
        'import { spawn } from "node:child_process";',
        'import { writeFileSync } from "node:fs";',
        'const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
        `writeFileSync(${JSON.stringify(evidenceFile)}, JSON.stringify({ runtimePid: process.pid, descendantPid: descendant.pid }));`,
        "setInterval(() => {}, 1000);",
        "",
      ].join("\n"),
    );
    const previousHome = process.env.CHAINLESSCHAIN_HOME;
    let launched;
    try {
      process.env.CHAINLESSCHAIN_HOME = isolatedHome;
      launched = launchBackgroundAgent({
        argv: [],
        cwd: workDir,
        sessionId: "session-hard-kill",
        title: "hard kill containment",
        cliEntry: fakeCli,
      });
    } finally {
      if (previousHome === undefined) {
        delete process.env.CHAINLESSCHAIN_HOME;
      } else {
        process.env.CHAINLESSCHAIN_HOME = previousHome;
      }
    }

    let armed = null;
    const armedDeadline = Date.now() + 60_000;
    while (Date.now() < armedDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const current = readBackgroundAgentState(launched.id);
      if (
        current?.turnKeeperStatus === "armed" &&
        current.turnBootstrapStatus === "released" &&
        existsSync(evidenceFile)
      ) {
        armed = current;
        break;
      }
    }
    expect(
      armed,
      `state=${JSON.stringify(readBackgroundAgentState(launched.id))} log=${readBackgroundAgentLog(launched.id)}`,
    ).not.toBeNull();
    const evidence = JSON.parse(readFileSync(evidenceFile, "utf8"));
    expect(evidence.runtimePid).toBe(armed.agentRuntimePid);
    expect(isProcessStillAlive(evidence.descendantPid)).toBe(true);
    expect(isProcessStillAlive(armed.keeperPid)).toBe(true);

    // Kill only the worker process, never its tree. The sibling keeper must
    // observe channel EOF and independently retire the already-armed turn.
    process.kill(Number(armed.pid), "SIGKILL");

    let cleaned = null;
    const cleanupDeadline = Date.now() + 30_000;
    while (Date.now() < cleanupDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const current = readBackgroundAgentState(launched.id);
      if (
        current?.turnKeeperStatus === "retired" &&
        !isProcessStillAlive(armed.agentPid) &&
        !isProcessStillAlive(evidence.runtimePid) &&
        !isProcessStillAlive(evidence.descendantPid) &&
        !isProcessStillAlive(armed.keeperPid)
      ) {
        cleaned = current;
        break;
      }
    }
    expect(
      cleaned,
      `state=${JSON.stringify(readBackgroundAgentState(launched.id))} descendantAlive=${isProcessStillAlive(evidence.descendantPid)} log=${readBackgroundAgentLog(launched.id)}`,
    ).not.toBeNull();
    expect(cleaned.turnKeeperCleanupReason).toBe("worker-disconnected");
    expect(cleaned.turnKeeperCleanupConfirmedAt).toEqual(expect.any(Number));
  }, 90_000);

  it("keeps a running rename when the worker writes completion", async () => {
    const workDir = join(dir, "rename-work");
    const isolatedHome = join(dir, "rename-home");
    mkdirSync(workDir);
    const fakeCli = join(dir, "fake-cli-rename.mjs");
    writeFileSync(fakeCli, "setTimeout(() => process.exit(0), 150);\n");
    const previousHome = process.env.CHAINLESSCHAIN_HOME;
    let state;
    try {
      process.env.CHAINLESSCHAIN_HOME = isolatedHome;
      state = launchBackgroundAgent({
        argv: [],
        cwd: workDir,
        sessionId: "session-rename",
        title: "before",
        cliEntry: fakeCli,
      });
    } finally {
      if (previousHome === undefined) {
        delete process.env.CHAINLESSCHAIN_HOME;
      } else {
        process.env.CHAINLESSCHAIN_HOME = previousHome;
      }
    }

    const renamed = renameBackgroundAgent(state.id, "after");
    expect(renamed.title).toBe("after");

    // Deadline-based poll: a cold detached node boot can take >1.5s under CI
    // load — the fixed 30×50ms loop here used to expire before the worker
    // even wrote completion. (The rename-vs-finalize clobber itself is fixed
    // at the root in writeBackgroundAgentState's field-aware merge.)
    let completed = null;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const current = readBackgroundAgentState(state.id);
      if (current?.status === "completed") {
        completed = current;
        break;
      }
    }

    expect(completed?.title).toBe("after");
    expect(completed?.status).toBe("completed");
  });

  it("buildFollowUpArgv strips the first turn's prompt tokens, keeps flags", () => {
    const optionSpecs = [
      { long: "--model", required: true },
      { long: "--title", required: true },
      { short: "-p", long: "--print", optional: true },
      { long: "--session", required: true },
    ];
    // positional prompt
    expect(
      buildFollowUpArgv(
        ["agent", "do", "the", "task", "--model", "m", "--session", "s"],
        { positionalTokens: ["do", "the", "task"], optionSpecs },
      ),
    ).toEqual(["agent", "--model", "m", "--session", "s"]);
    // -p <value> prompt
    expect(
      buildFollowUpArgv(["agent", "-p", "fix it", "--session", "s"], {
        printValue: "fix it",
        optionSpecs,
      }),
    ).toEqual(["agent", "--session", "s"]);
    // bare -p (piped prompt) — flag dropped, no value to drop
    expect(
      buildFollowUpArgv(["agent", "-p", "--session", "s"], {
        printValue: null,
        optionSpecs,
      }),
    ).toEqual(["agent", "--session", "s"]);
    // a flag value that happens to equal a positional token is not stripped
    expect(
      buildFollowUpArgv(["agent", "fix", "--title", "fix"], {
        positionalTokens: ["fix"],
        optionSpecs,
      }),
    ).toEqual(["agent", "--title", "fix"]);
    // equals-form --print=<value> is stripped too
    expect(
      buildFollowUpArgv(["agent", "--print=fix it", "--session", "s"], {
        printValue: "fix it",
        optionSpecs,
      }),
    ).toEqual(["agent", "--session", "s"]);
    expect(
      buildFollowUpArgv(
        ["agent", "--model", "same", "same", "--session", "s"],
        { positionalTokens: ["same"], optionSpecs },
      ),
    ).toEqual(["agent", "--model", "same", "--session", "s"]);

    const terminated = buildFollowUpArgv(
      ["agent", "--session", "s", "--", "literal task"],
      { positionalTokens: ["literal task"], optionSpecs },
    );
    expect(terminated).toEqual(["agent", "--session", "s"]);
    expect(
      insertArgumentsBeforeOptionTerminator(terminated, ["-p", "next task"]),
    ).toEqual(["agent", "--session", "s", "-p", "next task"]);
  });

  it("resumeBackgroundAgent relaunches a finished session on the same conversation", () => {
    writeBackgroundAgentState({
      id: "bg-done-abc",
      status: "completed",
      sessionId: "sess-42",
      // must be a REAL directory: launch now fail-fasts on an unusable cwd
      // (stability matrix #2) instead of crashing async in spawn
      cwd: dir,
      title: "old task",
      startedAt: 1,
      endedAt: 2,
    });
    _deps.spawn = vi.fn(() => ({ pid: 777, unref: vi.fn() }));

    const state = resumeBackgroundAgent("bg-done-abc", "continue the work");

    expect(state.sessionId).toBe("sess-42");
    expect(state.status).toBe("running");
    // the job file (2nd spawn arg) carries the minimal resume argv
    const jobFile = _deps.spawn.mock.calls[0][1][1];
    const job = JSON.parse(readFileSync(jobFile, "utf8"));
    expect(job.argv).toEqual([
      "agent",
      "--session",
      "sess-42",
      "--print=continue the work",
    ]);
    expect(job.followUpArgv).toEqual(["agent", "--session", "sess-42"]);
  });

  it.each([
    ["bg-resume-option-help", "--help"],
    ["bg-resume-option-worktree", "--no-worktree"],
    ["bg-resume-option-bypass", "--dangerously-skip-permissions"],
  ])("keeps an option-shaped resume prompt as data (%s)", (id, prompt) => {
    writeBackgroundAgentState({
      id,
      status: "completed",
      sessionId: `session-${id}`,
      cwd: dir,
      startedAt: 1,
      endedAt: 2,
    });
    _deps.spawn = vi.fn(() => ({ pid: 778, unref: vi.fn() }));

    resumeBackgroundAgent(id, prompt);
    const jobFile = _deps.spawn.mock.calls[0][1][1];
    const job = JSON.parse(readFileSync(jobFile, "utf8"));

    expect(job.argv).toContain(`--print=${prompt}`);
    expect(job.argv).not.toContain(prompt);
  });

  it("resumeBackgroundAgent rebuilds the persisted provider and policy profile", () => {
    // Hosted macOS and Windows runners expose tmp paths through aliases
    // (/var -> /private/var, or short-name/junction paths). Exercise that
    // explicitly: the persisted profile owns canonical paths, not the input
    // spelling used by the first launch.
    const profileRoot = join(dir, "profile-root");
    const profileAlias = join(dir, "profile-alias");
    mkdirSync(profileRoot);
    symlinkSync(
      profileRoot,
      profileAlias,
      process.platform === "win32" ? "junction" : "dir",
    );
    const settings = join(profileAlias, "settings.json");
    const mcp = join(profileAlias, "mcp.json");
    const bundle = join(profileAlias, "bundle");
    writeFileSync(settings, "{}\n");
    writeFileSync(mcp, '{"mcpServers":{}}\n');
    mkdirSync(bundle);
    writeFileSync(join(bundle, "AGENTS.md"), "profile fixture\n");
    _deps.spawn = vi.fn(() => ({ pid: 777, unref: vi.fn() }));

    const original = launchBackgroundAgent({
      argv: [
        "agent",
        "initial task must not persist in the profile",
        "--provider",
        "openai",
        "--model",
        "gpt-profile",
        "--allowed-tools",
        "read_file,run_shell",
        "--disallowed-tools",
        "delete_file",
        "--permission-mode",
        "plan",
        "--sandbox-mode",
        "strict",
        "--mcp-config",
        mcp,
        "--strict-mcp-config",
        "--settings",
        settings,
        "--bundle",
        bundle,
        "--max-turns",
        "7",
        "--max-budget-usd",
        "1.5",
      ],
      cwd: dir,
      sessionId: "sess-profile",
      title: "profile launch",
      governance: {
        permissionMode: "plan",
        resourceBudget: { maxTurns: 7, maxCostUsd: 1.5 },
      },
    });
    expect(original.launchProfile.settings.file).not.toBe(settings);
    writeBackgroundAgentState({
      ...readBackgroundAgentState(original.id),
      status: "completed",
      endedAt: Date.now(),
      exitCode: 0,
    });

    const resumed = resumeBackgroundAgent(original.id, "continue safely");
    const workerSpawn = _deps.spawn.mock.calls
      .filter((call) => call[2].origin === "background-agent:worker")
      .at(-1);
    const jobFile = workerSpawn[1][1];
    const job = JSON.parse(readFileSync(jobFile, "utf8"));
    expect(job.argv).toEqual(
      expect.arrayContaining([
        "--provider",
        "openai",
        "--model",
        "gpt-profile",
        "--allowed-tools",
        "read_file,run_shell",
        "--disallowed-tools",
        "delete_file",
        "--permission-mode",
        "plan",
        "--sandbox-mode",
        "strict",
        "--mcp-config",
        original.launchProfile.mcp.configFile,
        "--settings",
        original.launchProfile.settings.file,
        "--bundle",
        original.launchProfile.plugins.bundle,
        "--max-turns",
        "7",
        "--max-budget-usd",
        "1.5",
        "--session",
        "sess-profile",
        "--print=continue safely",
      ]),
    );
    expect(JSON.stringify(job)).not.toContain(
      "initial task must not persist in the profile",
    );
    expect(resumed.id).not.toBe(original.id);
    expect(resumed.launchProfile.llm).toMatchObject({
      provider: "openai",
      model: "gpt-profile",
    });
    expect(resumed.configFingerprint).toBe(original.configFingerprint);
  });

  it("resumeBackgroundAgent rejects model/profile drift unless explicitly overridden", () => {
    _deps.spawn = vi.fn(() => ({ pid: 777, unref: vi.fn() }));
    const original = launchBackgroundAgent({
      argv: [
        "agent",
        "task",
        "--model",
        "model-one",
        "--permission-mode",
        "manual",
      ],
      cwd: dir,
      sessionId: "sess-drift",
      title: "drift launch",
    });
    writeBackgroundAgentState({
      ...readBackgroundAgentState(original.id),
      status: "completed",
      endedAt: Date.now(),
      exitCode: 0,
    });
    const override = structuredClone(original.launchProfile);
    override.llm.model = "model-two";
    override.permission.dangerousBypass = true;

    expect(() =>
      resumeBackgroundAgent(original.id, "continue", {
        launchProfileOverride: override,
      }),
    ).toThrow(/model-changed.*permission-bypass-enabled/);

    const resumed = resumeBackgroundAgent(original.id, "continue", {
      launchProfileOverride: override,
      allowIncompatibleProfile: true,
    });
    expect(resumed.launchProfile.llm.model).toBe("model-two");
    expect(resumed.launchProfile.permission.dangerousBypass).toBe(true);
    expect(resumed.governance.permissionMode).toBe("manual");
    const workerSpawn = _deps.spawn.mock.calls
      .filter((call) => call[2].origin === "background-agent:worker")
      .at(-1);
    const jobFile = workerSpawn[1][1];
    const job = JSON.parse(readFileSync(jobFile, "utf8"));
    expect(job.argv).toEqual(
      expect.arrayContaining([
        "--model",
        "model-two",
        "--allow-dangerous-bypass",
      ]),
    );
  });

  it("resumeBackgroundAgent requires an external replacement for a redacted API key", () => {
    const previous = process.env.CC_API_KEY;
    delete process.env.CC_API_KEY;
    try {
      _deps.spawn = vi.fn(() => ({ pid: 777, unref: vi.fn() }));
      const original = launchBackgroundAgent({
        argv: [
          "agent",
          "task",
          "--model",
          "model-one",
          "--api-key",
          "launch-secret",
        ],
        cwd: dir,
        sessionId: "sess-redacted-key",
        title: "key launch",
      });
      writeBackgroundAgentState({
        ...readBackgroundAgentState(original.id),
        status: "completed",
        endedAt: Date.now(),
        exitCode: 0,
      });

      expect(() => resumeBackgroundAgent(original.id, "continue")).toThrow(
        /external-api-key-unavailable/,
      );
      const resumed = resumeBackgroundAgent(original.id, "continue", {
        apiKey: "resume-secret",
      });
      expect(resumed.launchProfile.credentials.apiKey).toBe("external");
      const workerSpawn = _deps.spawn.mock.calls
        .filter((call) => call[2].origin === "background-agent:worker")
        .at(-1);
      const jobFile = workerSpawn[1][1];
      expect(readFileSync(jobFile, "utf8")).not.toContain("resume-secret");
      expect(workerSpawn[2].env.CC_API_KEY).toBe("resume-secret");
    } finally {
      if (previous === undefined) delete process.env.CC_API_KEY;
      else process.env.CC_API_KEY = previous;
    }
  });

  it("resumeBackgroundAgent refuses running sessions and empty prompts", () => {
    writeBackgroundAgentState({
      id: "bg-live-abc",
      status: "running",
      pid: process.pid,
      sessionId: "sess-1",
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
    });
    expect(() => resumeBackgroundAgent("bg-live-abc", "x")).toThrow(
      /still running/,
    );

    writeBackgroundAgentState({
      id: "bg-nosess-abc",
      status: "failed",
      startedAt: 1,
      endedAt: 2,
    });
    expect(() => resumeBackgroundAgent("bg-nosess-abc", "x")).toThrow(
      /no session id/,
    );
    writeBackgroundAgentState({
      id: "bg-done2-abc",
      status: "completed",
      sessionId: "s",
      startedAt: 1,
      endedAt: 2,
    });
    expect(() => resumeBackgroundAgent("bg-done2-abc", "   ")).toThrow(
      /requires a prompt/,
    );
  });

  it("runs follow-up turns over the session transport and finalizes on detach", async () => {
    const workDir = join(dir, "interactive-work");
    const isolatedHome = join(dir, "interactive-home");
    mkdirSync(workDir);
    const fakeCli = join(dir, "fake-cli-interactive.mjs");
    // Turn 1 (no -p) stays alive long enough for the test to attach; follow-up
    // turns (-p present) print their argv and exit quickly.
    writeFileSync(
      fakeCli,
      [
        "const argv = process.argv.slice(2);",
        'console.log("TURN " + JSON.stringify(argv));',
        'const wait = argv.includes("-p") ? 100 : 4000;',
        "setTimeout(() => process.exit(0), wait);",
        "",
      ].join("\n"),
    );
    const previousHome = process.env.CHAINLESSCHAIN_HOME;
    let state;
    try {
      process.env.CHAINLESSCHAIN_HOME = isolatedHome;
      state = launchBackgroundAgent({
        argv: ["--flag-a"],
        cwd: workDir,
        sessionId: "session-interactive",
        title: "interactive",
        cliEntry: fakeCli,
        followUpArgv: ["--flag-a"],
      });
    } finally {
      if (previousHome === undefined) {
        delete process.env.CHAINLESSCHAIN_HOME;
      } else {
        process.env.CHAINLESSCHAIN_HOME = previousHome;
      }
    }
    expect(state.cwd).toBe(state.launchProfile.workspace.cwd);

    // Wait for the worker to publish its transport endpoint.
    let transport = null;
    for (let i = 0; i < 100 && !transport; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      transport = readBackgroundAgentState(state.id)?.transport || null;
    }
    expect(transport?.pipe).toBeTruthy();
    expect(transport?.token).toBeTruthy();

    const { connectBackgroundSession } =
      await import("../../src/lib/background-session-transport.js");
    const events = [];
    const conn = await connectBackgroundSession({
      pipePath: transport.pipe,
      token: transport.token,
      timeoutMs: 60_000,
      onEvent: (m) => events.push(m),
    });
    expect(conn.hello).toMatchObject({ type: "hello", interactive: true });

    // Queue a follow-up while turn 1 is still running.
    conn.send({ type: "prompt", text: "second task" });
    // Turn 1 is a 4s sleep — /stop cuts it short so turn 2 starts right away.
    conn.send({ type: "stop" });

    let turn2Ended = false;
    for (let i = 0; i < 300 && !turn2Ended; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      turn2Ended = events.some((e) => e.type === "turn-ended" && e.turn === 2);
    }
    expect(
      events.some((e) => e.type === "turn-started" && e.turn === 2),
      `state=${JSON.stringify(readBackgroundAgentState(state.id))} log=${readBackgroundAgentLog(state.id)}`,
    ).toBe(true);
    expect(
      turn2Ended,
      `state=${JSON.stringify(readBackgroundAgentState(state.id))} log=${readBackgroundAgentLog(state.id)}`,
    ).toBe(true);
    expect(readBackgroundAgentLog(state.id)).toContain('"--print=second task"');

    // Detach while idle → the worker finalizes and clears the transport.
    conn.close();
    let final = null;
    for (let i = 0; i < 100; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const current = readBackgroundAgentState(state.id);
      if (current?.status && current.status !== "running") {
        final = current;
        break;
      }
    }
    expect(final?.status).toBe("completed");
    expect(final?.transport ?? null).toBe(null);
    expect(final?.turnCount).toBe(2);
  }, 90000);

  it.skipIf(process.platform !== "win32")(
    "stops a running Windows process tree through taskkill",
    () => {
      // A real live sleeper (non-self) passes the liveness gate; the stubbed
      // spawnSync absorbs the taskkill so no real signal is delivered — the
      // sleeper is reaped in afterEach via its state record.
      const sleeperPid = spawnSleeperPid();
      writeBackgroundAgentState({
        id: "bg-stop-abc",
        status: "running",
        pid: sleeperPid,
        startedAt: Date.now(),
      });
      const startedAt = readBackgroundAgentState("bg-stop-abc").startedAt;
      _deps.readProcessStartTimeMs = vi.fn(() => startedAt);
      _deps.spawnSync = vi.fn((file, args) => {
        process.kill(Number(args[1]), "SIGKILL");
        return { status: 0 };
      });
      const state = stopBackgroundAgent("bg-stop-abc");
      expect(state.status).toBe("stopped");
      expect(state.stopped).toBe(true);
      expect(_deps.spawnSync).toHaveBeenCalledWith(
        "taskkill",
        expect.arrayContaining(["/T", "/F"]),
        expect.objectContaining({
          origin: "background-agent:stop-tree",
          policy: "allow",
          scope: "background-agent",
          shell: false,
          timeout: BACKGROUND_AGENT_KEEPER_TASKKILL_TIMEOUT_MS,
        }),
      );
    },
  );

  it("routes an attached Windows session stop through brokered taskkill tree semantics", () => {
    _deps.spawnSync = vi.fn(() => ({ status: 0 }));

    expect(stopBackgroundAgentChildTree(4242, { platform: "win32" })).toBe(
      true,
    );
    expect(_deps.spawnSync).toHaveBeenCalledWith(
      "taskkill",
      ["/PID", "4242", "/T", "/F"],
      expect.objectContaining({
        origin: "background-agent:session-stop-tree",
        policy: "allow",
        scope: "background-agent",
        shell: false,
        timeout: BACKGROUND_AGENT_KEEPER_TASKKILL_TIMEOUT_MS,
      }),
    );
  });

  it("fails closed when the bounded Windows taskkill times out", () => {
    const timeout = Object.assign(new Error("taskkill timed out"), {
      code: "ETIMEDOUT",
    });
    _deps.spawnSync = vi.fn(() => ({ error: timeout, status: null }));

    expect(() =>
      stopBackgroundAgentChildTree(4242, { platform: "win32" }),
    ).toThrow(/taskkill timed out/u);
    expect(_deps.spawnSync).toHaveBeenCalledWith(
      "taskkill",
      ["/PID", "4242", "/T", "/F"],
      expect.objectContaining({
        timeout: BACKGROUND_AGENT_KEEPER_TASKKILL_TIMEOUT_MS,
      }),
    );
  });

  it.skipIf(process.platform !== "win32")(
    "bounds the orphan-reclaim taskkill command",
    () => {
      _deps.spawnSync = vi.fn(() => ({ status: 0 }));

      expect(originalKillTree(4242)).toBe(true);
      expect(_deps.spawnSync).toHaveBeenCalledWith(
        "taskkill",
        ["/PID", "4242", "/T", "/F"],
        expect.objectContaining({
          origin: "background-agent:process-tree-kill",
          timeout: BACKGROUND_AGENT_KEEPER_TASKKILL_TIMEOUT_MS,
        }),
      );
    },
  );

  it.skipIf(process.platform === "win32")(
    "stops a running POSIX worker via the injectable kill seam (group first)",
    () => {
      const sleeperPid = spawnSleeperPid();
      writeBackgroundAgentState({
        id: "bg-stop-posix",
        status: "running",
        pid: sleeperPid,
        startedAt: Date.now(),
      });
      const startedAt = readBackgroundAgentState("bg-stop-posix").startedAt;
      _deps.readProcessStartTimeMs = vi.fn(() => startedAt);
      _deps.kill = vi.fn((pid, signal) => process.kill(pid, signal));
      const state = stopBackgroundAgent("bg-stop-posix");
      expect(state.status).toBe("stopped");
      expect(state.stopped).toBe(true);
      // Group signal through the seam — never a bare process.kill.
      expect(_deps.kill).toHaveBeenCalledWith(-sleeperPid, "SIGTERM");
    },
  );

  it("accepts ESRCH when an exact POSIX target exits between probe and signal", () => {
    const missing = Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });
    _deps.kill = vi.fn(() => {
      throw missing;
    });

    expect(
      signalBackgroundProcessTree(4242, "SIGTERM", { platform: "linux" }),
    ).toBe("already-exited");
    expect(_deps.kill).toHaveBeenNthCalledWith(1, -4242, "SIGTERM");
    expect(_deps.kill).toHaveBeenNthCalledWith(2, 4242, "SIGTERM");
  });

  it("does not fall back from a POSIX process-group permission failure", () => {
    const denied = Object.assign(new Error("kill EPERM"), { code: "EPERM" });
    _deps.kill = vi.fn(() => {
      throw denied;
    });

    expect(() =>
      signalBackgroundProcessTree(4242, "SIGTERM", { platform: "linux" }),
    ).toThrow(denied);
    expect(_deps.kill).toHaveBeenCalledTimes(1);
    expect(_deps.kill).toHaveBeenCalledWith(-4242, "SIGTERM");
  });

  it.skipIf(process.platform === "win32")(
    "reads POSIX group states through the constrained execution broker",
    () => {
      _deps.spawnSync = vi.fn(() => ({
        status: 0,
        stdout: "  41 Z\n  42 Ss\n  42 Z+\n",
      }));

      expect(originalReadProcessGroupStates(42)).toEqual(["S", "Z"]);
      expect(_deps.spawnSync).toHaveBeenCalledWith(
        "ps",
        ["-A", "-o", "pgid=", "-o", "stat="],
        expect.objectContaining({
          origin: "background-agent:process-group-state",
          policy: "allow",
          scope: "background-agent",
          shell: false,
        }),
      );
    },
  );

  it.skipIf(process.platform === "win32")(
    "treats a signalled POSIX zombie as terminated before parent reaping",
    () => {
      const sleeperPid = spawnSleeperPid();
      const startedAt = Date.now();
      writeBackgroundAgentState({
        id: "bg-stop-posix-zombie",
        status: "running",
        pid: sleeperPid,
        startedAt,
      });
      _deps.readProcessStartTimeMs = vi.fn(() => startedAt);
      _deps.readProcessState = vi
        .fn()
        .mockReturnValueOnce("S")
        .mockReturnValue("Z");
      _deps.readProcessGroupStates = vi.fn(() => ["Z"]);
      _deps.kill = vi.fn();

      const state = stopBackgroundAgent("bg-stop-posix-zombie");

      expect(state).toMatchObject({ status: "stopped", stopped: true });
      expect(_deps.kill).toHaveBeenCalledWith(-sleeperPid, "SIGTERM");
    },
  );

  it.skipIf(process.platform === "win32")(
    "keeps stop pending while a zombie POSIX leader has an executing group member",
    () => {
      const sleeperPid = spawnSleeperPid();
      const startedAt = Date.now();
      writeBackgroundAgentState({
        id: "bg-stop-posix-zombie-live-group",
        status: "running",
        pid: sleeperPid,
        startedAt,
      });
      _deps.readProcessStartTimeMs = vi.fn(() => startedAt);
      _deps.readProcessState = vi
        .fn()
        .mockReturnValueOnce("S")
        .mockReturnValue("Z");
      _deps.readProcessGroupStates = vi.fn(() => ["Z", "S"]);
      _deps.processExitWaitDeadlineMs = 0;
      _deps.kill = vi.fn();

      const state = stopBackgroundAgent("bg-stop-posix-zombie-live-group");

      expect(state).toMatchObject({
        status: "running",
        stopped: false,
        stopPending: true,
        stopPendingReason: "process-exit",
      });
      expect(_deps.kill).toHaveBeenCalledWith(-sleeperPid, "SIGTERM");
    },
  );

  it.skipIf(process.platform === "win32")(
    "fails closed when a zombie POSIX group snapshot cannot be read",
    () => {
      const sleeperPid = spawnSleeperPid();
      const startedAt = Date.now();
      writeBackgroundAgentState({
        id: "bg-stop-posix-zombie-unknown-group",
        status: "running",
        pid: sleeperPid,
        startedAt,
      });
      _deps.readProcessStartTimeMs = vi.fn(() => startedAt);
      _deps.readProcessState = vi
        .fn()
        .mockReturnValueOnce("S")
        .mockReturnValue("Z");
      _deps.readProcessGroupStates = vi.fn(() => null);
      _deps.processExitWaitDeadlineMs = 0;
      _deps.kill = vi.fn();

      const state = stopBackgroundAgent("bg-stop-posix-zombie-unknown-group");

      expect(state).toMatchObject({
        stopped: false,
        stopPending: true,
        stopPendingReason: "process-exit",
      });
    },
  );

  it.skipIf(process.platform === "win32")(
    "fails closed when descendants survive a POSIX leader PID reuse",
    () => {
      const sleeperPid = spawnSleeperPid();
      const startedAt = Date.now() - 300_000;
      writeBackgroundAgentState({
        id: "bg-stop-posix-reused-live-group",
        status: "running",
        pid: sleeperPid,
        startedAt,
      });
      _deps.readProcessState = vi.fn(() => "S");
      _deps.readProcessStartTimeMs = vi.fn(() => Date.now());
      _deps.readProcessGroupStates = vi.fn(() => ["S"]);
      _deps.kill = vi.fn();

      const state = stopBackgroundAgent("bg-stop-posix-reused-live-group");

      expect(state).toMatchObject({
        stopped: false,
        stopPending: true,
        stopPendingReason: "identity-unverifiable",
      });
      expect(_deps.kill).not.toHaveBeenCalled();
    },
  );

  it("refuses to signal a record whose pid is the current process (corrupt state)", () => {
    // A worker record can never legitimately point at the stopper itself —
    // pre-guard, this exact shape SIGTERMed the vitest worker (the shard-2/4
    // "worker-death" CI flake) and would nuke a user's shell tree on Windows.
    writeBackgroundAgentState({
      id: "bg-stop-self",
      status: "running",
      pid: process.pid,
      startedAt: Date.now(),
    });
    _deps.spawnSync = vi.fn(() => ({ status: 0 }));
    const state = stopBackgroundAgent("bg-stop-self");
    expect(state.stopped).toBe(false);
    expect(state.status).toBe("lost");
    expect(state.lostReason).toBe("self-pid-corrupt-record");
    expect(_deps.kill).not.toHaveBeenCalled();
    expect(_deps.spawnSync).not.toHaveBeenCalled();
  });

  it("defaultKillProcessTree never signals the current process", () => {
    _deps.spawnSync = vi.fn(() => ({ status: 0 }));
    expect(originalKillTree(process.pid)).toBe(false);
    expect(_deps.kill).not.toHaveBeenCalled();
    expect(_deps.spawnSync).not.toHaveBeenCalled();
  });

  it("keeps a visible stop fence when process-tree termination fails", () => {
    const sleeperPid = spawnSleeperPid();
    writeBackgroundAgentState({
      id: "bg-stop-failed-fence",
      status: "running",
      pid: sleeperPid,
      workerPid: sleeperPid,
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
    });
    if (process.platform === "win32") {
      _deps.spawnSync = vi.fn(() => ({
        status: 1,
        error: new Error("taskkill denied"),
      }));
    } else {
      _deps.kill = vi.fn(() => {
        throw new Error("kill denied");
      });
    }

    const startedAt = readBackgroundAgentState(
      "bg-stop-failed-fence",
    ).startedAt;
    _deps.readProcessStartTimeMs = vi.fn(() => startedAt);

    expect(() => stopBackgroundAgent("bg-stop-failed-fence")).toThrow();
    const fenced = readBackgroundAgentState("bg-stop-failed-fence");
    expect(fenced).toMatchObject({
      status: "running",
      phase: "stop_failed",
      stopRequestedBy: "user",
    });
    expect(fenced.stopRequestedAt).toEqual(expect.any(Number));
    expect(fenced.stopError).toMatch(/denied/i);
    expect(
      claimBackgroundAgentHeartbeat("bg-stop-failed-fence", {
        pid: sleeperPid,
        workerPid: sleeperPid,
      }).applied,
    ).toBe(false);
  });
});

describe("removeBackgroundAgent (cc daemon rm, gap 2026-07-11)", () => {
  it("removes a terminal session's state + log", () => {
    writeBackgroundAgentState({
      id: "bg-rm-done",
      status: "completed",
      startedAt: Date.now(),
    });
    writeFileSync(logPath("bg-rm-done"), "some log\n", "utf-8");
    const result = removeBackgroundAgent("bg-rm-done");
    expect(result).toMatchObject({
      id: "bg-rm-done",
      removed: true,
      status: "completed",
    });
    expect(existsSync(statePath("bg-rm-done"))).toBe(false);
    expect(existsSync(logPath("bg-rm-done"))).toBe(false);
    expect(readBackgroundAgentState("bg-rm-done")).toBeNull();
  });

  it("never lets a stale generic writer recreate a removed record", () => {
    const id = "bg-rm-no-resurrection";
    writeBackgroundAgentState({
      id,
      status: "completed",
      startedAt: 1,
      endedAt: 2,
    });
    const stale = readBackgroundAgentState(id);
    removeBackgroundAgent(id);

    const written = persistBackgroundAgentState({
      ...stale,
      status: "running",
      heartbeatAt: Date.now(),
    });

    expect(written).toBeNull();
    const claim = claimBackgroundAgentHeartbeat(id, {
      pid: 43213,
      workerPid: 43213,
    });
    expect(claim).toEqual({ applied: false, state: null, previous: null });
    expect(readBackgroundAgentState(id)).toBeNull();
  });

  it("retains terminal records while turn ownership is uncertain", () => {
    const id = "bg-rm-turn-uncertain";
    writeBackgroundAgentState({
      id,
      status: "failed",
      startedAt: 1,
      endedAt: 2,
      agentPid: 43215,
      turnLaunchFinalizationUncertain: true,
    });

    expect(() => removeBackgroundAgent(id, { keepWorktree: true })).toThrow(
      /state changed before removal/i,
    );
    expect(readBackgroundAgentState(id)).toMatchObject({
      turnLaunchFinalizationUncertain: true,
      agentPid: 43215,
    });
  });

  it("fails closed when a heartbeat finds corrupt state", () => {
    const id = "bg-corrupt-heartbeat";
    writeFileSync(statePath(id), "{not-json", "utf8");

    expect(() =>
      claimBackgroundAgentHeartbeat(id, {
        pid: 43214,
        workerPid: 43214,
      }),
    ).toThrow(
      expect.objectContaining({ code: "BACKGROUND_AGENT_STATE_CORRUPT" }),
    );
    expect(readFileSync(statePath(id), "utf8")).toBe("{not-json");
  });

  it("refuses a RUNNING session without --force", () => {
    writeBackgroundAgentState({
      id: "bg-rm-live",
      status: "running",
      pid: process.pid,
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
    });
    expect(() => removeBackgroundAgent("bg-rm-live")).toThrow(/--force/);
    expect(existsSync(statePath("bg-rm-live"))).toBe(true);
  });

  it("--force keeps the record when the mocked stop did not end the process", () => {
    // Fabricated (non-self) pid + fail-open identity probe → the stop path
    // really runs, but the signal lands in the _deps.kill spy / taskkill stub
    // instead of a live process. (The old fixture recorded pid=process.pid and
    // the then-uninterceptable POSIX process.kill SIGTERMed the vitest worker
    // itself — the shard-2/4 "worker-death" CI flake.)
    const sleeperPid = spawnSleeperPid();
    writeBackgroundAgentState({
      id: "bg-rm-force",
      status: "running",
      pid: sleeperPid,
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
    });
    const startedAt = readBackgroundAgentState("bg-rm-force").startedAt;
    _deps.readProcessStartTimeMs = vi.fn(() => startedAt);
    _deps.spawnSync = vi.fn(() => ({ status: 0 })); // Windows taskkill stub
    expect(() => removeBackgroundAgent("bg-rm-force", { force: true })).toThrow(
      /process termination and interaction recovery/i,
    );
    expect(existsSync(statePath("bg-rm-force"))).toBe(true);
    if (process.platform !== "win32") {
      expect(_deps.kill).toHaveBeenCalledWith(-sleeperPid, "SIGTERM");
    }
  });

  it("--force removes a stale-heartbeat record only after exact process death", () => {
    const sleeperPid = spawnSleeperPid();
    const startedAt = Date.now();
    writeBackgroundAgentState({
      id: "bg-rm-stale-force",
      status: "lost",
      lostReason: "heartbeat-stale",
      pid: sleeperPid,
      workerPid: sleeperPid,
      startedAt,
      heartbeatAt: startedAt - 300_000,
    });
    _deps.readProcessStartTimeMs = vi.fn(() => startedAt);
    if (process.platform === "win32") {
      _deps.spawnSync = vi.fn((file, args) => {
        process.kill(Number(args[1]), "SIGKILL");
        return { status: 0 };
      });
    } else {
      _deps.kill = vi.fn((pid, signal) => process.kill(pid, signal));
    }

    expect(
      removeBackgroundAgent("bg-rm-stale-force", { force: true }),
    ).toMatchObject({ id: "bg-rm-stale-force", removed: true });
    expect(readBackgroundAgentState("bg-rm-stale-force")).toBeNull();
  });

  it("--keep-log preserves the log file", () => {
    writeBackgroundAgentState({
      id: "bg-rm-keep",
      status: "failed",
      startedAt: Date.now(),
    });
    writeFileSync(logPath("bg-rm-keep"), "crash trace\n", "utf-8");
    removeBackgroundAgent("bg-rm-keep", { keepLog: true });
    expect(existsSync(statePath("bg-rm-keep"))).toBe(false);
    expect(existsSync(logPath("bg-rm-keep"))).toBe(true);
  });

  it("unknown id throws", () => {
    expect(() => removeBackgroundAgent("bg-nope")).toThrow(/not found/i);
  });
});

describe("pid identity — reuse detection (Gap 1, supervisor gap 2026-07-11)", () => {
  it("a pid created well AFTER startedAt reconciles running → lost (pid-reused) and persists", () => {
    const now = Date.now();
    writeBackgroundAgentState({
      id: "bg-reuse-a",
      status: "running",
      pid: process.pid, // alive — but "not our worker" per the injected probe
      workerPid: process.pid,
      startedAt: now - 300_000,
      heartbeatAt: now, // fresh — loss must come from the identity check
    });
    // pid owner born ~290s after the recorded session start → reused
    _deps.readProcessStartTimeMs = vi.fn(() => now - 10_000);

    const s = effectiveBackgroundAgentState(
      readBackgroundAgentState("bg-reuse-a"),
      { now },
    );
    expect(s.status).toBe("lost");
    expect(s.lostReason).toBe("pid-reused");
    expect(readBackgroundAgentState("bg-reuse-a").status).toBe("lost");
    expect(_deps.readProcessStartTimeMs).toHaveBeenCalledWith(process.pid);
  });

  it("probe failure fails OPEN — a live worker is never declared dead by a broken probe", () => {
    const now = Date.now();
    const state = writeBackgroundAgentState({
      id: "bg-reuse-open",
      status: "running",
      pid: process.pid,
      startedAt: now - 300_000,
      heartbeatAt: now,
    });
    _deps.readProcessStartTimeMs = vi.fn(() => null);
    const s = effectiveBackgroundAgentState(state, { now });
    expect(s.status).toBe("running");
    expect(s).toStrictEqual(state); // no correction minted
  });

  it("creation time at/before startedAt (within tolerance) is the same process", () => {
    const now = Date.now();
    _deps.readProcessStartTimeMs = () => now - 295_000; // ~5s after start
    expect(isSameProcess(process.pid, now - 300_000)).toBe(true);
    _deps.readProcessStartTimeMs = () => now - 305_000; // before start
    expect(isSameProcess(process.pid, now - 300_000)).toBe(true);
    _deps.readProcessStartTimeMs = () => now - 100_000; // 200s later → reused
    expect(isSameProcess(process.pid, now - 300_000)).toBe(false);
    // dead pid is never "the same process"
    expect(isSameProcess(999999999, now)).toBe(false);
    // no anchor → legacy semantics (alive is enough)
    expect(isSameProcess(process.pid, undefined)).toBe(true);
  });

  it.skipIf(process.platform !== "win32")(
    "stop refuses to taskkill a reused pid — even when the pre-stop reconcile just passed",
    () => {
      const now = Date.now();
      // Live non-self sleeper: passes the liveness gate without tripping the
      // self-pid guard (which would preempt the pid-reused path under test).
      const sleeperPid = spawnSleeperPid();
      writeBackgroundAgentState({
        id: "bg-reuse-stop",
        status: "running",
        pid: sleeperPid,
        startedAt: now - 300_000,
        heartbeatAt: now,
      });
      // The fresh destructive probe observes a different creation time and
      // therefore refuses to signal the reused pid.
      _deps.readProcessStartTimeMs = vi.fn(() => now - 1_000);
      _deps.spawnSync = vi.fn(() => ({ status: 0 }));

      const result = stopBackgroundAgent("bg-reuse-stop");
      expect(result.stopped).toBe(false);
      expect(result.status).toBe("lost");
      expect(result.lostReason).toBe("pid-reused");
      expect(_deps.spawnSync).not.toHaveBeenCalled(); // no taskkill fired
      expect(readBackgroundAgentState("bg-reuse-stop").status).toBe("lost");
    },
  );
});

describe("orphan agent reclaim (Gap 2, supervisor gap 2026-07-11)", () => {
  it("rejects a lost worker's pending interaction exactly once", () => {
    const originalAppend =
      interactionJournalDeps.appendEventWithVerifiedProjection;
    const originalReadVerified = interactionJournalDeps.readVerifiedEvents;
    const events = [{ type: "session_start", data: {} }];
    interactionJournalDeps.appendEventWithVerifiedProjection = vi.fn(
      (sessionId, type, data, { createProjection, validateProjection }) => {
        const projection = createProjection();
        for (const event of events) projection.accept(structuredClone(event));
        validateProjection(projection.finish(), {
          headHash: null,
          eventCount: events.length,
        });
        events.push({ sessionId, type, data: structuredClone(data) });
        return { hash: "mock-hash" };
      },
    );
    interactionJournalDeps.readVerifiedEvents = vi.fn(() =>
      events.map(({ type, data }) => ({ type, data: structuredClone(data) })),
    );

    try {
      const now = Date.now();
      writeBackgroundAgentState({
        id: "bg-interaction-lost",
        sessionId: "session-interaction-lost",
        status: "running",
        phase: "needs_input",
        pid: 999999999,
        workerPid: 999999999,
        startedAt: now - 60_000,
        heartbeatAt: now,
        pendingQuestion: {
          requestId: "request-lost",
          question: "Continue?",
          binding: {
            backgroundAgentId: "bg-interaction-lost",
            sessionId: "session-interaction-lost",
            turnId: "turn-lost",
            toolUseId: "tool-lost",
            sequence: 1,
          },
          askedAt: now - 1_000,
        },
      });

      const first = effectiveBackgroundAgentState(
        readBackgroundAgentState("bg-interaction-lost"),
        { now },
      );
      expect(first).toMatchObject({
        status: "lost",
        lostReason: "process-exited",
        phase: null,
        pendingQuestion: null,
        interactionRecovery: {
          status: "rejected",
          requestIds: ["request-lost"],
          recoveredAt: now,
        },
      });
      expect(events).toHaveLength(2);
      expect(events[1]).toMatchObject({
        sessionId: "session-interaction-lost",
        type: BACKGROUND_INTERACTION_JOURNAL_EVENT,
      });
      expect(events[1].data.records[0]).toMatchObject({
        requestId: "request-lost",
        status: "rejected",
        settlement: {
          error: { code: "INTERACTION_WORKER_LOST" },
        },
      });

      const second = effectiveBackgroundAgentState(
        readBackgroundAgentState("bg-interaction-lost"),
        { now: now + 1 },
      );
      expect(second.interactionRecovery).toEqual(first.interactionRecovery);
      expect(events).toHaveLength(2);
    } finally {
      interactionJournalDeps.appendEventWithVerifiedProjection = originalAppend;
      interactionJournalDeps.readVerifiedEvents = originalReadVerified;
    }
  });

  it("returns the fresh durable state when terminal recovery loses its CAS", () => {
    const originalAppend =
      interactionJournalDeps.appendEventWithVerifiedProjection;
    const originalReadVerified = interactionJournalDeps.readVerifiedEvents;
    const events = [{ type: "session_start", data: {} }];
    const id = "bg-interaction-recovery-cas";
    const sessionId = "session-interaction-recovery-cas";
    const workerGeneration = "generation-interaction-recovery-cas";
    const now = Date.now();

    interactionJournalDeps.readVerifiedEvents = vi.fn(() =>
      events.map(({ type, data }) => ({ type, data: structuredClone(data) })),
    );
    interactionJournalDeps.appendEventWithVerifiedProjection = vi.fn(
      (
        candidateSessionId,
        type,
        data,
        { createProjection, validateProjection },
      ) => {
        const projection = createProjection();
        for (const event of events) projection.accept(structuredClone(event));
        validateProjection(projection.finish(), {
          headHash: null,
          eventCount: events.length,
        });
        events.push({
          sessionId: candidateSessionId,
          type,
          data: structuredClone(data),
        });

        // Simulate a concurrent supervisor writer after the journal terminal
        // append but before this caller can project that result into state.
        mutateBackgroundAgentState(id, (current) => ({
          ...current,
          interactionRecovery: {
            status: "failed",
            code: "CONCURRENT_RECOVERY_OWNER",
            recoveredAt: now + 1,
            turn: 1,
            workerGeneration,
          },
        }));
        return { hash: "mock-cas-race-hash" };
      },
    );

    try {
      writeBackgroundAgentState({
        id,
        sessionId,
        workerGeneration,
        turnCount: 1,
        status: "running",
        phase: "needs_input",
        pid: 999999999,
        workerPid: 999999999,
        startedAt: now - 60_000,
        heartbeatAt: now,
        pendingQuestion: {
          requestId: "request-recovery-cas",
          question: "Continue?",
          binding: {
            backgroundAgentId: id,
            sessionId,
            turnId: "turn-recovery-cas",
            toolUseId: "tool-recovery-cas",
            sequence: 1,
          },
          askedAt: now - 1_000,
        },
        interactionRecovery: {
          status: "pending",
          turn: 1,
          workerGeneration,
          startedAt: now - 1_000,
        },
      });

      const returned = effectiveBackgroundAgentState(
        readBackgroundAgentState(id),
        { now },
      );
      const durable = readBackgroundAgentState(id);

      expect(returned.interactionRecovery).toMatchObject({
        status: "failed",
        code: "CONCURRENT_RECOVERY_OWNER",
        recoveredAt: now + 1,
      });
      expect(returned.interactionRecovery).toEqual(durable.interactionRecovery);
      expect(returned.pendingQuestion).toEqual(durable.pendingQuestion);
      expect(events.at(-1).data.records[0].status).toBe("rejected");
    } finally {
      interactionJournalDeps.appendEventWithVerifiedProjection = originalAppend;
      interactionJournalDeps.readVerifiedEvents = originalReadVerified;
    }
  });

  it("fails closed when a lost worker has malformed pending interaction evidence", () => {
    const originalReadVerified = interactionJournalDeps.readVerifiedEvents;
    interactionJournalDeps.readVerifiedEvents = vi.fn(() => [
      { type: "session_start", data: {} },
    ]);
    try {
      const now = Date.now();
      writeBackgroundAgentState({
        id: "bg-interaction-malformed",
        sessionId: "session-interaction-malformed",
        workerGeneration: "generation-malformed",
        turnCount: 1,
        status: "running",
        phase: "needs_input",
        pid: 999999999,
        workerPid: 999999999,
        startedAt: now - 60_000,
        heartbeatAt: now,
        pendingQuestion: {
          question: "Continue?",
          binding: {
            backgroundAgentId: "bg-interaction-malformed",
            sessionId: "session-interaction-malformed",
            turnId: "turn-malformed",
            toolUseId: "tool-malformed",
            sequence: 1,
          },
        },
      });

      const state = effectiveBackgroundAgentState(
        readBackgroundAgentState("bg-interaction-malformed"),
        { now },
      );
      expect(state).toMatchObject({
        status: "lost",
        pendingQuestion: { question: "Continue?" },
        interactionRecovery: {
          status: "failed",
          code: "INTERACTION_RECOVERY_FALLBACK_INVALID",
          turn: 1,
          workerGeneration: "generation-malformed",
        },
      });
      expect(() =>
        removeBackgroundAgent("bg-interaction-malformed", { force: true }),
      ).toThrow(/interaction recovery/i);
    } finally {
      interactionJournalDeps.readVerifiedEvents = originalReadVerified;
    }
  });

  it("reaps the recorded agent child when the worker is lost (dead worker pid)", () => {
    const sleeperPid = spawnSleeperPid();
    const now = Date.now();
    writeBackgroundAgentState({
      id: "bg-orphan-a",
      status: "running",
      pid: 999999999, // worker gone
      workerPid: 999999999,
      agentPid: sleeperPid, // leaked agent child, alive
      agentStartedAt: now - 5_000,
      startedAt: now - 60_000,
      heartbeatAt: now,
    });
    _deps.readProcessStartTimeMs = vi.fn((pid) =>
      pid === sleeperPid ? now - 5_000 : null,
    );
    _deps.killProcessTree = vi.fn(() => true);

    const s = effectiveBackgroundAgentState(
      readBackgroundAgentState("bg-orphan-a"),
      { now },
    );
    expect(s.status).toBe("lost");
    expect(s.lostReason).toBe("process-exited");
    expect(_deps.killProcessTree).toHaveBeenCalledWith(sleeperPid, "SIGKILL");
  });

  it("never treats the current process as a reclaimable orphan agent", () => {
    const now = Date.now();
    writeBackgroundAgentState({
      id: "bg-orphan-self",
      status: "running",
      pid: 999999999,
      workerPid: 999999999,
      agentPid: process.pid,
      agentStartedAt: now - 5_000,
      startedAt: now - 60_000,
      heartbeatAt: now,
    });
    _deps.readProcessStartTimeMs = vi.fn(() => now - 5_000);
    _deps.killProcessTree = vi.fn(() => true);

    const state = effectiveBackgroundAgentState(
      readBackgroundAgentState("bg-orphan-self"),
      { now },
    );

    expect(state).toMatchObject({
      status: "lost",
      lostReason: "process-exited",
    });
    expect(_deps.killProcessTree).not.toHaveBeenCalled();
  });

  it("never kills without an identity anchor (no agentStartedAt → fail closed)", () => {
    const now = Date.now();
    writeBackgroundAgentState({
      id: "bg-orphan-b",
      status: "running",
      pid: 999999999,
      agentPid: process.pid, // alive but unverifiable
      startedAt: now - 60_000,
      heartbeatAt: now,
    });
    _deps.killProcessTree = vi.fn(() => true);
    const s = effectiveBackgroundAgentState(
      readBackgroundAgentState("bg-orphan-b"),
      { now },
    );
    expect(s.status).toBe("lost");
    expect(_deps.killProcessTree).not.toHaveBeenCalled();
  });

  it("never kills an agent pid that was itself reused", () => {
    const now = Date.now();
    writeBackgroundAgentState({
      id: "bg-orphan-c",
      status: "running",
      pid: 999999999,
      agentPid: process.pid,
      agentStartedAt: now - 100_000,
      startedAt: now - 120_000,
      heartbeatAt: now,
    });
    // agent pid owner born ~99s after the recorded agent start → reused
    _deps.readProcessStartTimeMs = vi.fn(() => now - 1_000);
    _deps.killProcessTree = vi.fn(() => true);
    const s = effectiveBackgroundAgentState(
      readBackgroundAgentState("bg-orphan-c"),
      { now },
    );
    expect(s.status).toBe("lost");
    expect(_deps.killProcessTree).not.toHaveBeenCalled();
  });

  it("stop on an already-lost session still reaps the leaked agent child", () => {
    const sleeperPid = spawnSleeperPid();
    const now = Date.now();
    writeBackgroundAgentState({
      id: "bg-orphan-stop",
      status: "lost",
      lostReason: "heartbeat-stale",
      pid: 999999999,
      agentPid: sleeperPid,
      agentStartedAt: now - 5_000,
      startedAt: now - 60_000,
      endedAt: now - 1_000,
    });
    _deps.readProcessStartTimeMs = vi.fn(() => now - 5_000);
    if (process.platform === "win32") {
      _deps.spawnSync = vi.fn((file, args) => {
        process.kill(Number(args[1]), "SIGKILL");
        return { status: 0 };
      });
    } else {
      _deps.kill = vi.fn((pid, signal) => process.kill(pid, signal));
    }

    const result = stopBackgroundAgent("bg-orphan-stop");
    expect(result).toMatchObject({ stopped: true, status: "stopped" });
    if (process.platform === "win32") {
      expect(_deps.spawnSync).toHaveBeenCalledWith(
        "taskkill",
        expect.arrayContaining(["/PID", String(sleeperPid), "/T", "/F"]),
        expect.any(Object),
      );
    } else {
      expect(_deps.kill).toHaveBeenCalledWith(-sleeperPid, "SIGTERM");
    }
  });
});

describe("prompt queue backpressure (Gap 4, supervisor gap 2026-07-11)", () => {
  it("rejects prompts past the 100-entry cap with a transport error event", async () => {
    const fakeCli = join(dir, "fake-cli-queue.mjs");
    // Turn 1 (no -p) sleeps long so the queue stays full while we flood it;
    // follow-up turns would exit fast (they never get to run — see reap).
    writeFileSync(
      fakeCli,
      [
        "const argv = process.argv.slice(2);",
        'const wait = argv.includes("-p") ? 50 : 20000;',
        "setTimeout(() => process.exit(0), wait);",
        "",
      ].join("\n"),
    );
    const state = launchBackgroundAgent({
      argv: ["--flag-a"],
      cwd: dir,
      sessionId: "session-queue",
      title: "queue cap",
      cliEntry: fakeCli,
      followUpArgv: ["--flag-a"],
    });

    let transport = null;
    for (let i = 0; i < 100 && !transport; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      transport = readBackgroundAgentState(state.id)?.transport || null;
    }
    expect(transport?.pipe).toBeTruthy();

    const { connectBackgroundSession } =
      await import("../../src/lib/background-session-transport.js");
    const events = [];
    const conn = await connectBackgroundSession({
      pipePath: transport.pipe,
      token: transport.token,
      timeoutMs: 60_000,
      onEvent: (m) => events.push(m),
    });

    for (let i = 0; i < 101; i++) {
      conn.send({ type: "prompt", text: `queued task ${i}` });
    }
    const replies = () =>
      events.filter((e) => e.type === "accepted" || e.type === "error");
    for (let i = 0; i < 100 && replies().length < 101; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const accepted = events.filter((e) => e.type === "accepted");
    const errors = events.filter((e) => e.type === "error");
    expect(accepted.length).toBe(100);
    expect(errors.length).toBe(1);
    expect(errors[0].message).toMatch(/prompt queue full/);

    conn.close();
    // This test owns every PID in the freshly launched record. Process
    // identity admission has dedicated coverage above; return a fresh
    // in-window creation time here so a worker turn-state update cannot make
    // this queue/backpressure test depend on a second OS identity probe.
    _deps.readProcessStartTimeMs = vi.fn((pid) => {
      const target = Number(pid);
      return Number.isInteger(target) && target > 0 && target !== process.pid
        ? Date.now()
        : null;
    });
    // Reap the worker tree so the 20s turn + 100 queued turns never run on.
    if (process.platform === "win32") {
      // The sandbox can reject taskkill /T even for our own child. Keep the
      // production stop path and terminal-state write under test, but replace
      // only its OS command seam with direct termination of the recorded pids.
      _deps.spawnSync = vi.fn(() => {
        const latest = readBackgroundAgentState(state.id) || state;
        for (const pid of [
          latest.agentRuntimePid,
          latest.agentPid,
          latest.workerPid,
          latest.workerWrapperPid,
          latest.pid,
          latest.keeperPid,
          latest.keeperWrapperPid,
        ]) {
          const target = Number(pid);
          if (!Number.isInteger(target) || target <= 0) continue;
          launchedPids.add(target);
          try {
            process.kill(target, "SIGKILL");
          } catch {
            /* already gone */
          }
        }
        return { status: 0, stdout: "", stderr: "" };
      });
    } else {
      _deps.kill = (pid, signal) => process.kill(pid, signal);
    }
    const stopped = stopBackgroundAgent(state.id);
    expect(
      stopped,
      `stop=${JSON.stringify({
        status: stopped.status,
        stopped: stopped.stopped,
        phase: stopped.phase,
        stopPending: stopped.stopPending,
        stopPendingReason: stopped.stopPendingReason,
        stopError: stopped.stopError,
        processIdentityError: stopped.processIdentityError,
        interactionRecovery: stopped.interactionRecovery,
      })}`,
    ).toMatchObject({ stopped: true, status: "stopped" });
  }, 30000);
});

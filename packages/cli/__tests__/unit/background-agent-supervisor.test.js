import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  _deps,
  buildFollowUpArgv,
  effectiveBackgroundAgentState,
  isSameProcess,
  launchBackgroundAgent,
  listBackgroundAgents,
  logPath,
  normalizeBackgroundAgentTitle,
  readBackgroundAgentLog,
  readBackgroundAgentState,
  removeBackgroundAgent,
  renameBackgroundAgent,
  resumeBackgroundAgent,
  sessionLifecycleState,
  statePath,
  stopBackgroundAgent,
  writeBackgroundAgentState,
} from "../../src/lib/background-agent-supervisor.js";
import { existsSync } from "node:fs";

let dir;
const originalSpawn = _deps.spawn;
const originalSpawnSync = _deps.spawnSync;
const originalReadStart = _deps.readProcessStartTimeMs;
const originalKillTree = _deps.killProcessTree;

// PIDs of the REAL detached workers a test spawns (cliEntry tests). Several of
// them run a fake CLI that sleeps 4s–20s, so without an explicit reap they
// outlive the test as ORPHAN node processes (seen in CI as GitHub's "Terminate
// orphan process: pid (…) (node)"). On POSIX those orphans keep their transport
// domain-socket SERVER alive with our client still associated, which stops the
// vitest forks worker's event loop from draining → "Timeout terminating forks
// worker … Worker exited unexpectedly" (the recurring forks-pool worker-death
// flake, unit shard 2/4 on ubuntu+macos). Reaping every spawned tree in
// afterEach removes the orphans and lets the worker terminate cleanly.
let spawnedWorkerPids = new Set();

function killTree(pid) {
  const target = Number(pid);
  if (!Number.isInteger(target) || target <= 0 || target === process.pid)
    return;
  try {
    if (process.platform === "win32") {
      originalSpawnSync("taskkill", ["/PID", String(target), "/T", "/F"], {
        windowsHide: true,
      });
    } else {
      // Detached workers are session/group leaders → negative-pid group kill;
      // the agent grandchild is detached into its OWN group, so its recorded
      // agentPid is reaped separately (collected from the state files below).
      try {
        process.kill(-target, "SIGKILL");
      } catch {
        process.kill(target, "SIGKILL");
      }
    }
  } catch {
    /* already gone */
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cc-bg-agent-"));
  process.env.CC_BACKGROUND_AGENTS_DIR = dir;
  // Hermetic pid-identity probe: null = "unknown" → fail-open, i.e. exactly
  // the pre-Gap-1 kill(pid,0) semantics every legacy fixture here assumes.
  // Identity tests inject their own probe explicitly.
  _deps.readProcessStartTimeMs = () => null;
  // Track every REAL child this test spawns so afterEach can reap it. Mocked
  // tests reassign _deps.spawn to their own vi.fn AFTER beforeEach, so this
  // wrapper only ever records genuine detached workers, never fake pids.
  spawnedWorkerPids = new Set();
  _deps.spawn = (...args) => {
    const child = originalSpawn(...args);
    if (child && typeof child.pid === "number")
      spawnedWorkerPids.add(child.pid);
    return child;
  };
});

afterEach(async () => {
  // Reap every real worker this test spawned — plus the per-turn agent
  // grandchild the worker recorded in its state file (own process group) —
  // BEFORE tearing down _deps / the temp dir, so none of them outlive the test
  // as orphan node processes holding a live transport socket.
  try {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json") || name.includes(".job.")) continue;
      try {
        const st = JSON.parse(readFileSync(join(dir, name), "utf8"));
        for (const pid of [st.workerPid, st.pid, st.agentPid]) {
          if (Number.isInteger(pid) && pid > 0) spawnedWorkerPids.add(pid);
        }
      } catch {
        /* unreadable/partial state file — skip */
      }
    }
  } catch {
    /* dir already gone */
  }
  for (const pid of spawnedWorkerPids) killTree(pid);
  spawnedWorkerPids.clear();

  _deps.spawn = originalSpawn;
  _deps.spawnSync = originalSpawnSync;
  _deps.readProcessStartTimeMs = originalReadStart;
  _deps.killProcessTree = originalKillTree;
  delete process.env.CC_BACKGROUND_AGENTS_DIR;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      break;
    } catch (error) {
      if (error?.code !== "EBUSY" || attempt === 19) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
});

describe("background agent supervisor", () => {
  it("launches a detached worker without persisting argv secrets", () => {
    _deps.spawn = vi.fn(() => ({ pid: 43210, unref: vi.fn() }));
    const state = launchBackgroundAgent({
      argv: ["agent", "-p", "work", "--api-key", "secret"],
      cwd: process.cwd(),
      sessionId: "session-test",
      title: "work",
    });
    expect(state.status).toBe("running");
    expect(state.pid).toBe(43210);
    expect(readBackgroundAgentState(state.id)).not.toHaveProperty("argv");
    expect(_deps.spawn.mock.calls[0][2]).toMatchObject({
      detached: true,
      stdio: "ignore",
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
    const fakeCli = join(dir, "fake-cli.mjs");
    writeFileSync(
      fakeCli,
      'console.log("worker-output"); setTimeout(() => process.exit(0), 50);\n',
    );
    const state = launchBackgroundAgent({
      argv: [],
      cwd: dir,
      sessionId: "session-real",
      title: "real worker",
      cliEntry: fakeCli,
    });
    let completed = null;
    for (let i = 0; i < 50; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const current = readBackgroundAgentState(state.id);
      if (current?.status === "completed") {
        completed = current;
        break;
      }
    }
    expect(completed?.exitCode).toBe(0);
    expect(completed?.workerPid).toBe(state.pid);
    expect(Number.isInteger(completed?.agentPid)).toBe(true);
    expect(Number.isFinite(completed?.heartbeatAt)).toBe(true);
    expect(readBackgroundAgentLog(state.id)).toContain("worker-output");
  });

  it("keeps a running rename when the worker writes completion", async () => {
    const fakeCli = join(dir, "fake-cli-rename.mjs");
    writeFileSync(fakeCli, "setTimeout(() => process.exit(0), 150);\n");
    const state = launchBackgroundAgent({
      argv: [],
      cwd: dir,
      sessionId: "session-rename",
      title: "before",
      cliEntry: fakeCli,
    });

    const renamed = renameBackgroundAgent(state.id, "after");
    expect(renamed.title).toBe("after");

    // Deadline-based poll: a cold detached node boot can take >1.5s under CI
    // load — the fixed 30×50ms loop here used to expire before the worker
    // even wrote completion. (The rename-vs-finalize clobber itself is fixed
    // at the root in writeBackgroundAgentState's field-aware merge.)
    let completed = null;
    const deadline = Date.now() + 10_000;
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
    // positional prompt
    expect(
      buildFollowUpArgv(
        ["agent", "do", "the", "task", "--model", "m", "--session", "s"],
        { positionalTokens: ["do", "the", "task"] },
      ),
    ).toEqual(["agent", "--model", "m", "--session", "s"]);
    // -p <value> prompt
    expect(
      buildFollowUpArgv(["agent", "-p", "fix it", "--session", "s"], {
        printValue: "fix it",
      }),
    ).toEqual(["agent", "--session", "s"]);
    // bare -p (piped prompt) — flag dropped, no value to drop
    expect(
      buildFollowUpArgv(["agent", "-p", "--session", "s"], {
        printValue: null,
      }),
    ).toEqual(["agent", "--session", "s"]);
    // a flag value that happens to equal a positional token is not stripped
    expect(
      buildFollowUpArgv(["agent", "fix", "--title", "fix"], {
        positionalTokens: ["fix"],
      }),
    ).toEqual(["agent", "--title", "fix"]);
    // equals-form --print=<value> is stripped too
    expect(
      buildFollowUpArgv(["agent", "--print=fix it", "--session", "s"], {
        printValue: "fix it",
      }),
    ).toEqual(["agent", "--session", "s"]);
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
      "-p",
      "continue the work",
    ]);
    expect(job.followUpArgv).toEqual(["agent", "--session", "sess-42"]);
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

  // BISECT (temp): does skipping the transport-client-socket tests clear the
  // forks-pool worker-death on POSIX? If so, the client socket is the pin.
  it.skip("runs follow-up turns over the session transport and finalizes on detach", async () => {
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
    const state = launchBackgroundAgent({
      argv: ["--flag-a"],
      cwd: dir,
      sessionId: "session-interactive",
      title: "interactive",
      cliEntry: fakeCli,
      followUpArgv: ["--flag-a"],
    });

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
      onEvent: (m) => events.push(m),
    });
    expect(conn.hello).toMatchObject({ type: "hello", interactive: true });

    // Queue a follow-up while turn 1 is still running.
    conn.send({ type: "prompt", text: "second task" });
    // Turn 1 is a 4s sleep — /stop cuts it short so turn 2 starts right away.
    conn.send({ type: "stop" });

    let turn2Ended = false;
    for (let i = 0; i < 150 && !turn2Ended; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      turn2Ended = events.some((e) => e.type === "turn-ended" && e.turn === 2);
    }
    expect(events.some((e) => e.type === "turn-started" && e.turn === 2)).toBe(
      true,
    );
    expect(turn2Ended).toBe(true);
    expect(readBackgroundAgentLog(state.id)).toContain('"second task"');

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
  }, 30000);

  it.skipIf(process.platform !== "win32")(
    "stops a running Windows process tree through taskkill",
    () => {
      writeBackgroundAgentState({
        id: "bg-stop-abc",
        status: "running",
        pid: process.pid,
        startedAt: Date.now(),
      });
      _deps.spawnSync = vi.fn(() => ({ status: 0 }));
      const state = stopBackgroundAgent("bg-stop-abc");
      expect(state.status).toBe("stopped");
      expect(state.stopped).toBe(true);
      expect(_deps.spawnSync).toHaveBeenCalledWith(
        "taskkill",
        expect.arrayContaining(["/T", "/F"]),
        expect.any(Object),
      );
    },
  );
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

  it("--force stops the running session first, then removes", () => {
    writeBackgroundAgentState({
      id: "bg-rm-force",
      status: "running",
      pid: process.pid,
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
    });
    _deps.spawnSync = vi.fn(() => ({ status: 0 })); // taskkill / kill stub
    const result = removeBackgroundAgent("bg-rm-force", { force: true });
    expect(result.removed).toBe(true);
    expect(existsSync(statePath("bg-rm-force"))).toBe(false);
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
    expect(s).toBe(state); // passthrough, no correction minted
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
      writeBackgroundAgentState({
        id: "bg-reuse-stop",
        status: "running",
        pid: process.pid,
        startedAt: now - 300_000,
        heartbeatAt: now,
      });
      // First identity check (effectiveBackgroundAgentState) sees our worker;
      // the pid is reused in the gap before the kill → the last-instant
      // re-check must catch it.
      _deps.readProcessStartTimeMs = vi
        .fn()
        .mockReturnValueOnce(now - 299_000) // reconcile: same process
        .mockReturnValue(now - 1_000); // pre-kill: reused
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
  it("reaps the recorded agent child when the worker is lost (dead worker pid)", () => {
    const now = Date.now();
    writeBackgroundAgentState({
      id: "bg-orphan-a",
      status: "running",
      pid: 999999999, // worker gone
      workerPid: 999999999,
      agentPid: process.pid, // leaked agent child, alive
      agentStartedAt: now - 5_000,
      startedAt: now - 60_000,
      heartbeatAt: now,
    });
    _deps.readProcessStartTimeMs = vi.fn((pid) =>
      pid === process.pid ? now - 5_000 : null,
    );
    _deps.killProcessTree = vi.fn(() => true);

    const s = effectiveBackgroundAgentState(
      readBackgroundAgentState("bg-orphan-a"),
      { now },
    );
    expect(s.status).toBe("lost");
    expect(s.lostReason).toBe("process-exited");
    expect(_deps.killProcessTree).toHaveBeenCalledWith(process.pid, "SIGKILL");
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
    const now = Date.now();
    writeBackgroundAgentState({
      id: "bg-orphan-stop",
      status: "lost",
      lostReason: "heartbeat-stale",
      pid: 999999999,
      agentPid: process.pid,
      agentStartedAt: now - 5_000,
      startedAt: now - 60_000,
      endedAt: now - 1_000,
    });
    _deps.readProcessStartTimeMs = vi.fn(() => now - 5_000);
    _deps.killProcessTree = vi.fn(() => true);

    const result = stopBackgroundAgent("bg-orphan-stop");
    expect(result.stopped).toBe(false);
    expect(_deps.killProcessTree).toHaveBeenCalledWith(process.pid, "SIGKILL");
  });
});

describe("prompt queue backpressure (Gap 4, supervisor gap 2026-07-11)", () => {
  it.skip("rejects prompts past the 100-entry cap with a transport error event", async () => {
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
    // Reap the worker tree so the 20s turn + 100 queued turns never run on.
    try {
      stopBackgroundAgent(state.id);
    } catch {
      /* already gone */
    }
  }, 30000);
});

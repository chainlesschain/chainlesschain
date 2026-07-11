/**
 * Background supervisor stability matrix, part 2 (gap #5 — 后台 agent/worktree
 * 稳定性矩阵). Complements background-stability-matrix.test.js (env
 * inheritance / launch-time cwd hygiene / async spawn errors / stale-running /
 * attach fallback / resume guards / agent-worktree keep-vs-remove) with the
 * remaining matrix cells. Full cell → test mapping lives in
 * __tests__/README-background-stability.md.
 *
 *  1. upgrade / old-schema state files  — listing, details, resume degrade
 *     gracefully when the state was written by an older CLI (missing fields),
 *     is corrupted, or carries unknown fields from a NEWER CLI
 *  2. cwd deleted after launch          — resume fails with ONE clear error
 *     (not an ENOENT crash), list/details/logs still work
 *  3. cwd replaced by a file            — same, clear "not a directory" error
 *  4. pid semantics                     — liveness is keyed to the WORKER pid
 *     (state.pid === workerPid), never to agentPid (pinning tests)
 *  5. status transitions / pid reuse    — terminal-wins write merge (rename
 *     race regression) + pid-reuse pinning
 *  6. phase / stale-correction no-flip  — a live running session is passed
 *     through byte-identically (never flipped)
 *  8. log tail rotation/truncation      — supervisor-level reader survives
 *     truncate / rotate / delete
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  _deps,
  effectiveBackgroundAgentState,
  launchBackgroundAgent,
  listBackgroundAgents,
  logPath,
  readBackgroundAgentLog,
  readBackgroundAgentState,
  renameBackgroundAgent,
  resumeBackgroundAgent,
  setBackgroundAgentPinned,
  statePath,
  writeBackgroundAgentState,
} from "../../src/lib/background-agent-supervisor.js";
import {
  formatBackgroundAgentDetails,
  formatBackgroundAgentLine,
} from "../../src/commands/background-session.js";

let dir;
const originalSpawn = _deps.spawn;
const originalSpawnSync = _deps.spawnSync;
const originalReadStart = _deps.readProcessStartTimeMs;
const originalKillTree = _deps.killProcessTree;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cc-bg-matrix2-"));
  process.env.CC_BACKGROUND_AGENTS_DIR = dir;
  // Hermetic pid-identity probe (Gap 1): null = unknown → fail-open, i.e.
  // the legacy kill(pid,0)-only semantics the fixtures here assume (many use
  // pid: process.pid with synthetic startedAt values). Identity-specific
  // tests inject their own probe.
  _deps.readProcessStartTimeMs = () => null;
});

afterEach(async () => {
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

describe("1. attach/resume across a simulated upgrade (old-schema state files)", () => {
  it("lists and reconciles a pre-heartbeat-schema state (no heartbeatAt/workerPid/startedAt/title)", () => {
    // A state file written by an older CLI: only the original fields exist.
    // The staleness check must degrade to the pid probe (Number(undefined)
    // is NaN → the heartbeat branch is skipped, no crash).
    writeFileSync(
      statePath("bg-oldschema-run"),
      JSON.stringify({
        id: "bg-oldschema-run",
        status: "running",
        pid: process.pid,
      }),
      "utf-8",
    );
    const sessions = listBackgroundAgents({ all: true });
    const s = sessions.find((x) => x.id === "bg-oldschema-run");
    expect(s.status).toBe("running"); // pid alive, no heartbeat field → trusted
    // rendering never crashes on the missing fields
    expect(() => formatBackgroundAgentLine(s)).not.toThrow();
    expect(formatBackgroundAgentDetails(s, "")).toContain("bg-oldschema-run");
  });

  it("old-schema running state with a dead pid still reconciles to lost", () => {
    writeFileSync(
      statePath("bg-oldschema-dead"),
      JSON.stringify({
        id: "bg-oldschema-dead",
        status: "running",
        pid: 999999999,
      }),
      "utf-8",
    );
    const s = effectiveBackgroundAgentState(
      readBackgroundAgentState("bg-oldschema-dead"),
    );
    expect(s.status).toBe("lost");
    expect(s.lostReason).toBe("process-exited");
  });

  it("resume of an old-schema state missing cwd degrades to process.cwd()", () => {
    writeBackgroundAgentState({
      id: "bg-oldschema-done",
      status: "completed",
      sessionId: "sid-old",
      startedAt: 1,
      endedAt: 2,
      // no cwd, no title, no logFile — pre-batch-14 schema
    });
    _deps.spawn = vi.fn(() => ({ pid: 4242, unref: vi.fn(), on: vi.fn() }));
    const state = resumeBackgroundAgent("bg-oldschema-done", "carry on");
    expect(state.status).toBe("running");
    const jobFile = _deps.spawn.mock.calls[0][1][1];
    expect(JSON.parse(readFileSync(jobFile, "utf8")).cwd).toBe(process.cwd());
  });

  it("a corrupted state file is skipped by listing instead of crashing it", () => {
    writeFileSync(statePath("bg-corrupt-x"), "{not json!!!", "utf-8");
    writeBackgroundAgentState({
      id: "bg-intact-x",
      status: "completed",
      startedAt: 1,
      endedAt: 2,
    });
    expect(readBackgroundAgentState("bg-corrupt-x")).toBe(null);
    const ids = listBackgroundAgents({ all: true }).map((s) => s.id);
    expect(ids).toContain("bg-intact-x");
    expect(ids).not.toContain("bg-corrupt-x");
  });

  it("unknown fields from a NEWER schema survive a rename round-trip (forward compat)", () => {
    writeBackgroundAgentState({
      id: "bg-future-x",
      status: "running",
      pid: process.pid,
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
      title: "old",
      futureField: { keep: "me" },
    });
    renameBackgroundAgent("bg-future-x", "new");
    const after = readBackgroundAgentState("bg-future-x");
    expect(after.title).toBe("new");
    expect(after.futureField).toEqual({ keep: "me" }); // never stripped
  });
});

describe("2. cwd deleted after launch", () => {
  it("resume against a deleted cwd fails with one clear error, not an ENOENT crash", () => {
    const gone = join(dir, "was-here");
    mkdirSync(gone);
    writeBackgroundAgentState({
      id: "bg-cwd-gone",
      status: "completed",
      sessionId: "sid-g",
      cwd: gone,
      startedAt: 1,
      endedAt: 2,
    });
    rmSync(gone, { recursive: true, force: true }); // cwd deleted after launch
    _deps.spawn = vi.fn();
    expect(() => resumeBackgroundAgent("bg-cwd-gone", "go")).toThrow(
      /Cannot launch background agent.*does not exist/,
    );
    expect(_deps.spawn).not.toHaveBeenCalled();
    // no phantom state/job files were minted for the failed resume
    expect(
      listBackgroundAgents({ all: true }).filter((s) => s.status === "running"),
    ).toEqual([]);
  });

  it("list/details/logs still work when the recorded cwd no longer exists", () => {
    writeBackgroundAgentState({
      id: "bg-cwd-gone2",
      status: "completed",
      cwd: join(dir, "never-existed"),
      startedAt: 1,
      endedAt: 2,
      exitCode: 0,
    });
    writeFileSync(logPath("bg-cwd-gone2"), "did things\n", "utf-8");
    const s = listBackgroundAgents({ all: true }).find(
      (x) => x.id === "bg-cwd-gone2",
    );
    expect(formatBackgroundAgentLine(s)).toContain("never-existed");
    expect(readBackgroundAgentLog("bg-cwd-gone2")).toContain("did things");
  });
});

describe("3. cwd locked/replaced (cross-platform testable form: replaced by a file)", () => {
  it("resume against a cwd that is now a FILE fails with a clear error", () => {
    const path = join(dir, "was-a-dir");
    writeBackgroundAgentState({
      id: "bg-cwd-file",
      status: "failed",
      sessionId: "sid-f",
      cwd: path,
      startedAt: 1,
      endedAt: 2,
    });
    writeFileSync(path, "now a file", "utf-8");
    _deps.spawn = vi.fn();
    expect(() => resumeBackgroundAgent("bg-cwd-file", "go")).toThrow(
      /not a directory/,
    );
    expect(_deps.spawn).not.toHaveBeenCalled();
  });
});

describe("4. pid semantics — liveness is keyed to the WORKER pid (pinning)", () => {
  // SEMANTICS (pinned, current behavior): state.pid === workerPid is the
  // supervising detached node process; agentPid is the per-turn CLI child.
  // Liveness/stop are keyed to state.pid only:
  //  - worker dead + agent child leaked alive  → session is LOST (correct:
  //    nothing supervises the leak; stopBackgroundAgent's taskkill /T on the
  //    worker pid is what reaps the tree on the happy path);
  //  - worker alive + agentPid dead            → still RUNNING (correct:
  //    that is exactly the between-turns / idle shape).
  it("worker pid dead → lost, even when agentPid is still alive", () => {
    writeBackgroundAgentState({
      id: "bg-pid-worker-dead",
      status: "running",
      pid: 999999999, // worker gone
      workerPid: 999999999,
      agentPid: process.pid, // leaked agent child, alive
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
    });
    const s = effectiveBackgroundAgentState(
      readBackgroundAgentState("bg-pid-worker-dead"),
    );
    expect(s.status).toBe("lost");
    expect(s.lostReason).toBe("process-exited");
  });

  it("worker pid alive + agentPid dead → still running (idle/between turns)", () => {
    const state = writeBackgroundAgentState({
      id: "bg-pid-agent-dead",
      status: "running",
      pid: process.pid,
      workerPid: process.pid,
      agentPid: 999999999,
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
    });
    expect(effectiveBackgroundAgentState(state).status).toBe("running");
  });
});

describe("5. status consistency — terminal-wins merge + pid reuse", () => {
  it("REGRESSION (rename race B1): a stale 'running' snapshot can never resurrect a terminal state", () => {
    // Worker finalized…
    writeBackgroundAgentState({
      id: "bg-term-wins",
      status: "completed",
      exitCode: 0,
      startedAt: 1,
      endedAt: 2,
      title: "old",
    });
    // …then a racing writer (rename/pin/launcher) lands a snapshot it read
    // BEFORE the finalize. The write must keep the terminal outcome.
    const written = writeBackgroundAgentState({
      id: "bg-term-wins",
      status: "running",
      pid: 12345,
      startedAt: 1,
      heartbeatAt: 99,
      title: "new",
      renamedAt: 100,
      transport: { pipe: "p", token: "t" },
    });
    expect(written.status).toBe("completed");
    expect(written.exitCode).toBe(0);
    expect(written.endedAt).toBe(2);
    expect(written.transport).toBe(null); // dead endpoint never re-advertised
    expect(written.title).toBe("new"); // the rename itself is preserved
    const disk = readBackgroundAgentState("bg-term-wins");
    expect(disk.status).toBe("completed");
    expect(disk.title).toBe("new");
  });

  it("REGRESSION (rename race B2): a stale snapshot without renamedAt can never roll back a fresh rename", () => {
    writeBackgroundAgentState({
      id: "bg-rename-keep",
      status: "running",
      pid: process.pid,
      startedAt: 1000,
      heartbeatAt: Date.now(),
      title: "old",
    });
    renameBackgroundAgent("bg-rename-keep", "new");
    // Worker-style heartbeat/finalize write carrying the PRE-rename snapshot:
    writeBackgroundAgentState({
      id: "bg-rename-keep",
      status: "completed",
      exitCode: 0,
      startedAt: 1000,
      endedAt: Date.now(),
      title: "old", // stale
    });
    const disk = readBackgroundAgentState("bg-rename-keep");
    expect(disk.status).toBe("completed"); // terminal write applied…
    expect(disk.title).toBe("new"); // …but the newer rename wins
  });

  it("same newest-wins protection for pin state", () => {
    writeBackgroundAgentState({
      id: "bg-pin-keep",
      status: "running",
      pid: process.pid,
      startedAt: 1000,
      heartbeatAt: Date.now(),
    });
    setBackgroundAgentPinned("bg-pin-keep", true);
    writeBackgroundAgentState({
      id: "bg-pin-keep",
      status: "running",
      pid: process.pid,
      startedAt: 1000,
      heartbeatAt: Date.now(), // stale worker snapshot without pin fields
    });
    expect(readBackgroundAgentState("bg-pin-keep").pinned).toBe(true);
  });

  it("lost-correction preserves a pre-existing endedAt instead of re-stamping it", () => {
    writeBackgroundAgentState({
      id: "bg-ended-keep",
      status: "running",
      pid: 999999999,
      startedAt: 1,
      heartbeatAt: Date.now(),
      endedAt: 777,
    });
    const s = effectiveBackgroundAgentState(
      readBackgroundAgentState("bg-ended-keep"),
    );
    expect(s.status).toBe("lost");
    expect(s.endedAt).toBe(777);
  });

  it("GAP CLOSED (2026-07-11): a reused pid with a fresh-looking heartbeat is detected via the process-creation identity check", () => {
    // The formerly-pinned TODO(pid-identity) gap: the supervisor now records
    // startedAt and compares it against the pid's real creation time. A pid
    // whose owner was created well after startedAt cannot be the worker —
    // it is an OS pid reuse, reconciled to lost WITHIN the heartbeat window.
    const now = Date.now();
    const state = writeBackgroundAgentState({
      id: "bg-pid-reused",
      status: "running",
      pid: process.pid, // "reused": alive, but it is not the worker
      startedAt: now - 86_400_000, // started "yesterday"
      heartbeatAt: now, // fresh (in reality frozen at reuse time)
    });
    // the pid's current owner was born ~24h after the recorded start
    _deps.readProcessStartTimeMs = vi.fn(() => now - 60_000);
    const s = effectiveBackgroundAgentState(state, { now });
    expect(s.status).toBe("lost");
    expect(s.lostReason).toBe("pid-reused");
    // …while a probe that cannot answer (null) fails OPEN and leaves the
    // heartbeat as the defense in force — never flipping a live session:
    _deps.readProcessStartTimeMs = () => null;
    const open = writeBackgroundAgentState({
      id: "bg-pid-open",
      status: "running",
      pid: process.pid,
      startedAt: now - 86_400_000,
      heartbeatAt: now,
    });
    expect(effectiveBackgroundAgentState(open, { now }).status).toBe("running");
    const later = effectiveBackgroundAgentState(open, {
      now: now + 200_000,
      heartbeatStaleMs: 120_000,
    });
    expect(later.status).toBe("lost");
    expect(later.lostReason).toBe("heartbeat-stale");
  });
});

describe("6. phase / stale-correction never flips a live running session", () => {
  it("running + alive pid + fresh heartbeat passes through IDENTICALLY (no copy, no persist)", () => {
    const state = {
      id: "bg-live-passthrough",
      status: "running",
      pid: process.pid,
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
      phase: "turn",
      turnCount: 3,
    };
    writeBackgroundAgentState(state);
    const effective = effectiveBackgroundAgentState(
      readBackgroundAgentState("bg-live-passthrough"),
    );
    expect(effective.status).toBe("running");
    expect(effective.phase).toBe("turn");
    expect(effective.turnCount).toBe(3);
    // identity pin: no correction object is minted for a live session
    const raw = readBackgroundAgentState("bg-live-passthrough");
    expect(effectiveBackgroundAgentState(raw)).toBe(raw);
  });

  it("details view surfaces phase and turn count (needs-input UX contract)", () => {
    const text = formatBackgroundAgentDetails(
      {
        id: "bg-phase-x",
        status: "running",
        startedAt: Date.now(),
        phase: "idle",
        turnCount: 2,
        transport: { pipe: "\\\\.\\pipe\\x", token: "t" },
      },
      "",
    );
    expect(text).toContain("phase: idle");
    expect(text).toContain("turns: 2");
    expect(text).toContain("interactive attach available");
  });
});

describe("8. log tail — rotation / truncation / deletion (supervisor reader)", () => {
  it("survives truncation and returns only the fresh content", () => {
    writeBackgroundAgentState({ id: "bg-log-rot", status: "completed" });
    const file = logPath("bg-log-rot");
    writeFileSync(file, "old-1\nold-2\nold-3\n", "utf-8");
    expect(readBackgroundAgentLog("bg-log-rot", { lines: 10 })).toContain(
      "old-2",
    );
    // rotate: truncate + start fresh (what logrotate copytruncate does)
    writeFileSync(file, "", "utf-8");
    expect(() => readBackgroundAgentLog("bg-log-rot")).not.toThrow();
    writeFileSync(file, "new-1\n", "utf-8");
    const after = readBackgroundAgentLog("bg-log-rot", { lines: 10 });
    expect(after).toContain("new-1");
    expect(after).not.toContain("old-1"); // no duplicated stale content
  });

  it("a deleted log file reads as empty instead of throwing ENOENT", () => {
    writeBackgroundAgentState({ id: "bg-log-del", status: "completed" });
    const file = logPath("bg-log-del");
    writeFileSync(file, "x\n", "utf-8");
    rmSync(file, { force: true });
    expect(readBackgroundAgentLog("bg-log-del")).toBe("");
  });
});

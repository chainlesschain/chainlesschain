import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  _deps,
  buildFollowUpArgv,
  effectiveBackgroundAgentState,
  launchBackgroundAgent,
  listBackgroundAgents,
  logPath,
  normalizeBackgroundAgentTitle,
  readBackgroundAgentLog,
  readBackgroundAgentState,
  renameBackgroundAgent,
  resumeBackgroundAgent,
  stopBackgroundAgent,
  writeBackgroundAgentState,
} from "../../src/lib/background-agent-supervisor.js";

let dir;
const originalSpawn = _deps.spawn;
const originalSpawnSync = _deps.spawnSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cc-bg-agent-"));
  process.env.CC_BACKGROUND_AGENTS_DIR = dir;
});

afterEach(async () => {
  _deps.spawn = originalSpawn;
  _deps.spawnSync = originalSpawnSync;
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

    let completed = null;
    for (let i = 0; i < 30; i++) {
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

  it("runs follow-up turns over the session transport and finalizes on detach", async () => {
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

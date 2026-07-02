import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  _deps,
  launchBackgroundAgent,
  listBackgroundAgents,
  logPath,
  readBackgroundAgentLog,
  readBackgroundAgentState,
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
    expect(readBackgroundAgentLog(state.id)).toContain("worker-output");
  });

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

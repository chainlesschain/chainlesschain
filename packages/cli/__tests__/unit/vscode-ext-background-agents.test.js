/**
 * Background Agents panel core — pure list / stale-correction / summarize /
 * log-tail logic over the supervisor state dir. Headless (no `vscode`).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HEARTBEAT_STALE_MS,
  effectiveStatus,
  listBackgroundSessions,
  summarizeSessions,
  formatElapsed,
  tailLog,
  readLogDelta,
} from "../../../vscode-extension/src/background-agents.js";

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "vsx-bg-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeState(state) {
  writeFileSync(join(dir, `${state.id}.json`), JSON.stringify(state), "utf8");
}

const aliveDeps = { kill: () => true }; // pid probe: alive
const deadDeps = {
  kill: () => {
    const e = new Error("ESRCH");
    e.code = "ESRCH";
    throw e;
  },
};

describe("effectiveStatus (display-only correction)", () => {
  it("keeps a fresh-heartbeat running session running", () => {
    const now = 1_000_000;
    expect(
      effectiveStatus(
        { status: "running", pid: 1, heartbeatAt: now - 5000 },
        { now, deps: aliveDeps },
      ),
    ).toEqual({ status: "running", lostReason: null });
  });

  it("marks stale heartbeat as lost without persisting", () => {
    const now = 1_000_000;
    expect(
      effectiveStatus(
        {
          status: "running",
          pid: 1,
          heartbeatAt: now - HEARTBEAT_STALE_MS - 1,
        },
        { now, deps: aliveDeps },
      ),
    ).toEqual({ status: "lost", lostReason: "heartbeat-stale" });
  });

  it("marks dead-pid running sessions as lost", () => {
    const now = 1_000_000;
    expect(
      effectiveStatus(
        { status: "running", pid: 424242, heartbeatAt: now - 1000 },
        { now, deps: deadDeps },
      ),
    ).toEqual({ status: "lost", lostReason: "process-exited" });
  });

  it("passes terminal states through untouched", () => {
    expect(effectiveStatus({ status: "completed" })).toEqual({
      status: "completed",
      lostReason: null,
    });
  });
});

describe("listBackgroundSessions", () => {
  it("lists newest first, skips job files and garbage, flags interactive", () => {
    const now = 2_000_000;
    writeState({
      id: "bg-old",
      status: "completed",
      startedAt: 100,
      endedAt: 200,
      exitCode: 0,
      sessionId: "s1",
    });
    writeState({
      id: "bg-new",
      status: "running",
      pid: 1,
      startedAt: 1_500_000,
      heartbeatAt: now - 1000,
      phase: "idle",
      turnCount: 2,
      transport: { pipe: "\\\\.\\pipe\\x", token: "t" },
    });
    writeFileSync(join(dir, "bg-x.job.123.json"), "{}", "utf8"); // job file — skipped
    writeFileSync(join(dir, "broken.json"), "{not json", "utf8"); // garbage — skipped

    const sessions = listBackgroundSessions({ dir, now, deps: aliveDeps });
    expect(sessions.map((s) => s.id)).toEqual(["bg-new", "bg-old"]);
    expect(sessions[0]).toMatchObject({
      status: "running",
      interactive: true,
      phase: "idle",
      turnCount: 2,
    });
    expect(sessions[1]).toMatchObject({
      status: "completed",
      interactive: false,
      exitCode: 0,
      sessionId: "s1",
    });
    // the takeover token itself is not part of the listing payload
    expect(JSON.stringify(sessions)).not.toContain('"token"');
  });

  it("returns [] for a missing dir", () => {
    expect(listBackgroundSessions({ dir: join(dir, "nope") })).toEqual([]);
  });

  it("a lost session is never flagged interactive even with a transport", () => {
    const now = 3_000_000;
    writeState({
      id: "bg-stale",
      status: "running",
      pid: 1,
      startedAt: 1,
      heartbeatAt: now - HEARTBEAT_STALE_MS - 1,
      transport: { pipe: "p", token: "t" },
    });
    const [s] = listBackgroundSessions({ dir, now, deps: aliveDeps });
    expect(s.status).toBe("lost");
    expect(s.interactive).toBe(false);
  });
});

describe("summarize / format / log helpers", () => {
  it("summarizeSessions counts statuses and interactive", () => {
    const sum = summarizeSessions([
      { status: "running", interactive: true },
      { status: "running", interactive: false },
      { status: "completed", interactive: false },
      { status: "lost", interactive: false },
    ]);
    expect(sum).toEqual({
      total: 4,
      running: 2,
      interactive: 1,
      counts: { running: 2, completed: 1, lost: 1 },
    });
  });

  it("formatElapsed renders s / m / h buckets", () => {
    expect(formatElapsed({ startedAt: 0, endedAt: 42_000 })).toBe("42s");
    expect(formatElapsed({ startedAt: 0, endedAt: 192_000 })).toBe("3m 12s");
    expect(formatElapsed({ startedAt: 0, endedAt: 3_840_000 })).toBe("1h 4m");
    expect(formatElapsed({ startedAt: 1000 }, 43_000)).toBe("42s"); // running → now
  });

  it("tailLog returns the last N lines and '' when unreadable", () => {
    const log = join(dir, "x.log");
    writeFileSync(log, "one\ntwo\nthree\n", "utf8");
    expect(tailLog(log, 2)).toBe("three\n");
    expect(tailLog(join(dir, "missing.log"))).toBe("");
  });

  it("readLogDelta streams growth and restarts on truncation", () => {
    const log = join(dir, "d.log");
    writeFileSync(log, "hello ", "utf8");
    const first = readLogDelta(log, 0);
    expect(first.chunk).toBe("hello ");
    writeFileSync(log, "hello world", "utf8");
    const second = readLogDelta(log, first.offset);
    expect(second.chunk).toBe("world");
    writeFileSync(log, "new", "utf8"); // truncated/rotated
    const third = readLogDelta(log, second.offset);
    expect(third.chunk).toBe("new");
  });
});

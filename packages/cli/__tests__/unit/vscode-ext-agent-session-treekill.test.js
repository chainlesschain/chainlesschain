/**
 * AgentChatSession.stop() process-tree kill + close-time buffer flush.
 *
 * On Windows the child is a cmd.exe wrapper (shell:true for the cc.cmd shim):
 * a plain child.kill() only kills cmd.exe and orphans the real cc/node
 * grandchild — it keeps running its turn (burning tokens) and holds the
 * better_sqlite3 native-module lock. stop() must go through taskkill /T /F
 * (same pattern as preview.js). On POSIX cc is spawned directly and reaps its
 * own children on SIGTERM, so child.kill() is correct there.
 */
import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { AgentChatSession } from "../../../vscode-extension/src/chat/agent-session.js";

function fakeChild({ pid } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.exitCode = null;
  child.killed = false;
  if (pid) child.pid = pid;
  child.kill = vi.fn(() => {
    child.killed = true;
  });
  return child;
}

function withPlatform(platform, fn) {
  const desc = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: platform });
  try {
    return fn();
  } finally {
    Object.defineProperty(process, "platform", desc);
  }
}

describe("AgentChatSession.stop() tree kill", () => {
  it("win32: kills the whole tree via taskkill /T /F, not just the cmd wrapper", () => {
    withPlatform("win32", () => {
      const child = fakeChild({ pid: 4242 });
      const spawnFn = vi.fn(() => child);
      const s = new AgentChatSession({ deps: { spawn: spawnFn } });
      s.start();
      s.stop();
      const taskkill = spawnFn.mock.calls.find((c) => c[0] === "taskkill");
      expect(taskkill).toBeTruthy();
      expect(taskkill[1]).toEqual(["/pid", "4242", "/T", "/F"]);
      // The wrapper is reaped by taskkill's /T — no bare kill() needed.
      expect(child.kill).not.toHaveBeenCalled();
      expect(s.running).toBe(false);
    });
  });

  it("POSIX: plain kill() (cc is the direct child and reaps its own children)", () => {
    withPlatform("linux", () => {
      const child = fakeChild({ pid: 4242 });
      const spawnFn = vi.fn(() => child);
      const s = new AgentChatSession({ deps: { spawn: spawnFn } });
      s.start();
      s.stop();
      expect(child.kill).toHaveBeenCalledTimes(1);
      expect(
        spawnFn.mock.calls.filter((c) => c[0] === "taskkill"),
      ).toHaveLength(0);
    });
  });

  it("no pid (spawn failed / fake) falls back to kill() everywhere", () => {
    withPlatform("win32", () => {
      const child = fakeChild(); // no pid
      const s = new AgentChatSession({ deps: { spawn: () => child } });
      s.start();
      s.stop();
      expect(child.kill).toHaveBeenCalledTimes(1);
    });
  });
});

describe("AgentChatSession close-time buffer flush", () => {
  it("emits a final stdout line that arrived without a trailing newline", () => {
    const child = fakeChild();
    const events = [];
    const stderrLines = [];
    const s = new AgentChatSession({
      deps: { spawn: () => child },
      onEvent: (e) => events.push(e),
      onStderr: (l) => stderrLines.push(l),
    });
    s.start();
    child.stdout.write('{"type":"result","ok":true}'); // NO trailing \n
    child.stderr.write("fatal: something broke"); // NO trailing \n
    child.emit("close", 1, null);
    expect(events).toContainEqual({ type: "result", ok: true });
    expect(stderrLines).toContain("fatal: something broke");
  });

  it("flushes non-JSON tails as raw events", () => {
    const child = fakeChild();
    const events = [];
    const s = new AgentChatSession({
      deps: { spawn: () => child },
      onEvent: (e) => events.push(e),
    });
    s.start();
    child.stdout.write("Error: cc exploded");
    child.emit("close", 1, null);
    expect(events).toContainEqual({ type: "raw", text: "Error: cc exploded" });
  });
});

describe("AgentChatSession stdin error safety", () => {
  it("an async stdin 'error' (EPIPE) is handled, not thrown uncaught", () => {
    const child = fakeChild();
    const s = new AgentChatSession({ deps: { spawn: () => child } });
    s.start();
    // Without a stdin 'error' listener, EventEmitter re-throws on emit('error')
    // — which in the real host is an uncaught exception that kills it.
    expect(() =>
      child.stdin.emit(
        "error",
        Object.assign(new Error("write EPIPE"), { code: "EPIPE" }),
      ),
    ).not.toThrow();
  });
});

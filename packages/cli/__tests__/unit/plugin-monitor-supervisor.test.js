import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PluginMonitorSupervisor } from "../../src/lib/plugin-monitor-supervisor.js";

/** A fake child process: EventEmitter with pipe-like stdout/stderr + kill(). */
function makeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = vi.fn(() => {
    child.killed = true;
    return true;
  });
  return child;
}

/** A spawn stub that records calls and hands back controllable children. */
function makeSpawn() {
  const children = [];
  const calls = [];
  const fn = (command, args, opts) => {
    calls.push({ command, args, opts });
    const c = makeChild();
    children.push(c);
    return c;
  };
  fn.children = children;
  fn.calls = calls;
  return fn;
}

const mon = (over = {}) => ({
  id: over.id || "p:m",
  plugin: "p",
  name: "m",
  command: "echo",
  args: ["hi"],
  mode: "interval",
  intervalMs: null,
  env: null,
  cwd: "/tmp",
  ...over,
});

let sup;
afterEach(() => {
  if (sup) sup.stopAll();
  sup = null;
});

describe("PluginMonitorSupervisor — interval mode", () => {
  it("runs the command immediately and captures stdout as records", () => {
    const spawn = makeSpawn();
    sup = new PluginMonitorSupervisor({ spawn });
    sup.start([mon()]);
    expect(spawn.calls).toHaveLength(1);
    expect(spawn.calls[0].command).toBe("echo");
    expect(spawn.calls[0].opts.shell).toBe(false); // no shell injection surface
    spawn.children[0].stdout.emit("data", Buffer.from("line1\nline2\n"));
    spawn.children[0].emit("exit", 0);
    const out = sup.drainOutputs();
    expect(out.map((o) => o.line)).toEqual(["line1", "line2"]);
    expect(out[0]).toMatchObject({ id: "p:m", plugin: "p", stream: "stdout" });
    expect(sup.drainOutputs()).toEqual([]); // drained
  });

  it("re-runs on the interval tick (fake timers)", () => {
    vi.useFakeTimers();
    try {
      const spawn = makeSpawn();
      sup = new PluginMonitorSupervisor({ spawn, defaultIntervalMs: 1000 });
      sup.start([mon()]);
      expect(spawn.calls).toHaveLength(1); // immediate run
      spawn.children[0].emit("exit", 0); // finish it
      vi.advanceTimersByTime(1000);
      expect(spawn.calls).toHaveLength(2); // ticked
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips a tick while the previous run is still in flight (no pile-up)", () => {
    vi.useFakeTimers();
    try {
      const spawn = makeSpawn();
      sup = new PluginMonitorSupervisor({ spawn, defaultIntervalMs: 1000 });
      sup.start([mon()]);
      expect(spawn.calls).toHaveLength(1); // running, not yet exited
      vi.advanceTimersByTime(3000); // 3 ticks, but run still in flight
      expect(spawn.calls).toHaveLength(1); // no new spawns
      spawn.children[0].emit("exit", 0);
      vi.advanceTimersByTime(1000);
      expect(spawn.calls).toHaveLength(2); // resumes after it finished
    } finally {
      vi.useRealTimers();
    }
  });

  it("kills a run that exceeds timeoutMs", () => {
    vi.useFakeTimers();
    try {
      const spawn = makeSpawn();
      sup = new PluginMonitorSupervisor({ spawn, timeoutMs: 500 });
      sup.start([mon()]);
      const child = spawn.children[0];
      vi.advanceTimersByTime(500);
      expect(child.kill).toHaveBeenCalledWith("SIGTERM");
      const out = sup.drainOutputs();
      expect(out.some((o) => /timed out/.test(o.line))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("caps simultaneous interval runs at maxConcurrent", () => {
    const spawn = makeSpawn();
    sup = new PluginMonitorSupervisor({ spawn, maxConcurrent: 2 });
    // Three monitors all try to run immediately on start.
    sup.start([
      mon({ id: "p:a", name: "a" }),
      mon({ id: "p:b", name: "b" }),
      mon({ id: "p:c", name: "c" }),
    ]);
    expect(spawn.calls).toHaveLength(2); // third gated by the cap
  });
});

describe("PluginMonitorSupervisor — longRunning mode", () => {
  it("spawns once and keeps capturing until stopAll kills it", () => {
    const spawn = makeSpawn();
    sup = new PluginMonitorSupervisor({ spawn });
    sup.start([mon({ mode: "longRunning" })]);
    expect(spawn.calls).toHaveLength(1);
    const child = spawn.children[0];
    child.stdout.emit("data", Buffer.from("tail-line\n"));
    child.stderr.emit("data", Buffer.from("warn\n"));
    const out = sup.peekOutputs();
    expect(out.map((o) => o.stream)).toEqual(["stdout", "stderr"]);
    sup.stopAll();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM"); // reaped
  });
});

describe("PluginMonitorSupervisor — lifecycle", () => {
  it("dedupes a double-start of the same monitor id", () => {
    const spawn = makeSpawn();
    sup = new PluginMonitorSupervisor({ spawn, defaultIntervalMs: 999999 });
    sup.start([mon({ mode: "longRunning" })]);
    const started = sup.start([mon({ mode: "longRunning" })]);
    expect(started).toEqual([]); // already running
    expect(spawn.calls).toHaveLength(1);
  });

  it("stopAll reaps every child + timer and makes start a no-op", () => {
    const spawn = makeSpawn();
    sup = new PluginMonitorSupervisor({ spawn });
    sup.start([
      mon({ id: "p:a", name: "a", mode: "longRunning" }),
      mon({ id: "p:b", name: "b", mode: "longRunning" }),
    ]);
    expect(sup.size).toBe(2);
    sup.stopAll();
    expect(spawn.children.every((c) => c.kill.mock.calls.length > 0)).toBe(
      true,
    );
    expect(sup.size).toBe(0);
    expect(sup.start([mon()])).toEqual([]); // no-op after stop
  });

  it("survives a spawn that throws (records the failure, keeps going)", () => {
    const spawn = () => {
      throw new Error("ENOENT");
    };
    sup = new PluginMonitorSupervisor({ spawn });
    expect(() => sup.start([mon()])).not.toThrow();
    const out = sup.drainOutputs();
    expect(out.some((o) => /spawn failed/.test(o.line))).toBe(true);
  });
});

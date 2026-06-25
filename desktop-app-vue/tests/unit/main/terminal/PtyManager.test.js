import { describe, it, expect, beforeEach } from "vitest";
import pkg from "../../../../src/main/terminal/PtyManager.js";
const { PtyManager } = pkg;

// Mock node-pty: each `spawn` returns a fake ptyProcess with stubs that we
// can drive from the test (e.g. trigger onData to simulate stdout).
function makeFakePty() {
  const handlers = { data: null, exit: null };
  const proc = {
    pid: 12345,
    writes: [],
    resizes: [],
    killed: false,
    write(s) {
      this.writes.push(s);
    },
    resize(c, r) {
      this.resizes.push({ cols: c, rows: r });
    },
    kill() {
      this.killed = true;
      // Match real node-pty: kill is async — simulate by exposing
      // a manual trigger via fakePty.triggerExit() below.
    },
    onData(cb) {
      handlers.data = cb;
    },
    onExit(cb) {
      handlers.exit = cb;
    },
  };
  return {
    proc,
    triggerData(data) {
      handlers.data?.(data);
    },
    triggerExit({ exitCode = 0, signal = null } = {}) {
      handlers.exit?.({ exitCode, signal });
    },
  };
}

function makeMgr({ failNative = false, config = {}, now } = {}) {
  let fake;
  const loadNodePty = () => {
    if (failNative) {
      const err = new Error("Cannot find module 'node-pty'");
      throw err;
    }
    return {
      spawn() {
        fake = makeFakePty();
        return fake.proc;
      },
    };
  };
  const mgr = new PtyManager({
    config,
    _deps: { loadNodePty, now },
  });
  return { mgr, getFake: () => fake };
}

describe("PtyManager", () => {
  let mgr;
  let getFake;
  beforeEach(() => {
    ({ mgr, getFake } = makeMgr());
  });

  it("create spawns a pty and returns sessionId+pid", () => {
    const res = mgr.create({ shell: "pwsh", cols: 80, rows: 24 });
    expect(res.sessionId).toBeTruthy();
    expect(res.pid).toBe(12345);
    expect(res.shell).toBe("pwsh");
    expect(typeof res.createdAt).toBe("number");
  });

  it("create rejects non-whitelisted shell", () => {
    expect(() => mgr.create({ shell: "evil-shell" })).toThrow(
      "shell_not_allowed",
    );
  });

  it("create returns pty_native_unavailable when node-pty missing", () => {
    const { mgr: failMgr } = makeMgr({ failNative: true });
    expect(() => failMgr.create({ shell: "pwsh" })).toThrow(
      "pty_native_unavailable",
    );
  });

  it("create enforces maxConcurrentSessions", () => {
    const { mgr: limited } = makeMgr({ config: { maxConcurrentSessions: 2 } });
    limited.create({ shell: "pwsh" });
    limited.create({ shell: "pwsh" });
    expect(() => limited.create({ shell: "pwsh" })).toThrow(
      "max_concurrent_sessions_exceeded",
    );
  });

  it("stdout event fires with sessionId+data+seq when pty emits data", () => {
    const events = [];
    mgr.on("stdout", (e) => events.push(e));
    const { sessionId } = mgr.create({ shell: "pwsh" });
    getFake().triggerData("hello");
    expect(events).toHaveLength(1);
    expect(events[0].sessionId).toBe(sessionId);
    expect(events[0].data.toString()).toBe("hello");
    expect(events[0].seq).toBe(1);
  });

  it("write forwards string to ptyProcess.write", () => {
    const { sessionId } = mgr.create({ shell: "pwsh" });
    mgr.write(sessionId, "ls\r");
    expect(getFake().proc.writes).toEqual(["ls\r"]);
  });

  it("write converts Buffer to utf-8 string", () => {
    const { sessionId } = mgr.create({ shell: "pwsh" });
    mgr.write(sessionId, Buffer.from("dir\r", "utf-8"));
    expect(getFake().proc.writes).toEqual(["dir\r"]);
  });

  it("write throws session_not_found for unknown id", () => {
    expect(() => mgr.write("nope", "x")).toThrow("session_not_found");
  });

  it("resize updates pty + session dims", () => {
    const { sessionId } = mgr.create({ shell: "pwsh", cols: 80, rows: 24 });
    mgr.resize(sessionId, 120, 40);
    expect(getFake().proc.resizes).toEqual([{ cols: 120, rows: 40 }]);
  });

  it("resize rejects non-finite dims", () => {
    const { sessionId } = mgr.create({ shell: "pwsh" });
    expect(() => mgr.resize(sessionId, NaN, 24)).toThrow("invalid_dimensions");
  });

  it("close kills pty and exit event fires", () => {
    const events = [];
    mgr.on("exit", (e) => events.push(e));
    const { sessionId } = mgr.create({ shell: "pwsh" });
    mgr.close(sessionId);
    expect(getFake().proc.killed).toBe(true);
    // simulate node-pty firing exit
    getFake().triggerExit({ exitCode: 0 });
    expect(events).toHaveLength(1);
    expect(events[0].sessionId).toBe(sessionId);
    expect(events[0].exitCode).toBe(0);
  });

  it("list returns alive + dead sessions with lastSeq", () => {
    const a = mgr.create({ shell: "pwsh" });
    getFake().triggerData("foo");
    getFake().triggerData("bar");
    const items = mgr.list();
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(a.sessionId);
    expect(items[0].alive).toBe(true);
    expect(items[0].lastSeq).toBe(2);
  });

  it("history returns chunks since fromSeq", () => {
    const { sessionId } = mgr.create({ shell: "pwsh" });
    getFake().triggerData("a");
    getFake().triggerData("b");
    getFake().triggerData("c");
    const { chunks, truncated } = mgr.history(sessionId, 2);
    expect(chunks.map((c) => c.seq)).toEqual([2, 3]);
    expect(truncated).toBe(false);
  });

  it("shutdown kills all alive sessions and blocks further create", () => {
    const a = mgr.create({ shell: "pwsh" });
    expect(mgr._sessionCount).toBe(1);
    mgr.shutdown();
    expect(getFake().proc.killed).toBe(true);
    expect(() => mgr.create({ shell: "pwsh" })).toThrow("pty_manager_stopped");
  });

  it("idle sweep kills sessions exceeding idleKillMs", () => {
    let nowVal = 1000;
    const { mgr: idleMgr, getFake: getFakeIdle } = makeMgr({
      config: { idleKillMs: 5000 },
      now: () => nowVal,
    });
    idleMgr.create({ shell: "pwsh" });
    nowVal = 1000 + 6000; // 6s elapsed, beyond 5s idle cap
    idleMgr._sweepIdle();
    expect(getFakeIdle().proc.killed).toBe(true);
  });
});

// Multi-session harness: collects every spawned fake so a specific session's
// exit can be driven (the shared makeMgr only exposes the last spawn).
function makeMultiMgr(config = {}) {
  const fakes = [];
  const loadNodePty = () => ({
    spawn(cmd, args, opts) {
      const f = makeFakePty();
      f.proc.spawnOpts = opts;
      fakes.push(f);
      return f.proc;
    },
  });
  const mgr = new PtyManager({ config, _deps: { loadNodePty } });
  return { mgr, fakes };
}

describe("PtyManager — concurrency cap counts only live sessions", () => {
  it("a closed (dead, not-yet-reaped) session frees a slot", () => {
    const { mgr, fakes } = makeMultiMgr({ maxConcurrentSessions: 2 });
    const a = mgr.create({ shell: "pwsh" });
    mgr.create({ shell: "pwsh" });
    expect(() => mgr.create({ shell: "pwsh" })).toThrow(/max_concurrent/);

    mgr.close(a.sessionId);
    fakes[0].triggerExit({ exitCode: 0 }); // a now dead, still lingers in map
    expect(mgr._sessionCount).toBe(2); // dead entry not yet reaped
    expect(() => mgr.create({ shell: "pwsh" })).not.toThrow(); // slot freed
  });
});

describe("PtyManager — env handling (remote frame input)", () => {
  it("ignores a non-object env, merges a valid object env", () => {
    const { mgr, fakes } = makeMultiMgr({});
    mgr.create({ shell: "pwsh", env: "ATTACK" });
    expect(fakes[0].proc.spawnOpts.env["0"]).toBeUndefined();
    mgr.create({ shell: "pwsh", env: { MY_VAR: "x" } });
    expect(fakes[1].proc.spawnOpts.env.MY_VAR).toBe("x");
  });
});

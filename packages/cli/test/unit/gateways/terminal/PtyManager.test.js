/**
 * cli-side PtyManager unit tests — ESM mirror of
 * `desktop-app-vue/tests/unit/main/terminal/PtyManager.test.js`. Keep both
 * in sync; the desktop+cli copies should behave identically.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { PtyManager } from "../../../../src/gateways/terminal/PtyManager.js";

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
    triggerData(d) {
      handlers.data?.(d);
    },
    triggerExit({ exitCode = 0, signal = null } = {}) {
      handlers.exit?.({ exitCode, signal });
    },
  };
}

function makeMgr({ failNative = false, config = {}, now } = {}) {
  let fake;
  const loadNodePty = () => {
    if (failNative) throw new Error("Cannot find module 'node-pty'");
    return {
      spawn() {
        fake = makeFakePty();
        return fake.proc;
      },
    };
  };
  const mgr = new PtyManager({ config, _deps: { loadNodePty, now } });
  return { mgr, getFake: () => fake };
}

describe("cli/PtyManager", () => {
  let mgr, getFake;
  beforeEach(() => {
    ({ mgr, getFake } = makeMgr());
  });

  it("create returns sessionId + pid", () => {
    const r = mgr.create({ shell: "pwsh" });
    expect(r.sessionId).toBeTruthy();
    expect(r.pid).toBe(12345);
  });

  it("create rejects unknown shell", () => {
    expect(() => mgr.create({ shell: "evil" })).toThrow("shell_not_allowed");
  });

  it("create returns pty_native_unavailable when node-pty missing", () => {
    const { mgr: failMgr } = makeMgr({ failNative: true });
    expect(() => failMgr.create({ shell: "pwsh" })).toThrow(
      "pty_native_unavailable",
    );
  });

  it("write forwards string", () => {
    const { sessionId } = mgr.create({ shell: "pwsh" });
    mgr.write(sessionId, "ls\r");
    expect(getFake().proc.writes).toEqual(["ls\r"]);
  });

  it("stdout event fires with seq", () => {
    const events = [];
    mgr.on("stdout", (e) => events.push(e));
    mgr.create({ shell: "pwsh" });
    getFake().triggerData("hello");
    expect(events).toHaveLength(1);
    expect(events[0].seq).toBe(1);
  });

  it("close kills pty and exit event fires", () => {
    const events = [];
    mgr.on("exit", (e) => events.push(e));
    const { sessionId } = mgr.create({ shell: "pwsh" });
    mgr.close(sessionId);
    expect(getFake().proc.killed).toBe(true);
    getFake().triggerExit({ exitCode: 0 });
    expect(events).toHaveLength(1);
    expect(events[0].exitCode).toBe(0);
  });

  it("list returns lastSeq from ring buffer", () => {
    const { sessionId } = mgr.create({ shell: "pwsh" });
    getFake().triggerData("a");
    getFake().triggerData("b");
    const items = mgr.list();
    expect(items[0].id).toBe(sessionId);
    expect(items[0].lastSeq).toBe(2);
  });

  it("history returns chunks since fromSeq", () => {
    const { sessionId } = mgr.create({ shell: "pwsh" });
    getFake().triggerData("a");
    getFake().triggerData("b");
    getFake().triggerData("c");
    const { chunks } = mgr.history(sessionId, 2);
    expect(chunks.map((c) => c.seq)).toEqual([2, 3]);
  });

  it("shutdown kills all sessions and blocks further create", () => {
    mgr.create({ shell: "pwsh" });
    mgr.shutdown();
    expect(getFake().proc.killed).toBe(true);
    expect(() => mgr.create({ shell: "pwsh" })).toThrow("pty_manager_stopped");
  });

  it("idle sweep kills sessions past idleKillMs", () => {
    let nowVal = 1000;
    const { mgr: idleMgr, getFake: getIdle } = makeMgr({
      config: { idleKillMs: 5000 },
      now: () => nowVal,
    });
    idleMgr.create({ shell: "pwsh" });
    nowVal = 1000 + 6000;
    idleMgr._sweepIdle();
    expect(getIdle().proc.killed).toBe(true);
  });
});

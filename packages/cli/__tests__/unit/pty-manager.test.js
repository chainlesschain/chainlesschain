/**
 * PtyManager — remote-terminal session manager (cc ui Plan A).
 *
 * node-pty is loaded via the injectable `_deps.loadNodePty` seam, so these run
 * with a fake pty (no native binding, no real shell). Focus: the concurrency
 * cap counts only LIVE sessions (a just-exited session lingers ~60s before the
 * reaper removes it, and must not block new sessions), plus the shell whitelist
 * and stopped-manager guards.
 */
import { describe, it, expect } from "vitest";
import { PtyManager } from "../../src/gateways/terminal/PtyManager.js";

function makeFakeDeps() {
  const procs = [];
  const loadNodePty = () => ({
    spawn: (cmd, args, opts) => {
      let exitCb = null;
      const proc = {
        pid: 1000 + procs.length,
        spawnOpts: opts,
        onData() {},
        onExit(cb) {
          exitCb = cb;
        },
        write() {},
        resize() {},
        kill() {
          if (exitCb) exitCb({ exitCode: 0, signal: null });
        },
      };
      procs.push(proc);
      return proc;
    },
  });
  return { loadNodePty, procs };
}

describe("PtyManager concurrency cap", () => {
  it("rejects a new session once the LIVE cap is reached", () => {
    const { loadNodePty } = makeFakeDeps();
    const mgr = new PtyManager({
      config: { maxConcurrentSessions: 2 },
      _deps: { loadNodePty },
    });
    mgr.create({ shell: "bash" });
    mgr.create({ shell: "bash" });
    expect(() => mgr.create({ shell: "bash" })).toThrow(
      /max_concurrent_sessions_exceeded/,
    );
  });

  it("counts only LIVE sessions — a closed (dead, not-yet-reaped) session frees a slot", () => {
    const { loadNodePty } = makeFakeDeps();
    const mgr = new PtyManager({
      config: { maxConcurrentSessions: 2 },
      _deps: { loadNodePty },
    });
    const a = mgr.create({ shell: "bash" });
    mgr.create({ shell: "bash" });
    // At cap.
    expect(() => mgr.create({ shell: "bash" })).toThrow(/max_concurrent/);

    // Close one: onExit marks it dead but it lingers in _sessions until the
    // 60s reaper runs — that dead entry must NOT count against the cap.
    mgr.close(a.sessionId);
    expect(mgr._sessionCount).toBe(2); // still present (dead, pending reap)
    expect(() => mgr.create({ shell: "bash" })).not.toThrow(); // slot freed
  });

  it("rejects a shell not on the whitelist", () => {
    const { loadNodePty } = makeFakeDeps();
    const mgr = new PtyManager({ _deps: { loadNodePty } });
    expect(() => mgr.create({ shell: "nc" })).toThrow(/shell_not_allowed/);
  });

  it("rejects create() after shutdown and kills live sessions", () => {
    const { loadNodePty, procs } = makeFakeDeps();
    const mgr = new PtyManager({ _deps: { loadNodePty } });
    mgr.create({ shell: "bash" });
    mgr.shutdown();
    expect(procs).toHaveLength(1);
    expect(() => mgr.create({ shell: "bash" })).toThrow(/pty_manager_stopped/);
  });
});

describe("PtyManager env handling (remote frame input)", () => {
  it("ignores a non-object env (no garbage numeric keys spread into the shell)", () => {
    const { loadNodePty, procs } = makeFakeDeps();
    const mgr = new PtyManager({ _deps: { loadNodePty } });
    mgr.create({ shell: "bash", env: "ATTACK" });
    const env = procs[0].spawnOpts.env;
    expect(env["0"]).toBeUndefined(); // "ATTACK"[0] was not spread
    expect(Object.keys(env).length).toBeGreaterThan(1); // process.env preserved
  });

  it("merges a valid plain-object env", () => {
    const { loadNodePty, procs } = makeFakeDeps();
    const mgr = new PtyManager({ _deps: { loadNodePty } });
    mgr.create({ shell: "bash", env: { MY_VAR: "x" } });
    expect(procs[0].spawnOpts.env.MY_VAR).toBe("x");
  });
});

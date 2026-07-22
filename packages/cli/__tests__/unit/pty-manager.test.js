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
import { executionBroker } from "../../src/lib/process-execution-broker/index.js";

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

  it("routes native PTY creation through the execution broker seam", () => {
    const { loadNodePty, procs } = makeFakeDeps();
    const calls = [];
    const mgr = new PtyManager({
      _deps: {
        loadNodePty,
        spawnPty: (module, command, args, options) => {
          calls.push({ module, command, args, options });
          return module.spawn(command, args, options);
        },
      },
    });
    mgr.create({ shell: "bash" });
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toMatch(/bash/);
    expect(calls[0].options).toMatchObject({
      origin: "terminal:pty",
      policy: "allow",
      scope: "terminal",
    });
    expect(procs).toHaveLength(1);
  });
});

describe("PtyManager process broker seam", () => {
  it("routes PTY allocation through the injected broker boundary", () => {
    const { loadNodePty, procs } = makeFakeDeps();
    const calls = [];
    const mgr = new PtyManager({
      _deps: {
        loadNodePty,
        spawnPty(pty, command, args, options) {
          calls.push({ pty, command, args, options });
          return pty.spawn(command, args, options);
        },
      },
    });

    mgr.create({ shell: "bash", env: { API_TOKEN: "secret" } });

    expect(calls).toHaveLength(1);
    expect(calls[0].command).toMatch(/bash(?:\.exe)?$/);
    expect(calls[0].args).toEqual([]);
    expect(procs[0].spawnOpts.env.API_TOKEN).toBe("secret");
  });

  it("filters PTY credentials and records native boundary provenance", () => {
    let received;
    const pty = {
      spawn(command, args, options) {
        received = { command, args, options };
        return { pid: 4242 };
      },
    };
    const proc = executionBroker.spawnPty(pty, "bash", [], {
      origin: "terminal:pty",
      policy: "allow",
      env: { API_TOKEN: "secret", PATH: "safe" },
    });

    expect(proc.pid).toBe(4242);
    expect(received.options.env.API_TOKEN).toBeUndefined();
    expect(received.options.env.CC_CRED_REF_API_TOKEN).toMatch(/^cc-cred-/);
    expect(
      executionBroker
        .getAuditLog(10)
        .find((entry) => entry.executionId && entry.operation === "pty.spawn"),
    ).toMatchObject({
      origin: "terminal:pty",
      operation: "pty.spawn",
      pty: true,
      credentialFiltered: true,
      sandboxed: false,
    });
  });
});

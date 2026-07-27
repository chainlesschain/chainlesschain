/**
 * PtyManager — remote-terminal session manager (cc ui Plan A).
 *
 * node-pty is loaded via the injectable `_deps.loadNodePty` seam, so these run
 * with a fake pty (no native binding, no real shell). Focus: the concurrency
 * cap counts only LIVE sessions (a just-exited session lingers ~60s before the
 * reaper removes it, and must not block new sessions), plus the shell whitelist
 * and stopped-manager guards.
 */
import { describe, it, expect, vi } from "vitest";
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
    expect(calls[0].options).not.toHaveProperty("sandboxPolicy");
    expect(procs).toHaveLength(1);
  });
});

describe("PtyManager plugin sandbox policy", () => {
  it("passes the exact pinned policy from the fixed workspace resolver", () => {
    const { loadNodePty } = makeFakeDeps();
    const calls = [];
    const policy = Object.freeze({
      requiredBoundaries: Object.freeze(["filesystem", "network"]),
    });
    const resolveSandboxPolicy = vi.fn(() => policy);
    const mgr = new PtyManager({
      policyCwd: "trusted-workspace",
      resolveSandboxPolicy,
      _deps: {
        loadNodePty,
        spawnPty(pty, command, args, options) {
          calls.push({ pty, command, args, options });
          return pty.spawn(command, args, options);
        },
      },
    });

    mgr.create({ shell: "bash", cwd: "requested-worktree" });

    expect(resolveSandboxPolicy).toHaveBeenCalledWith({
      workspaceCwd: "trusted-workspace",
      executionCwd: "requested-worktree",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].options.sandboxPolicy).toBe(policy);
  });

  it("fails closed through the real Broker before native PTY allocation", () => {
    executionBroker.flushAuditLog();
    const pty = { spawn: vi.fn() };
    const loadNodePty = vi.fn(() => pty);
    const policy = Object.freeze({
      requiredBoundaries: Object.freeze(["filesystem"]),
    });
    const mgr = new PtyManager({
      policyCwd: "trusted-workspace",
      resolveSandboxPolicy: () => policy,
      _deps: { loadNodePty },
    });

    let error;
    try {
      mgr.create({ shell: "bash", cwd: "requested-worktree" });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      code: "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED",
      sandboxReason: "required_boundaries_unsatisfied",
      requiredBoundaries: ["filesystem"],
      missingBoundaries: ["filesystem"],
    });
    expect(loadNodePty).toHaveBeenCalledOnce();
    expect(pty.spawn).not.toHaveBeenCalled();
    expect(
      executionBroker
        .getAuditLog(10)
        .findLast((entry) => entry.origin === "terminal:pty"),
    ).toMatchObject({
      operation: "pty.spawn",
      sandboxRequired: ["filesystem"],
      sandboxGuarantees: [],
      sandboxBackend: null,
      sandboxState: "denied",
    });
  });

  it("propagates discovery failure before loading node-pty", () => {
    const discoveryError = Object.assign(
      new Error("plugin bin policy discovery failed"),
      {
        code: "ERR_PLUGIN_BIN_DISCOVERY_FAILED",
        pluginBinFailClosed: true,
      },
    );
    const loadNodePty = vi.fn();
    const mgr = new PtyManager({
      resolveSandboxPolicy: () => {
        throw discoveryError;
      },
      _deps: { loadNodePty },
    });

    let error;
    try {
      mgr.create({ shell: "bash" });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBe(discoveryError);
    expect(loadNodePty).not.toHaveBeenCalled();
  });

  it.each([
    ["an async resolver", () => Promise.resolve(null)],
    ["an unfrozen policy", () => ({ requiredBoundaries: ["filesystem"] })],
    [
      "an empty policy",
      () =>
        Object.freeze({
          requiredBoundaries: Object.freeze([]),
        }),
    ],
  ])("rejects %s before loading node-pty", (_label, resolver) => {
    const loadNodePty = vi.fn();
    const mgr = new PtyManager({
      resolveSandboxPolicy: resolver,
      _deps: { loadNodePty },
    });

    let error;
    try {
      mgr.create({ shell: "bash" });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      code: "ERR_PTY_SANDBOX_POLICY_INVALID",
    });
    expect(loadNodePty).not.toHaveBeenCalled();
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
    const secret = ["pty", "credential", "value"].join("-");
    const proc = executionBroker.spawnPty(pty, "bash", [`--token=${secret}`], {
      origin: "terminal:pty",
      policy: "allow",
      env: { API_TOKEN: secret, PATH: "safe" },
    });

    expect(proc.pid).toBe(4242);
    expect(received.args).toEqual(["--token=***REDACTED***"]);
    expect(received.options.env.API_TOKEN).toBeUndefined();
    expect(received.options.env.CC_CRED_REF_API_TOKEN).toMatch(/^cc-cred-/);
    const audit = executionBroker
      .getAuditLog(10)
      .findLast(
        (entry) => entry.executionId && entry.operation === "pty.spawn",
      );
    expect(audit).toMatchObject({
      origin: "terminal:pty",
      operation: "pty.spawn",
      pty: true,
      credentialFiltered: true,
      credentialEnvCount: 1,
      credentialArgCount: 1,
      sandboxed: false,
    });
    expect(JSON.stringify(audit)).not.toContain(secret);
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect, beforeEach, vi } from "vitest";
import pkg from "../../../../src/main/terminal/PtyManager.js";
import brokerPkg from "../../../../src/main/process/desktop-process-broker.js";
const { PtyManager } = pkg;
const { installDesktopProcessBroker } = brokerPkg;

const tempRoots = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    fs.rmSync(tempRoots.pop(), { recursive: true, force: true });
  }
});

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
  it("ignores caller environment claims", () => {
    const { mgr, fakes } = makeMultiMgr({});
    mgr.create({ shell: "pwsh", env: "ATTACK" });
    expect(fakes[0].proc.spawnOpts.env["0"]).toBeUndefined();
    mgr.create({ shell: "pwsh", env: { MY_VAR: "x" } });
    expect(fakes[1].proc.spawnOpts.env.MY_VAR).toBeUndefined();
  });
});

describe("PtyManager Plugin-bin sandbox policy", () => {
  it("uses the fixed host root and passes the exact pinned policy to the broker", () => {
    const policy = Object.freeze({
      requiredBoundaries: Object.freeze(["filesystem"]),
    });
    const resolveSandboxPolicy = vi.fn(() => policy);
    const brokerCalls = [];
    const fake = makeFakePty();
    const pty = {
      spawn: vi.fn(() => fake.proc),
    };
    const broker = {
      spawnPty(ptyModule, command, args, options) {
        brokerCalls.push({ ptyModule, command, args, options });
        return fake.proc;
      },
    };
    const mgr = new PtyManager({
      policyCwd: "trusted-workspace",
      resolveSandboxPolicy,
      _deps: {
        loadNodePty: () => pty,
        getProcessBroker: () => broker,
        platform: () => "win32",
      },
    });

    mgr.create({ shell: "pwsh", cwd: "caller-worktree" });

    expect(resolveSandboxPolicy).toHaveBeenCalledWith({
      workspaceCwd: path.resolve("trusted-workspace"),
      executionCwd: "caller-worktree",
    });
    expect(brokerCalls).toHaveLength(1);
    expect(brokerCalls[0].options).toMatchObject({
      origin: "terminal:pty",
      policy: "allow",
      scope: "terminal",
    });
    expect(brokerCalls[0].options.sandboxPolicy).toBe(policy);
    expect(pty.spawn).not.toHaveBeenCalled();
  });

  it("rejects a strict policy without the Desktop broker before loading node-pty", () => {
    const policy = Object.freeze({
      requiredBoundaries: Object.freeze(["network"]),
    });
    const loadNodePty = vi.fn();
    const mgr = new PtyManager({
      resolveSandboxPolicy: () => policy,
      _deps: {
        loadNodePty,
        getProcessBroker: () => null,
        platform: () => "win32",
        // A custom seam must not become a strict-policy direct fallback.
        spawnPty: vi.fn(),
      },
    });

    let error;
    try {
      mgr.create({ shell: "pwsh" });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      code: "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED",
      sandboxReason: "desktop_process_broker_unavailable",
      sandboxFailClosed: true,
      requiredBoundaries: ["network"],
      actualGuarantees: [],
      missingBoundaries: ["network"],
      sandboxBackend: null,
    });
    expect(loadNodePty).not.toHaveBeenCalled();
  });

  it("fails closed through the real Desktop broker without native PTY allocation", () => {
    const childProcess = Object.fromEntries(
      [
        "spawn",
        "spawnSync",
        "exec",
        "execSync",
        "execFile",
        "execFileSync",
        "fork",
      ].map((name) => [name, vi.fn()]),
    );
    const audit = [];
    const broker = installDesktopProcessBroker({
      childProcess,
      auditSink: (entry) => audit.push(entry),
    });
    const pty = { spawn: vi.fn() };
    const loadNodePty = vi.fn(() => pty);
    const policy = Object.freeze({
      requiredBoundaries: Object.freeze(["filesystem"]),
    });
    const mgr = new PtyManager({
      resolveSandboxPolicy: () => policy,
      _deps: {
        loadNodePty,
        getProcessBroker: () => broker,
        platform: () => "win32",
      },
    });

    let error;
    try {
      mgr.create({ shell: "pwsh" });
    } catch (caught) {
      error = caught;
    } finally {
      broker.uninstall();
    }

    expect(error).toMatchObject({
      code: "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED",
      sandboxReason: "required_boundaries_unsatisfied",
      requiredBoundaries: ["filesystem"],
      missingBoundaries: ["filesystem"],
    });
    expect(loadNodePty).toHaveBeenCalledOnce();
    expect(pty.spawn).not.toHaveBeenCalled();
    expect(audit[0]).toMatchObject({
      operation: "pty.spawn",
      origin: "terminal:pty",
      sandboxRequired: ["filesystem"],
      sandboxGuarantees: [],
      sandboxBackend: null,
      sandboxState: "denied",
    });
  });

  it("propagates policy discovery failure before loading node-pty", () => {
    const policyError = Object.assign(new Error("policy discovery failed"), {
      code: "ERR_TEST_POLICY_DISCOVERY",
    });
    const loadNodePty = vi.fn();
    const mgr = new PtyManager({
      resolveSandboxPolicy() {
        throw policyError;
      },
      _deps: { loadNodePty },
    });

    expect(() => mgr.create({ shell: "pwsh" })).toThrow(policyError);
    expect(loadNodePty).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "an async resolver result",
      policy: Promise.resolve(null),
    },
    {
      name: "an unfrozen policy",
      policy: { requiredBoundaries: ["filesystem"] },
    },
    {
      name: "an unfrozen boundary list",
      policy: Object.freeze({ requiredBoundaries: ["filesystem"] }),
    },
    {
      name: "an empty pinned policy",
      policy: Object.freeze({ requiredBoundaries: Object.freeze([]) }),
    },
    {
      name: "an unsupported policy field",
      policy: Object.freeze({
        requiredBoundaries: Object.freeze(["filesystem"]),
        profile: "allow-all",
      }),
    },
    {
      name: "an unsupported boundary",
      policy: Object.freeze({
        requiredBoundaries: Object.freeze(["process"]),
      }),
    },
  ])("rejects $name before loading node-pty", ({ policy }) => {
    const loadNodePty = vi.fn();
    const mgr = new PtyManager({
      resolveSandboxPolicy: () => policy,
      _deps: { loadNodePty },
    });

    let error;
    try {
      mgr.create({ shell: "pwsh" });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      code: "ERR_PTY_SANDBOX_POLICY_INVALID",
      sandboxReason: "invalid_sandbox_policy",
      sandboxFailClosed: true,
    });
    expect(loadNodePty).not.toHaveBeenCalled();
  });
});

function makeBoundProjectManager({
  shell = "bash",
  projectOverrides = {},
  resolveSandboxPolicy = () => null,
  platform = () => process.platform,
  issueLinuxWorkspaceSandboxExecutionContract = null,
  spawnLinuxStrongPty = null,
} = {}) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pty-project-"));
  tempRoots.push(tmpRoot);
  const workspace = path.join(tmpRoot, "workspace");
  const subdir = path.join(workspace, "subdir");
  const strictDir = path.join(workspace, "strict");
  const outside = path.join(tmpRoot, "outside");
  for (const dir of [workspace, subdir, strictDir, outside]) {
    fs.mkdirSync(dir);
  }
  const fake = makeFakePty();
  const pty = { spawn: vi.fn(() => fake.proc) };
  const broker = {
    spawnPty: vi.fn(() => fake.proc),
  };
  const project = {
    id: "project-1",
    root_path: workspace,
    root_path_local_attested: 1,
    deleted: 0,
    ...projectOverrides,
  };
  const resolveProjectBinding = vi.fn(() => project);
  const policyResolver = vi.fn(resolveSandboxPolicy);
  const loadNodePty = vi.fn(() => pty);
  const mgr = new PtyManager({
    requireProjectBinding: true,
    resolveProjectBinding,
    resolveSandboxPolicy: policyResolver,
    config: {
      defaultShell: shell,
      shellWhitelist: ["bash", "pwsh", "cmd"],
    },
    _deps: {
      loadNodePty,
      getProcessBroker: () => broker,
      platform,
      issueLinuxWorkspaceSandboxExecutionContract,
      spawnLinuxStrongPty,
    },
  });
  return {
    mgr,
    fake,
    broker,
    project,
    resolveProjectBinding,
    resolveSandboxPolicy: policyResolver,
    loadNodePty,
    workspace,
    subdir,
    strictDir,
    outside,
  };
}

describe("PtyManager DB-authorized strong Linux PTY", () => {
  it("issues one launch from the canonical DB root and routes it to the strong broker", () => {
    const policy = Object.freeze({
      requiredBoundaries: Object.freeze(["filesystem", "network"]),
    });
    const contract = Object.freeze({
      contractVersion: 1,
      kind: "strict-workspace-command",
    });
    const issueContract = vi.fn(() => contract);
    const strongSpawn = vi.fn();
    const { mgr, fake, broker, loadNodePty, workspace, subdir, outside } =
      makeBoundProjectManager({
        resolveSandboxPolicy: () => policy,
        platform: () => "linux",
        issueLinuxWorkspaceSandboxExecutionContract: issueContract,
        spawnLinuxStrongPty: strongSpawn,
      });
    strongSpawn.mockReturnValue(fake.proc);

    const created = mgr.create({
      projectId: "project-1",
      shell: "bash",
      cwd: subdir,
      // These untrusted fields are deliberately ignored as authority.
      workspaceRoot: outside,
      policyCwd: outside,
    });

    const canonicalWorkspace = fs.realpathSync.native(workspace);
    const canonicalCwd = fs.realpathSync.native(subdir);
    expect(issueContract).toHaveBeenCalledOnce();
    expect(issueContract.mock.calls[0]).toEqual([
      "bash",
      ["-l"],
      expect.objectContaining({
        cwd: canonicalCwd,
        origin: "terminal:pty",
        scope: "terminal",
        policy: "allow",
        shell: false,
        sandboxPolicy: policy,
      }),
      canonicalWorkspace,
      { pty: true },
    ]);
    expect(issueContract.mock.calls[0][2]).not.toHaveProperty(
      "sandboxExecutionContract",
    );
    expect(strongSpawn).toHaveBeenCalledWith(
      expect.objectContaining({ spawn: expect.any(Function) }),
      "bash",
      ["-l"],
      expect.objectContaining({
        cwd: canonicalCwd,
        sandboxPolicy: policy,
        sandboxExecutionContract: contract,
      }),
    );
    expect(broker.spawnPty).not.toHaveBeenCalled();
    expect(loadNodePty).toHaveBeenCalledOnce();
    expect(issueContract.mock.invocationCallOrder[0]).toBeLessThan(
      loadNodePty.mock.invocationCallOrder[0],
    );
    expect(created).toMatchObject({
      projectId: "project-1",
      cwd: canonicalCwd,
      pid: fake.proc.pid,
    });
  });

  it("fails before loading node-pty when the strong Linux facade is unavailable", () => {
    const policy = Object.freeze({
      requiredBoundaries: Object.freeze(["filesystem"]),
    });
    const { mgr, broker, loadNodePty } = makeBoundProjectManager({
      resolveSandboxPolicy: () => policy,
      platform: () => "linux",
    });

    expect(() =>
      mgr.create({ projectId: "project-1", shell: "bash" }),
    ).toThrowError(
      expect.objectContaining({
        code: "ERR_DESKTOP_PTY_STRONG_BACKEND_UNAVAILABLE",
        sandboxReason: "desktop_strong_pty_backend_unavailable",
        sandboxFailClosed: true,
        requiredBoundaries: ["filesystem"],
        missingBoundaries: ["filesystem"],
      }),
    );
    expect(loadNodePty).not.toHaveBeenCalled();
    expect(broker.spawnPty).not.toHaveBeenCalled();
  });

  it("fails before loading node-pty when no one-shot contract is issued", () => {
    const policy = Object.freeze({
      requiredBoundaries: Object.freeze(["network"]),
    });
    const issueContract = vi.fn(() => null);
    const strongSpawn = vi.fn();
    const { mgr, loadNodePty } = makeBoundProjectManager({
      resolveSandboxPolicy: () => policy,
      platform: () => "linux",
      issueLinuxWorkspaceSandboxExecutionContract: issueContract,
      spawnLinuxStrongPty: strongSpawn,
    });

    expect(() =>
      mgr.create({ projectId: "project-1", shell: "bash" }),
    ).toThrowError(
      expect.objectContaining({
        code: "ERR_DESKTOP_PTY_STRONG_BACKEND_UNAVAILABLE",
        sandboxFailClosed: true,
      }),
    );
    expect(loadNodePty).not.toHaveBeenCalled();
    expect(strongSpawn).not.toHaveBeenCalled();
  });
});

describe("PtyManager DB-backed project-root selector", () => {
  it("derives the initial workspace/cwd from the DB project record", () => {
    const {
      mgr,
      broker,
      resolveProjectBinding,
      resolveSandboxPolicy,
      workspace,
      subdir,
    } = makeBoundProjectManager();

    const created = mgr.create({
      projectId: "project-1",
      shell: "bash",
      cwd: subdir,
      env: { KEEP_ME: "yes" },
    });

    expect(resolveProjectBinding).toHaveBeenCalledWith({
      projectId: "project-1",
      legacyCwd: subdir,
    });
    expect(resolveSandboxPolicy).toHaveBeenCalledWith({
      workspaceCwd: fs.realpathSync.native(workspace),
      executionCwd: fs.realpathSync.native(subdir),
    });
    expect(broker.spawnPty.mock.calls[0][3].cwd).toBe(
      fs.realpathSync.native(subdir),
    );
    expect(broker.spawnPty.mock.calls[0][3].env.KEEP_ME).toBeUndefined();
    expect(created).toMatchObject({
      projectId: "project-1",
      cwd: fs.realpathSync.native(subdir),
    });
    expect(mgr.list("project-1")[0]).toMatchObject({
      projectId: "project-1",
      cwd: fs.realpathSync.native(subdir),
    });
  });

  it("rejects a remote-sourced pc_root_path without local approval provenance", () => {
    const dbRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pty-db-root-"));
    tempRoots.push(dbRoot);
    const { mgr, broker } = makeBoundProjectManager({
      projectOverrides: {
        source_peer_id: "desktop-peer",
        pc_root_path: dbRoot,
        root_path_local_attested: 0,
      },
    });

    expect(() =>
      mgr.create({ projectId: "project-1", shell: "bash" }),
    ).toThrowError(
      expect.objectContaining({
        code: "ERR_PTY_PROJECT_ROOT_PROVENANCE_UNATTESTED",
      }),
    );
    expect(broker.spawnPty).not.toHaveBeenCalled();
  });

  it("rejects a historical root without a local host attestation", () => {
    const { mgr, broker } = makeBoundProjectManager({
      projectOverrides: {
        root_path_local_attested: 0,
      },
    });

    expect(() =>
      mgr.create({ projectId: "project-1", shell: "bash" }),
    ).toThrowError(
      expect.objectContaining({
        code: "ERR_PTY_PROJECT_ROOT_PROVENANCE_UNATTESTED",
        projectBindingFailClosed: true,
      }),
    );
    expect(broker.spawnPty).not.toHaveBeenCalled();
  });

  it("rejects missing, deleted, mismatched and async project records before PTY allocation", () => {
    const cases = [
      {
        resolver: () => null,
        code: "ERR_PTY_DB_PROJECT_BINDING_REQUIRED",
      },
      {
        resolver: () => ({
          id: "project-1",
          root_path: process.cwd(),
          deleted: 2,
        }),
        code: "ERR_PTY_PROJECT_BINDING_INVALID",
      },
      {
        resolver: () => ({
          id: "other-project",
          root_path: process.cwd(),
          deleted: 0,
        }),
        code: "ERR_PTY_PROJECT_BINDING_INVALID",
      },
      {
        resolver: () => Promise.resolve(null),
        code: "ERR_PTY_PROJECT_AUTHORITY_ASYNC",
      },
    ];

    for (const { resolver, code } of cases) {
      const loadNodePty = vi.fn();
      const mgr = new PtyManager({
        requireProjectBinding: true,
        resolveProjectBinding: resolver,
        _deps: { loadNodePty },
      });
      let error;
      try {
        mgr.create({ projectId: "project-1", shell: "pwsh" });
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({
        code,
        projectBindingFailClosed: true,
      });
      expect(loadNodePty).not.toHaveBeenCalled();
    }
  });

  it("rejects a caller cwd outside the canonical database project root", () => {
    const { mgr, outside } = makeBoundProjectManager();

    expect(() =>
      mgr.create({
        projectId: "project-1",
        shell: "bash",
        cwd: outside,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "ERR_PTY_EXECUTION_CWD_OUTSIDE_PROJECT",
        projectBindingFailClosed: true,
      }),
    );
  });

  it("uses a legacy cwd only to select the project and starts at root_path", () => {
    const { mgr, broker, workspace, outside } = makeBoundProjectManager();
    mgr._resolveProjectBinding.mockImplementation(() => ({
      id: "project-1",
      root_path: workspace,
      root_path_local_attested: 1,
      pc_root_path: outside,
      deleted: 0,
    }));

    mgr.create({ shell: "bash", cwd: outside });

    expect(mgr._resolveProjectBinding).toHaveBeenCalledWith({
      projectId: null,
      legacyCwd: outside,
    });
    expect(broker.spawnPty.mock.calls[0][3].cwd).toBe(
      fs.realpathSync.native(workspace),
    );
  });

  it("forwards arbitrary shell input in one bulk write without cwd claims", () => {
    const { mgr, fake, workspace } = makeBoundProjectManager();
    const { sessionId } = mgr.create({
      projectId: "project-1",
      shell: "bash",
    });
    const command = "x=cd; $x ../outside\r";

    mgr.write(sessionId, command, "project-1");

    expect(fake.proc.writes).toEqual([command]);
    expect(mgr.list("project-1")[0].cwd).toBe(
      fs.realpathSync.native(workspace),
    );
  });

  it("requires an exact project scope for list and session operations", () => {
    const { mgr, fake } = makeBoundProjectManager();
    const { sessionId } = mgr.create({
      projectId: "project-1",
      shell: "bash",
    });

    expect(() => mgr.list()).toThrowError(
      expect.objectContaining({ code: "ERR_PTY_PROJECT_SCOPE_REQUIRED" }),
    );
    expect(() => mgr.write(sessionId, "pwd\r", "project-2")).toThrowError(
      expect.objectContaining({ code: "ERR_PTY_SESSION_PROJECT_MISMATCH" }),
    );
    expect(fake.proc.writes).toEqual([]);
    expect(mgr.list("project-2")).toEqual([]);
  });
});

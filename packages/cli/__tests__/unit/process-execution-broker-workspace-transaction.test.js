import { EventEmitter } from "node:events";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import executionBroker from "../../src/lib/process-execution-broker/index.js";
import { executeControlledExecutionLocationResultApply } from "../../src/lib/execution-location-result-apply.js";
import {
  WORKSPACE_TRANSACTION_COVERAGE,
  WORKSPACE_TRANSACTION_ERROR,
  WORKSPACE_TRANSACTION_STATE,
} from "../../src/lib/process-execution-broker/workspace-transaction.js";

const ORIGINAL_NATIVE = executionBroker._native;
const roots = [];
const transactions = [];
const managerKeys = [];

function fixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-broker-workspace-transaction-"),
  );
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const stateDir = path.join(root, "state");
  const lockDir = path.join(root, "locks");
  fs.mkdirSync(workspaceRoot);
  fs.writeFileSync(path.join(workspaceRoot, "before.txt"), "before\n");
  managerKeys.push(`${path.resolve(stateDir)}\0<default>`);
  return { root, workspaceRoot, stateDir, lockDir };
}

function createDirectoryAlias(target, alias) {
  fs.symlinkSync(
    target,
    alias,
    process.platform === "win32" ? "junction" : "dir",
  );
  return alias;
}

function begin(input, options = {}) {
  const transaction = executionBroker.beginWorkspaceTransaction({
    stateDir: input.stateDir,
    runId: "broker-run",
    taskKey: "broker-task",
    workspaceRoot: input.workspaceRoot,
    coverageTarget: WORKSPACE_TRANSACTION_COVERAGE.PARTIAL,
    externalSideEffects: false,
    ...options,
  });
  transactions.push(transaction);
  return transaction;
}

function useTestSandboxPlan({ processTree = true, postSpawn = false } = {}) {
  return vi
    .spyOn(executionBroker, "_prepareSandboxPlan")
    .mockImplementation((command, args, options, context = {}) => ({
      contractVersion: 1,
      applied: processTree,
      platform: process.platform,
      profile: "default",
      command,
      args: [...(args || [])],
      options: { ...options },
      enforcement: processTree ? "test-process-tree" : null,
      backend: processTree ? "test-process-tree" : null,
      guarantees: processTree ? ["process-tree"] : [],
      requiredBoundaries: [
        ...(context.sandboxPolicy?.requiredBoundaries || []),
      ],
      reason: processTree ? null : "test_unsandboxed",
      postSpawn: {
        required: postSpawn,
        mode: postSpawn ? "sync" : "none",
      },
      cleanup: vi.fn(),
    }));
}

afterEach(() => {
  executionBroker._native = ORIGINAL_NATIVE;
  vi.restoreAllMocks();
  for (const transaction of transactions.splice(0)) {
    if (transaction.manager?._active?.has(transaction.id)) {
      try {
        transaction._lock?.release();
      } catch {
        // Test cleanup only; the assertion retains the fail-closed state.
      }
      transaction.manager._active.delete(transaction.id);
    }
  }
  for (const key of managerKeys.splice(0)) {
    executionBroker._workspaceTransactionManagers.delete(key);
  }
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("ProcessExecutionBroker workspace transactions", () => {
  it("commits a fixed git apply sequence and rolls back a rejected diff", () => {
    const input = fixture();
    const git = (...args) => {
      const result = spawnSync("git", args, {
        cwd: input.workspaceRoot,
        shell: false,
        encoding: "utf8",
      });
      expect(result.status, result.stderr).toBe(0);
    };
    git("init");
    git("add", "before.txt");
    git(
      "-c",
      "user.name=ChainlessChain Test",
      "-c",
      "user.email=test@chainlesschain.invalid",
      "commit",
      "-m",
      "fixture",
    );
    managerKeys.push(`${path.resolve(input.stateDir)}\0<default>`);
    useTestSandboxPlan();

    const patchBytes = Buffer.from(
      [
        "diff --git a/before.txt b/before.txt",
        "--- a/before.txt",
        "+++ b/before.txt",
        "@@ -1 +1 @@",
        "-before",
        "+after",
        "",
      ].join("\n"),
      "utf8",
    );
    const applied = executeControlledExecutionLocationResultApply({
      broker: executionBroker,
      sessionId: "broker-apply-session",
      applyId: "broker-apply-success",
      workspaceRoot: input.workspaceRoot,
      stateDir: input.stateDir,
      diffBytes: patchBytes,
      onPrepared: vi.fn(),
    });
    expect(applied).toMatchObject({
      ok: true,
      outcome: "applied",
      transaction: {
        coverage: "partial",
        fileCoverage: "partial",
        externalSideEffects: false,
        uncoveredPaths: [".git"],
      },
    });
    expect(
      fs
        .readFileSync(path.join(input.workspaceRoot, "before.txt"), "utf8")
        .replaceAll("\r\n", "\n"),
    ).toBe("after\n");
    expect(
      executionBroker.inspectWorkspaceTransaction(applied.transaction.id, {
        stateDir: input.stateDir,
      }),
    ).toMatchObject({ state: WORKSPACE_TRANSACTION_STATE.COMMITTED });

    const rejected = executeControlledExecutionLocationResultApply({
      broker: executionBroker,
      sessionId: "broker-apply-session",
      applyId: "broker-apply-rejected",
      workspaceRoot: input.workspaceRoot,
      stateDir: input.stateDir,
      diffBytes: Buffer.from("not a patch\n", "utf8"),
      onPrepared: vi.fn(),
    });
    expect(rejected).toMatchObject({
      ok: false,
      outcome: "rolled_back",
      stage: "check",
      process: { exitCode: 128 },
    });
    expect(
      fs
        .readFileSync(path.join(input.workspaceRoot, "before.txt"), "utf8")
        .replaceAll("\r\n", "\n"),
    ).toBe("after\n");
    expect(
      executionBroker.inspectWorkspaceTransaction(rejected.transaction.id, {
        stateDir: input.stateDir,
      }),
    ).toMatchObject({ state: WORKSPACE_TRANSACTION_STATE.ROLLED_BACK });
  });

  it("uses one canonical lock authority across caller lockDir and stateDir choices", () => {
    const input = fixture();
    const first = executionBroker.beginWorkspaceTransaction({
      stateDir: input.stateDir,
      lockDir: path.join(input.root, "caller-lock-a"),
      runId: "canonical-a",
      taskKey: "canonical-a",
      workspaceRoot: input.workspaceRoot,
      coverageTarget: WORKSPACE_TRANSACTION_COVERAGE.PARTIAL,
    });
    transactions.push(first);

    const otherStateDir = path.join(input.root, "other-state");
    managerKeys.push(`${path.resolve(otherStateDir)}\0<default>`);
    expect(() =>
      executionBroker.beginWorkspaceTransaction({
        stateDir: otherStateDir,
        lockDir: path.join(input.root, "caller-lock-b"),
        runId: "canonical-b",
        taskKey: "canonical-b",
        workspaceRoot: input.workspaceRoot,
        coverageTarget: WORKSPACE_TRANSACTION_COVERAGE.PARTIAL,
      }),
    ).toThrow(
      expect.objectContaining({
        code: WORKSPACE_TRANSACTION_ERROR.OVERLAPPING_WORKSPACE,
        ownerTransactionId: first.id,
      }),
    );
    expect(fs.existsSync(path.join(input.root, "caller-lock-a"))).toBe(false);
    expect(fs.existsSync(path.join(input.root, "caller-lock-b"))).toBe(false);
    expect(first.rollback().outcome).toBe("rolled_back");
  });

  it("records sync execution before native code writes and seals typed evidence", () => {
    const input = fixture();
    const sandboxPlan = useTestSandboxPlan();
    let transaction;
    const spawnSync = vi.fn(() => {
      expect(transaction.snapshot().executions).toEqual([
        expect.objectContaining({
          status: "prepared",
          treeGuarantee: "process-tree",
        }),
      ]);
      fs.writeFileSync(
        path.join(input.workspaceRoot, "child.txt"),
        "child-write\n",
      );
      return {
        status: 0,
        signal: null,
        error: null,
        stdout: "",
        stderr: "",
      };
    });
    executionBroker._native = {
      ...(ORIGINAL_NATIVE || {}),
      spawnSync,
    };
    transaction = begin(input);

    const result = executionBroker.spawnSync("test-command", [], {
      cwd: input.workspaceRoot,
      origin: "team:test",
      scope: "team",
      policy: "allow",
      shell: false,
      encoding: "utf8",
      workspaceTransactionId: "caller-cannot-select-a-transaction",
      workspaceTransactionStateDir: "caller-cannot-select-state",
      workspaceTransactionCapture: false,
    });
    expect(result.status).toBe(0);
    expect(
      sandboxPlan.mock.calls[0][3].sandboxPolicy.requiredBoundaries,
    ).toContain("process-tree");
    expect(spawnSync.mock.calls[0][2]).not.toHaveProperty(
      "workspaceTransactionId",
    );
    expect(spawnSync.mock.calls[0][2]).not.toHaveProperty(
      "workspaceTransactionStateDir",
    );
    expect(spawnSync.mock.calls[0][2]).not.toHaveProperty(
      "workspaceTransactionCapture",
    );

    const running = transaction.snapshot();
    expect(running.executions).toEqual([
      expect.objectContaining({
        executionId: expect.any(String),
        origin: "team:test",
        cwd: expect.any(String),
        status: "settled",
        treeGuarantee: "process-tree",
        commandDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      }),
    ]);
    const evidence = transaction.accept();
    expect(evidence.executions).toEqual([running.executions[0].executionId]);
    expect(
      executionBroker.inspectWorkspaceTransaction(transaction.id, {
        stateDir: input.stateDir,
      }),
    ).toMatchObject({
      id: transaction.id,
      state: WORKSPACE_TRANSACTION_STATE.COMMITTED,
      runId: "broker-run",
      taskKey: "broker-task",
    });
    expect(
      executionBroker.listWorkspaceTransactions({
        stateDir: input.stateDir,
        workspaceRoot: input.workspaceRoot,
      }),
    ).toEqual([
      expect.objectContaining({
        id: transaction.id,
        state: WORKSPACE_TRANSACTION_STATE.COMMITTED,
      }),
    ]);

    const audit = executionBroker
      .getAuditLog(20)
      .find((entry) => entry.executionId === running.executions[0].executionId);
    expect(audit.workspaceTransactionIds).toContain(transaction.id);
  });

  it("records async, sync, and PTY executions from a canonical cwd alias", () => {
    const input = fixture();
    const cwdAlias = createDirectoryAlias(
      input.workspaceRoot,
      path.join(input.root, "workspace-alias"),
    );
    useTestSandboxPlan();

    const asyncProc = new EventEmitter();
    asyncProc.pid = 42_010;
    asyncProc.kill = vi.fn();
    const spawnSync = vi.fn(() => ({
      status: 0,
      signal: null,
      error: null,
      stdout: "",
      stderr: "",
    }));
    const spawn = vi.fn(() => asyncProc);
    executionBroker._native = {
      ...(ORIGINAL_NATIVE || {}),
      spawn,
      spawnSync,
    };
    const transaction = begin(input);

    executionBroker.spawn("async-command", [], {
      cwd: cwdAlias,
      origin: "team:alias-async",
      scope: "team",
      policy: "allow",
      shell: false,
    });
    asyncProc.emit("close", 0, null);

    executionBroker.spawnSync("sync-command", [], {
      cwd: cwdAlias,
      origin: "team:alias-sync",
      scope: "team",
      policy: "allow",
      shell: false,
    });

    // The legacy node-pty branch cannot attest a process tree. Admission was
    // already exercised above; bypass only its automatic boundary upgrade so
    // prepareSpawn can prove the aliased PTY cwd is still durably recorded.
    vi.spyOn(
      executionBroker,
      "_workspaceTransactionRequiredBoundaries",
    ).mockReturnValue([]);
    let settlePty;
    const ptyProc = {
      pid: 42_011,
      kill: vi.fn(),
      onExit: vi.fn((listener) => {
        settlePty = listener;
        return { dispose: vi.fn() };
      }),
    };
    executionBroker.spawnPty(
      { spawn: vi.fn(() => ptyProc) },
      "pty-command",
      [],
      {
        cwd: cwdAlias,
        origin: "terminal:alias-pty",
        scope: "team",
        policy: "allow",
      },
    );
    settlePty({ exitCode: 0, signal: null });

    const canonicalCwd = fs.realpathSync.native(input.workspaceRoot);
    expect(spawn.mock.calls[0][2].cwd).toBe(canonicalCwd);
    expect(spawnSync.mock.calls[0][2].cwd).toBe(canonicalCwd);
    const executions = transaction.snapshot().executions;
    expect(executions).toHaveLength(3);
    expect(
      executions.map(({ origin, cwd, status }) => ({ origin, cwd, status })),
    ).toEqual([
      {
        origin: "team:alias-async",
        cwd: canonicalCwd,
        status: "settled",
      },
      {
        origin: "team:alias-sync",
        cwd: canonicalCwd,
        status: "settled",
      },
      {
        origin: "terminal:alias-pty",
        cwd: canonicalCwd,
        status: "settled",
      },
    ]);

    const ptyExecution = executions.find(
      (entry) => entry.origin === "terminal:alias-pty",
    );
    transaction.updateExecutionGuarantees(ptyExecution.executionId, {
      treeGuarantee: true,
    });
    expect(
      transaction.rollback({ reason: "canonical cwd alias regression" }),
    ).toMatchObject({
      outcome: "rolled_back",
      executions: expect.arrayContaining(
        executions.map((entry) => entry.executionId),
      ),
    });
  });

  it("uses close rather than exit as the asynchronous writer fence", () => {
    const input = fixture();
    useTestSandboxPlan();
    const proc = new EventEmitter();
    proc.pid = 42_001;
    proc.kill = vi.fn();
    executionBroker._native = {
      ...(ORIGINAL_NATIVE || {}),
      spawn: vi.fn(() => proc),
    };
    const transaction = begin(input);

    executionBroker.spawn("test-command", [], {
      cwd: input.workspaceRoot,
      origin: "team:test",
      scope: "team",
      policy: "allow",
      shell: false,
    });
    expect(transaction.snapshot().executions[0]).toMatchObject({
      status: "running",
      treeGuarantee: "process-tree",
    });
    expect(() => transaction.rollback()).toThrow(
      expect.objectContaining({
        code: WORKSPACE_TRANSACTION_ERROR.WRITERS_ACTIVE,
      }),
    );

    proc.emit("exit", 0, null);
    fs.writeFileSync(
      path.join(input.workspaceRoot, "late.txt"),
      "late-after-exit\n",
    );
    expect(transaction.snapshot().executions[0].status).toBe("running");

    proc.emit("close", 0, null);
    expect(transaction.snapshot().executions[0].status).toBe("settled");
    const evidence = transaction.rollback({
      reason: "task failed after writer close",
    });
    expect(evidence.outcome).toBe("rolled_back");
    expect(fs.existsSync(path.join(input.workspaceRoot, "late.txt"))).toBe(
      false,
    );
  });

  it("upgrades the writer fence only after synchronous post-spawn enforcement", () => {
    const input = fixture();
    useTestSandboxPlan({ postSpawn: true });
    const proc = new EventEmitter();
    proc.pid = 42_003;
    proc.kill = vi.fn();
    executionBroker._native = {
      ...(ORIGINAL_NATIVE || {}),
      spawn: vi.fn(() => proc),
    };
    const transaction = begin(input);
    const postSpawnSandbox = vi
      .spyOn(executionBroker._sandboxAdapter, "postSpawnSandbox")
      .mockImplementation(() => {
        expect(transaction.snapshot().executions[0]).toMatchObject({
          status: "running",
          treeGuarantee: "unproven",
        });
      });

    executionBroker.spawn("test-command", [], {
      cwd: input.workspaceRoot,
      origin: "team:test",
      scope: "team",
      policy: "allow",
      shell: false,
    });
    expect(postSpawnSandbox).toHaveBeenCalledOnce();
    expect(transaction.snapshot().executions[0]).toMatchObject({
      status: "running",
      treeGuarantee: "process-tree",
      treeGuaranteeVerifiedAt: expect.any(String),
    });

    proc.emit("close", 0, null);
    expect(transaction.accept().outcome).toBe("committed");
  });

  it("exposes a close fence when post-spawn enforcement fails", async () => {
    const input = fixture();
    useTestSandboxPlan({ postSpawn: true });
    const proc = new EventEmitter();
    proc.pid = 42_004;
    proc.kill = vi.fn(() => {
      queueMicrotask(() => proc.emit("close", null, "SIGKILL"));
      return true;
    });
    executionBroker._native = {
      ...(ORIGINAL_NATIVE || {}),
      spawn: vi.fn(() => proc),
    };
    vi.spyOn(
      executionBroker._sandboxAdapter,
      "postSpawnSandbox",
    ).mockImplementation(() => {
      throw new Error("post-spawn attestation failed");
    });
    const transaction = begin(input);

    let failure;
    try {
      executionBroker.spawn("test-command", [], {
        cwd: input.workspaceRoot,
        origin: "team:test",
        scope: "team",
        policy: "allow",
        shell: false,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure.spawnedProcess).toBe(proc);
    expect(failure.workspaceTerminationRequested).toBe(true);
    expect(failure.workspaceProcessClosed).toBeInstanceOf(Promise);
    await expect(failure.workspaceProcessClosed).resolves.toMatchObject({
      observed: true,
      signal: "SIGKILL",
    });
    expect(transaction.snapshot().executions[0]).toMatchObject({
      status: "settled",
      treeGuarantee: "unproven",
    });
    expect(() => transaction.rollback()).toThrow(
      expect.objectContaining({
        code: WORKSPACE_TRANSACTION_ERROR.WRITERS_ACTIVE,
      }),
    );
  });

  it("preserves process ownership when transaction binding throws after native spawn", async () => {
    const input = fixture();
    useTestSandboxPlan();
    const transaction = begin(input);
    const proc = new EventEmitter();
    proc.pid = 42_005;
    proc.kill = vi.fn(() => {
      queueMicrotask(() => proc.emit("close", null, "SIGKILL"));
      return true;
    });
    executionBroker._native = {
      ...(ORIGINAL_NATIVE || {}),
      spawn: vi.fn(() => proc),
    };
    vi.spyOn(transaction.manager, "bindProcess").mockImplementation(() => {
      throw new Error("transaction bind failed");
    });

    let failure;
    try {
      executionBroker.spawn("test-command", [], {
        cwd: input.workspaceRoot,
        origin: "team:test",
        scope: "team",
        policy: "allow",
        shell: false,
      });
    } catch (error) {
      failure = error;
    }

    expect(failure.message).toContain("transaction bind failed");
    expect(failure.spawnedProcess).toBe(proc);
    expect(failure.workspaceTerminationRequested).toBe(true);
    expect(proc.kill).toHaveBeenCalledWith("SIGKILL");
    await expect(failure.workspaceProcessClosed).resolves.toMatchObject({
      observed: true,
      signal: "SIGKILL",
    });
  });

  it("preserves process ownership when a synchronous spawn audit listener throws", async () => {
    const input = fixture();
    useTestSandboxPlan();
    const proc = new EventEmitter();
    proc.pid = 42_006;
    proc.kill = vi.fn(() => {
      queueMicrotask(() => proc.emit("close", null, "SIGKILL"));
      return true;
    });
    executionBroker._native = {
      ...(ORIGINAL_NATIVE || {}),
      spawn: vi.fn(() => proc),
    };
    const listenerError = new Error("spawn audit listener failed");
    executionBroker.once("spawn", () => {
      throw listenerError;
    });

    let failure;
    try {
      executionBroker.spawn("test-command", [], {
        cwd: input.workspaceRoot,
        origin: "team:test",
        scope: "team",
        policy: "allow",
        shell: false,
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBe(listenerError);
    expect(failure.spawnedProcess).toBe(proc);
    expect(failure.workspaceTerminationRequested).toBe(true);
    expect(proc.kill).toHaveBeenCalledWith("SIGKILL");
    await expect(failure.workspaceProcessClosed).resolves.toMatchObject({
      observed: true,
      signal: "SIGKILL",
    });
  });

  it("rejects detached writers before invoking the native spawn", () => {
    const input = fixture();
    useTestSandboxPlan();
    const issue = vi.spyOn(
      executionBroker,
      "issueLinuxWorkspaceSandboxExecutionContract",
    );
    const spawn = vi.fn();
    executionBroker._native = {
      ...(ORIGINAL_NATIVE || {}),
      spawn,
    };
    const transaction = begin(input);

    expect(() =>
      executionBroker.spawn("test-command", [], {
        cwd: input.workspaceRoot,
        origin: "team:test",
        scope: "team",
        policy: "allow",
        shell: false,
        detached: true,
      }),
    ).toThrow(
      expect.objectContaining({
        code: WORKSPACE_TRANSACTION_ERROR.DETACHED_PROCESS,
      }),
    );
    expect(issue).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    expect(transaction.rollback().outcome).toBe("rolled_back");
  });

  it("fails closed before spawn when macOS-like authority cannot prove process-tree", () => {
    const input = fixture();
    const spawn = vi.fn();
    const issue = vi
      .spyOn(executionBroker, "issueLinuxWorkspaceSandboxExecutionContract")
      .mockReturnValue(null);
    executionBroker._native = {
      ...(ORIGINAL_NATIVE || {}),
      spawn,
    };
    vi.spyOn(executionBroker, "_prepareSandboxPlan").mockImplementation(
      (_command, _args, _options, context = {}) => {
        expect(context.sandboxPolicy.requiredBoundaries).toContain(
          "process-tree",
        );
        const error = new Error(
          "test platform cannot guarantee process-tree closure",
        );
        error.code = "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED";
        error.sandboxReason = "required_boundaries_unsatisfied";
        error.sandboxFailClosed = true;
        error.requiredBoundaries = ["process-tree"];
        error.missingBoundaries = ["process-tree"];
        throw error;
      },
    );
    const transaction = begin(input);

    expect(() =>
      executionBroker.spawn("test-command", [], {
        cwd: input.workspaceRoot,
        origin: "team:test",
        scope: "team",
        policy: "allow",
        shell: false,
      }),
    ).toThrow(
      expect.objectContaining({
        code: "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED",
      }),
    );
    expect(spawn).not.toHaveBeenCalled();
    expect(issue).toHaveBeenCalledOnce();
    expect(transaction.snapshot()).toMatchObject({
      state: WORKSPACE_TRANSACTION_STATE.PREPARED,
      executions: [],
    });
    expect(transaction.rollback().outcome).toBe("rolled_back");
  });

  it("issues a Linux workspace execution contract from active transaction authority", () => {
    const input = fixture();
    const transaction = begin(input);
    const issuedContract = Object.freeze({ kind: "test-linux-contract" });
    const issue = vi
      .spyOn(executionBroker, "issueLinuxWorkspaceSandboxExecutionContract")
      .mockReturnValue(issuedContract);

    const options = executionBroker._withWorkspaceTransactionBoundaries(
      {
        cwd: input.workspaceRoot,
        origin: "agent:test",
        shell: false,
      },
      input.workspaceRoot,
      {
        command: "node",
        args: ["script.js"],
        sync: true,
      },
    );

    expect(options.requiredBoundaries).toContain("process-tree");
    expect(options.sandboxExecutionContract).toBe(issuedContract);
    expect(issue).toHaveBeenCalledWith(
      "node",
      ["script.js"],
      expect.objectContaining({
        requiredBoundaries: expect.arrayContaining(["process-tree"]),
        cwd: transaction.workspaceRoot,
        shell: false,
      }),
      transaction.workspaceRoot,
      { sync: true, pty: false },
    );
    expect(transaction.rollback().outcome).toBe("rolled_back");
  });

  it("uses an explicit Linux shell argv for managed execSync", () => {
    vi.spyOn(
      executionBroker,
      "_requiresExplicitLinuxWorkspaceShell",
    ).mockReturnValue(true);
    const spawnSync = vi.spyOn(executionBroker, "spawnSync").mockReturnValue({
      status: 0,
      signal: null,
      error: null,
      stdout: "ok\n",
      stderr: "",
    });

    expect(
      executionBroker.execSync("printf 'ok\\n'", {
        cwd: "C:\\trusted-workspace",
        encoding: "utf8",
      }),
    ).toBe("ok\n");
    expect(spawnSync).toHaveBeenCalledWith(
      "/bin/sh",
      ["-c", "printf 'ok\\n'"],
      expect.objectContaining({
        cwd: "C:\\trusted-workspace",
        shell: false,
        origin: "shell:execSync",
      }),
    );
  });

  it("settles an unsandboxed PTY through onExit and strips transaction controls", () => {
    const input = fixture();
    // Bypass only automatic admission so this unit can exercise the legacy
    // node-pty onExit binding. Production transactions require process-tree
    // and deny this unsandboxed path before ptyModule.spawn().
    vi.spyOn(
      executionBroker,
      "_workspaceTransactionRequiredBoundaries",
    ).mockReturnValue([]);
    let onExit;
    const proc = {
      pid: 42_002,
      kill: vi.fn(),
      onExit: vi.fn((listener) => {
        onExit = listener;
        return { dispose: vi.fn() };
      }),
    };
    const ptyModule = {
      spawn: vi.fn(() => proc),
    };
    const transaction = begin(input);

    executionBroker.spawnPty(ptyModule, "test-shell", [], {
      cwd: input.workspaceRoot,
      origin: "terminal:test",
      scope: "team",
      policy: "allow",
      workspaceTransactionId: "forged-id",
      workspaceTransactionStateDir: "forged-state",
      workspaceTransactionCapture: false,
    });
    const nativeOptions = ptyModule.spawn.mock.calls[0][2];
    expect(nativeOptions).not.toHaveProperty("workspaceTransactionId");
    expect(nativeOptions).not.toHaveProperty("workspaceTransactionStateDir");
    expect(nativeOptions).not.toHaveProperty("workspaceTransactionCapture");
    expect(proc.onExit).toHaveBeenCalledOnce();
    expect(transaction.snapshot().executions[0].status).toBe("running");

    onExit({ exitCode: 0, signal: null });
    expect(transaction.snapshot().executions[0]).toMatchObject({
      status: "settled",
      exitCode: 0,
      treeGuarantee: "unproven",
    });
    expect(() => transaction.accept()).toThrow(
      expect.objectContaining({
        code: WORKSPACE_TRANSACTION_ERROR.WRITERS_ACTIVE,
      }),
    );
    expect(transaction.snapshot()).toMatchObject({
      state: WORKSPACE_TRANSACTION_STATE.ROLLBACK_REQUIRED,
      fileCoverage: WORKSPACE_TRANSACTION_COVERAGE.NONE,
      coverage: WORKSPACE_TRANSACTION_COVERAGE.NONE,
    });
  });

  it("keeps a settled sync spawn fail-closed without a process-tree guarantee", () => {
    const input = fixture();
    useTestSandboxPlan({ processTree: false });
    executionBroker._native = {
      ...(ORIGINAL_NATIVE || {}),
      spawnSync: vi.fn(() => ({
        status: 0,
        signal: null,
        error: null,
        stdout: "",
        stderr: "",
      })),
    };
    const transaction = begin(input);

    executionBroker.spawnSync("test-command", [], {
      cwd: input.workspaceRoot,
      origin: "team:test",
      scope: "team",
      policy: "allow",
      shell: false,
    });
    expect(transaction.snapshot().executions[0]).toMatchObject({
      status: "settled",
      treeGuarantee: "unproven",
    });
    expect(() => transaction.accept()).toThrow(
      expect.objectContaining({
        code: WORKSPACE_TRANSACTION_ERROR.WRITERS_ACTIVE,
      }),
    );
    expect(transaction.snapshot()).toMatchObject({
      state: WORKSPACE_TRANSACTION_STATE.ROLLBACK_REQUIRED,
      fileCoverage: WORKSPACE_TRANSACTION_COVERAGE.NONE,
      coverage: WORKSPACE_TRANSACTION_COVERAGE.NONE,
    });
    expect(() => transaction.rollback()).toThrow(
      expect.objectContaining({
        code: WORKSPACE_TRANSACTION_ERROR.WRITERS_ACTIVE,
      }),
    );
  });
});

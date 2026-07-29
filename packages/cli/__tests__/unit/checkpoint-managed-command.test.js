import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn as nativeSpawn } from "node:child_process";
import {
  listManagedCheckpoints,
  registerManagedCheckpointCommands,
  restoreManagedCheckpoint,
  runManagedWorkspaceCommand,
  showManagedCheckpoint,
  undoManagedCheckpointRestore,
} from "../../src/commands/checkpoint-managed.js";
import { WorkspaceTransactionManager } from "../../src/lib/process-execution-broker/workspace-transaction.js";

const digest = (character) => `sha256:${character.repeat(64)}`;

function state(overrides = {}) {
  return {
    version: 1,
    id: "wcp-test",
    checkpointId: "checkpoint-wcp-test",
    state: "committed",
    runId: "run-1",
    taskKey: "task-1",
    workspaceRoot: "C:\\workspace",
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:01:00.000Z",
    coverage: "partial",
    fileCoverage: "partial",
    externalSideEffects: true,
    writerIsolation: "unknown",
    uncoveredPaths: [".git", "@external-git-metadata"],
    checkpoint: {
      id: "checkpoint-wcp-test",
      digest: digest("a"),
      entries: 4,
      files: 2,
      bytes: 20,
    },
    writeManifest: {
      digest: digest("b"),
      summary: { added: 0, modified: 1, deleted: 0 },
    },
    evidence: {
      outcome: "committed",
      evidenceDigest: digest("c"),
      coverage: "partial",
      fileCoverage: "partial",
      uncoveredPaths: [".git", "@external-git-metadata"],
    },
    restoreEvidence: null,
    undoRestoreEvidence: null,
    failureEvidence: [],
    ...overrides,
  };
}

function outputRecorder() {
  return {
    json: vi.fn(),
    line: vi.fn(),
    error: vi.fn(),
  };
}

function commandHarness(manager, dependencies = {}) {
  const output = outputRecorder();
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeOut: () => {},
    writeErr: () => {},
  });
  const checkpoint = program.command("checkpoint");
  registerManagedCheckpointCommands(checkpoint, {
    managerFactory: vi.fn(() => manager),
    output,
    isTTY: false,
    ...dependencies,
  });
  return { program, output };
}

class ProcessTreeTestBroker {
  constructor({ stateDir, lockDir, processTree = true } = {}) {
    this.manager = new WorkspaceTransactionManager({
      stateDir,
      lockDir,
      allowNonCanonicalLockDirForTests: true,
    });
    this.processTree = processTree;
    this.transaction = null;
    this.beginWorkspaceTransaction = vi.fn((options) => {
      this.transaction = this.manager.begin(options);
      return this.transaction;
    });
    this.spawnOptions = [];
  }

  spawn(command, args, options) {
    this.spawnOptions.push({ command, args, options });
    if (
      !this.processTree ||
      !options.requiredBoundaries?.includes("process-tree")
    ) {
      const error = new Error("required process-tree boundary unavailable");
      error.code = "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED";
      throw error;
    }
    const executionId = crypto.randomUUID();
    this.transaction.recordExecution({
      executionId,
      command,
      args,
      cwd: options.cwd,
      detached: options.detached,
      origin: options.origin,
      scope: options.scope,
      sandboxGuarantees: ["process-tree"],
    });
    let proc;
    try {
      proc = nativeSpawn(command, args, {
        cwd: options.cwd,
        shell: false,
        detached: false,
        stdio: options.stdio,
        windowsHide: true,
      });
      this.transaction.bindExecution(executionId, {
        pid: proc.pid,
        treeGuarantee: true,
      });
    } catch (error) {
      this.transaction.settleExecution(executionId, {
        error: error.message,
      });
      throw error;
    }
    proc.once("close", (exitCode, signal) => {
      this.transaction.settleExecution(executionId, {
        exitCode,
        signal,
      });
    });
    return proc;
  }
}

describe("managed checkpoint inspection", () => {
  it("lists verified transactions newest first with explicit coverage warnings", () => {
    const earlier = state({
      id: "wcp-earlier",
      updatedAt: "2026-07-29T00:00:00.000Z",
    });
    const later = state({
      id: "wcp-later",
      updatedAt: "2026-07-29T00:02:00.000Z",
    });
    const manager = {
      list: vi.fn(() => [earlier, later]),
    };

    const records = listManagedCheckpoints(manager, {
      workspaceRoot: ".",
    });

    expect(manager.list).toHaveBeenCalledWith({
      workspaceRoot: expect.any(String),
    });
    expect(records.map((record) => record.id)).toEqual([
      "wcp-later",
      "wcp-earlier",
    ]);
    expect(records[0]).toMatchObject({
      coverage: "partial",
      fileCoverage: "partial",
      externalSideEffects: true,
      uncoveredPaths: [".git", "@external-git-metadata"],
    });
    expect(records[0].warnings.join("\n")).toMatch(
      /must not be treated as a full side-effect rollback/,
    );
    expect(records[0].warnings.join("\n")).toMatch(
      /databases, messages, deployments, payments/,
    );
  });

  it("only reports overall full when both the persisted claim and side-effect contract say full", () => {
    const manager = {
      inspect: vi.fn(() =>
        state({
          coverage: "full",
          fileCoverage: "full",
          externalSideEffects: false,
          writerIsolation: "exclusive-workspace",
          uncoveredPaths: [],
          evidence: {
            outcome: "committed",
            evidenceDigest: digest("d"),
            coverage: "full",
            fileCoverage: "full",
            uncoveredPaths: [],
          },
        }),
      ),
    };

    const details = showManagedCheckpoint(manager, "wcp-test");

    expect(details.coverage).toBe("full");
    expect(details.fileCoverage).toBe("full");
    expect(details.warnings).toEqual([]);
  });

  it("uses only the verified inspect API and returns restore authority digests", () => {
    const manager = {
      inspect: vi.fn(() => ({
        state: state({
          restoreEvidence: {
            outcome: "restored",
            evidenceDigest: digest("e"),
          },
          undoRestoreEvidence: {
            outcome: "restore_undone",
            evidenceDigest: digest("f"),
          },
        }),
        baseline: { entries: [{ path: "must-not-be-rendered" }] },
      })),
    };

    const details = showManagedCheckpoint(manager, "wcp-test");

    expect(manager.inspect).toHaveBeenCalledWith("wcp-test");
    expect(details.restoreEvidenceDigest).toBe(digest("e"));
    expect(details.undoRestoreEvidenceDigest).toBe(digest("f"));
    expect(JSON.stringify(details)).not.toContain("must-not-be-rendered");
  });

  it("fails closed if the public verified inspection APIs are unavailable", () => {
    expect(() => listManagedCheckpoints({}, {})).toThrowError(
      expect.objectContaining({
        code: "MANAGED_CHECKPOINT_API_UNAVAILABLE",
      }),
    );
    expect(() => showManagedCheckpoint({}, "wcp-test")).toThrowError(
      expect.objectContaining({
        code: "MANAGED_CHECKPOINT_API_UNAVAILABLE",
      }),
    );
  });
});

describe("managed checkpoint restore authority", () => {
  it("binds restore to the exact committed evidence digest and preserves force semantics", () => {
    const manager = {
      restore: vi.fn(() => ({
        outcome: "restored",
        evidenceDigest: digest("e"),
      })),
    };

    restoreManagedCheckpoint(manager, "wcp-test", {
      expectedEvidenceDigest: digest("c"),
      force: true,
      reason: "operator approved",
    });

    expect(manager.restore).toHaveBeenCalledWith("wcp-test", {
      expectedEvidenceDigest: digest("c"),
      force: true,
      reason: "operator approved",
    });
  });

  it("rejects a missing or malformed digest before calling restore, including with force", () => {
    const manager = { restore: vi.fn() };

    expect(() =>
      restoreManagedCheckpoint(manager, "wcp-test", {
        force: true,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "MANAGED_CHECKPOINT_INVALID_EVIDENCE_DIGEST",
      }),
    );
    expect(() =>
      restoreManagedCheckpoint(manager, "wcp-test", {
        expectedEvidenceDigest: "sha256:NOT-A-DIGEST",
        force: true,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "MANAGED_CHECKPOINT_INVALID_EVIDENCE_DIGEST",
      }),
    );
    expect(manager.restore).not.toHaveBeenCalled();
  });

  it("binds undo to the exact restore evidence digest", () => {
    const manager = {
      undoRestore: vi.fn(() => ({
        outcome: "restore_undone",
        evidenceDigest: digest("f"),
      })),
    };

    undoManagedCheckpointRestore(manager, "wcp-test", {
      expectedRestoreEvidenceDigest: digest("e"),
      force: false,
      reason: "recover post-task files",
    });

    expect(manager.undoRestore).toHaveBeenCalledWith("wcp-test", {
      expectedRestoreEvidenceDigest: digest("e"),
      force: false,
      reason: "recover post-task files",
    });
  });
});

describe("managed checkpoint foreground runner", () => {
  let root;
  let workspace;
  let stateDir;
  let lockDir;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-managed-run-"));
    workspace = path.join(root, "workspace");
    stateDir = path.join(root, "state");
    lockDir = path.join(root, "locks");
    fs.mkdirSync(workspace);
    fs.writeFileSync(path.join(workspace, "value.txt"), "before", "utf8");
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("commits a successful Broker command and reports partial coverage honestly", async () => {
    const broker = new ProcessTreeTestBroker({ stateDir, lockDir });
    const script =
      "require('node:fs').writeFileSync('value.txt', 'after'); process.stdout.write('done')";

    const result = await runManagedWorkspaceCommand({
      broker,
      workspaceRoot: workspace,
      command: process.execPath,
      args: ["-e", script],
      stateDir,
      lockDir,
      captureOutput: true,
    });

    expect(result).toMatchObject({
      ok: true,
      state: "committed",
      outcome: "committed",
      exitCode: 0,
      stdout: "done",
      coverage: "partial",
      fileCoverage: "partial",
      externalSideEffects: true,
    });
    expect(result.transactionId).toMatch(/^wcp-/);
    expect(result.checkpointId).toBe(`checkpoint-${result.transactionId}`);
    expect(result.evidenceDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.warnings.join("\n")).toMatch(
      /must not be treated as a full side-effect rollback/,
    );
    expect(fs.readFileSync(path.join(workspace, "value.txt"), "utf8")).toBe(
      "after",
    );
    expect(broker.spawnOptions[0].options).toMatchObject({
      cwd: workspace,
      shell: false,
      detached: false,
      requiredBoundaries: ["process-tree"],
    });
  });

  it("waits for close and rolls back all workspace writes on a nonzero exit", async () => {
    const broker = new ProcessTreeTestBroker({ stateDir, lockDir });
    const script =
      "const fs=require('node:fs'); fs.writeFileSync('value.txt','bad'); fs.writeFileSync('new.txt','new'); process.stderr.write('failed'); process.exit(7)";

    const result = await runManagedWorkspaceCommand({
      broker,
      workspaceRoot: workspace,
      command: process.execPath,
      args: ["-e", script],
      stateDir,
      lockDir,
      captureOutput: true,
    });

    expect(result).toMatchObject({
      ok: false,
      state: "rolled_back",
      outcome: "rolled_back",
      exitCode: 7,
      stderr: "failed",
    });
    expect(result.evidenceDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(fs.readFileSync(path.join(workspace, "value.txt"), "utf8")).toBe(
      "before",
    );
    expect(fs.existsSync(path.join(workspace, "new.txt"))).toBe(false);
  });

  it("lists, inspects, restores, and undoes a real committed transaction through public APIs", async () => {
    const broker = new ProcessTreeTestBroker({ stateDir, lockDir });
    const result = await runManagedWorkspaceCommand({
      broker,
      workspaceRoot: workspace,
      command: process.execPath,
      args: [
        "-e",
        "require('node:fs').writeFileSync('value.txt', 'committed')",
      ],
      stateDir,
      lockDir,
      captureOutput: true,
    });

    const listed = listManagedCheckpoints(broker.manager, {
      workspaceRoot: workspace,
    });
    expect(listed).toEqual([
      expect.objectContaining({
        id: result.transactionId,
        state: "committed",
        evidenceDigest: result.evidenceDigest,
        coverage: "partial",
      }),
    ]);
    const shown = showManagedCheckpoint(broker.manager, result.transactionId);
    expect(shown).toMatchObject({
      id: result.transactionId,
      checkpointId: result.checkpointId,
      state: "committed",
      evidenceDigest: result.evidenceDigest,
      checkpoint: {
        digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        files: 1,
      },
      writeManifest: {
        digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      },
    });

    const restored = restoreManagedCheckpoint(
      broker.manager,
      result.transactionId,
      {
        expectedEvidenceDigest: result.evidenceDigest,
      },
    );
    expect(restored).toMatchObject({
      outcome: "restored",
      sourceEvidenceDigest: result.evidenceDigest,
      forced: false,
    });
    expect(fs.readFileSync(path.join(workspace, "value.txt"), "utf8")).toBe(
      "before",
    );

    const undone = undoManagedCheckpointRestore(
      broker.manager,
      result.transactionId,
      {
        expectedRestoreEvidenceDigest: restored.evidenceDigest,
      },
    );
    expect(undone).toMatchObject({
      outcome: "restore_undone",
      sourceRestoreEvidenceDigest: restored.evidenceDigest,
      forced: false,
    });
    expect(fs.readFileSync(path.join(workspace, "value.txt"), "utf8")).toBe(
      "committed",
    );
  });

  it("parses `managed run -- <command...>` literally and emits JSON evidence", async () => {
    const broker = new ProcessTreeTestBroker({ stateDir, lockDir });
    const output = outputRecorder();
    const program = new Command();
    program.exitOverride();
    program.configureOutput({
      writeOut: () => {},
      writeErr: () => {},
    });
    const checkpoint = program.command("checkpoint");
    registerManagedCheckpointCommands(checkpoint, {
      broker,
      output,
      stdoutWriter: vi.fn(),
      stderrWriter: vi.fn(),
      isTTY: false,
    });
    const priorExitCode = process.exitCode;
    process.exitCode = undefined;
    try {
      await program.parseAsync([
        "node",
        "cc",
        "checkpoint",
        "managed",
        "run",
        "--dir",
        workspace,
        "--state-dir",
        stateDir,
        "--json",
        "--",
        process.execPath,
        "-e",
        "require('node:fs').writeFileSync('value.txt','cli-run')",
      ]);
      expect(output.json).toHaveBeenCalledWith(
        expect.objectContaining({
          ok: true,
          state: "committed",
          evidenceDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
          coverage: "partial",
          externalSideEffects: true,
          warnings: expect.arrayContaining([
            expect.stringMatching(/full side-effect rollback/),
          ]),
        }),
      );
      expect(fs.readFileSync(path.join(workspace, "value.txt"), "utf8")).toBe(
        "cli-run",
      );
      expect(process.exitCode).toBeUndefined();
    } finally {
      process.exitCode = priorExitCode;
    }
  });

  it("rejects background mode before checkpoint creation or process spawn", async () => {
    const broker = new ProcessTreeTestBroker({ stateDir, lockDir });
    const spawn = vi.spyOn(broker, "spawn");

    await expect(
      runManagedWorkspaceCommand({
        broker,
        workspaceRoot: workspace,
        command: process.execPath,
        args: ["-e", "process.exit(0)"],
        stateDir,
        lockDir,
        background: true,
      }),
    ).rejects.toMatchObject({
      code: "MANAGED_CHECKPOINT_FOREGROUND_REQUIRED",
    });
    expect(broker.beginWorkspaceTransaction).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it("fails before command execution when the Broker cannot prove a process-tree fence", async () => {
    const broker = new ProcessTreeTestBroker({
      stateDir,
      lockDir,
      processTree: false,
    });
    const marker = path.join(workspace, "must-not-exist.txt");

    await expect(
      runManagedWorkspaceCommand({
        broker,
        workspaceRoot: workspace,
        command: process.execPath,
        args: [
          "-e",
          "require('node:fs').writeFileSync('must-not-exist.txt','bad')",
        ],
        stateDir,
        lockDir,
      }),
    ).rejects.toMatchObject({
      code: "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED",
      managedTransactionResult: expect.objectContaining({
        ok: false,
        state: "rolled_back",
        outcome: "rolled_back",
      }),
    });
    expect(fs.existsSync(marker)).toBe(false);
    expect(broker.spawnOptions[0].options.requiredBoundaries).toEqual([
      "process-tree",
    ]);
  });

  it("waits for the Broker's spawned-process close proof before attempting rollback", async () => {
    let closeProcess;
    const workspaceProcessClosed = new Promise((resolve) => {
      closeProcess = resolve;
    });
    const rollback = vi.fn(() => ({
      outcome: "rolled_back",
      evidenceDigest: digest("a"),
      coverage: "partial",
      fileCoverage: "partial",
      externalSideEffects: true,
      uncoveredPaths: [],
    }));
    const transaction = {
      id: "wcp-post-spawn-failure",
      checkpointId: "checkpoint-wcp-post-spawn-failure",
      snapshot: vi.fn(() => ({
        id: "wcp-post-spawn-failure",
        state: "rolled_back",
        coverage: "partial",
        fileCoverage: "partial",
        externalSideEffects: true,
        uncoveredPaths: [],
      })),
      rollback,
    };
    const spawnError = Object.assign(
      new Error("post-spawn process-tree boundary failed"),
      {
        code: "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED",
        workspaceProcessClosed,
        workspaceTerminationRequested: true,
      },
    );
    const broker = {
      beginWorkspaceTransaction: vi.fn(() => transaction),
      spawn: vi.fn(() => {
        throw spawnError;
      }),
    };

    const running = runManagedWorkspaceCommand({
      broker,
      workspaceRoot: workspace,
      command: process.execPath,
      args: ["-e", "process.exit(0)"],
      stateDir,
      lockDir,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(rollback).not.toHaveBeenCalled();

    closeProcess();
    await expect(running).rejects.toMatchObject({
      code: "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED",
      managedTransactionResult: expect.objectContaining({
        state: "rolled_back",
      }),
    });
    expect(rollback).toHaveBeenCalledOnce();
  });
});

describe("managed checkpoint Commander surface", () => {
  let priorExitCode;

  beforeEach(() => {
    priorExitCode = process.exitCode;
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = priorExitCode;
  });

  it(
    "is registered by the real checkpoint manifest and preserves literal run tokens after `--`",
    { timeout: 30_000 },
    async () => {
      const { createProgram } = await import("../../src/index.js");
      const program = createProgram({
        allowedCommands: new Set(["checkpoint"]),
      });
      program.exitOverride();
      program.configureOutput({
        writeOut: () => {},
        writeErr: () => {},
      });
      const checkpoint = program.commands.find(
        (command) => command.name() === "checkpoint",
      );
      const managed = checkpoint?.commands.find(
        (command) => command.name() === "managed",
      );
      const run = managed?.commands.find((command) => command.name() === "run");

      expect(checkpoint).toBeTruthy();
      expect(managed).toBeTruthy();
      expect(managed.commands.map((command) => command.name()).sort()).toEqual([
        "list",
        "restore",
        "run",
        "show",
        "undo",
      ]);
      expect(managed.helpInformation()).toMatch(
        /run.*literal foreground command/is,
      );
      expect(run.helpInformation()).toContain("--background");
      expect(run.helpInformation()).toContain(
        "Managed transaction state directory",
      );

      const parsed = vi.fn();
      run.action(parsed);
      const script = "process.stdout.write('literal -- token')";
      await program.parseAsync([
        "node",
        "cc",
        "checkpoint",
        "managed",
        "run",
        "--json",
        "--",
        process.execPath,
        "-e",
        script,
      ]);
      expect(parsed).toHaveBeenCalledOnce();
      expect(parsed.mock.calls[0][0]).toEqual([process.execPath, "-e", script]);
      expect(parsed.mock.calls[0][1]).toMatchObject({
        json: true,
        dir: ".",
        taskKey: "managed-command",
      });
    },
  );

  it("emits JSON list records with machine-readable coverage warnings", async () => {
    const manager = { list: vi.fn(() => [state()]) };
    const { program, output } = commandHarness(manager);

    await program.parseAsync([
      "node",
      "cc",
      "checkpoint",
      "managed",
      "list",
      "--json",
    ]);

    expect(output.json).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "wcp-test",
        coverage: "partial",
        warnings: expect.arrayContaining([
          expect.stringMatching(/full side-effect rollback/),
        ]),
      }),
    ]);
    expect(process.exitCode).toBeUndefined();
  });

  it("requires separate non-interactive approval and never treats force as approval", async () => {
    const manager = { restore: vi.fn() };
    const { program, output } = commandHarness(manager);

    await program.parseAsync([
      "node",
      "cc",
      "checkpoint",
      "managed",
      "restore",
      "wcp-test",
      "--expected-evidence-digest",
      digest("c"),
      "--force",
    ]);

    expect(manager.restore).not.toHaveBeenCalled();
    expect(output.error).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "MANAGED_CHECKPOINT_CONFIRMATION_REQUIRED",
      }),
      false,
    );
    expect(process.exitCode).toBe(1);
  });

  it("passes --force only after --yes and exact evidence authority", async () => {
    const manager = {
      restore: vi.fn(() => ({
        outcome: "restored",
        forced: true,
        fileCoverage: "partial",
        uncoveredPaths: [".git"],
        evidenceDigest: digest("e"),
        safetyCheckpoint: {
          id: "safety-1",
          digest: digest("a"),
        },
      })),
    };
    const { program, output } = commandHarness(manager);

    await program.parseAsync([
      "node",
      "cc",
      "checkpoint",
      "managed",
      "restore",
      "wcp-test",
      "--expected-evidence-digest",
      digest("c"),
      "--force",
      "--yes",
      "--json",
    ]);

    expect(manager.restore).toHaveBeenCalledWith("wcp-test", {
      expectedEvidenceDigest: digest("c"),
      force: true,
    });
    expect(output.json).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        forced: true,
        restoreEvidenceDigest: digest("e"),
        fileCoverage: "partial",
        uncoveredPaths: [".git"],
      }),
    );
    expect(process.exitCode).toBeUndefined();
  });

  it("reports a core evidence mismatch as JSON and does not claim success", async () => {
    const mismatch = Object.assign(
      new Error("explicit restore must bind the committed evidence digest"),
      {
        code: "WORKSPACE_TRANSACTION_EVIDENCE_MISMATCH",
        transactionId: "wcp-test",
        expectedEvidenceDigest: digest("d"),
        actualEvidenceDigest: digest("c"),
      },
    );
    const manager = {
      restore: vi.fn(() => {
        throw mismatch;
      }),
    };
    const { program, output } = commandHarness(manager);

    await program.parseAsync([
      "node",
      "cc",
      "checkpoint",
      "managed",
      "restore",
      "wcp-test",
      "--expected-evidence-digest",
      digest("d"),
      "--force",
      "--yes",
      "--json",
    ]);

    expect(output.json).not.toHaveBeenCalled();
    expect(output.error).toHaveBeenCalledWith(mismatch, true);
    expect(process.exitCode).toBe(1);
  });

  it("supports an explicit interactive abort without constructing a manager", async () => {
    const managerFactory = vi.fn();
    const confirm = vi.fn(async () => false);
    const output = outputRecorder();
    const program = new Command();
    program.exitOverride();
    program.configureOutput({
      writeOut: () => {},
      writeErr: () => {},
    });
    const checkpoint = program.command("checkpoint");
    registerManagedCheckpointCommands(checkpoint, {
      managerFactory,
      output,
      isTTY: true,
      confirm,
    });

    await program.parseAsync([
      "node",
      "cc",
      "checkpoint",
      "managed",
      "undo",
      "wcp-test",
      "--expected-restore-evidence-digest",
      digest("e"),
    ]);

    expect(confirm).toHaveBeenCalledOnce();
    expect(managerFactory).not.toHaveBeenCalled();
    expect(output.line).toHaveBeenCalledWith("Aborted.");
    expect(process.exitCode).toBeUndefined();
  });
});

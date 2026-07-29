import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  WORKSPACE_TRANSACTION_COVERAGE,
  WORKSPACE_TRANSACTION_ERROR,
  WORKSPACE_TRANSACTION_STATE,
  WorkspaceTransactionManager,
} from "../../src/lib/process-execution-broker/workspace-transaction.js";

const roots = [];

function fixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-workspace-transaction-adversarial-"),
  );
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const stateDir = path.join(root, "state");
  const lockDir = path.join(root, "locks");
  fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceRoot, "src", "tracked.txt"),
    "baseline\n",
  );
  return { root, workspaceRoot, stateDir, lockDir };
}

function manager(input, overrides = {}) {
  let sequence = 0;
  return new WorkspaceTransactionManager({
    stateDir: input.stateDir,
    lockDir: input.lockDir,
    allowNonCanonicalLockDirForTests: true,
    uuid: () =>
      `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    ownerToken: () =>
      `10000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    ...overrides,
  });
}

function begin(runtime, input, overrides = {}) {
  return runtime.begin({
    id: `wcp-adversarial-${Math.random().toString(16).slice(2)}`,
    runId: "adversarial-run",
    taskKey: "adversarial-task",
    workspaceRoot: input.workspaceRoot,
    coverageTarget: WORKSPACE_TRANSACTION_COVERAGE.FULL,
    writerIsolation: "exclusive-workspace",
    externalSideEffects: false,
    ...overrides,
  });
}

function audit(input, overrides = {}) {
  return {
    executionId: `exec-${Math.random().toString(16).slice(2)}`,
    cwd: input.workspaceRoot,
    origin: "adversarial:test",
    scope: "team",
    command: "node",
    args: [],
    detached: false,
    sandboxGuarantees: ["process-tree"],
    ...overrides,
  };
}

function fakeProcess(pid = 41_001) {
  const proc = new EventEmitter();
  proc.pid = pid;
  return proc;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("workspace transaction adversarial safety", () => {
  it("rejects caller-selected production lock authorities", () => {
    const input = fixture();
    expect(
      () =>
        new WorkspaceTransactionManager({
          stateDir: input.stateDir,
          lockDir: input.lockDir,
        }),
    ).toThrow(
      expect.objectContaining({
        code: WORKSPACE_TRANSACTION_ERROR.INVALID_ARGUMENT,
      }),
    );
    expect(fs.existsSync(input.lockDir)).toBe(false);
  });

  it("rejects a lock registry that overlaps the workspace before creating it", () => {
    const input = fixture();
    input.lockDir = path.join(input.workspaceRoot, ".transaction-locks");
    const runtime = manager(input);

    expect(() => begin(runtime, input)).toThrow(
      expect.objectContaining({
        code: WORKSPACE_TRANSACTION_ERROR.INVALID_PATH,
      }),
    );
    expect(fs.existsSync(input.lockDir)).toBe(false);
    expect(fs.readdirSync(input.workspaceRoot).sort()).toEqual(["src"]);
  });

  it("pins the workspace root identity and never restores into a replacement", () => {
    const input = fixture();
    const runtime = manager(input);
    const transaction = begin(runtime, input);
    const originalRoot = path.join(input.root, "workspace-original");

    fs.renameSync(input.workspaceRoot, originalRoot);
    fs.mkdirSync(input.workspaceRoot);

    expect(() => transaction.rollback({ reason: "root replaced" })).toThrow(
      expect.objectContaining({
        code: WORKSPACE_TRANSACTION_ERROR.ROLLBACK_FAILED,
        cause: expect.objectContaining({
          code: WORKSPACE_TRANSACTION_ERROR.SNAPSHOT_RACE,
        }),
      }),
    );
    expect(fs.readdirSync(input.workspaceRoot)).toEqual([]);
    expect(
      fs.readFileSync(path.join(originalRoot, "src", "tracked.txt"), "utf8"),
    ).toBe("baseline\n");
    expect(transaction.snapshot()).toMatchObject({
      state: WORKSPACE_TRANSACTION_STATE.ROLLBACK_FAILED,
      workspaceRootIdentity: {
        dev: expect.any(String),
        ino: expect.any(String),
      },
    });
  });

  it("captures and restores file, directory, and workspace-root mtimes", () => {
    const input = fixture();
    const target = path.join(input.workspaceRoot, "src", "tracked.txt");
    const directory = path.dirname(target);
    const baselineTime = new Date("2020-01-02T03:04:05.000Z");
    const changedTime = new Date("2025-06-07T08:09:10.000Z");
    fs.utimesSync(target, baselineTime, baselineTime);
    fs.utimesSync(directory, baselineTime, baselineTime);
    fs.utimesSync(input.workspaceRoot, baselineTime, baselineTime);

    const runtime = manager(input);
    const transaction = begin(runtime, input);
    fs.utimesSync(target, changedTime, changedTime);
    fs.utimesSync(directory, changedTime, changedTime);
    fs.utimesSync(input.workspaceRoot, changedTime, changedTime);

    expect(
      transaction.rollback({ reason: "metadata-only mutation" }),
    ).toMatchObject({
      outcome: "rolled_back",
      fileCoverage: WORKSPACE_TRANSACTION_COVERAGE.FULL,
    });
    expect(Math.trunc(fs.statSync(target).mtimeMs)).toBe(
      baselineTime.getTime(),
    );
    expect(Math.trunc(fs.statSync(directory).mtimeMs)).toBe(
      baselineTime.getTime(),
    );
    expect(Math.trunc(fs.statSync(input.workspaceRoot).mtimeMs)).toBe(
      baselineTime.getTime(),
    );

    const writes = JSON.parse(
      fs.readFileSync(
        path.join(
          input.stateDir,
          "transactions",
          transaction.id,
          "writes.json",
        ),
        "utf8",
      ),
    );
    expect(writes.writes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ".", operation: "modified" }),
        expect.objectContaining({ path: "src", operation: "modified" }),
        expect.objectContaining({
          path: "src/tracked.txt",
          operation: "modified",
        }),
      ]),
    );
  });

  it.each([
    {
      name: "ordinary Git directory",
      install(input) {
        fs.mkdirSync(path.join(input.workspaceRoot, ".git"));
        fs.writeFileSync(
          path.join(input.workspaceRoot, ".git", "HEAD"),
          "ref: refs/heads/main\n",
        );
      },
      uncovered: [".git"],
    },
    {
      name: "linked-worktree Git file",
      install(input) {
        const externalGit = path.join(input.root, "external-git");
        fs.mkdirSync(externalGit);
        fs.writeFileSync(path.join(externalGit, "HEAD"), "linked\n");
        fs.writeFileSync(
          path.join(input.workspaceRoot, ".git"),
          `gitdir: ${externalGit}\n`,
        );
      },
      uncovered: [".git", "@external-git-metadata"],
    },
  ])(
    "rejects FULL and reports explicit PARTIAL gaps for $name",
    ({ install, uncovered }) => {
      const input = fixture();
      install(input);
      const runtime = manager(input);

      expect(() => begin(runtime, input)).toThrow(
        expect.objectContaining({
          code: WORKSPACE_TRANSACTION_ERROR.WRITER_ISOLATION_REQUIRED,
        }),
      );

      const partial = begin(runtime, input, {
        coverageTarget: WORKSPACE_TRANSACTION_COVERAGE.PARTIAL,
        writerIsolation: "unknown",
      });
      expect(partial.accept()).toMatchObject({
        fileCoverage: WORKSPACE_TRANSACTION_COVERAGE.PARTIAL,
        coverage: WORKSPACE_TRANSACTION_COVERAGE.PARTIAL,
        exclusions: [".git"],
        uncoveredPaths: uncovered,
      });
    },
  );

  it("binds explicit restore/undo to evidence and preserves forced-overwrite safety", () => {
    const input = fixture();
    const runtime = manager(input);
    const transaction = begin(runtime, input);
    const target = path.join(input.workspaceRoot, "src", "tracked.txt");
    fs.writeFileSync(target, "committed\n");
    const committed = transaction.accept();

    expect(() =>
      runtime.restore(transaction.id, {
        expectedEvidenceDigest: "sha256:untrusted",
      }),
    ).toThrow(
      expect.objectContaining({
        code: WORKSPACE_TRANSACTION_ERROR.EVIDENCE_MISMATCH,
      }),
    );

    fs.writeFileSync(target, "post-commit-user-edit\n");
    expect(() =>
      runtime.restore(transaction.id, {
        expectedEvidenceDigest: committed.evidenceDigest,
      }),
    ).toThrow(
      expect.objectContaining({
        code: WORKSPACE_TRANSACTION_ERROR.RESTORE_CONFLICT,
      }),
    );
    expect(fs.readFileSync(target, "utf8")).toBe("post-commit-user-edit\n");

    const restored = runtime.restore(transaction.id, {
      expectedEvidenceDigest: committed.evidenceDigest,
      force: true,
      reason: "confirmed destructive rewind",
    });
    expect(restored).toMatchObject({
      outcome: "restored",
      sourceEvidenceDigest: committed.evidenceDigest,
      forced: true,
      safetyCheckpoint: {
        id: expect.stringMatching(/^safety-/),
        digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        path: expect.stringMatching(
          /^restores\/restore-[^/]+\/baseline\.json$/,
        ),
      },
    });
    expect(fs.readFileSync(target, "utf8")).toBe("baseline\n");

    expect(() =>
      runtime.undoRestore(transaction.id, {
        expectedRestoreEvidenceDigest: "sha256:untrusted",
      }),
    ).toThrow(
      expect.objectContaining({
        code: WORKSPACE_TRANSACTION_ERROR.EVIDENCE_MISMATCH,
      }),
    );

    fs.writeFileSync(target, "post-restore-user-edit\n");
    expect(() =>
      runtime.undoRestore(transaction.id, {
        expectedRestoreEvidenceDigest: restored.evidenceDigest,
      }),
    ).toThrow(
      expect.objectContaining({
        code: WORKSPACE_TRANSACTION_ERROR.RESTORE_CONFLICT,
      }),
    );
    expect(fs.readFileSync(target, "utf8")).toBe("post-restore-user-edit\n");

    const undone = runtime.undoRestore(transaction.id, {
      expectedRestoreEvidenceDigest: restored.evidenceDigest,
      force: true,
      reason: "confirmed undo",
    });
    expect(undone).toMatchObject({
      outcome: "restore_undone",
      sourceRestoreEvidenceDigest: restored.evidenceDigest,
      safetyCheckpointId: restored.safetyCheckpoint.id,
      safetyCheckpointDigest: restored.safetyCheckpoint.digest,
      forced: true,
    });
    expect(fs.readFileSync(target, "utf8")).toBe("post-commit-user-edit\n");
    expect(
      runtime.undoRestore(transaction.id, {
        expectedRestoreEvidenceDigest: restored.evidenceDigest,
      }),
    ).toEqual(undone);
  });

  it.each(["accept", "rollback"])(
    "does not %s on child exit; close fences a late write",
    (operation) => {
      const input = fixture();
      const runtime = manager(input);
      const transaction = begin(runtime, input, {
        coverageTarget: WORKSPACE_TRANSACTION_COVERAGE.PARTIAL,
        writerIsolation: "unknown",
      });
      const entry = audit(input);
      const proc = fakeProcess();
      runtime.prepareSpawn(entry);
      runtime.bindProcess(entry, proc);

      proc.emit("exit", 0, null);
      fs.writeFileSync(
        path.join(input.workspaceRoot, "src", "late.txt"),
        "late-after-exit-before-close\n",
      );

      expect(() => transaction[operation]()).toThrow(
        expect.objectContaining({
          code: WORKSPACE_TRANSACTION_ERROR.WRITERS_ACTIVE,
        }),
      );
      expect(
        fs.readFileSync(
          path.join(input.workspaceRoot, "src", "late.txt"),
          "utf8",
        ),
      ).toBe("late-after-exit-before-close\n");

      proc.emit("close", 0, null);
      const rolledBack = transaction.rollback({
        reason: "close fence observed",
      });
      expect(rolledBack.outcome).toBe("rolled_back");
      expect(
        fs.existsSync(path.join(input.workspaceRoot, "src", "late.txt")),
      ).toBe(false);
    },
  );

  it.each(["accept", "rollback"])(
    "keeps %s unavailable when process-tree closure is unproven",
    (operation) => {
      const input = fixture();
      const runtime = manager(input);
      const transaction = begin(runtime, input, {
        coverageTarget: WORKSPACE_TRANSACTION_COVERAGE.PARTIAL,
        writerIsolation: "unknown",
      });
      const entry = audit(input, { sandboxGuarantees: [] });
      const proc = fakeProcess();
      runtime.prepareSpawn(entry);
      runtime.bindProcess(entry, proc);
      proc.emit("close", 0, null);

      expect(() => transaction[operation]()).toThrow(
        expect.objectContaining({
          code: WORKSPACE_TRANSACTION_ERROR.WRITERS_ACTIVE,
        }),
      );
      expect(transaction.snapshot()).toMatchObject({
        state: WORKSPACE_TRANSACTION_STATE.ROLLBACK_REQUIRED,
        fileCoverage: WORKSPACE_TRANSACTION_COVERAGE.NONE,
        coverage: WORKSPACE_TRANSACTION_COVERAGE.NONE,
        executions: [
          expect.objectContaining({
            status: "settled",
            treeGuarantee: "unproven",
          }),
        ],
      });
    },
  );

  it("rejects detached writers and cross-manager nested workspace claims", () => {
    const input = fixture();
    const first = manager(input);
    const parent = begin(first, input, {
      coverageTarget: WORKSPACE_TRANSACTION_COVERAGE.PARTIAL,
      writerIsolation: "unknown",
    });
    expect(() => first.prepareSpawn(audit(input, { detached: true }))).toThrow(
      expect.objectContaining({
        code: WORKSPACE_TRANSACTION_ERROR.DETACHED_PROCESS,
      }),
    );

    const nested = {
      ...input,
      workspaceRoot: path.join(input.workspaceRoot, "src"),
      stateDir: path.join(input.root, "nested-state"),
    };
    expect(() =>
      begin(manager(nested), nested, {
        coverageTarget: WORKSPACE_TRANSACTION_COVERAGE.PARTIAL,
        writerIsolation: "unknown",
      }),
    ).toThrow(
      expect.objectContaining({
        code: WORKSPACE_TRANSACTION_ERROR.OVERLAPPING_WORKSPACE,
        ownerTransactionId: parent.id,
      }),
    );
    parent.rollback();
  });

  it("leaves a crashed transaction with an unsettled child for manual recovery", () => {
    const input = fixture();
    const owner = manager(input, { isProcessAlive: () => true });
    const transaction = begin(owner, input, {
      coverageTarget: WORKSPACE_TRANSACTION_COVERAGE.PARTIAL,
      writerIsolation: "unknown",
    });
    const entry = audit(input);
    owner.prepareSpawn(entry);
    owner.bindProcess(entry, fakeProcess());
    const target = path.join(input.workspaceRoot, "src", "tracked.txt");
    fs.writeFileSync(target, "possibly-still-writing\n");

    const recovery = manager(input, { isProcessAlive: () => false });
    expect(
      recovery.recoverPending({ workspaceRoot: input.workspaceRoot }),
    ).toEqual([
      expect.objectContaining({
        id: transaction.id,
        status: "recovery_required",
        code: WORKSPACE_TRANSACTION_ERROR.WRITERS_ACTIVE,
        fileCoverage: WORKSPACE_TRANSACTION_COVERAGE.NONE,
        manualRecoveryRequired: true,
        executions: [
          expect.objectContaining({
            executionId: entry.executionId,
            status: "running",
          }),
        ],
      }),
    ]);
    expect(fs.readFileSync(target, "utf8")).toBe("possibly-still-writing\n");
  });

  it("fails closed before authorization when maxEntries is exhausted", () => {
    const input = fixture();
    fs.writeFileSync(path.join(input.workspaceRoot, "one.txt"), "1\n");
    fs.writeFileSync(path.join(input.workspaceRoot, "two.txt"), "2\n");
    const runtime = manager(input);

    expect(() =>
      begin(runtime, input, {
        limits: {
          maxEntries: 2,
          maxFiles: 2,
          maxTotalBytes: 1024,
          maxFileBytes: 1024,
          maxManifestBytes: 1024 * 1024,
          maxProcesses: 8,
          maxFailureEvidence: 8,
        },
      }),
    ).toThrow(
      expect.objectContaining({
        code: WORKSPACE_TRANSACTION_ERROR.RESOURCE_LIMIT,
      }),
    );
    expect(runtime._active.size).toBe(0);
    expect(
      fs
        .readdirSync(input.lockDir)
        .filter((name) => name !== "coordination.lock"),
    ).toEqual([]);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  WORKSPACE_TRANSACTION_COVERAGE,
  WORKSPACE_TRANSACTION_ERROR,
  WORKSPACE_TRANSACTION_STATE,
  WorkspaceTransactionManager,
  digestWorkspaceEvidence,
  inspectWorkspaceLockOwnerSync,
  withWorkspaceLockSync,
  withWorkspaceRecoveryLockSync,
} from "../../src/lib/process-execution-broker/workspace-transaction.js";

const roots = [];

function fixture({ git = false } = {}) {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "cc-workspace-transaction-")),
  );
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const stateDir = path.join(root, "state");
  fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceRoot, ".gitignore"),
    "*.ignored\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(workspaceRoot, "src", "before.txt"),
    "before\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(workspaceRoot, "cache.ignored"),
    "ignored-before\n",
    "utf8",
  );
  if (git) {
    fs.mkdirSync(path.join(workspaceRoot, ".git"), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, ".git", "metadata"),
      "git-metadata\n",
      "utf8",
    );
  }
  return { root, workspaceRoot, stateDir };
}

function manager(input, overrides = {}) {
  let now = overrides.startAt || Date.UTC(2026, 6, 29);
  let sequence = 0;
  return new WorkspaceTransactionManager({
    stateDir: input.stateDir,
    lockDir: path.join(input.root, "locks"),
    allowNonCanonicalLockDirForTests: true,
    now: () => now++,
    uuid: () =>
      `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    ownerToken: () =>
      `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    ...overrides,
  });
}

function begin(input, overrides = {}) {
  return manager(input).begin({
    runId: "run-1",
    taskKey: "task-1",
    workspaceRoot: input.workspaceRoot,
    coverageTarget: WORKSPACE_TRANSACTION_COVERAGE.FULL,
    writerIsolation: "exclusive-workspace",
    ...overrides,
  });
}

function workspaceLockOptions(input, overrides = {}) {
  let now = 1_000;
  return {
    workspaceRoot: input.workspaceRoot,
    operationId: "checkpoint-operation",
    purpose: "checkpoint-restore",
    timeoutMs: 50,
    retryMs: 10,
    lockDir: path.join(input.root, "locks"),
    allowNonCanonicalLockDirForTests: true,
    _now: () => now,
    _sleep: (milliseconds) => {
      now += milliseconds;
    },
    _isProcessAlive: () => true,
    _ownerToken: ownerTokenSequence("20000000"),
    ...overrides,
  };
}

function ownerTokenSequence(prefix) {
  let sequence = 0;
  return () =>
    `${prefix}-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
}

function workspaceLockEntries(input) {
  const lockDir = path.join(input.root, "locks");
  return fs.existsSync(lockDir) ? fs.readdirSync(lockDir).sort() : [];
}

function workspaceOwnerPath(input) {
  const entries = workspaceLockEntries(input).filter(
    (name) => name !== "coordination.lock",
  );
  expect(entries).toHaveLength(1);
  return path.join(input.root, "locks", entries[0], "owner.json");
}

function workspaceLockName(workspaceRoot) {
  const resolved = path.resolve(workspaceRoot);
  const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  return createHash("sha256").update(Buffer.from(key, "utf8")).digest("hex");
}

function captureThrown(callback) {
  try {
    callback();
  } catch (error) {
    return error;
  }
  return null;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("withWorkspaceLockSync", () => {
  it("holds a canonical lifetime lease and releases after success or callback failure", () => {
    const input = fixture();
    let observedLease = null;

    expect(
      withWorkspaceLockSync(workspaceLockOptions(input), (lease) => {
        observedLease = lease;
        expect(lease.canonicalWorkspaceRoot).toBe(
          fs.realpathSync.native(input.workspaceRoot),
        );
        expect(lease.owner).toMatchObject({
          transactionId: "checkpoint-operation",
          purpose: "checkpoint-restore",
          workspaceRoot: lease.canonicalWorkspaceRoot,
        });
        expect(Object.isFrozen(lease)).toBe(true);
        expect(Object.isFrozen(lease.owner)).toBe(true);
        expect(lease.assertOwned()).toBe(true);
        expect(workspaceLockEntries(input)).toHaveLength(1);
        return "completed";
      }),
    ).toBe("completed");
    expect(observedLease.assertOwned).toThrow(
      expect.objectContaining({
        code: WORKSPACE_TRANSACTION_ERROR.LOCK_OWNERSHIP_LOST,
      }),
    );
    expect(workspaceLockEntries(input)).toEqual([]);

    const callbackError = new Error("callback failed");
    let thrown = null;
    try {
      withWorkspaceLockSync(
        workspaceLockOptions(input, { operationId: "callback-failure" }),
        () => {
          throw callbackError;
        },
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(callbackError);
    expect(workspaceLockEntries(input)).toEqual([]);
  });

  it("rejects async callbacks and arbitrary thenables without reporting success", () => {
    const input = fixture();
    let asyncRan = false;

    expect(() =>
      withWorkspaceLockSync(workspaceLockOptions(input), async () => {
        asyncRan = true;
      }),
    ).toThrow(
      expect.objectContaining({
        code: WORKSPACE_TRANSACTION_ERROR.INVALID_ARGUMENT,
      }),
    );
    expect(asyncRan).toBe(false);
    expect(workspaceLockEntries(input)).toEqual([]);

    let thenableReturned = false;
    expect(() =>
      withWorkspaceLockSync(
        workspaceLockOptions(input, { operationId: "thenable-result" }),
        () => {
          thenableReturned = true;
          return { then() {} };
        },
      ),
    ).toThrow(
      expect.objectContaining({
        code: WORKSPACE_TRANSACTION_ERROR.INVALID_ARGUMENT,
      }),
    );
    expect(thenableReturned).toBe(true);
    expect(workspaceLockEntries(input)).toEqual([]);
  });

  it("times out on a live overlapping manager lease without holding coordination", () => {
    const input = fixture();
    const transaction = begin(input, { id: "wcp-live-owner" });
    let now = 2_000;
    let slept = 0;

    expect(() =>
      withWorkspaceLockSync(
        workspaceLockOptions(input, {
          workspaceRoot: path.join(input.workspaceRoot, "src"),
          operationId: "overlap-contender",
          timeoutMs: 25,
          retryMs: 10,
          _now: () => now,
          _sleep: (milliseconds) => {
            now += milliseconds;
            slept += milliseconds;
          },
        }),
        () => "unreachable",
      ),
    ).toThrow(
      expect.objectContaining({
        code: WORKSPACE_TRANSACTION_ERROR.WORKSPACE_LOCK_TIMEOUT,
        ownerOperationId: transaction.id,
        ownerWorkspaceRoot: fs.realpathSync.native(input.workspaceRoot),
      }),
    );
    expect(slept).toBe(25);
    expect(workspaceLockEntries(input)).toHaveLength(1);
    transaction.rollback();
    expect(workspaceLockEntries(input)).toEqual([]);
  });

  it("fails closed for dead or corrupt owners without reclaiming them", () => {
    const input = fixture();
    const transaction = begin(input, { id: "wcp-recovery-owner" });
    const ownerPath = workspaceOwnerPath(input);
    const originalOwner = fs.readFileSync(ownerPath, "utf8");

    expect(() =>
      withWorkspaceLockSync(
        workspaceLockOptions(input, {
          operationId: "dead-owner-contender",
          _isProcessAlive: () => false,
        }),
        () => "unreachable",
      ),
    ).toThrow(
      expect.objectContaining({
        code: WORKSPACE_TRANSACTION_ERROR.RECOVERY_REQUIRED,
        ownerTransactionId: transaction.id,
      }),
    );
    expect(fs.readFileSync(ownerPath, "utf8")).toBe(originalOwner);

    fs.writeFileSync(ownerPath, "{corrupt", { mode: 0o600 });
    expect(() =>
      withWorkspaceLockSync(
        workspaceLockOptions(input, {
          operationId: "corrupt-owner-contender",
        }),
        () => "unreachable",
      ),
    ).toThrow(
      expect.objectContaining({
        code: WORKSPACE_TRANSACTION_ERROR.LOCK_CORRUPT,
      }),
    );
    expect(fs.readFileSync(ownerPath, "utf8")).toBe("{corrupt");

    fs.writeFileSync(ownerPath, originalOwner, { mode: 0o600 });
    transaction.rollback();
  });

  it("surfaces exact ownership loss even when the callback also throws", () => {
    const input = fixture();
    const callbackError = new Error("body failed after ownership loss");
    let thrown = null;

    try {
      withWorkspaceLockSync(
        workspaceLockOptions(input, { operationId: "ownership-loss" }),
        () => {
          const ownerPath = workspaceOwnerPath(input);
          const owner = JSON.parse(fs.readFileSync(ownerPath, "utf8"));
          owner.token = "90000000-0000-4000-8000-999999999999";
          fs.writeFileSync(ownerPath, JSON.stringify(owner), { mode: 0o600 });
          throw callbackError;
        },
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      code: WORKSPACE_TRANSACTION_ERROR.LOCK_OWNERSHIP_LOST,
      callbackError,
    });
  });

  it("rejects filesystem roots and workspace aliases before lock creation", () => {
    const input = fixture();
    expect(() =>
      withWorkspaceLockSync(
        workspaceLockOptions(input, {
          workspaceRoot: path.parse(input.workspaceRoot).root,
        }),
        () => "unreachable",
      ),
    ).toThrow(
      expect.objectContaining({
        code: WORKSPACE_TRANSACTION_ERROR.INVALID_PATH,
      }),
    );

    const alias = path.join(input.root, "workspace-alias");
    fs.symlinkSync(
      input.workspaceRoot,
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(() =>
      withWorkspaceLockSync(
        workspaceLockOptions(input, { workspaceRoot: alias }),
        () => "unreachable",
      ),
    ).toThrow(
      expect.objectContaining({
        code: expect.stringMatching(
          /WORKSPACE_TRANSACTION_(?:UNSAFE_ENTRY|PATH_ESCAPE)/,
        ),
      }),
    );
    expect(workspaceLockEntries(input)).toEqual([]);
  });

  it("retains only an exact private recovery request and exposes a safe owner observation", () => {
    const input = fixture();
    expect(() =>
      withWorkspaceLockSync(
        workspaceLockOptions(input, {
          operationId: "wrong-retention-purpose",
          purpose: "workspace-transaction",
        }),
        (lease) => lease.retainForRecovery("not a checkpoint restore"),
      ),
    ).toThrow(
      expect.objectContaining({
        code: WORKSPACE_TRANSACTION_ERROR.INVALID_ARGUMENT,
      }),
    );
    expect(workspaceLockEntries(input)).toEqual([]);

    const caughtResult = withWorkspaceLockSync(
      workspaceLockOptions(input, { operationId: "caught-retention" }),
      (lease) => {
        try {
          lease.retainForRecovery("caught by callback");
        } catch {
          // A caught request is not allowed to retain the lock.
        }
        return "released";
      },
    );
    expect(caughtResult).toBe("released");
    expect(workspaceLockEntries(input)).toEqual([]);

    const forged = Object.assign(new Error("forged recovery"), {
      code: WORKSPACE_TRANSACTION_ERROR.RECOVERY_REQUIRED,
    });
    const forgedResult = captureThrown(() =>
      withWorkspaceLockSync(
        workspaceLockOptions(input, { operationId: "forged-retention" }),
        (lease) => {
          try {
            lease.retainForRecovery("request that will be replaced");
          } catch {
            throw forged;
          }
        },
      ),
    );
    expect(forgedResult).toBe(forged);
    expect(workspaceLockEntries(input)).toEqual([]);

    const thenableResult = captureThrown(() =>
      withWorkspaceLockSync(
        workspaceLockOptions(input, { operationId: "caught-thenable" }),
        (lease) => {
          try {
            lease.retainForRecovery("thenable must not retain");
          } catch {
            return { then() {} };
          }
        },
      ),
    );
    expect(thenableResult).toMatchObject({
      code: WORKSPACE_TRANSACTION_ERROR.INVALID_ARGUMENT,
    });
    expect(workspaceLockEntries(input)).toEqual([]);

    const operationId = "checkpoint-saga-retained";
    const retained = captureThrown(() =>
      withWorkspaceLockSync(
        workspaceLockOptions(input, { operationId }),
        (lease) => lease.retainForRecovery("mutation may be partial"),
      ),
    );
    expect(retained).toMatchObject({
      code: WORKSPACE_TRANSACTION_ERROR.RECOVERY_REQUIRED,
      operationId,
      retentionReason: "mutation may be partial",
      workspaceLockRetained: true,
      recoveryOfOperationId: operationId,
      priorOwner: null,
      retainedOwner: {
        transactionId: operationId,
        purpose: "checkpoint-restore",
      },
    });
    expect(Object.isFrozen(retained.retainedOwner)).toBe(true);
    expect(workspaceLockEntries(input)).toHaveLength(1);

    const observed = inspectWorkspaceLockOwnerSync(
      workspaceLockOptions(input, {
        operationId,
        purpose: "checkpoint-restore",
      }),
    );
    expect(observed).toEqual(retained.retainedOwner);
    expect(Object.isFrozen(observed)).toBe(true);
    expect(
      captureThrown(() =>
        inspectWorkspaceLockOwnerSync(
          workspaceLockOptions(input, {
            operationId: "different-saga",
            purpose: "checkpoint-restore",
          }),
        ),
      ),
    ).toMatchObject({
      code: WORKSPACE_TRANSACTION_ERROR.RECOVERY_REQUIRED,
      ownerOperationId: operationId,
    });

    let recoveryLease = null;
    expect(
      withWorkspaceRecoveryLockSync(
        workspaceLockOptions(input, {
          operationId,
          purpose: "checkpoint-restore",
          expectedOwner: observed,
          _isProcessAlive: () => false,
          _ownerToken: ownerTokenSequence("30000000"),
        }),
        (lease) => {
          recoveryLease = lease;
          expect(lease.priorOwner).toEqual(observed);
          expect(lease.recoveryOfOperationId).toBe(operationId);
          expect(lease.owner).toMatchObject({
            transactionId: operationId,
            purpose: "checkpoint-restore",
          });
          expect(lease.owner.token).not.toBe(observed.token);
          expect(lease.assertOwned()).toBe(true);
          return "recovered";
        },
      ),
    ).toBe("recovered");
    expect(recoveryLease.assertOwned).toThrow(
      expect.objectContaining({
        code: WORKSPACE_TRANSACTION_ERROR.LOCK_OWNERSHIP_LOST,
      }),
    );
    expect(workspaceLockEntries(input)).toEqual([]);
  });

  it("recovery rejects async work and can itself retain an exact resumable owner", () => {
    const input = fixture();
    const operationId = "checkpoint-recovery-retained";
    const initial = captureThrown(() =>
      withWorkspaceLockSync(
        workspaceLockOptions(input, { operationId }),
        (lease) => lease.retainForRecovery("initial process crashed"),
      ),
    );
    const initialOwner = initial.retainedOwner;

    let asyncRan = false;
    expect(() =>
      withWorkspaceRecoveryLockSync(
        workspaceLockOptions(input, {
          operationId,
          expectedOwner: initialOwner,
          _isProcessAlive: () => false,
        }),
        async () => {
          asyncRan = true;
        },
      ),
    ).toThrow(
      expect.objectContaining({
        code: WORKSPACE_TRANSACTION_ERROR.INVALID_ARGUMENT,
      }),
    );
    expect(asyncRan).toBe(false);
    expect(
      inspectWorkspaceLockOwnerSync(
        workspaceLockOptions(input, { operationId }),
      ),
    ).toEqual(initialOwner);

    const retainedAgain = captureThrown(() =>
      withWorkspaceRecoveryLockSync(
        workspaceLockOptions(input, {
          operationId,
          expectedOwner: initialOwner,
          _isProcessAlive: () => false,
          _ownerToken: ownerTokenSequence("40000000"),
        }),
        (lease) => lease.retainForRecovery("recovery process crashed"),
      ),
    );
    expect(retainedAgain).toMatchObject({
      code: WORKSPACE_TRANSACTION_ERROR.RECOVERY_REQUIRED,
      operationId,
      recoveryOfOperationId: operationId,
      workspaceLockRetained: true,
      priorOwner: initialOwner,
      newOwner: {
        transactionId: operationId,
        purpose: "checkpoint-restore",
      },
    });
    expect(retainedAgain.newOwner.token).not.toBe(initialOwner.token);
    expect(
      inspectWorkspaceLockOwnerSync(
        workspaceLockOptions(input, { operationId }),
      ),
    ).toEqual(retainedAgain.newOwner);

    const recoveryError = new Error("recovery callback failed");
    expect(
      captureThrown(() =>
        withWorkspaceRecoveryLockSync(
          workspaceLockOptions(input, {
            operationId,
            expectedOwner: retainedAgain.newOwner,
            _isProcessAlive: () => false,
            _ownerToken: ownerTokenSequence("50000000"),
          }),
          () => {
            throw recoveryError;
          },
        ),
      ),
    ).toBe(recoveryError);
    expect(workspaceLockEntries(input)).toEqual([]);
  });

  it("recovery fails closed on live, forged, or drifted exact owners", () => {
    const input = fixture();
    let activeError = null;
    withWorkspaceLockSync(
      workspaceLockOptions(input, { operationId: "active-checkpoint" }),
      (lease) => {
        activeError = captureThrown(() =>
          withWorkspaceRecoveryLockSync(
            workspaceLockOptions(input, {
              operationId: lease.owner.transactionId,
              expectedOwner: lease.owner,
              _isProcessAlive: () => true,
            }),
            () => "unreachable",
          ),
        );
      },
    );
    expect(activeError).toMatchObject({
      code: WORKSPACE_TRANSACTION_ERROR.RECOVERY_REQUIRED,
      ownerTransactionId: "active-checkpoint",
    });
    expect(workspaceLockEntries(input)).toEqual([]);

    const operationId = "drifted-checkpoint";
    const retained = captureThrown(() =>
      withWorkspaceLockSync(
        workspaceLockOptions(input, { operationId }),
        (lease) => lease.retainForRecovery("await exact recovery"),
      ),
    );
    const expectedOwner = retained.retainedOwner;
    expect(() =>
      withWorkspaceRecoveryLockSync(
        workspaceLockOptions(input, {
          operationId,
          expectedOwner: { ...expectedOwner, purpose: "workspace-transaction" },
          _isProcessAlive: () => false,
        }),
        () => "unreachable",
      ),
    ).toThrow(
      expect.objectContaining({
        code: WORKSPACE_TRANSACTION_ERROR.INVALID_ARGUMENT,
      }),
    );

    const ownerPath = workspaceOwnerPath(input);
    const driftedOwner = {
      ...expectedOwner,
      token: "60000000-0000-4000-8000-000000000001",
    };
    fs.writeFileSync(ownerPath, JSON.stringify(driftedOwner), { mode: 0o600 });
    expect(() =>
      withWorkspaceRecoveryLockSync(
        workspaceLockOptions(input, {
          operationId,
          expectedOwner,
          _isProcessAlive: () => false,
        }),
        () => "unreachable",
      ),
    ).toThrow(
      expect.objectContaining({
        code: WORKSPACE_TRANSACTION_ERROR.LOCK_CORRUPT,
      }),
    );
    expect(JSON.parse(fs.readFileSync(ownerPath, "utf8"))).toEqual(
      driftedOwner,
    );

    expect(
      withWorkspaceRecoveryLockSync(
        workspaceLockOptions(input, {
          operationId,
          expectedOwner: driftedOwner,
          _isProcessAlive: () => false,
          _ownerToken: ownerTokenSequence("61000000"),
        }),
        () => "cleaned",
      ),
    ).toBe("cleaned");
    expect(workspaceLockEntries(input)).toEqual([]);
  });

  it("recovery refuses parent-child overlap without reclaiming either owner", () => {
    const input = fixture();
    const operationId = "parent-checkpoint-recovery";
    const retained = captureThrown(() =>
      withWorkspaceLockSync(
        workspaceLockOptions(input, { operationId }),
        (lease) => lease.retainForRecovery("parent requires recovery"),
      ),
    );
    const parentOwner = retained.retainedOwner;
    const childWorkspaceRoot = fs.realpathSync.native(
      path.join(input.workspaceRoot, "src"),
    );
    const childLockDir = path.join(
      input.root,
      "locks",
      workspaceLockName(childWorkspaceRoot),
    );
    const childOwner = {
      pid: 2_147_483_645,
      startedAt: 2,
      token: "62000000-0000-4000-8000-000000000001",
      transactionId: "child-checkpoint-recovery",
      workspaceRoot: childWorkspaceRoot,
      purpose: "checkpoint-restore",
      identityPolicy: "pid-only-fail-closed",
    };
    fs.mkdirSync(childLockDir, { mode: 0o700 });
    fs.writeFileSync(
      path.join(childLockDir, "owner.json"),
      JSON.stringify(childOwner),
      { mode: 0o600 },
    );

    expect(() =>
      withWorkspaceRecoveryLockSync(
        workspaceLockOptions(input, {
          operationId,
          expectedOwner: parentOwner,
          _isProcessAlive: () => false,
        }),
        () => "unreachable",
      ),
    ).toThrow(
      expect.objectContaining({
        code: WORKSPACE_TRANSACTION_ERROR.RECOVERY_REQUIRED,
        ownerTransactionId: childOwner.transactionId,
      }),
    );
    expect(
      inspectWorkspaceLockOwnerSync(
        workspaceLockOptions(input, { operationId }),
      ),
    ).toEqual(parentOwner);
    expect(
      JSON.parse(
        fs.readFileSync(path.join(childLockDir, "owner.json"), "utf8"),
      ),
    ).toEqual(childOwner);

    fs.rmSync(childLockDir, { recursive: true, force: true });
    expect(
      withWorkspaceRecoveryLockSync(
        workspaceLockOptions(input, {
          operationId,
          expectedOwner: parentOwner,
          _isProcessAlive: () => false,
          _ownerToken: ownerTokenSequence("63000000"),
        }),
        () => "cleaned",
      ),
    ).toBe("cleaned");
    expect(workspaceLockEntries(input)).toEqual([]);
  });

  it("inspection is read-only before lock publication", () => {
    const input = fixture();
    const lockDir = path.join(input.root, "not-created-locks");
    expect(
      inspectWorkspaceLockOwnerSync(
        workspaceLockOptions(input, {
          lockDir,
          operationId: "created-before-locked",
        }),
      ),
    ).toBeNull();
    expect(fs.existsSync(lockDir)).toBe(false);
  });
});

describe("WorkspaceTransactionManager", () => {
  it("captures ignored files with typed write evidence and honest coverage", () => {
    const input = fixture({ git: true });
    const transaction = begin(input, {
      coverageTarget: WORKSPACE_TRANSACTION_COVERAGE.PARTIAL,
      writerIsolation: "unknown",
      exclusions: [".git"],
    });
    transaction.markRunning();

    fs.writeFileSync(
      path.join(input.workspaceRoot, "cache.ignored"),
      "ignored-after\n",
      "utf8",
    );
    fs.rmSync(path.join(input.workspaceRoot, "src", "before.txt"));
    fs.writeFileSync(
      path.join(input.workspaceRoot, "src", "added.txt"),
      "added\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(input.workspaceRoot, ".git", "metadata"),
      "not-checkpointed\n",
      "utf8",
    );

    const evidence = transaction.accept();
    expect(evidence).toMatchObject({
      checkpointId: transaction.checkpointId,
      fileCoverage: WORKSPACE_TRANSACTION_COVERAGE.PARTIAL,
      coverage: WORKSPACE_TRANSACTION_COVERAGE.PARTIAL,
      externalSideEffects: true,
      outcome: "committed",
      exclusions: [".git"],
      uncoveredPaths: [".git"],
    });
    expect(evidence.evidenceDigest).toMatch(/^sha256:[a-f0-9]{64}$/);

    const state = transaction.snapshot();
    expect(state.state).toBe(WORKSPACE_TRANSACTION_STATE.COMMITTED);
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
        expect.objectContaining({
          path: "cache.ignored",
          operation: "modified",
          before: expect.objectContaining({
            type: "file",
            mode: expect.any(Number),
            bytes: expect.any(Number),
            sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          }),
          after: expect.objectContaining({
            type: "file",
            mode: expect.any(Number),
            bytes: expect.any(Number),
            sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          }),
        }),
        expect.objectContaining({
          path: "src/added.txt",
          operation: "added",
        }),
        expect.objectContaining({
          path: "src/before.txt",
          operation: "deleted",
        }),
      ]),
    );
    expect(writes.writes.some((entry) => entry.path.startsWith(".git"))).toBe(
      false,
    );
    expect(transaction.accept()).toEqual(evidence);
  });

  it("reports overall full coverage only for a proven file-only task", () => {
    const input = fixture();
    const transaction = begin(input, { externalSideEffects: false });
    fs.writeFileSync(
      path.join(input.workspaceRoot, "src", "before.txt"),
      "after\n",
      "utf8",
    );
    expect(transaction.accept()).toMatchObject({
      fileCoverage: WORKSPACE_TRANSACTION_COVERAGE.FULL,
      coverage: WORKSPACE_TRANSACTION_COVERAGE.FULL,
      externalSideEffects: false,
    });
  });

  it("rolls back modified, deleted, and added workspace content idempotently", () => {
    const input = fixture();
    const transaction = begin(input);
    transaction.markRunning();
    fs.writeFileSync(
      path.join(input.workspaceRoot, "cache.ignored"),
      "changed\n",
      "utf8",
    );
    fs.rmSync(path.join(input.workspaceRoot, "src", "before.txt"));
    fs.mkdirSync(path.join(input.workspaceRoot, "new-dir"));
    fs.writeFileSync(
      path.join(input.workspaceRoot, "new-dir", "new.txt"),
      "new\n",
      "utf8",
    );

    const evidence = transaction.rollback({ reason: "human interrupt" });
    expect(evidence).toMatchObject({
      outcome: "rolled_back",
      rollbackReason: "human interrupt",
      fileCoverage: WORKSPACE_TRANSACTION_COVERAGE.FULL,
    });
    expect(
      fs.readFileSync(path.join(input.workspaceRoot, "cache.ignored"), "utf8"),
    ).toBe("ignored-before\n");
    expect(
      fs.readFileSync(
        path.join(input.workspaceRoot, "src", "before.txt"),
        "utf8",
      ),
    ).toBe("before\n");
    expect(fs.existsSync(path.join(input.workspaceRoot, "new-dir"))).toBe(
      false,
    );
    expect(transaction.rollback()).toEqual(evidence);
  });

  it("fails closed before execution on hardlinks, symlinks, and limits", () => {
    const hardlinkInput = fixture();
    fs.linkSync(
      path.join(hardlinkInput.workspaceRoot, "src", "before.txt"),
      path.join(hardlinkInput.workspaceRoot, "src", "linked.txt"),
    );
    expect(() => begin(hardlinkInput)).toThrow(
      expect.objectContaining({
        code: WORKSPACE_TRANSACTION_ERROR.UNSAFE_ENTRY,
      }),
    );

    const limitInput = fixture();
    expect(() =>
      begin(limitInput, {
        limits: {
          maxEntries: 1,
          maxFiles: 1,
          maxTotalBytes: 1024,
          maxFileBytes: 1024,
          maxManifestBytes: 1024 * 1024,
          maxProcesses: 2,
          maxFailureEvidence: 2,
        },
      }),
    ).toThrow(
      expect.objectContaining({
        code: WORKSPACE_TRANSACTION_ERROR.RESOURCE_LIMIT,
      }),
    );
  });

  it.skipIf(process.platform === "win32")(
    "rejects pre-existing symlinks and removes task-created symlinks on rollback",
    () => {
      const preflight = fixture();
      fs.symlinkSync(
        path.join(preflight.root, "outside"),
        path.join(preflight.workspaceRoot, "escape"),
      );
      expect(() => begin(preflight)).toThrow(
        expect.objectContaining({
          code: WORKSPACE_TRANSACTION_ERROR.UNSAFE_ENTRY,
        }),
      );

      const introduced = fixture();
      fs.writeFileSync(path.join(introduced.root, "outside"), "secret", "utf8");
      const transaction = begin(introduced);
      fs.symlinkSync(
        path.join(introduced.root, "outside"),
        path.join(introduced.workspaceRoot, "escape"),
      );
      expect(() => transaction.accept()).toThrow(
        expect.objectContaining({
          code: WORKSPACE_TRANSACTION_ERROR.UNSAFE_ENTRY,
        }),
      );
      expect(transaction.snapshot().state).toBe(
        WORKSPACE_TRANSACTION_STATE.ROLLBACK_REQUIRED,
      );
      transaction.rollback({ reason: "unsafe symlink" });
      expect(fs.existsSync(path.join(introduced.workspaceRoot, "escape"))).toBe(
        false,
      );
      expect(
        fs.readFileSync(path.join(introduced.root, "outside"), "utf8"),
      ).toBe("secret");
    },
  );

  it("retains durable failure evidence when a checkpoint blob is corrupt", () => {
    const input = fixture();
    const transaction = begin(input);
    const baseline = JSON.parse(
      fs.readFileSync(
        path.join(
          input.stateDir,
          "transactions",
          transaction.id,
          "baseline.json",
        ),
        "utf8",
      ),
    );
    const before = baseline.entries.find(
      (entry) => entry.path === "src/before.txt",
    );
    fs.rmSync(
      path.join(
        input.stateDir,
        "transactions",
        transaction.id,
        "blobs",
        before.sha256,
      ),
    );
    fs.writeFileSync(
      path.join(input.workspaceRoot, "src", "before.txt"),
      "changed\n",
      "utf8",
    );

    expect(() => transaction.rollback()).toThrow(
      expect.objectContaining({
        code: WORKSPACE_TRANSACTION_ERROR.ROLLBACK_FAILED,
      }),
    );
    const state = JSON.parse(
      fs.readFileSync(
        path.join(
          input.stateDir,
          "transactions",
          transaction.id,
          "transaction.json",
        ),
        "utf8",
      ),
    );
    expect(state.state).toBe(WORKSPACE_TRANSACTION_STATE.ROLLBACK_FAILED);
    expect(state.failureEvidence.at(-1)).toMatchObject({
      phase: "rollback",
      code: WORKSPACE_TRANSACTION_ERROR.EVIDENCE_MISMATCH,
    });
    expect(state.failureEvidence.at(-1).priorEvidenceDigest).toBeNull();
  });

  it("blocks another process authority and recovers a dead owner's task", () => {
    const input = fixture();
    const first = manager(input, { isProcessAlive: () => true });
    const transaction = first.begin({
      runId: "run-1",
      taskKey: "task-1",
      workspaceRoot: input.workspaceRoot,
      coverageTarget: WORKSPACE_TRANSACTION_COVERAGE.FULL,
      writerIsolation: "exclusive-workspace",
    });
    transaction.markRunning();
    fs.writeFileSync(
      path.join(input.workspaceRoot, "src", "before.txt"),
      "crashed-write\n",
      "utf8",
    );

    const contender = manager(input, { isProcessAlive: () => true });
    expect(() =>
      contender.begin({
        id: "wcp-contender",
        runId: "run-2",
        taskKey: "task-2",
        workspaceRoot: input.workspaceRoot,
        coverageTarget: WORKSPACE_TRANSACTION_COVERAGE.FULL,
        writerIsolation: "exclusive-workspace",
      }),
    ).toThrow(
      expect.objectContaining({
        code: WORKSPACE_TRANSACTION_ERROR.OVERLAPPING_WORKSPACE,
      }),
    );

    const recovery = manager(input, { isProcessAlive: () => false });
    const result = recovery.recoverPending({
      workspaceRoot: input.workspaceRoot,
    });
    expect(result).toEqual([
      expect.objectContaining({
        id: transaction.id,
        status: "rolled_back",
        evidenceDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      }),
    ]);
    expect(
      fs.readFileSync(
        path.join(input.workspaceRoot, "src", "before.txt"),
        "utf8",
      ),
    ).toBe("before\n");
  });

  it("recovers only the explicitly selected transaction id", () => {
    const input = fixture();
    const secondWorkspace = path.join(input.root, "second-workspace");
    fs.mkdirSync(secondWorkspace, { recursive: true });
    fs.writeFileSync(
      path.join(secondWorkspace, "before.txt"),
      "second-before\n",
      "utf8",
    );
    const owner = manager(input, { isProcessAlive: () => true });
    const first = owner.begin({
      id: "wcp-selected-recovery",
      runId: "run-selected",
      taskKey: "task-selected",
      workspaceRoot: input.workspaceRoot,
      coverageTarget: WORKSPACE_TRANSACTION_COVERAGE.FULL,
      writerIsolation: "exclusive-workspace",
    });
    const second = owner.begin({
      id: "wcp-unselected-recovery",
      runId: "run-unselected",
      taskKey: "task-unselected",
      workspaceRoot: secondWorkspace,
      coverageTarget: WORKSPACE_TRANSACTION_COVERAGE.FULL,
      writerIsolation: "exclusive-workspace",
    });
    first.markRunning();
    second.markRunning();
    fs.writeFileSync(
      path.join(input.workspaceRoot, "src", "before.txt"),
      "selected-change\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(secondWorkspace, "before.txt"),
      "unselected-change\n",
      "utf8",
    );

    const recovery = manager(input, { isProcessAlive: () => false });
    expect(
      recovery.recoverPending({
        id: first.id,
        workspaceRoot: input.workspaceRoot,
      }),
    ).toEqual([
      expect.objectContaining({
        id: first.id,
        status: "rolled_back",
      }),
    ]);
    expect(
      fs.readFileSync(
        path.join(input.workspaceRoot, "src", "before.txt"),
        "utf8",
      ),
    ).toBe("before\n");
    expect(
      fs.readFileSync(path.join(secondWorkspace, "before.txt"), "utf8"),
    ).toBe("unselected-change\n");
  });

  it("holds registry coordination across the dead-owner reclaim window", () => {
    const input = fixture();
    const first = manager(input, { isProcessAlive: () => true });
    const transaction = first.begin({
      id: "wcp-parent-recovery-window",
      runId: "parent-recovery-run",
      taskKey: "parent-recovery-task",
      workspaceRoot: input.workspaceRoot,
      coverageTarget: WORKSPACE_TRANSACTION_COVERAGE.FULL,
      writerIsolation: "exclusive-workspace",
    });
    transaction.markRunning();
    fs.writeFileSync(
      path.join(input.workspaceRoot, "src", "before.txt"),
      "crashed-parent-write\n",
      "utf8",
    );

    const parentLockDir = path.dirname(workspaceOwnerPath(input));
    const nativeRmSync = fs.rmSync.bind(fs);
    let reclaimWindowEntered = false;
    let childCallbackRan = false;
    let childError = null;
    let childNow = 5_000;
    const rm = vi.spyOn(fs, "rmSync").mockImplementation((target, options) => {
      const result = nativeRmSync(target, options);
      if (
        !reclaimWindowEntered &&
        path.resolve(String(target)) === path.resolve(parentLockDir) &&
        options?.recursive === true
      ) {
        reclaimWindowEntered = true;
        try {
          withWorkspaceLockSync(
            workspaceLockOptions(input, {
              workspaceRoot: path.join(input.workspaceRoot, "src"),
              operationId: "child-during-parent-recovery",
              timeoutMs: 10,
              retryMs: 5,
              _now: () => childNow,
              _sleep: (milliseconds) => {
                childNow += milliseconds;
              },
            }),
            () => {
              childCallbackRan = true;
            },
          );
        } catch (error) {
          childError = error;
        }
      }
      return result;
    });

    let result;
    try {
      result = manager(input, {
        isProcessAlive: () => false,
      }).recoverPending({ workspaceRoot: input.workspaceRoot });
    } finally {
      rm.mockRestore();
    }

    expect(reclaimWindowEntered).toBe(true);
    expect(childCallbackRan).toBe(false);
    expect(childError).toMatchObject({
      code: WORKSPACE_TRANSACTION_ERROR.WORKSPACE_LOCK_TIMEOUT,
    });
    expect(result).toEqual([
      expect.objectContaining({
        id: transaction.id,
        status: "rolled_back",
      }),
    ]);
    expect(
      fs.readFileSync(
        path.join(input.workspaceRoot, "src", "before.txt"),
        "utf8",
      ),
    ).toBe("before\n");
    expect(workspaceLockEntries(input)).toEqual([]);
  });

  it("does not reclaim an overlapping dead checkpoint owner during recovery", () => {
    const input = fixture();
    const transaction = begin(input, {
      id: "wcp-recovery-with-dead-checkpoint",
    });
    transaction.markRunning();
    const childWorkspaceRoot = fs.realpathSync.native(
      path.join(input.workspaceRoot, "src"),
    );
    const checkpointLockDir = path.join(
      input.root,
      "locks",
      workspaceLockName(childWorkspaceRoot),
    );
    const checkpointOwner = {
      pid: 2_147_483_646,
      startedAt: 1,
      token: "70000000-0000-4000-8000-000000000001",
      transactionId: "dead-checkpoint-owner",
      workspaceRoot: childWorkspaceRoot,
      purpose: "checkpoint-restore",
      identityPolicy: "pid-only-fail-closed",
    };
    fs.mkdirSync(checkpointLockDir, { mode: 0o700 });
    fs.writeFileSync(
      path.join(checkpointLockDir, "owner.json"),
      JSON.stringify(checkpointOwner),
      { mode: 0o600 },
    );

    const result = manager(input, {
      isProcessAlive: () => false,
    }).recoverPending({ workspaceRoot: input.workspaceRoot });
    expect(result).toEqual([
      expect.objectContaining({
        id: transaction.id,
        status: "rollback_failed",
        code: WORKSPACE_TRANSACTION_ERROR.RECOVERY_REQUIRED,
      }),
    ]);
    expect(
      JSON.parse(
        fs.readFileSync(path.join(checkpointLockDir, "owner.json"), "utf8"),
      ),
    ).toEqual(checkpointOwner);

    fs.rmSync(checkpointLockDir, { recursive: true, force: true });
    transaction.rollback();
  });

  it("uses deterministic canonical evidence digests", () => {
    expect(digestWorkspaceEvidence({ b: 2, a: 1 })).toBe(
      digestWorkspaceEvidence({ a: 1, b: 2 }),
    );
  });

  it("rejects Git metadata for full coverage and exposes it for partial coverage", () => {
    const input = fixture({ git: true });
    expect(() =>
      begin(input, {
        id: "wcp-full-git",
      }),
    ).toThrow(
      expect.objectContaining({
        code: WORKSPACE_TRANSACTION_ERROR.WRITER_ISOLATION_REQUIRED,
      }),
    );

    const partial = begin(input, {
      id: "wcp-partial-git",
      coverageTarget: WORKSPACE_TRANSACTION_COVERAGE.PARTIAL,
      writerIsolation: "unknown",
    });
    const evidence = partial.accept();
    expect(evidence).toMatchObject({
      fileCoverage: WORKSPACE_TRANSACTION_COVERAGE.PARTIAL,
      coverage: WORKSPACE_TRANSACTION_COVERAGE.PARTIAL,
      exclusions: [".git"],
      uncoveredPaths: [".git"],
    });
  });

  it("explicitly downgrades excluded large roots instead of claiming full", () => {
    const input = fixture();
    const vendor = path.join(input.workspaceRoot, "vendor");
    fs.mkdirSync(vendor);
    for (let index = 0; index < 8; index += 1) {
      fs.writeFileSync(path.join(vendor, `${index}.txt`), `${index}\n`);
    }
    const limits = {
      maxEntries: 6,
      maxFiles: 6,
      maxTotalBytes: 1024,
      maxFileBytes: 1024,
      maxManifestBytes: 1024 * 1024,
      maxProcesses: 8,
      maxFailureEvidence: 8,
    };
    expect(() =>
      begin(input, {
        id: "wcp-large-full",
        limits,
      }),
    ).toThrow(
      expect.objectContaining({
        code: WORKSPACE_TRANSACTION_ERROR.RESOURCE_LIMIT,
      }),
    );

    const partial = begin(input, {
      id: "wcp-large-partial",
      coverageTarget: WORKSPACE_TRANSACTION_COVERAGE.PARTIAL,
      writerIsolation: "unknown",
      exclusions: ["vendor"],
      limits,
    });
    expect(partial.accept()).toMatchObject({
      fileCoverage: WORKSPACE_TRANSACTION_COVERAGE.PARTIAL,
      uncoveredPaths: ["vendor"],
    });
  });

  it("leaves linked-worktree Git metadata uncovered during file rollback", () => {
    const input = fixture();
    const externalGit = path.join(input.root, "external-git");
    fs.mkdirSync(externalGit);
    fs.writeFileSync(path.join(externalGit, "HEAD"), "before-ref\n");
    fs.writeFileSync(
      path.join(input.workspaceRoot, ".git"),
      `gitdir: ${externalGit}\n`,
    );
    expect(() => begin(input, { id: "wcp-linked-full" })).toThrow(
      expect.objectContaining({
        code: WORKSPACE_TRANSACTION_ERROR.WRITER_ISOLATION_REQUIRED,
      }),
    );

    const transaction = begin(input, {
      id: "wcp-linked-partial",
      coverageTarget: WORKSPACE_TRANSACTION_COVERAGE.PARTIAL,
      writerIsolation: "unknown",
    });
    fs.writeFileSync(
      path.join(input.workspaceRoot, "src", "before.txt"),
      "task-change\n",
    );
    fs.writeFileSync(path.join(externalGit, "HEAD"), "after-ref\n");
    const evidence = transaction.rollback({ reason: "git task failed" });
    expect(evidence).toMatchObject({
      fileCoverage: WORKSPACE_TRANSACTION_COVERAGE.PARTIAL,
      uncoveredPaths: [".git", "@external-git-metadata"],
    });
    expect(
      fs.readFileSync(
        path.join(input.workspaceRoot, "src", "before.txt"),
        "utf8",
      ),
    ).toBe("before\n");
    expect(fs.readFileSync(path.join(externalGit, "HEAD"), "utf8")).toBe(
      "after-ref\n",
    );
  });

  it("restores a committed checkpoint with conflict binding and can undo via safety", () => {
    const input = fixture();
    const transaction = begin(input, {
      id: "wcp-explicit-restore",
      externalSideEffects: false,
    });
    fs.writeFileSync(
      path.join(input.workspaceRoot, "src", "before.txt"),
      "committed\n",
    );
    const committed = transaction.accept();
    const restored = transaction.restore({
      expectedEvidenceDigest: committed.evidenceDigest,
      reason: "user rewind",
    });
    expect(restored).toMatchObject({
      outcome: "restored",
      sourceEvidenceDigest: committed.evidenceDigest,
      safetyCheckpoint: {
        id: expect.stringMatching(/^safety-/),
        digest: expect.stringMatching(/^sha256:/),
      },
    });
    // Durable manifest paths are platform-neutral. In particular, a Windows
    // path.relative() result must not make undoRestore reject its own evidence.
    expect(restored.safetyCheckpoint.path).not.toContain("\\");
    expect(
      fs.readFileSync(
        path.join(input.workspaceRoot, "src", "before.txt"),
        "utf8",
      ),
    ).toBe("before\n");
    const safetyPath = path.join(
      input.stateDir,
      "transactions",
      transaction.id,
      ...restored.safetyCheckpoint.path.split("/"),
    );
    expect(fs.existsSync(safetyPath)).toBe(true);

    const undone = transaction.undoRestore({
      expectedRestoreEvidenceDigest: restored.evidenceDigest,
      reason: "undo rewind",
    });
    expect(undone).toMatchObject({
      outcome: "restore_undone",
      sourceRestoreEvidenceDigest: restored.evidenceDigest,
    });
    expect(
      fs.readFileSync(
        path.join(input.workspaceRoot, "src", "before.txt"),
        "utf8",
      ),
    ).toBe("committed\n");
    expect(
      transaction.undoRestore({
        expectedRestoreEvidenceDigest: restored.evidenceDigest,
      }),
    ).toEqual(undone);
  });

  it("refuses explicit restore after unacknowledged post-commit changes", () => {
    const input = fixture();
    const transaction = begin(input, {
      id: "wcp-restore-conflict",
      externalSideEffects: false,
    });
    fs.writeFileSync(
      path.join(input.workspaceRoot, "src", "before.txt"),
      "committed\n",
    );
    const committed = transaction.accept();
    fs.writeFileSync(
      path.join(input.workspaceRoot, "src", "before.txt"),
      "later-user-edit\n",
    );
    expect(() =>
      transaction.restore({
        expectedEvidenceDigest: committed.evidenceDigest,
      }),
    ).toThrow(
      expect.objectContaining({
        code: WORKSPACE_TRANSACTION_ERROR.RESTORE_CONFLICT,
        conflicts: expect.arrayContaining([
          expect.objectContaining({ path: "src/before.txt" }),
        ]),
      }),
    );
    expect(
      fs.readFileSync(
        path.join(input.workspaceRoot, "src", "before.txt"),
        "utf8",
      ),
    ).toBe("later-user-edit\n");
  });

  it("exposes validated inspect state and stable list summaries", () => {
    const input = fixture();
    const runtime = manager(input);
    const transaction = runtime.begin({
      id: "wcp-read-api",
      runId: "read-run",
      taskKey: "read-task",
      workspaceRoot: input.workspaceRoot,
      coverageTarget: WORKSPACE_TRANSACTION_COVERAGE.FULL,
      writerIsolation: "exclusive-workspace",
      externalSideEffects: false,
    });
    fs.writeFileSync(
      path.join(input.workspaceRoot, "src", "before.txt"),
      "committed\n",
    );
    const evidence = transaction.accept();
    const canonicalWorkspaceRoot = fs.realpathSync.native(input.workspaceRoot);

    const inspected = runtime.inspect(transaction.id);
    expect(inspected).toMatchObject({
      id: transaction.id,
      state: WORKSPACE_TRANSACTION_STATE.COMMITTED,
      workspaceRoot: canonicalWorkspaceRoot,
      runId: "read-run",
      taskKey: "read-task",
      coverage: WORKSPACE_TRANSACTION_COVERAGE.FULL,
      fileCoverage: WORKSPACE_TRANSACTION_COVERAGE.FULL,
      externalSideEffects: false,
      uncoveredPaths: [],
      evidence: {
        evidenceDigest: evidence.evidenceDigest,
      },
    });
    inspected.taskKey = "caller-mutation";
    expect(runtime.inspect(transaction.id).taskKey).toBe("read-task");

    expect(runtime.list({ workspaceRoot: input.workspaceRoot })).toEqual([
      expect.objectContaining({
        id: transaction.id,
        state: WORKSPACE_TRANSACTION_STATE.COMMITTED,
        workspaceRoot: canonicalWorkspaceRoot,
        runId: "read-run",
        taskKey: "read-task",
        coverage: WORKSPACE_TRANSACTION_COVERAGE.FULL,
        fileCoverage: WORKSPACE_TRANSACTION_COVERAGE.FULL,
        externalSideEffects: false,
        uncoveredPaths: [],
        evidence: expect.objectContaining({
          evidenceDigest: evidence.evidenceDigest,
        }),
        restoreEvidence: null,
        undoRestoreEvidence: null,
        executionCount: 0,
        failureCount: 0,
      }),
    ]);
  });

  it("fails closed on baseline, state, and lock ownership tampering", () => {
    const baselineInput = fixture();
    const baselineTransaction = begin(baselineInput, {
      id: "wcp-baseline-tamper",
    });
    const baselinePath = path.join(
      baselineInput.stateDir,
      "transactions",
      baselineTransaction.id,
      "baseline.json",
    );
    const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
    baseline.entries[0].mode ^= 1;
    fs.writeFileSync(baselinePath, JSON.stringify(baseline), {
      mode: 0o600,
    });
    expect(() => baselineTransaction.accept()).toThrow(
      expect.objectContaining({
        code: WORKSPACE_TRANSACTION_ERROR.EVIDENCE_MISMATCH,
      }),
    );

    const stateInput = fixture();
    const stateTransaction = begin(stateInput, {
      id: "wcp-state-tamper",
    });
    const statePath = path.join(
      stateInput.stateDir,
      "transactions",
      stateTransaction.id,
      "transaction.json",
    );
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    state.taskKey = "tampered";
    fs.writeFileSync(statePath, JSON.stringify(state), { mode: 0o600 });
    expect(() => stateTransaction.markRunning()).toThrow(
      expect.objectContaining({
        code: WORKSPACE_TRANSACTION_ERROR.EVIDENCE_MISMATCH,
      }),
    );

    const lockInput = fixture();
    const lockTransaction = begin(lockInput, {
      id: "wcp-lock-tamper",
    });
    const ownerPath = path.join(
      lockInput.root,
      "locks",
      fs
        .readdirSync(path.join(lockInput.root, "locks"))
        .find((name) => name !== "coordination.lock"),
      "owner.json",
    );
    const owner = JSON.parse(fs.readFileSync(ownerPath, "utf8"));
    owner.token = "00000000-0000-4000-8000-999999999999";
    fs.writeFileSync(ownerPath, JSON.stringify(owner), { mode: 0o600 });
    expect(() => lockTransaction.rollback()).toThrow(
      expect.objectContaining({
        code: WORKSPACE_TRANSACTION_ERROR.ROLLBACK_FAILED,
        cause: expect.objectContaining({
          code: WORKSPACE_TRANSACTION_ERROR.LOCK_OWNERSHIP_LOST,
        }),
      }),
    );
  });

  it("rejects overlapping parent/child workspaces across managers", () => {
    const input = fixture();
    const parentManager = manager(input);
    const parent = parentManager.begin({
      id: "wcp-parent",
      runId: "parent-run",
      taskKey: "parent-task",
      workspaceRoot: input.workspaceRoot,
      coverageTarget: WORKSPACE_TRANSACTION_COVERAGE.PARTIAL,
    });
    const childRoot = path.join(input.workspaceRoot, "src");
    const otherState = path.join(input.root, "other-state");
    const childManager = new WorkspaceTransactionManager({
      stateDir: otherState,
      lockDir: path.join(input.root, "locks"),
      allowNonCanonicalLockDirForTests: true,
    });
    expect(() =>
      childManager.begin({
        id: "wcp-child",
        runId: "child-run",
        taskKey: "child-task",
        workspaceRoot: childRoot,
        coverageTarget: WORKSPACE_TRANSACTION_COVERAGE.PARTIAL,
      }),
    ).toThrow(
      expect.objectContaining({
        code: WORKSPACE_TRANSACTION_ERROR.OVERLAPPING_WORKSPACE,
        ownerTransactionId: parent.id,
      }),
    );
    parent.rollback();
  });

  it("keeps crash recovery manual when a child tree was not durably closed", () => {
    const input = fixture();
    const first = manager(input, { isProcessAlive: () => true });
    const transaction = first.begin({
      id: "wcp-unsettled-crash",
      runId: "crash-run",
      taskKey: "crash-task",
      workspaceRoot: input.workspaceRoot,
      coverageTarget: WORKSPACE_TRANSACTION_COVERAGE.PARTIAL,
    });
    first.prepareSpawn({
      executionId: "exec-unsettled",
      cwd: input.workspaceRoot,
      origin: "mcp:stdio",
      scope: "team",
      command: "node",
      args: [],
      detached: false,
      sandboxGuarantees: [],
    });
    fs.writeFileSync(
      path.join(input.workspaceRoot, "src", "before.txt"),
      "possibly-still-writing\n",
    );

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
      }),
    ]);
    expect(
      fs.readFileSync(
        path.join(input.workspaceRoot, "src", "before.txt"),
        "utf8",
      ),
    ).toBe("possibly-still-writing\n");
  });

  it("requires manual crash recovery for a settled process without a tree fence", () => {
    const input = fixture();
    const owner = manager(input, { isProcessAlive: () => true });
    const transaction = owner.begin({
      id: "wcp-settled-unproven-crash",
      runId: "crash-run",
      taskKey: "crash-task",
      workspaceRoot: input.workspaceRoot,
      coverageTarget: WORKSPACE_TRANSACTION_COVERAGE.PARTIAL,
    });
    const audit = {
      executionId: "exec-settled-unproven",
      cwd: input.workspaceRoot,
      origin: "plugin:stdio",
      scope: "team",
      command: "node",
      args: [],
      detached: false,
      sandboxGuarantees: [],
    };
    owner.prepareSpawn(audit);
    owner.settleSpawn(audit, { exitCode: 0 });

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
            executionId: audit.executionId,
            status: "settled",
            treeGuarantee: "unproven",
          }),
        ],
      }),
    ]);
  });

  it("does not accept or auto-rollback a settled process without a tree fence", () => {
    const input = fixture();
    const runtime = manager(input);
    const transaction = runtime.begin({
      id: "wcp-unproven-tree",
      runId: "tree-run",
      taskKey: "tree-task",
      workspaceRoot: input.workspaceRoot,
      coverageTarget: WORKSPACE_TRANSACTION_COVERAGE.PARTIAL,
    });
    const audit = {
      executionId: "exec-tree",
      cwd: input.workspaceRoot,
      origin: "plugin:stdio",
      scope: "team",
      command: "node",
      args: [],
      detached: false,
      sandboxGuarantees: [],
    };
    runtime.prepareSpawn(audit);
    runtime.settleSpawn(audit, { exitCode: 0 });
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

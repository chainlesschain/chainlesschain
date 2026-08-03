import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";

// The copy adapter's authority and rollback logic stays production-real in
// this wiring test. Avoid starting PowerShell for every owner-private DACL
// assertion on Windows; dedicated file-checkpoint tests exercise the native
// ACL implementation in child processes.
vi.mock("../../src/lib/secure-fs.js", async (importOriginal) => {
  const actual = await importOriginal();
  if (process.platform !== "win32") return actual;
  const runtimeFs = (await import("node:fs")).default;
  const inspect = (target) => {
    try {
      const stat = runtimeFs.lstatSync(target);
      return {
        target,
        exists: true,
        ok: !stat.isSymbolicLink(),
        platform: "win32-command-wiring-double",
      };
    } catch {
      return {
        target,
        exists: false,
        ok: false,
        platform: "win32-command-wiring-double",
      };
    }
  };
  return {
    ...actual,
    ensurePrivateDirectory(target) {
      runtimeFs.mkdirSync(target, { recursive: true, mode: 0o700 });
      return target;
    },
    inspectPrivatePaths(targets) {
      return [...new Set((targets || []).map(String))].map(inspect);
    },
    repairPrivatePaths(targets) {
      return [...new Set((targets || []).map(String))].map((target) => ({
        ...inspect(target),
        ok: true,
      }));
    },
  };
});

import {
  CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES,
  CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES,
  CheckpointRestoreRecoveryCliError,
  createCheckpointRestoreRecoveryCommandHandlers,
  previewCheckpointRestoreRecoveryAuthority,
  registerCheckpointRestoreRecoveryCommands,
} from "../../src/commands/checkpoint-restore-recovery.js";
import {
  CHECKPOINT_RESTORE_ALREADY_COMPLETED_ACTION,
  CHECKPOINT_RESTORE_ALREADY_COMPLETED_ERROR_CODES,
} from "../../src/lib/checkpoint-restore-already-completed-controller.js";
import { CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ACTION } from "../../src/lib/checkpoint-restore-partial-rollback-controller.js";
import {
  createCheckpoint,
  statusAgainst,
} from "../../src/lib/checkpoint-store.js";
import {
  computeCheckpointIdentity as computeCopyCheckpointIdentity,
  createCheckpoint as createCopyCheckpoint,
  restoreCheckpoint as restoreCopyCheckpoint,
} from "../../src/lib/file-checkpoint.js";

const HEAD_HASH = `sha256:${"a".repeat(64)}`;
const RECORDED_OWNER_DIGEST = `sha256:${"b".repeat(64)}`;
const LIVE_OWNER_DIGEST = `sha256:${"c".repeat(64)}`;
const OTHER_OWNER_DIGEST = `sha256:${"d".repeat(64)}`;
const OWNER_TOKEN = "private-owner-token-0000000000000001";
const WORKSPACE_ROOT = "C:\\private\\customer\\workspace";
const RAW_REASON = `secret recovery reason ${OWNER_TOKEN} ${WORKSPACE_ROOT}`;

function git(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  }).trim();
}

function action(candidate, eligible = false, blockers = []) {
  return {
    candidate,
    eligible,
    blockers,
    prerequisites: candidate ? ["external_verification"] : [],
  };
}

function recoveryProjection({
  operationId = "restore_cli_1",
  phase = "locked",
  basePhase = phase,
  seq = 2,
  terminal = false,
  clean = true,
  restore = {},
  progress = {},
  safety = {},
  rollback,
  eligibility = {},
} = {}) {
  return {
    schema: "chainlesschain.checkpoint-restore-recovery-projection",
    version: 1,
    operationId,
    phase,
    basePhase,
    status: terminal ? "terminal" : "pending",
    pending: !terminal,
    terminal,
    seq,
    headHash: HEAD_HASH,
    workspaceIdentity: `sha256:${"e".repeat(64)}`,
    fence: {
      expectedSeq: seq,
      expectedHash: HEAD_HASH,
      ownerAuthority: "unverified",
      recordedOwnerDigest: RECORDED_OWNER_DIGEST,
    },
    restore: {
      kind: "git",
      surface: "timeline",
      intentAuthority: "session",
      checkpointNamespace: "session-1",
      checkpointId: "checkpoint-1",
      checkpointIdentity: `git:${"1".repeat(40)}`,
      sessionId: "session-1",
      timelineEntryId: "turn-1",
      ...restore,
    },
    progress: { targetCount: 1, appliedCount: null, ...progress },
    safety: { coverage: null, complete: false, ...safety },
    ...(rollback === undefined ? {} : { rollback }),
    authority: {
      workspaceOwnerEvidencePresent: true,
      workspaceOwnerDigestPresent: true,
      complete: true,
    },
    recovery: {
      errorCode: "CHECKPOINT_RESTORE_INTERRUPTED",
      reasonPresent: true,
      actionRecorded: false,
    },
    integrity: {
      clean,
      orphanTemporaryFilesPresent: !clean,
    },
    actionEligibility: {
      abort: action(!terminal),
      resume: action(!terminal),
      rollback: action(basePhase === "mutation_started"),
      release: action(terminal),
      ...eligibility,
    },
  };
}

function rollbackProjection({
  operationId = "restore_cli_rollback",
  phase = "recovery_required",
  basePhase = "mutation_started",
  seq = 7,
  kind = "git",
  surface = "direct",
  checkpointNamespace = kind === "git" ? "session-1" : null,
  originalMutationTargetCount = 1,
  rollbackTargetCount = 1,
} = {}) {
  const timeline = surface === "timeline";
  const identity =
    kind === "git" ? `git:${"1".repeat(40)}` : `sha256:${"1".repeat(64)}`;
  const rollbackPhase = basePhase === "mutation_started" ? null : basePhase;
  const workspaceSettled = [
    "workspace_rolled_back",
    "session_rollback_committed",
  ].includes(rollbackPhase);
  return recoveryProjection({
    operationId,
    phase,
    basePhase,
    seq,
    restore: {
      kind,
      surface,
      intentAuthority: timeline ? "session" : "operation",
      checkpointNamespace,
      checkpointId: "checkpoint-1",
      checkpointIdentity: identity,
      sessionId: timeline ? "session-1" : null,
      timelineEntryId: timeline ? "turn-1" : null,
    },
    progress: {
      targetCount:
        rollbackPhase === null
          ? originalMutationTargetCount
          : rollbackTargetCount,
    },
    safety: {
      coverage: "full",
      complete: true,
      checkpointId: "safety-1",
      checkpointIdentity: identity,
      planIdentity: `sha256:${"2".repeat(64)}`,
    },
    rollback: {
      phase: rollbackPhase,
      recoveryRequestId: rollbackPhase ? "rollback-request-1" : null,
      rollbackPrestateDigest: rollbackPhase ? `sha256:${"3".repeat(64)}` : null,
      rollbackPlanIdentity: rollbackPhase ? `sha256:${"4".repeat(64)}` : null,
      originalMutationTargetCount: rollbackPhase
        ? originalMutationTargetCount
        : null,
      targetCount: rollbackPhase ? rollbackTargetCount : null,
      rolledBackCount: workspaceSettled ? rollbackTargetCount : null,
      rollbackStateDigest: workspaceSettled ? `sha256:${"5".repeat(64)}` : null,
      resultDigest: workspaceSettled ? `sha256:${"6".repeat(64)}` : null,
      sessionRollbackCommitDigest:
        rollbackPhase === "session_rollback_committed"
          ? `sha256:${"7".repeat(64)}`
          : null,
    },
    eligibility: { rollback: action(true) },
  });
}

function listProjection(item = recoveryProjection()) {
  return {
    schema: "chainlesschain.checkpoint-restore-recovery-list",
    version: 1,
    items: [item],
    diagnostics: [],
    page: {
      afterOperationId: "",
      limit: 64,
      returned: 1,
      diagnostics: 0,
      truncated: false,
      budgetExhausted: false,
      nextCursor: null,
    },
  };
}

function workspaceOwner(operationId = "restore_cli_1") {
  return {
    identityPolicy: "pid-only-fail-closed",
    pid: 4321,
    purpose: "checkpoint-restore",
    startedAt: 1_780_000_000_000,
    token: OWNER_TOKEN,
    transactionId: operationId,
    workspaceRoot: WORKSPACE_ROOT,
  };
}

function mutationResult(actionName, operationId, overrides = {}) {
  const partialRollback =
    actionName === CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ACTION;
  return {
    ok: true,
    action: actionName,
    operationId,
    phase:
      actionName === "abort"
        ? "aborted"
        : partialRollback
          ? "rolled_back"
          : "completed",
    seq: 4,
    headHash: `sha256:${"f".repeat(64)}`,
    archived: true,
    alreadyArchived: false,
    reconciledFromError: false,
    ...(actionName === CHECKPOINT_RESTORE_ALREADY_COMPLETED_ACTION
      ? {
          sessionCommitDigest: `sha256:${"1".repeat(64)}`,
          resultDigest: `sha256:${"2".repeat(64)}`,
        }
      : {}),
    ...(partialRollback
      ? {
          recoveryRequestId: "rollback-request-1",
          rolledBackCount: 1,
          rollbackStateDigest: `sha256:${"3".repeat(64)}`,
          resultDigest: `sha256:${"4".repeat(64)}`,
          sessionRollbackCommitDigest: null,
        }
      : {}),
    warning: null,
    ...overrides,
  };
}

function harness({ projection, list, owner } = {}) {
  const stdout = [];
  const stderr = [];
  const exitCodes = [];
  const store = {};
  const reader = {
    list: vi.fn(() => list || listProjection(projection)),
    show: vi.fn(() => projection || recoveryProjection()),
  };
  const controller = {
    abort: vi.fn((operationId) => mutationResult("abort", operationId)),
    release: vi.fn((operationId) => mutationResult("release", operationId)),
  };
  const sessionRecoveryReader = { read: vi.fn() };
  const workspaceTargetVerifier = { verify: vi.fn() };
  const alreadyCompletedController = {
    resume: vi.fn((operationId) =>
      mutationResult(CHECKPOINT_RESTORE_ALREADY_COMPLETED_ACTION, operationId),
    ),
  };
  const partialRollbackController = {
    rollback: vi.fn((operationId) =>
      mutationResult(CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ACTION, operationId),
    ),
  };
  const observedOwner = owner === undefined ? workspaceOwner() : owner;
  const dependencies = {
    resolveWorkspaceRoot: vi.fn(() => WORKSPACE_ROOT),
    canonicalizeWorkspaceRoot: vi.fn((value) => value),
    createStore: vi.fn(() => store),
    createRecoveryReader: vi.fn(() => reader),
    createRecoveryController: vi.fn(() => controller),
    createSessionRecoveryReader: vi.fn(() => sessionRecoveryReader),
    createWorkspaceTargetVerifier: vi.fn(() => workspaceTargetVerifier),
    createAlreadyCompletedController: vi.fn(() => alreadyCompletedController),
    createPartialRollbackController: vi.fn(() => partialRollbackController),
    prepareGitCheckpointRollback: vi.fn(),
    executeGitCheckpointRollback: vi.fn(),
    prepareCopyCheckpointRollback: vi.fn(),
    executeCopyCheckpointRollback: vi.fn(),
    withSessionAuthorityTransaction: vi.fn(),
    withWorkspaceRecoveryLockSync: vi.fn(),
    inspectWorkspaceLockOwnerSync: vi.fn(() => observedOwner),
    computeWorkspaceLockOwnerDigest: vi.fn(() => LIVE_OWNER_DIGEST),
    workspaceLockOptions: { lockDir: "C:\\private\\checkpoint-locks" },
    writeStdout: vi.fn((value) => stdout.push(String(value))),
    writeStderr: vi.fn((value) => stderr.push(String(value))),
    setExitCode: vi.fn((value) => exitCodes.push(value)),
  };
  return {
    stdout,
    stderr,
    exitCodes,
    store,
    reader,
    controller,
    sessionRecoveryReader,
    workspaceTargetVerifier,
    alreadyCompletedController,
    partialRollbackController,
    observedOwner,
    dependencies,
  };
}

function commandProgram(testHarness) {
  const program = new Command();
  program.exitOverride();
  const checkpoint = program.command("checkpoint");
  const recovery = registerCheckpointRestoreRecoveryCommands(
    checkpoint,
    testHarness.dependencies,
  );
  return { program, checkpoint, recovery };
}

async function parse(testHarness, args) {
  const { program } = commandProgram(testHarness);
  await program.parseAsync(["node", "cc", "checkpoint", "recovery", ...args]);
}

describe("checkpoint restore recovery command surface", () => {
  it("registers verified resume and partial-mutation rollback", () => {
    const testHarness = harness();
    const { recovery } = commandProgram(testHarness);

    expect(recovery.commands.map((command) => command.name()).sort()).toEqual([
      "abort",
      "list",
      "release",
      "resume",
      "rollback",
      "show",
    ]);
    expect(recovery.helpInformation()).toMatch(/partial workspace\s+mutation/i);
  });

  it("routes bounded list pagination and emits the safe JSON projection", async () => {
    const testHarness = harness();

    await parse(testHarness, [
      "list",
      "--after-operation-id",
      "restore_cursor_1",
      "--limit",
      "2",
      "--json",
    ]);

    expect(testHarness.reader.list).toHaveBeenCalledWith({
      afterOperationId: "restore_cursor_1",
      limit: 2,
    });
    expect(JSON.parse(testHarness.stdout[0])).toMatchObject({
      schema: "chainlesschain.checkpoint-restore-recovery-list",
      items: [{ operationId: "restore_cli_1" }],
    });
    expect(testHarness.exitCodes).toEqual([
      CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.OK,
    ]);
  });

  it("derives show mutation authority from the live owner, never recorded evidence", async () => {
    const testHarness = harness();

    await parse(testHarness, ["show", "restore_cli_1", "--json"]);

    const output = JSON.parse(testHarness.stdout[0]);
    expect(output).toMatchObject({
      schema: "chainlesschain.checkpoint-restore-recovery-command-preview",
      liveAuthority: { state: "retained", verified: true },
      mutationFence: {
        expectedSeq: 2,
        expectedHash: HEAD_HASH,
        expectedOwnerDigest: LIVE_OWNER_DIGEST,
      },
      actions: {
        abort: { candidate: true, eligible: true },
        resume: { candidate: true, eligible: false },
        rollback: { eligible: false },
      },
    });
    expect(output.mutationFence.expectedOwnerDigest).not.toBe(
      RECORDED_OWNER_DIGEST,
    );
    expect(
      testHarness.dependencies.inspectWorkspaceLockOwnerSync,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceRoot: WORKSPACE_ROOT,
        operationId: "restore_cli_1",
        purpose: "checkpoint-restore",
      }),
    );
    expect(
      testHarness.dependencies.computeWorkspaceLockOwnerDigest,
    ).toHaveBeenCalledWith(testHarness.observedOwner);
    const serialized = JSON.stringify(output);
    expect(serialized).not.toContain(OWNER_TOKEN);
    expect(serialized).not.toContain(WORKSPACE_ROOT);
    expect(serialized).not.toContain(RAW_REASON);
    expect(serialized).not.toContain('"workspaceLockOwner"');
  });

  it("renders unsupported resume and incomplete rollback authority", async () => {
    const mutationProjection = recoveryProjection({
      phase: "recovery_required",
      basePhase: "mutation_started",
      seq: 7,
    });
    const testHarness = harness({ projection: mutationProjection });

    await parse(testHarness, ["show", "restore_cli_1"]);

    expect(testHarness.stdout[0]).toContain(
      "resume: candidate only (not executable: controller_phase_not_supported)",
    );
    expect(testHarness.stdout[0]).toContain(
      "rollback: candidate only (not executable: verified_rollback_authority_required)",
    );
  });

  it("projects resume as executable only for retained timeline/session authority", async () => {
    const projection = recoveryProjection({
      phase: "recovery_required",
      basePhase: "workspace_applied",
      seq: 7,
    });
    const testHarness = harness({ projection });

    await parse(testHarness, ["show", "restore_cli_1", "--json"]);

    expect(JSON.parse(testHarness.stdout[0])).toMatchObject({
      mutationFence: {
        expectedSeq: 7,
        expectedHash: HEAD_HASH,
        expectedOwnerDigest: LIVE_OWNER_DIGEST,
      },
      actions: {
        resume: {
          candidate: true,
          eligible: true,
          blockers: [],
          prerequisites: [
            "exact_mutation_fence",
            "verified_session_already_completed",
            "verified_workspace_target_state",
            "controller_compare_and_swap",
          ],
        },
      },
    });
  });

  it("canonicalizes a workspace symlink before creating recovery authority", async () => {
    const temporaryRoot = mkdtempSync(
      path.join(os.tmpdir(), "cc-recovery-command-alias-"),
    );
    const canonicalDirectory = path.join(temporaryRoot, "workspace");
    const aliasDirectory = path.join(temporaryRoot, "workspace-alias");
    mkdirSync(canonicalDirectory);
    symlinkSync(
      canonicalDirectory,
      aliasDirectory,
      process.platform === "win32" ? "junction" : "dir",
    );
    const canonicalRoot = realpathSync.native(canonicalDirectory);
    const projection = recoveryProjection({
      phase: "recovery_required",
      basePhase: "workspace_applied",
      seq: 7,
    });
    const testHarness = harness({ projection });
    testHarness.dependencies.resolveWorkspaceRoot.mockReturnValue(
      aliasDirectory,
    );
    delete testHarness.dependencies.canonicalizeWorkspaceRoot;

    try {
      await parse(testHarness, [
        "resume",
        "restore_cli_1",
        "--dir",
        aliasDirectory,
        "--expected-seq",
        "7",
        "--expected-head-hash",
        HEAD_HASH,
        "--expected-owner-digest",
        LIVE_OWNER_DIGEST,
        "--yes",
        "--json",
      ]);

      expect(
        testHarness.dependencies.resolveWorkspaceRoot,
      ).toHaveBeenCalledWith(aliasDirectory);
      expect(testHarness.dependencies.createStore).toHaveBeenCalledWith({
        workspaceRoot: canonicalRoot,
      });
      expect(
        testHarness.dependencies.createSessionRecoveryReader,
      ).toHaveBeenCalledWith({ workspaceRoot: canonicalRoot });
      expect(
        testHarness.dependencies.createWorkspaceTargetVerifier,
      ).toHaveBeenCalledWith({ workspaceRoot: canonicalRoot });
      expect(
        testHarness.dependencies.createAlreadyCompletedController,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceRoot: canonicalRoot }),
      );
      expect(
        testHarness.dependencies.inspectWorkspaceLockOwnerSync,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceRoot: canonicalRoot }),
      );
      expect(testHarness.alreadyCompletedController.resume).toHaveBeenCalled();
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("returns a stable safe error when the workspace cannot be canonicalized", async () => {
    const temporaryRoot = mkdtempSync(
      path.join(os.tmpdir(), "cc-recovery-command-missing-"),
    );
    const missingWorkspace = path.join(temporaryRoot, "missing-workspace");
    const testHarness = harness();
    testHarness.dependencies.resolveWorkspaceRoot.mockReturnValue(
      missingWorkspace,
    );
    delete testHarness.dependencies.canonicalizeWorkspaceRoot;

    try {
      await parse(testHarness, [
        "show",
        "restore_cli_1",
        "--dir",
        missingWorkspace,
        "--json",
      ]);

      expect(testHarness.dependencies.createStore).not.toHaveBeenCalled();
      const serialized = testHarness.stderr[0];
      expect(JSON.parse(serialized)).toMatchObject({
        error: {
          code: CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.WORKSPACE_UNAVAILABLE,
          message:
            "The recovery workspace does not exist or cannot be resolved safely.",
        },
        exitCode: CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.NOT_EXECUTABLE,
      });
      expect(serialized).not.toContain(missingWorkspace);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("requires --yes before opening resume authority", async () => {
    const projection = recoveryProjection({
      phase: "recovery_required",
      basePhase: "workspace_applied",
      seq: 7,
    });
    const testHarness = harness({ projection });

    await parse(testHarness, [
      "resume",
      "restore_cli_1",
      "--expected-seq",
      "7",
      "--expected-head-hash",
      HEAD_HASH,
      "--expected-owner-digest",
      LIVE_OWNER_DIGEST,
      "--json",
    ]);

    expect(
      testHarness.alreadyCompletedController.resume,
    ).not.toHaveBeenCalled();
    expect(testHarness.dependencies.createStore).not.toHaveBeenCalled();
    expect(
      testHarness.dependencies.createSessionRecoveryReader,
    ).not.toHaveBeenCalled();
    expect(JSON.parse(testHarness.stderr[0])).toMatchObject({
      error: {
        code: CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.CONFIRMATION_REQUIRED,
      },
      exitCode: CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.INVALID_USAGE,
    });
  });

  it("resumes through the already-completed controller with the exact preview fence", async () => {
    const projection = recoveryProjection({
      phase: "recovery_required",
      basePhase: "session_committed",
      seq: 7,
    });
    const testHarness = harness({ projection });

    await parse(testHarness, [
      "resume",
      "restore_cli_1",
      "--expected-seq",
      "7",
      "--expected-head-hash",
      HEAD_HASH,
      "--expected-owner-digest",
      LIVE_OWNER_DIGEST,
      "--yes",
      "--json",
    ]);

    expect(testHarness.alreadyCompletedController.resume).toHaveBeenCalledWith(
      "restore_cli_1",
      {
        expectedSeq: 7,
        expectedHash: HEAD_HASH,
        expectedOwnerDigest: LIVE_OWNER_DIGEST,
      },
    );
    expect(
      testHarness.dependencies.createSessionRecoveryReader,
    ).toHaveBeenCalledWith({ workspaceRoot: WORKSPACE_ROOT });
    expect(
      testHarness.dependencies.createWorkspaceTargetVerifier,
    ).toHaveBeenCalledWith({ workspaceRoot: WORKSPACE_ROOT });
    expect(
      testHarness.dependencies.createAlreadyCompletedController,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceRoot: WORKSPACE_ROOT,
        store: testHarness.store,
        sessionRecoveryReader: testHarness.sessionRecoveryReader,
        inspectWorkspaceLockOwnerSync:
          testHarness.dependencies.inspectWorkspaceLockOwnerSync,
        computeWorkspaceLockOwnerDigest:
          testHarness.dependencies.computeWorkspaceLockOwnerDigest,
        workspaceLockOptions: {
          lockDir: "C:\\private\\checkpoint-locks",
        },
        verifyWorkspaceTarget: expect.any(Function),
      }),
    );
    const controllerOptions =
      testHarness.dependencies.createAlreadyCompletedController.mock
        .calls[0][0];
    const verifierRequest = { operationId: "restore_cli_1" };
    controllerOptions.verifyWorkspaceTarget(verifierRequest);
    expect(testHarness.workspaceTargetVerifier.verify).toHaveBeenCalledWith(
      verifierRequest,
    );
    expect(JSON.parse(testHarness.stdout[0])).toMatchObject({
      ok: true,
      action: "resume",
      recoveryAction: CHECKPOINT_RESTORE_ALREADY_COMPLETED_ACTION,
      operationId: "restore_cli_1",
      phase: "completed",
      sessionCommitDigest: `sha256:${"1".repeat(64)}`,
      resultDigest: `sha256:${"2".repeat(64)}`,
    });
  });

  it("keeps the human command contract at resume without exposing the internal action as the verb", async () => {
    const projection = recoveryProjection({
      phase: "recovery_required",
      basePhase: "workspace_applied",
      seq: 7,
    });
    const testHarness = harness({ projection });

    await parse(testHarness, [
      "resume",
      "restore_cli_1",
      "--expected-seq",
      "7",
      "--expected-head-hash",
      HEAD_HASH,
      "--expected-owner-digest",
      LIVE_OWNER_DIGEST,
      "--yes",
    ]);

    expect(testHarness.stdout[0]).toContain(
      "Checkpoint restore resume completed: restore_cli_1",
    );
    expect(testHarness.stdout[0]).not.toContain(
      CHECKPOINT_RESTORE_ALREADY_COMPLETED_ACTION,
    );
  });

  it.each([
    "mutation_started",
    "rollback_prepared",
    "rollback_started",
    "workspace_rolled_back",
    "session_rollback_committed",
  ])("projects rollback as executable at %s", async (basePhase) => {
    const projection = rollbackProjection({ basePhase });
    const testHarness = harness({ projection });

    await parse(testHarness, ["show", projection.operationId, "--json"]);

    expect(JSON.parse(testHarness.stdout[0])).toMatchObject({
      mutationFence: {
        expectedSeq: 7,
        expectedHash: HEAD_HASH,
        expectedOwnerDigest: LIVE_OWNER_DIGEST,
      },
      actions: {
        rollback: {
          candidate: true,
          eligible: true,
          blockers: [],
          prerequisites: [
            "exact_mutation_fence",
            "verified_full_safety_checkpoint",
            "verified_workspace_rollback_state",
            "controller_compare_and_swap",
          ],
        },
      },
    });
  });

  it.each(["rollback_prepared", "workspace_rolled_back"])(
    "keeps zero-target %s rollback publicly executable and returns zero",
    async (basePhase) => {
      const projection = rollbackProjection({
        basePhase,
        originalMutationTargetCount: 3,
        rollbackTargetCount: 0,
      });
      const testHarness = harness({ projection });
      testHarness.partialRollbackController.rollback.mockReturnValue(
        mutationResult(
          CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ACTION,
          projection.operationId,
          { rolledBackCount: 0 },
        ),
      );

      await parse(testHarness, ["show", projection.operationId, "--json"]);

      expect(JSON.parse(testHarness.stdout[0])).toMatchObject({
        recovery: {
          progress: { targetCount: 0 },
          rollback: {
            phase: basePhase,
            originalMutationTargetCount: 3,
            targetCount: 0,
          },
        },
        actions: {
          rollback: {
            candidate: true,
            eligible: true,
            blockers: [],
          },
        },
      });

      await parse(testHarness, [
        "rollback",
        projection.operationId,
        "--expected-seq",
        "7",
        "--expected-head-hash",
        HEAD_HASH,
        "--expected-owner-digest",
        LIVE_OWNER_DIGEST,
        "--yes",
        "--json",
      ]);

      expect(JSON.parse(testHarness.stdout[1])).toMatchObject({
        ok: true,
        action: "rollback",
        recoveryAction: CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ACTION,
        operationId: projection.operationId,
        rolledBackCount: 0,
      });
    },
  );

  it("uses initial mutation count while recovery_started has no rollback binding", async () => {
    const projection = rollbackProjection();
    projection.rollback = {
      ...projection.rollback,
      phase: "recovery_started",
      recoveryRequestId: "rollback-request-started",
    };
    const testHarness = harness({ projection });

    await parse(testHarness, ["show", projection.operationId, "--json"]);

    expect(JSON.parse(testHarness.stdout[0])).toMatchObject({
      recovery: {
        basePhase: "mutation_started",
        progress: { targetCount: 1 },
        rollback: {
          phase: "recovery_started",
          originalMutationTargetCount: null,
        },
      },
      actions: { rollback: { candidate: true, eligible: true } },
    });
  });

  it("never falls back to latest progress after rollback binding begins", async () => {
    const projection = rollbackProjection({ basePhase: "rollback_prepared" });
    projection.rollback = {
      ...projection.rollback,
      originalMutationTargetCount: null,
    };
    const testHarness = harness({ projection });

    await parse(testHarness, ["show", projection.operationId, "--json"]);

    expect(JSON.parse(testHarness.stdout[0])).toMatchObject({
      recovery: { progress: { targetCount: 1 } },
      actions: {
        rollback: {
          candidate: true,
          eligible: false,
          blockers: ["verified_rollback_authority_required"],
        },
      },
    });
  });

  it.each([
    ".hidden",
    "part..part",
    "session.lock",
    "session.LOCK",
    "trailing.",
    "bad/name",
    "bad namespace",
    123,
  ])(
    "rejects non-canonical Git namespace %s from rollback eligibility",
    async (checkpointNamespace) => {
      const projection = rollbackProjection({ checkpointNamespace });
      const testHarness = harness({ projection });

      await parse(testHarness, ["show", projection.operationId, "--json"]);

      expect(JSON.parse(testHarness.stdout[0])).toMatchObject({
        actions: {
          rollback: {
            candidate: true,
            eligible: false,
            blockers: ["verified_rollback_authority_required"],
          },
        },
      });
    },
  );

  it.each([
    ".hidden",
    "part..part",
    "session.lock",
    "session.LOCK",
    "trailing.",
    "bad/name",
    "bad namespace",
    123,
  ])(
    "rejects non-canonical Git namespace %s before adapter preparation",
    async (checkpointNamespace) => {
      const projection = rollbackProjection();
      const testHarness = harness({ projection });

      await parse(testHarness, [
        "rollback",
        projection.operationId,
        "--expected-seq",
        "7",
        "--expected-head-hash",
        HEAD_HASH,
        "--expected-owner-digest",
        LIVE_OWNER_DIGEST,
        "--yes",
        "--json",
      ]);

      const controllerOptions =
        testHarness.dependencies.createPartialRollbackController.mock
          .calls[0][0];
      expect(() =>
        controllerOptions.prepareWorkspaceRollback({
          workspaceRoot: WORKSPACE_ROOT,
          expected: {
            engine: "git",
            checkpointNamespace,
            originalCheckpoint: {
              id: "git-original",
              identity: `git:${"1".repeat(40)}`,
            },
            safetyCheckpoint: {
              id: "git-safety",
              identity: `git:${"2".repeat(40)}`,
              planIdentity: `sha256:${"3".repeat(64)}`,
            },
            originalMutationTargetCount: 3,
          },
        }),
      ).toThrow(
        expect.objectContaining({
          code: CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.INVALID_DEPENDENCY,
        }),
      );
      expect(
        testHarness.dependencies.prepareGitCheckpointRollback,
      ).not.toHaveBeenCalled();
    },
  );

  it("executes partial rollback with exact fences and emits declassified JSON", async () => {
    const projection = rollbackProjection();
    const testHarness = harness({ projection });
    testHarness.partialRollbackController.rollback.mockReturnValue(
      mutationResult(
        CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ACTION,
        projection.operationId,
        {
          privatePlan: { workspaceRoot: WORKSPACE_ROOT },
          warning: { code: "EPERM", message: RAW_REASON },
        },
      ),
    );

    await parse(testHarness, [
      "rollback",
      projection.operationId,
      "--expected-seq",
      "7",
      "--expected-head-hash",
      HEAD_HASH,
      "--expected-owner-digest",
      LIVE_OWNER_DIGEST,
      "--yes",
      "--json",
    ]);

    expect(testHarness.partialRollbackController.rollback).toHaveBeenCalledWith(
      projection.operationId,
      {
        expectedSeq: 7,
        expectedHash: HEAD_HASH,
        expectedOwnerDigest: LIVE_OWNER_DIGEST,
      },
    );
    expect(
      testHarness.dependencies.createPartialRollbackController,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceRoot: WORKSPACE_ROOT,
        store: testHarness.store,
        sessionRecoveryReader: testHarness.sessionRecoveryReader,
        withSessionAuthorityTransaction:
          testHarness.dependencies.withSessionAuthorityTransaction,
        inspectWorkspaceLockOwnerSync:
          testHarness.dependencies.inspectWorkspaceLockOwnerSync,
        withWorkspaceRecoveryLockSync:
          testHarness.dependencies.withWorkspaceRecoveryLockSync,
        computeWorkspaceLockOwnerDigest:
          testHarness.dependencies.computeWorkspaceLockOwnerDigest,
        workspaceLockOptions: {
          lockDir: "C:\\private\\checkpoint-locks",
        },
        prepareWorkspaceRollback: expect.any(Function),
        executeWorkspaceRollback: expect.any(Function),
      }),
    );
    const output = JSON.parse(testHarness.stdout[0]);
    expect(output).toMatchObject({
      ok: true,
      action: "rollback",
      recoveryAction: CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ACTION,
      operationId: projection.operationId,
      phase: "rolled_back",
      recoveryRequestId: "rollback-request-1",
      rolledBackCount: 1,
      rollbackStateDigest: `sha256:${"3".repeat(64)}`,
      resultDigest: `sha256:${"4".repeat(64)}`,
      sessionRollbackCommitDigest: null,
      warning: { code: "CHECKPOINT_RESTORE_SAGA_ARCHIVE_PENDING" },
    });
    const serialized = JSON.stringify(output);
    expect(serialized).not.toContain("privatePlan");
    expect(serialized).not.toContain(WORKSPACE_ROOT);
    expect(serialized).not.toContain(RAW_REASON);
    expect(serialized).not.toContain("EPERM");
  });

  it("requires rollback confirmation before opening any authority", async () => {
    const projection = rollbackProjection();
    const testHarness = harness({ projection });

    await parse(testHarness, [
      "rollback",
      projection.operationId,
      "--expected-seq",
      "7",
      "--expected-head-hash",
      HEAD_HASH,
      "--expected-owner-digest",
      LIVE_OWNER_DIGEST,
      "--json",
    ]);

    expect(testHarness.dependencies.createStore).not.toHaveBeenCalled();
    expect(
      testHarness.dependencies.createPartialRollbackController,
    ).not.toHaveBeenCalled();
    expect(
      testHarness.dependencies.inspectWorkspaceLockOwnerSync,
    ).not.toHaveBeenCalled();
    expect(JSON.parse(testHarness.stderr[0])).toMatchObject({
      error: {
        code: CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.CONFIRMATION_REQUIRED,
      },
      exitCode: CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.INVALID_USAGE,
    });
  });

  it("dispatches copy rollback by persisted engine and requires a null namespace", async () => {
    const projection = rollbackProjection({ kind: "copy" });
    const testHarness = harness({ projection });

    await parse(testHarness, [
      "rollback",
      projection.operationId,
      "--expected-seq",
      "7",
      "--expected-head-hash",
      HEAD_HASH,
      "--expected-owner-digest",
      LIVE_OWNER_DIGEST,
      "--yes",
      "--json",
    ]);

    const controllerOptions =
      testHarness.dependencies.createPartialRollbackController.mock.calls[0][0];
    const expected = {
      engine: "copy",
      restoreSurface: "direct",
      checkpointNamespace: null,
      originalCheckpoint: {
        id: "copy-original",
        identity: `sha256:${"1".repeat(64)}`,
      },
      safetyCheckpoint: {
        id: "copy-safety",
        identity: `sha256:${"2".repeat(64)}`,
        planIdentity: `sha256:${"3".repeat(64)}`,
      },
      originalWorkspaceWritePlanIdentity: `sha256:${"4".repeat(64)}`,
      originalPrestateDigest: `sha256:${"5".repeat(64)}`,
      originalMutationTargetCount: 3,
    };
    const prepared = { engine: "copy", checkpointNamespace: null };
    testHarness.dependencies.prepareCopyCheckpointRollback.mockReturnValue(
      prepared,
    );

    expect(
      controllerOptions.prepareWorkspaceRollback({
        operationId: projection.operationId,
        recoveryRequestId: "rollback-request-copy",
        workspaceRoot: WORKSPACE_ROOT,
        workspaceLease: {},
        expected,
      }),
    ).toBe(prepared);
    expect(
      testHarness.dependencies.prepareCopyCheckpointRollback,
    ).toHaveBeenCalledWith(WORKSPACE_ROOT, "copy-original", "copy-safety", {
      expectedOriginalIdentity: expected.originalCheckpoint.identity,
      expectedSafetyIdentity: expected.safetyCheckpoint.identity,
      expectedSafetyPlanIdentity: expected.safetyCheckpoint.planIdentity,
      originalMutationTargetCount: 3,
    });
    expect(() =>
      controllerOptions.prepareWorkspaceRollback({
        workspaceRoot: WORKSPACE_ROOT,
        expected: { ...expected, checkpointNamespace: "default" },
      }),
    ).toThrow(
      expect.objectContaining({
        code: CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.INVALID_DEPENDENCY,
      }),
    );

    const lease = { assertOwned: vi.fn() };
    const executed = { ok: true };
    testHarness.dependencies.executeCopyCheckpointRollback.mockReturnValue(
      executed,
    );
    expect(
      controllerOptions.executeWorkspaceRollback({
        workspaceRoot: WORKSPACE_ROOT,
        workspaceLease: lease,
        plan: prepared,
      }),
    ).toBe(executed);
    expect(
      testHarness.dependencies.executeCopyCheckpointRollback,
    ).toHaveBeenCalledWith(WORKSPACE_ROOT, prepared, {
      workspaceLease: lease,
    });
    expect(
      testHarness.dependencies.prepareGitCheckpointRollback,
    ).not.toHaveBeenCalled();
    expect(
      testHarness.dependencies.executeGitCheckpointRollback,
    ).not.toHaveBeenCalled();
  });

  it("uses the real Git rollback adapter behind the public wiring", async () => {
    const projection = rollbackProjection();
    const testHarness = harness({ projection });
    delete testHarness.dependencies.prepareGitCheckpointRollback;
    delete testHarness.dependencies.executeGitCheckpointRollback;

    await parse(testHarness, [
      "rollback",
      projection.operationId,
      "--expected-seq",
      "7",
      "--expected-head-hash",
      HEAD_HASH,
      "--expected-owner-digest",
      LIVE_OWNER_DIGEST,
      "--yes",
      "--json",
    ]);

    const controllerOptions =
      testHarness.dependencies.createPartialRollbackController.mock.calls[0][0];
    const repo = realpathSync.native(
      mkdtempSync(path.join(os.tmpdir(), "cc-recovery-cli-git-")),
    );
    const session = "recovery-cli-real-adapter";
    try {
      git(repo, "init", "-q");
      git(repo, "config", "user.email", "recovery@test.local");
      git(repo, "config", "user.name", "recovery-test");
      git(repo, "config", "core.autocrlf", "false");
      writeFileSync(path.join(repo, "a.txt"), "base-a\n", "utf8");
      writeFileSync(path.join(repo, "b.txt"), "base-b\n", "utf8");
      git(repo, "add", "-A");
      git(repo, "commit", "-q", "-m", "base");

      writeFileSync(path.join(repo, "a.txt"), "target-a\n", "utf8");
      rmSync(path.join(repo, "b.txt"));
      writeFileSync(path.join(repo, "target-added.txt"), "target\n", "utf8");
      const original = createCheckpoint(repo, {
        session,
        label: "original-target",
      });
      writeFileSync(path.join(repo, "a.txt"), "safety-a\n", "utf8");
      writeFileSync(path.join(repo, "b.txt"), "safety-b\n", "utf8");
      rmSync(path.join(repo, "target-added.txt"));
      const safety = createCheckpoint(repo, { session, label: "safety" });
      const originalPreview = statusAgainst(repo, original.id, {
        session,
        expectedIdentity: `git:${original.commit}`,
      });
      const originalMutationTargetCount =
        originalPreview.modified.length +
        originalPreview.added.length +
        originalPreview.deleted.length;

      writeFileSync(path.join(repo, "a.txt"), "target-a\n", "utf8");
      rmSync(path.join(repo, "b.txt"));
      writeFileSync(path.join(repo, "target-added.txt"), "target\n", "utf8");
      const workspaceLease = {
        canonicalWorkspaceRoot: repo,
        assertOwned: vi.fn(),
      };
      const plan = controllerOptions.prepareWorkspaceRollback({
        operationId: projection.operationId,
        recoveryRequestId: "rollback-real-git",
        workspaceRoot: repo,
        workspaceLease,
        expected: {
          engine: "git",
          restoreSurface: "direct",
          checkpointNamespace: session,
          originalCheckpoint: {
            id: original.id,
            identity: `git:${original.commit}`,
          },
          safetyCheckpoint: {
            id: safety.id,
            identity: `git:${safety.commit}`,
            planIdentity: originalPreview.workspaceBinding.writePlanIdentity,
          },
          originalWorkspaceWritePlanIdentity:
            originalPreview.workspaceBinding.writePlanIdentity,
          originalPrestateDigest: `sha256:${"5".repeat(64)}`,
          originalMutationTargetCount,
        },
      });
      expect(plan).toMatchObject({
        engine: "git",
        checkpointNamespace: session,
        targetCount: 3,
      });

      const result = controllerOptions.executeWorkspaceRollback({
        operationId: projection.operationId,
        recoveryRequestId: "rollback-real-git",
        workspaceRoot: repo,
        workspaceLease,
        plan,
      });
      expect(result).toMatchObject({ engine: "git", rolledBackCount: 3 });
      expect(readFileSync(path.join(repo, "a.txt"), "utf8")).toBe("safety-a\n");
      expect(readFileSync(path.join(repo, "b.txt"), "utf8")).toBe("safety-b\n");
      expect(existsSync(path.join(repo, "target-added.txt"))).toBe(false);
      expect(statusAgainst(repo, safety.id, { session })).toMatchObject({
        modified: [],
        added: [],
        deleted: [],
      });
      expect(workspaceLease.assertOwned).toHaveBeenCalled();
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }, 60_000);

  it("uses the real copy rollback adapter behind the public wiring", async () => {
    const projection = rollbackProjection({ kind: "copy" });
    const testHarness = harness({ projection });
    delete testHarness.dependencies.prepareCopyCheckpointRollback;
    delete testHarness.dependencies.executeCopyCheckpointRollback;

    await parse(testHarness, [
      "rollback",
      projection.operationId,
      "--expected-seq",
      "7",
      "--expected-head-hash",
      HEAD_HASH,
      "--expected-owner-digest",
      LIVE_OWNER_DIGEST,
      "--yes",
      "--json",
    ]);

    const controllerOptions =
      testHarness.dependencies.createPartialRollbackController.mock.calls[0][0];
    const base = realpathSync.native(
      mkdtempSync(path.join(os.tmpdir(), "cc-recovery-cli-copy-")),
    );
    const work = path.join(base, "work");
    const privateHome = path.join(base, "private-home");
    mkdirSync(work, { recursive: true });
    mkdirSync(privateHome, { recursive: true });
    const priorHome = process.env.CHAINLESSCHAIN_HOME;
    process.env.CHAINLESSCHAIN_HOME = privateHome;
    try {
      const target = path.join(work, "a.txt");
      writeFileSync(target, "FORWARD-A", "utf8");
      const forward = createCopyCheckpoint(["a.txt"], {
        cwd: work,
        label: "forward-target",
      });
      writeFileSync(target, "SAFETY-A", "utf8");
      const original = restoreCopyCheckpoint(forward.id, {
        cwd: work,
        expectedIdentity: computeCopyCheckpointIdentity(forward),
      });
      expect(readFileSync(target, "utf8")).toBe("FORWARD-A");

      let originalMutationTargetCount = null;
      let interrupted = null;
      try {
        restoreCopyCheckpoint(original.safetyId, {
          cwd: work,
          expectedIdentity: original.safetyIdentity,
          expectedSafetyPlanIdentity: original.safetyPlanIdentity,
          onMutationStarted: (evidence) => {
            originalMutationTargetCount = evidence.mutationCount;
          },
          onTargetPublished: () => {
            const error = new Error("stop after copy target publication");
            error.code = "INJECTED_COPY_ROLLBACK_WIRING_STOP";
            throw error;
          },
        });
      } catch (error) {
        interrupted = error;
      }
      expect(interrupted).toMatchObject({
        code: "INJECTED_COPY_ROLLBACK_WIRING_STOP",
        safetyCoverage: "full",
        safetyId: expect.any(String),
        safetyIdentity: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        safetyPlanIdentity: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      });
      expect(originalMutationTargetCount).toBe(1);
      expect(readFileSync(target, "utf8")).toBe("SAFETY-A");

      const workspaceLease = {
        canonicalWorkspaceRoot: realpathSync.native(work),
        assertOwned: vi.fn(),
      };
      const plan = controllerOptions.prepareWorkspaceRollback({
        operationId: projection.operationId,
        recoveryRequestId: "rollback-real-copy",
        workspaceRoot: work,
        workspaceLease,
        expected: {
          engine: "copy",
          restoreSurface: "direct",
          checkpointNamespace: null,
          originalCheckpoint: {
            id: original.safetyId,
            identity: original.safetyIdentity,
          },
          safetyCheckpoint: {
            id: interrupted.safetyId,
            identity: interrupted.safetyIdentity,
            planIdentity: interrupted.safetyPlanIdentity,
          },
          originalWorkspaceWritePlanIdentity: original.safetyPlanIdentity,
          originalPrestateDigest: `sha256:${"5".repeat(64)}`,
          originalMutationTargetCount,
        },
      });
      expect(plan).toMatchObject({
        engine: "copy",
        checkpointNamespace: null,
        targetCount: 1,
      });

      const result = controllerOptions.executeWorkspaceRollback({
        operationId: projection.operationId,
        recoveryRequestId: "rollback-real-copy",
        workspaceRoot: work,
        workspaceLease,
        plan,
      });
      expect(result).toMatchObject({ engine: "copy", rolledBackCount: 1 });
      expect(readFileSync(target, "utf8")).toBe("FORWARD-A");
      expect(workspaceLease.assertOwned).toHaveBeenCalled();
    } finally {
      if (priorHome === undefined) delete process.env.CHAINLESSCHAIN_HOME;
      else process.env.CHAINLESSCHAIN_HOME = priorHome;
      rmSync(base, { recursive: true, force: true });
    }
  }, 120_000);

  it("maps unknown rollback errors to one public allowlisted failure", async () => {
    const projection = rollbackProjection();
    const testHarness = harness({ projection });
    testHarness.partialRollbackController.rollback.mockImplementation(() => {
      const error = new CheckpointRestoreRecoveryCliError(
        "PRIVATE_ROLLBACK_SECRET_CODE",
        RAW_REASON,
        CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.INVALID_USAGE,
      );
      error.workspaceRoot = WORKSPACE_ROOT;
      throw error;
    });

    await parse(testHarness, [
      "rollback",
      projection.operationId,
      "--expected-seq",
      "7",
      "--expected-head-hash",
      HEAD_HASH,
      "--expected-owner-digest",
      LIVE_OWNER_DIGEST,
      "--yes",
      "--json",
    ]);

    const serialized = testHarness.stderr[0];
    expect(JSON.parse(serialized)).toMatchObject({
      error: {
        code: CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.FAILED,
        message:
          "Checkpoint restore recovery failed without changing the requested authority.",
      },
      exitCode: CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.FAILURE,
    });
    expect(serialized).not.toContain("PRIVATE_ROLLBACK_SECRET_CODE");
    expect(serialized).not.toContain(RAW_REASON);
    expect(serialized).not.toContain(WORKSPACE_ROOT);
  });

  it("rejects a thenable returned by an ordinary rollback function", async () => {
    const projection = rollbackProjection();
    const testHarness = harness({ projection });
    let rollbackCalls = 0;
    function rollback() {
      rollbackCalls += 1;
      return Promise.resolve(
        mutationResult(
          CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ACTION,
          projection.operationId,
        ),
      );
    }
    testHarness.dependencies.createPartialRollbackController.mockReturnValue({
      rollback,
    });

    await parse(testHarness, [
      "rollback",
      projection.operationId,
      "--expected-seq",
      "7",
      "--expected-head-hash",
      HEAD_HASH,
      "--expected-owner-digest",
      LIVE_OWNER_DIGEST,
      "--yes",
      "--json",
    ]);

    expect(rollbackCalls).toBe(1);
    expect(testHarness.stdout).toEqual([]);
    expect(JSON.parse(testHarness.stderr[0])).toMatchObject({
      error: {
        code: CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.INVALID_DEPENDENCY,
      },
      exitCode: CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.FAILURE,
    });
  });

  it("fails closed when a rollback result has a hostile then getter", async () => {
    const projection = rollbackProjection();
    const testHarness = harness({ projection });
    let rollbackCalls = 0;
    let thenReads = 0;
    function rollback() {
      rollbackCalls += 1;
      const result = mutationResult(
        CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ACTION,
        projection.operationId,
      );
      Object.defineProperty(result, "then", {
        enumerable: true,
        get() {
          thenReads += 1;
          throw new Error(RAW_REASON);
        },
      });
      return result;
    }
    testHarness.dependencies.createPartialRollbackController.mockReturnValue({
      rollback,
    });

    await parse(testHarness, [
      "rollback",
      projection.operationId,
      "--expected-seq",
      "7",
      "--expected-head-hash",
      HEAD_HASH,
      "--expected-owner-digest",
      LIVE_OWNER_DIGEST,
      "--yes",
      "--json",
    ]);

    expect(rollbackCalls).toBe(1);
    expect(thenReads).toBe(1);
    expect(testHarness.stdout).toEqual([]);
    const serialized = testHarness.stderr[0];
    expect(JSON.parse(serialized)).toMatchObject({
      error: {
        code: CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.INVALID_DEPENDENCY,
      },
      exitCode: CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.FAILURE,
    });
    expect(serialized).not.toContain(RAW_REASON);
  });

  it("rejects an asynchronous rollback handler before invoking it", async () => {
    const projection = rollbackProjection();
    const testHarness = harness({ projection });
    let rollbackCalls = 0;
    async function rollback() {
      rollbackCalls += 1;
      return mutationResult(
        CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ACTION,
        projection.operationId,
      );
    }
    testHarness.dependencies.createPartialRollbackController.mockReturnValue({
      rollback,
    });

    await parse(testHarness, [
      "rollback",
      projection.operationId,
      "--expected-seq",
      "7",
      "--expected-head-hash",
      HEAD_HASH,
      "--expected-owner-digest",
      LIVE_OWNER_DIGEST,
      "--yes",
      "--json",
    ]);

    expect(rollbackCalls).toBe(0);
    expect(JSON.parse(testHarness.stderr[0])).toMatchObject({
      error: {
        code: CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.INVALID_DEPENDENCY,
      },
      exitCode: CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.FAILURE,
    });
  });

  it("rejects direct restore authority before invoking resume", async () => {
    const projection = recoveryProjection({
      phase: "recovery_required",
      basePhase: "workspace_applied",
      seq: 7,
      restore: {
        surface: "direct",
        intentAuthority: "operation",
        sessionId: null,
        timelineEntryId: null,
      },
    });
    const testHarness = harness({ projection });

    await parse(testHarness, [
      "resume",
      "restore_cli_1",
      "--expected-seq",
      "7",
      "--expected-head-hash",
      HEAD_HASH,
      "--expected-owner-digest",
      LIVE_OWNER_DIGEST,
      "--yes",
      "--json",
    ]);

    expect(
      testHarness.alreadyCompletedController.resume,
    ).not.toHaveBeenCalled();
    expect(testHarness.sessionRecoveryReader.read).not.toHaveBeenCalled();
    expect(JSON.parse(testHarness.stderr[0])).toMatchObject({
      error: {
        code: CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.ACTION_NOT_ELIGIBLE,
      },
      exitCode: CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.NOT_EXECUTABLE,
    });
  });

  it("preserves stable JSON errors without leaking controller diagnostics", async () => {
    const projection = recoveryProjection({
      phase: "recovery_required",
      basePhase: "workspace_applied",
      seq: 7,
    });
    const testHarness = harness({ projection });
    testHarness.alreadyCompletedController.resume.mockImplementation(() => {
      const error = new Error(RAW_REASON);
      error.code =
        CHECKPOINT_RESTORE_ALREADY_COMPLETED_ERROR_CODES.SESSION_CONFLICT;
      error.workspaceRoot = WORKSPACE_ROOT;
      throw error;
    });

    await parse(testHarness, [
      "resume",
      "restore_cli_1",
      "--expected-seq",
      "7",
      "--expected-head-hash",
      HEAD_HASH,
      "--expected-owner-digest",
      LIVE_OWNER_DIGEST,
      "--yes",
      "--json",
    ]);

    const serialized = testHarness.stderr[0];
    expect(JSON.parse(serialized)).toMatchObject({
      error: {
        code: CHECKPOINT_RESTORE_ALREADY_COMPLETED_ERROR_CODES.SESSION_CONFLICT,
        message:
          "The session transcript does not prove one exact completed restore settlement.",
      },
      exitCode: CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.NOT_EXECUTABLE,
    });
    expect(serialized).not.toContain(RAW_REASON);
    expect(serialized).not.toContain(WORKSPACE_ROOT);
    expect(serialized).not.toContain(OWNER_TOKEN);
  });

  it("requires --yes before opening any mutation authority", async () => {
    const testHarness = harness();

    await parse(testHarness, [
      "abort",
      "restore_cli_1",
      "--expected-seq",
      "2",
      "--expected-head-hash",
      HEAD_HASH,
      "--expected-owner-digest",
      LIVE_OWNER_DIGEST,
      "--json",
    ]);

    expect(testHarness.controller.abort).not.toHaveBeenCalled();
    expect(testHarness.dependencies.createStore).not.toHaveBeenCalled();
    expect(
      testHarness.dependencies.inspectWorkspaceLockOwnerSync,
    ).not.toHaveBeenCalled();
    const error = JSON.parse(testHarness.stderr[0]);
    expect(error).toMatchObject({
      ok: false,
      error: {
        code: CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.CONFIRMATION_REQUIRED,
      },
      exitCode: CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.INVALID_USAGE,
    });
  });

  it("executes abort only with exact saga and live-owner fences", async () => {
    const testHarness = harness();
    testHarness.controller.abort.mockReturnValue(
      mutationResult("abort", "restore_cli_1", {
        warning: {
          code: "CHECKPOINT_RESTORE_ARCHIVE_PENDING",
          message: RAW_REASON,
        },
        privateOwner: testHarness.observedOwner,
      }),
    );

    await parse(testHarness, [
      "abort",
      "restore_cli_1",
      "--expected-seq",
      "2",
      "--expected-head-hash",
      HEAD_HASH,
      "--expected-owner-digest",
      LIVE_OWNER_DIGEST,
      "--yes",
      "--json",
    ]);

    expect(testHarness.controller.abort).toHaveBeenCalledWith("restore_cli_1", {
      expectedSeq: 2,
      expectedHash: HEAD_HASH,
      expectedOwnerDigest: LIVE_OWNER_DIGEST,
      reason: "Operator confirmed checkpoint restore recovery abort",
    });
    expect(
      testHarness.dependencies.createRecoveryController,
    ).toHaveBeenCalledWith({
      workspaceRoot: WORKSPACE_ROOT,
      store: testHarness.store,
      inspectWorkspaceLockOwnerSync:
        testHarness.dependencies.inspectWorkspaceLockOwnerSync,
      computeWorkspaceLockOwnerDigest:
        testHarness.dependencies.computeWorkspaceLockOwnerDigest,
      workspaceLockOptions: {
        lockDir: "C:\\private\\checkpoint-locks",
      },
    });
    const result = JSON.parse(testHarness.stdout[0]);
    expect(result).toMatchObject({
      ok: true,
      action: "abort",
      operationId: "restore_cli_1",
      warning: { code: "CHECKPOINT_RESTORE_SAGA_ARCHIVE_PENDING" },
    });
    expect(JSON.stringify(result)).not.toContain(RAW_REASON);
    expect(JSON.stringify(result)).not.toContain(OWNER_TOKEN);
  });

  it("rejects a historical or stale owner digest before calling the controller", async () => {
    const testHarness = harness();

    await parse(testHarness, [
      "abort",
      "restore_cli_1",
      "--expected-seq",
      "2",
      "--expected-head-hash",
      HEAD_HASH,
      "--expected-owner-digest",
      RECORDED_OWNER_DIGEST,
      "--yes",
      "--json",
    ]);

    expect(testHarness.controller.abort).not.toHaveBeenCalled();
    expect(JSON.parse(testHarness.stderr[0])).toMatchObject({
      error: {
        code: CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.FENCE_MISMATCH,
      },
      exitCode: CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.NOT_EXECUTABLE,
    });
  });

  it("permits owner-absent abort only while the current saga phase is created", async () => {
    const created = recoveryProjection({
      operationId: "restore_created_absent",
      phase: "created",
      basePhase: "created",
      seq: 1,
    });
    const createdHarness = harness({ projection: created, owner: null });

    await parse(createdHarness, ["show", "restore_created_absent", "--json"]);

    expect(JSON.parse(createdHarness.stdout[0])).toMatchObject({
      liveAuthority: { state: "absent", verified: true },
      actions: { abort: { candidate: true, eligible: true, blockers: [] } },
    });

    const recoveryRequired = recoveryProjection({
      operationId: "restore_created_recovery",
      phase: "recovery_required",
      basePhase: "created",
      seq: 2,
    });
    const recoveryHarness = harness({
      projection: recoveryRequired,
      owner: null,
    });

    await parse(recoveryHarness, [
      "show",
      "restore_created_recovery",
      "--json",
    ]);

    expect(JSON.parse(recoveryHarness.stdout[0])).toMatchObject({
      liveAuthority: { state: "absent", verified: true },
      actions: {
        abort: {
          candidate: true,
          eligible: false,
          blockers: ["retained_workspace_owner_required_after_recovery"],
        },
      },
    });

    await parse(recoveryHarness, [
      "abort",
      "restore_created_recovery",
      "--expected-seq",
      "2",
      "--expected-head-hash",
      HEAD_HASH,
      "--yes",
      "--json",
    ]);

    expect(recoveryHarness.controller.abort).not.toHaveBeenCalled();
    expect(JSON.parse(recoveryHarness.stderr[0])).toMatchObject({
      error: {
        code: CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.ACTION_NOT_ELIGIBLE,
      },
      exitCode: CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.NOT_EXECUTABLE,
    });
  });

  it("allows a retained-owner takeover for base-created recovery phases", async () => {
    const recoveryRequired = recoveryProjection({
      operationId: "restore_created_retained",
      phase: "recovery_required",
      basePhase: "created",
      seq: 2,
    });
    const testHarness = harness({
      projection: recoveryRequired,
      owner: workspaceOwner("restore_created_retained"),
    });

    await parse(testHarness, ["show", "restore_created_retained", "--json"]);

    expect(JSON.parse(testHarness.stdout[0])).toMatchObject({
      liveAuthority: { state: "retained", verified: true },
      actions: { abort: { candidate: true, eligible: true, blockers: [] } },
    });
  });

  it("releases an archive-pending terminal saga when the live lock is absent", async () => {
    const terminal = recoveryProjection({
      operationId: "restore_terminal_1",
      phase: "completed",
      basePhase: "session_committed",
      seq: 9,
      terminal: true,
    });
    const testHarness = harness({ projection: terminal, owner: null });
    testHarness.controller.release.mockReturnValue(
      mutationResult("release", "restore_terminal_1", {
        phase: "completed",
        seq: 9,
        headHash: HEAD_HASH,
        alreadyArchived: true,
      }),
    );

    await parse(testHarness, [
      "release",
      "restore_terminal_1",
      "--expected-seq",
      "9",
      "--expected-head-hash",
      HEAD_HASH,
      "--yes",
      "--json",
    ]);

    expect(testHarness.controller.release).toHaveBeenCalledWith(
      "restore_terminal_1",
      {
        expectedSeq: 9,
        expectedHash: HEAD_HASH,
        expectedOwnerDigest: null,
      },
    );
    expect(JSON.parse(testHarness.stdout[0])).toMatchObject({
      ok: true,
      action: "release",
      alreadyArchived: true,
    });
  });

  it("fails closed on a different live owner without leaking its evidence", async () => {
    const testHarness = harness();
    testHarness.dependencies.inspectWorkspaceLockOwnerSync.mockImplementation(
      () => {
        const error = new Error(RAW_REASON);
        error.code = "WORKSPACE_TRANSACTION_RECOVERY_REQUIRED";
        error.owner = workspaceOwner("different_operation");
        throw error;
      },
    );

    await parse(testHarness, ["show", "restore_cli_1", "--json"]);

    expect(testHarness.stdout).toEqual([]);
    const serialized = testHarness.stderr[0];
    expect(JSON.parse(serialized)).toMatchObject({
      error: {
        code: "WORKSPACE_TRANSACTION_RECOVERY_REQUIRED",
        message: "The workspace is owned by a different durable operation.",
      },
      exitCode: CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.NOT_EXECUTABLE,
    });
    expect(serialized).not.toContain(RAW_REASON);
    expect(serialized).not.toContain(OWNER_TOKEN);
    expect(serialized).not.toContain(WORKSPACE_ROOT);
  });

  it("reports missing exact mutation flags with a stable usage error", async () => {
    const testHarness = harness();

    await parse(testHarness, ["abort", "restore_cli_1", "--yes", "--json"]);

    expect(testHarness.controller.abort).not.toHaveBeenCalled();
    expect(JSON.parse(testHarness.stderr[0])).toMatchObject({
      error: {
        code: CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.INVALID_ARGUMENT,
      },
      exitCode: CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.INVALID_USAGE,
    });
  });

  it("projects a live owner digest without returning the inspected owner", () => {
    const owner = workspaceOwner("restore_preview_1");
    const dependencies = {
      inspectWorkspaceLockOwnerSync: vi.fn(() => owner),
      computeWorkspaceLockOwnerDigest: vi.fn(() => OTHER_OWNER_DIGEST),
    };

    const preview = previewCheckpointRestoreRecoveryAuthority(
      {
        workspaceRoot: WORKSPACE_ROOT,
        operationId: "restore_preview_1",
      },
      dependencies,
    );

    expect(preview).toEqual({
      state: "retained",
      verified: true,
      expectedOwnerDigest: OTHER_OWNER_DIGEST,
    });
    expect(JSON.stringify(preview)).not.toContain(OWNER_TOKEN);
    expect(JSON.stringify(preview)).not.toContain(WORKSPACE_ROOT);
  });

  it("handlers remain directly injectable without Commander", () => {
    const testHarness = harness({ owner: null });
    const handlers = createCheckpointRestoreRecoveryCommandHandlers(
      testHarness.dependencies,
    );

    const result = handlers.list({ json: true, limit: 1 });

    expect(result.items).toHaveLength(1);
    expect(testHarness.reader.list).toHaveBeenCalledWith({
      afterOperationId: "",
      limit: 1,
    });
  });
});

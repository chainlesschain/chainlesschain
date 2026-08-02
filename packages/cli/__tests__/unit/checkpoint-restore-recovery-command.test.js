import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";
import {
  CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES,
  CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES,
  createCheckpointRestoreRecoveryCommandHandlers,
  previewCheckpointRestoreRecoveryAuthority,
  registerCheckpointRestoreRecoveryCommands,
} from "../../src/commands/checkpoint-restore-recovery.js";

const HEAD_HASH = `sha256:${"a".repeat(64)}`;
const RECORDED_OWNER_DIGEST = `sha256:${"b".repeat(64)}`;
const LIVE_OWNER_DIGEST = `sha256:${"c".repeat(64)}`;
const OTHER_OWNER_DIGEST = `sha256:${"d".repeat(64)}`;
const OWNER_TOKEN = "private-owner-token-0000000000000001";
const WORKSPACE_ROOT = "C:\\private\\customer\\workspace";
const RAW_REASON = `secret recovery reason ${OWNER_TOKEN} ${WORKSPACE_ROOT}`;

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
      checkpointId: "checkpoint-1",
      sessionId: "session-1",
    },
    progress: { targetCount: 1, appliedCount: null },
    safety: { coverage: null, complete: false },
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
    },
  };
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
  return {
    ok: true,
    action: actionName,
    operationId,
    phase: actionName === "abort" ? "aborted" : "completed",
    seq: 4,
    headHash: `sha256:${"f".repeat(64)}`,
    archived: true,
    alreadyArchived: false,
    reconciledFromError: false,
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
  const observedOwner = owner === undefined ? workspaceOwner() : owner;
  const dependencies = {
    resolveWorkspaceRoot: vi.fn(() => WORKSPACE_ROOT),
    createStore: vi.fn(() => store),
    createRecoveryReader: vi.fn(() => reader),
    createRecoveryController: vi.fn(() => controller),
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
  it("registers only list/show/abort/release and documents deferred actions", () => {
    const testHarness = harness();
    const { recovery } = commandProgram(testHarness);

    expect(recovery.commands.map((command) => command.name()).sort()).toEqual([
      "abort",
      "list",
      "release",
      "show",
    ]);
    expect(recovery.helpInformation()).toMatch(
      /Resume\s+and rollback are read-only candidates only/,
    );
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

  it("renders resume and rollback as non-executable in human output", async () => {
    const mutationProjection = recoveryProjection({
      phase: "recovery_required",
      basePhase: "mutation_started",
      seq: 7,
    });
    const testHarness = harness({ projection: mutationProjection });

    await parse(testHarness, ["show", "restore_cli_1"]);

    expect(testHarness.stdout[0]).toContain(
      "resume: candidate only (not executable: action_not_implemented)",
    );
    expect(testHarness.stdout[0]).toContain(
      "rollback: candidate only (not executable: action_not_implemented)",
    );
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
      warning: { code: "CHECKPOINT_RESTORE_ARCHIVE_PENDING" },
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

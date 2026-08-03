import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CheckpointRestoreSagaStore,
  computeCheckpointRestoreWorkspaceLockOwnerDigest,
} from "../../src/lib/checkpoint-restore-saga.js";
import { computeCheckpointRestoreDigest } from "../../src/lib/checkpoint-restore-orchestrator.js";
import {
  CHECKPOINT_RESTORE_RECOVERY_RESOLUTION_SCHEMA,
  CHECKPOINT_RESTORE_SESSION_RECONCILIATION,
  CHECKPOINT_RESTORE_SESSION_RECOVERY_SCHEMA,
  CHECKPOINT_RESTORE_SESSION_RECOVERY_VERSION,
  computeCheckpointRestoreSessionRollbackCommitDigest,
} from "../../src/lib/checkpoint-restore-session-recovery.js";
import {
  CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ACTION,
  CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ERROR_CODES,
  CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_RESULT_SCHEMA,
  CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_RESULT_VERSION,
  CHECKPOINT_ROLLBACK_PLAN_SCHEMA,
  CHECKPOINT_ROLLBACK_PLAN_VERSION,
  CHECKPOINT_ROLLBACK_RESULT_SCHEMA,
  CHECKPOINT_ROLLBACK_RESULT_VERSION,
  CheckpointRestorePartialRollbackController,
} from "../../src/lib/checkpoint-restore-partial-rollback-controller.js";
import {
  inspectWorkspaceLockOwnerSync,
  withWorkspaceLockSync,
  withWorkspaceRecoveryLockSync,
} from "../../src/lib/process-execution-broker/workspace-transaction.js";

const roots = [];

function digest(value) {
  return `sha256:${Number(value).toString(16).padStart(64, "0")}`;
}

function rawHash(value) {
  return Number(value).toString(16).padStart(64, "0");
}

function secureDirectory(target) {
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") fs.chmodSync(target, 0o700);
}

function secureAuthorityPaths(targets) {
  return targets.map((target) => {
    const stat = fs.lstatSync(target);
    if (process.platform !== "win32") {
      fs.chmodSync(target, stat.isDirectory() ? 0o700 : 0o600);
    }
    return { target, exists: true, ok: true };
  });
}

function tokenSequence(prefix = "91000000") {
  let sequence = 0;
  return () =>
    `${prefix}-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
}

function captureThrown(callback) {
  try {
    callback();
  } catch (error) {
    return error;
  }
  return null;
}

function advance(store, saga, phase, evidence = {}) {
  return store.advance(saga.operationId, {
    expectedSeq: saga.seq,
    expectedHash: saga.headHash,
    phase,
    evidence,
  });
}

function stateDigest(domain, binding, stateIdentity) {
  return computeCheckpointRestoreDigest(domain, {
    engine: binding.engine,
    scopeIdentity: binding.scopeIdentity,
    stateIdentity,
  });
}

function mutationSetIdentity(engine, paths) {
  return computeCheckpointRestoreDigest(
    "cc-checkpoint-restore-original-mutation-set-v1",
    { engine, paths },
  );
}

function makeBinding(workspaceRoot, values = {}) {
  return {
    schema: "cc-checkpoint-workspace-binding/v1",
    version: 1,
    engine: "copy",
    workspaceRoot,
    scopeIdentity: values.scopeIdentity || digest(201),
    prestateIdentity: values.prestateIdentity || digest(202),
    writePlanIdentity: values.writePlanIdentity || digest(203),
    targetPoststateIdentity: values.targetPoststateIdentity || digest(204),
  };
}

function makePlan(input, targetCount = 2, options = {}) {
  const originalMutationPaths = options.originalMutationPaths || [
    "a.txt",
    "b.txt",
  ];
  const currentRollbackPaths = originalMutationPaths.slice(0, targetCount);
  const binding =
    options.binding ||
    makeBinding(input.workspaceRoot, {
      scopeIdentity: digest(301 + targetCount),
      prestateIdentity: digest(311 + targetCount),
      writePlanIdentity: digest(321 + targetCount),
      targetPoststateIdentity: digest(331 + targetCount),
    });
  return {
    schema: CHECKPOINT_ROLLBACK_PLAN_SCHEMA,
    version: CHECKPOINT_ROLLBACK_PLAN_VERSION,
    engine: "copy",
    workspaceRoot: input.workspaceRoot,
    checkpointNamespace: null,
    originalCheckpoint: {
      id: "checkpoint-rollback-1",
      identity: digest(401),
      treeIdentity: null,
    },
    safetyCheckpoint: {
      id: "safety-rollback-1",
      identity: digest(402),
      planIdentity: digest(403),
      treeIdentity: null,
    },
    originalMutationPaths,
    currentRollbackPaths,
    originalMutationTargetCount: originalMutationPaths.length,
    targetCount,
    expectedWorkspaceBinding: binding,
    originalWorkspaceBinding: null,
    originalBindingVerification: "durable-safety-plan-v2",
    originalPlanAuthority: {
      sourceCheckpointId: "checkpoint-rollback-1",
      sourceCheckpointIdentity: digest(401),
      safetyPlanIdentity: digest(403),
      mutationSetIdentity: mutationSetIdentity("copy", originalMutationPaths),
      bindingReconstructable: false,
    },
    rollbackPlanIdentity: binding.writePlanIdentity,
    rollbackPrestateDigest: stateDigest(
      "cc-checkpoint-restore-rollback-prestate-v1",
      binding,
      binding.prestateIdentity,
    ),
    expectedRollbackStateDigest: stateDigest(
      "cc-checkpoint-restore-rollback-state-v1",
      binding,
      binding.targetPoststateIdentity,
    ),
  };
}

function makeSettledVerificationPlan(input, settledPlan) {
  return makePlan(input, 0, {
    originalMutationPaths: settledPlan.originalMutationPaths,
    binding: makeBinding(input.workspaceRoot, {
      scopeIdentity: settledPlan.expectedWorkspaceBinding.scopeIdentity,
      prestateIdentity:
        settledPlan.expectedWorkspaceBinding.targetPoststateIdentity,
      writePlanIdentity: digest(799),
      targetPoststateIdentity:
        settledPlan.expectedWorkspaceBinding.targetPoststateIdentity,
    }),
  });
}

function makeGitPlan(input, targetCount = 2, options = {}) {
  const originalMutationPaths = options.originalMutationPaths || [
    "a.txt",
    "b.txt",
  ];
  const currentRollbackPaths = originalMutationPaths.slice(0, targetCount);
  const originalTreeIdentity = `git-tree:${"1".repeat(40)}`;
  const safetyTreeIdentity = `git-tree:${"2".repeat(40)}`;
  const originalWorkspaceBinding = {
    schema: "cc-checkpoint-workspace-binding/v1",
    version: 1,
    engine: "git",
    workspaceRoot: input.workspaceRoot,
    scopeIdentity: digest(611),
    prestateIdentity: safetyTreeIdentity,
    writePlanIdentity: digest(501),
    targetPoststateIdentity: originalTreeIdentity,
  };
  const expectedWorkspaceBinding = {
    schema: "cc-checkpoint-workspace-binding/v1",
    version: 1,
    engine: "git",
    workspaceRoot: input.workspaceRoot,
    scopeIdentity: digest(612),
    prestateIdentity: `git-tree:${"3".repeat(40)}`,
    writePlanIdentity: digest(613),
    targetPoststateIdentity: safetyTreeIdentity,
  };
  return {
    schema: CHECKPOINT_ROLLBACK_PLAN_SCHEMA,
    version: CHECKPOINT_ROLLBACK_PLAN_VERSION,
    engine: "git",
    workspaceRoot: input.workspaceRoot,
    checkpointNamespace: "partial-rollback-session",
    originalCheckpoint: {
      id: "checkpoint-rollback-1",
      identity: `git:${"4".repeat(40)}`,
      treeIdentity: originalTreeIdentity,
    },
    safetyCheckpoint: {
      id: "safety-rollback-1",
      identity: `git:${"5".repeat(40)}`,
      planIdentity: digest(501),
      treeIdentity: safetyTreeIdentity,
    },
    originalMutationPaths,
    currentRollbackPaths,
    originalMutationTargetCount: originalMutationPaths.length,
    targetCount,
    expectedWorkspaceBinding,
    originalWorkspaceBinding,
    originalBindingVerification: "exact-checkpoint-tree-reconstruction",
    originalPlanAuthority: {
      sourceCheckpointId: "checkpoint-rollback-1",
      sourceCheckpointIdentity: `git:${"4".repeat(40)}`,
      safetyPlanIdentity: digest(501),
      mutationSetIdentity: mutationSetIdentity("git", originalMutationPaths),
      bindingReconstructable: true,
    },
    rollbackPlanIdentity: expectedWorkspaceBinding.writePlanIdentity,
    rollbackPrestateDigest: stateDigest(
      "cc-checkpoint-restore-rollback-prestate-v1",
      expectedWorkspaceBinding,
      expectedWorkspaceBinding.prestateIdentity,
    ),
    expectedRollbackStateDigest: stateDigest(
      "cc-checkpoint-restore-rollback-state-v1",
      expectedWorkspaceBinding,
      expectedWorkspaceBinding.targetPoststateIdentity,
    ),
  };
}

function makeResult(plan) {
  return {
    schema: CHECKPOINT_ROLLBACK_RESULT_SCHEMA,
    version: CHECKPOINT_ROLLBACK_RESULT_VERSION,
    engine: plan.engine,
    rolledBackCount: plan.targetCount,
    rollbackStateDigest: plan.expectedRollbackStateDigest,
  };
}

function intentCommitDigest(eventHash) {
  return computeCheckpointRestoreDigest(
    "cc-checkpoint-restore-intent-commit-v1",
    eventHash,
  );
}

function makeTimelineContext(input, plan) {
  const intentEventHash = rawHash(701);
  const originalBinding = plan.originalWorkspaceBinding;
  return {
    sessionId: "session-partial-rollback-1",
    timelineEntryId: "turn-partial-rollback-1",
    intentEventHash,
    sessionHeadHash: intentEventHash,
    intentCommitDigest: intentCommitDigest(intentEventHash),
    authority: {
      revision: "revision-partial-rollback-1",
      action: "restore-code",
      turnId: "turn-partial-rollback-1",
      checkpointId: plan.originalCheckpoint.id,
      checkpointIdentity: plan.originalCheckpoint.identity,
      workspaceDir: input.workspaceRoot,
      workspaceScopeIdentity: originalBinding?.scopeIdentity || digest(601),
      workspacePrestateIdentity:
        originalBinding?.prestateIdentity || digest(602),
      workspaceWritePlanIdentity:
        originalBinding?.writePlanIdentity || digest(501),
      workspaceTargetPoststateIdentity:
        originalBinding?.targetPoststateIdentity || digest(603),
      confirmationDigest: digest(502),
    },
  };
}

function makeTimelineProjection(input, options = {}) {
  const context = input.timeline;
  const classification =
    options.classification ||
    CHECKPOINT_RESTORE_SESSION_RECONCILIATION.CODE_SETTLEMENT_RESUMABLE;
  const rolledBack =
    classification === CHECKPOINT_RESTORE_SESSION_RECONCILIATION.ROLLED_BACK;
  const resolutionEventHash = options.resolutionEventHash || rawHash(702);
  const resolutionInput = options.resolutionInput || null;
  const operationTailHash = rolledBack
    ? resolutionEventHash
    : context.intentEventHash;
  return {
    schema: CHECKPOINT_RESTORE_SESSION_RECOVERY_SCHEMA,
    version: CHECKPOINT_RESTORE_SESSION_RECOVERY_VERSION,
    operationId: input.operationId,
    sessionId: context.sessionId,
    restoreSurface: "timeline",
    classification,
    failClosed: false,
    safeToMutate: false,
    issues: [],
    transcript: {
      headHash: operationTailHash,
      eventCount: rolledBack ? 2 : 1,
      operationEventCount: rolledBack ? 2 : 1,
      operationTailHash,
      eventsAfterOperationTail: 0,
    },
    intent: {
      index: 1,
      eventHash: context.intentEventHash,
      prevHash: null,
      intentCommitDigest: context.intentCommitDigest,
      authority: { ...context.authority },
    },
    conversationCommit: null,
    audit: { completed: null, failed: null },
    resolution: rolledBack
      ? {
          index: 2,
          eventHash: resolutionEventHash,
          prevHash: context.sessionHeadHash,
          sessionRollbackCommitDigest:
            computeCheckpointRestoreSessionRollbackCommitDigest(
              resolutionEventHash,
            ),
          data: {
            schema: CHECKPOINT_RESTORE_RECOVERY_RESOLUTION_SCHEMA,
            version: 1,
            ...resolutionInput,
          },
        }
      : null,
  };
}

function makeResolutionReceipt(
  timeline,
  resolutionInput,
  eventHash = rawHash(702),
) {
  return {
    eventHash,
    prevHash: timeline.sessionHeadHash,
    sessionRollbackCommitDigest:
      computeCheckpointRestoreSessionRollbackCommitDigest(eventHash),
    resolution: {
      schema: CHECKPOINT_RESTORE_RECOVERY_RESOLUTION_SCHEMA,
      version: 1,
      ...resolutionInput,
    },
  };
}

function retainSaga(input) {
  const timeline = input.timeline || null;
  const plan = input.plan;
  const originalPrestateDigest =
    timeline || plan.engine === "git"
      ? stateDigest(
          "cc-checkpoint-restore-prestate-v1",
          {
            engine: plan.engine,
            scopeIdentity:
              timeline?.authority.workspaceScopeIdentity ||
              plan.originalWorkspaceBinding.scopeIdentity,
          },
          timeline?.authority.workspacePrestateIdentity ||
            plan.originalWorkspaceBinding.prestateIdentity,
        )
      : digest(503);
  const checkpointNamespace =
    input.createdCheckpointNamespace === undefined
      ? plan.checkpointNamespace
      : input.createdCheckpointNamespace;
  let saga = input.store.create({
    operationId: input.operationId,
    evidence: {
      restoreKind: plan.engine,
      restoreSurface: timeline ? "timeline" : "direct",
      checkpointId: plan.originalCheckpoint.id,
      checkpointIdentity: plan.originalCheckpoint.identity,
      workspaceBinding:
        plan.originalWorkspaceBinding?.writePlanIdentity || digest(501),
      confirmationDigest: digest(502),
      actorPid: process.pid,
      ...(checkpointNamespace == null ? {} : { checkpointNamespace }),
      ...(timeline
        ? {
            sessionId: timeline.sessionId,
            timelineEntryId: timeline.timelineEntryId,
          }
        : {}),
    },
  });
  const retained = captureThrown(() =>
    withWorkspaceLockSync(input.lockOptions(input.operationId), (lease) => {
      saga = advance(input.store, saga, "locked", {
        workspaceLockOwner: lease.owner,
      });
      saga = advance(input.store, saga, "prepared", {
        prestateDigest: originalPrestateDigest,
        targetCount: input.originalMutationTargetCount,
        workspaceBinding:
          plan.originalWorkspaceBinding?.writePlanIdentity || digest(501),
      });
      saga = advance(input.store, saga, "intent_committed", {
        intentAuthority: timeline ? "session" : "operation",
        intentCommitDigest: timeline
          ? timeline.intentCommitDigest
          : digest(504),
        ...(timeline
          ? {
              sessionId: timeline.sessionId,
              timelineEntryId: timeline.timelineEntryId,
            }
          : {}),
      });
      saga = advance(input.store, saga, "safety_ready", {
        safetyId: plan.safetyCheckpoint.id,
        safetyIdentity: plan.safetyCheckpoint.identity,
        safetyPlanIdentity: plan.safetyCheckpoint.planIdentity,
        safetyCoverage: "full",
      });
      saga = advance(input.store, saga, "mutation_started", {
        targetCount: input.originalMutationTargetCount,
      });
      lease.retainForRecovery("partial mutation fixture");
    }),
  );
  expect(retained).toMatchObject({
    workspaceLockRetained: true,
    retainedOwner: { transactionId: input.operationId },
  });
  return { saga, owner: retained.retainedOwner };
}

function fixture(options = {}) {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "cc-partial-rollback-")),
  );
  roots.push(root);
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(workspace, { recursive: true });
  const workspaceRoot = fs.realpathSync.native(workspace);
  const operationId = "restore_partial_rollback_1";
  const store = new CheckpointRestoreSagaStore({
    workspaceRoot,
    stateDir: path.join(root, "state", "checkpoint-restores"),
    secureDirectory,
    secureAuthorityPaths,
  });
  const lockDir = path.join(root, "locks");
  let now = 1_000;
  const workspaceLockOptions = {
    lockDir,
    allowNonCanonicalLockDirForTests: true,
    timeoutMs: 50,
    retryMs: 5,
    _now: () => now,
    _sleep: (milliseconds) => {
      now += milliseconds;
    },
    _isProcessAlive: () => false,
    _ownerToken: tokenSequence(),
  };
  const lockOptions = (id) => ({
    ...workspaceLockOptions,
    workspaceRoot,
    operationId: id,
    purpose: "checkpoint-restore",
  });
  const setup = { root, workspaceRoot, operationId, store, lockOptions };
  const makeEnginePlan = options.restoreKind === "git" ? makeGitPlan : makePlan;
  const plan =
    options.plan ||
    makeEnginePlan(setup, options.targetCount ?? 2, {
      originalMutationPaths: options.originalMutationPaths,
    });
  const timeline =
    options.restoreSurface === "timeline"
      ? makeTimelineContext(setup, plan)
      : null;
  Object.assign(setup, {
    plan,
    timeline,
    originalMutationTargetCount: plan.originalMutationTargetCount,
    createdCheckpointNamespace: options.createdCheckpointNamespace,
  });
  const retained = retainSaga(setup);
  const log = [];

  const controllerStore = {
    load: (...args) => {
      const loaded = store.load(...args);
      return options.loadHook ? options.loadHook({ args, loaded }) : loaded;
    },
    advance: (id, request) => {
      log.push(`saga:${request.phase}`);
      const callDefault = () => store.advance(id, request);
      return options.advanceHook
        ? options.advanceHook({ id, request, callDefault })
        : callDefault();
    },
    archiveTerminal: (id, request) => {
      log.push("archive");
      if (options.archiveError) throw options.archiveError;
      return store.archiveTerminal(id, request);
    },
  };
  const prepareWorkspaceRollback = vi.fn((request) => {
    log.push("workspace:prepare");
    if (options.prepareHook) {
      return options.prepareHook({ request, plan });
    }
    return options.prepareResult === undefined ? plan : options.prepareResult;
  });
  const executeWorkspaceRollback = vi.fn((request) => {
    log.push("workspace:execute");
    if (options.executeHook) {
      return options.executeHook({ request, plan });
    }
    return options.executeResult === undefined
      ? makeResult(plan)
      : options.executeResult;
  });
  const withRecoveryLock = (request, callback) => {
    log.push("workspace:acquire");
    try {
      const result = withWorkspaceRecoveryLockSync(request, callback);
      log.push("workspace:released");
      return result;
    } catch (error) {
      if (error?.workspaceLockRetained) log.push("workspace:retained");
      throw error;
    }
  };
  const readSessionRecovery = options.readSessionRecovery
    ? (...args) => {
        log.push("session:read");
        return options.readSessionRecovery(...args);
      }
    : undefined;
  const withSessionAuthorityTransaction =
    options.withSessionAuthorityTransaction
      ? (...args) => {
          log.push("session:transaction");
          return options.withSessionAuthorityTransaction(...args);
        }
      : undefined;
  const appendSessionResolution = options.appendSessionResolution
    ? (...args) => {
        log.push("session:append");
        return options.appendSessionResolution(...args);
      }
    : undefined;
  const reconcileSessionResolution = options.reconcileSessionResolution
    ? (...args) => {
        log.push("session:reconcile");
        return options.reconcileSessionResolution(...args);
      }
    : undefined;
  const controller = new CheckpointRestorePartialRollbackController({
    workspaceRoot,
    store: controllerStore,
    prepareWorkspaceRollback,
    executeWorkspaceRollback,
    createRecoveryRequestId:
      options.createRecoveryRequestId || (() => "rollback-request-1"),
    workspaceLockOptions,
    withWorkspaceRecoveryLockSync:
      options.withWorkspaceRecoveryLockSync || withRecoveryLock,
    readSessionRecovery,
    withSessionAuthorityTransaction,
    appendSessionResolution,
    reconcileSessionResolution,
  });

  return {
    ...setup,
    retained,
    timeline,
    log,
    plan,
    controller,
    prepareWorkspaceRollback,
    executeWorkspaceRollback,
  };
}

function ownerDigest(input) {
  return computeCheckpointRestoreWorkspaceLockOwnerDigest(input.retained.owner);
}

function currentOwner(input) {
  return inspectWorkspaceLockOwnerSync(input.lockOptions(input.operationId));
}

function archivedEvents(input) {
  const directory = path.join(input.store.archiveRoot, input.operationId);
  return fs
    .readdirSync(directory)
    .filter((name) => /^\d{6}-.+\.json$/u.test(name))
    .sort()
    .map((name) =>
      JSON.parse(fs.readFileSync(path.join(directory, name), "utf8")),
    );
}

function rollback(input, overrides = {}) {
  return input.controller.rollback(input.operationId, {
    expectedSeq: input.retained.saga.seq,
    expectedHash: input.retained.saga.headHash,
    expectedOwnerDigest: ownerDigest(input),
    ...overrides,
  });
}

function rollbackCurrent(input) {
  const saga = input.store.load(input.operationId);
  const owner = currentOwner(input);
  return input.controller.rollback(input.operationId, {
    expectedSeq: saga.seq,
    expectedHash: saga.headHash,
    expectedOwnerDigest:
      computeCheckpointRestoreWorkspaceLockOwnerDigest(owner),
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("CheckpointRestorePartialRollbackController direct recovery", () => {
  it("executes an authority-bound partial rollback, releases, then archives", () => {
    const input = fixture();

    const result = rollback(input);

    expect(result).toMatchObject({
      schema: CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_RESULT_SCHEMA,
      version: CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_RESULT_VERSION,
      ok: true,
      action: CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ACTION,
      phase: "rolled_back",
      recoveryRequestId: "rollback-request-1",
      rolledBackCount: 2,
      rollbackStateDigest: input.plan.expectedRollbackStateDigest,
      resultDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      sessionRollbackCommitDigest: null,
      archived: true,
      warning: null,
    });
    expect(input.executeWorkspaceRollback).toHaveBeenCalledTimes(1);
    expect(currentOwner(input)).toBeNull();
    expect(
      archivedEvents(input)
        .slice(-6)
        .map((event) => event.phase),
    ).toEqual([
      "recovery_required",
      "recovery_started",
      "rollback_prepared",
      "rollback_started",
      "workspace_rolled_back",
      "rolled_back",
    ]);
    expect(input.log).toEqual([
      "workspace:acquire",
      "saga:recovery_required",
      "saga:recovery_started",
      "workspace:prepare",
      "saga:rollback_prepared",
      "saga:rollback_started",
      "workspace:execute",
      "saga:workspace_rolled_back",
      "saga:rolled_back",
      "workspace:released",
      "archive",
    ]);
  });

  it("settles a verified zero-target plan without executing mutation", () => {
    const input = fixture({ targetCount: 0 });

    const result = rollback(input);

    expect(result).toMatchObject({
      phase: "rolled_back",
      rolledBackCount: 0,
      rollbackStateDigest: input.plan.expectedRollbackStateDigest,
    });
    expect(input.executeWorkspaceRollback).not.toHaveBeenCalled();
    expect(
      archivedEvents(input)
        .slice(-3)
        .map((event) => event.phase),
    ).toEqual(["rollback_prepared", "workspace_rolled_back", "rolled_back"]);
  });

  it("rejects stale saga and owner authority before takeover", () => {
    const stale = fixture();
    const ownerBefore = currentOwner(stale);
    expect(() =>
      rollback(stale, { expectedSeq: stale.retained.saga.seq + 1 }),
    ).toThrow(
      expect.objectContaining({
        code: CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ERROR_CODES.SAGA_CONFLICT,
      }),
    );
    expect(currentOwner(stale)).toEqual(ownerBefore);
    expect(stale.log).toEqual([]);

    const drift = fixture();
    const driftBefore = currentOwner(drift);
    expect(() => rollback(drift, { expectedOwnerDigest: digest(999) })).toThrow(
      expect.objectContaining({
        code: CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ERROR_CODES.OWNER_CONFLICT,
      }),
    );
    expect(currentOwner(drift)).toEqual(driftBefore);
    expect(drift.log).toEqual([]);
  });

  it("rejects a drifted rollback plan and retains the replacement owner", () => {
    const input = fixture();
    input.plan.rollbackPlanIdentity = digest(998);

    const error = captureThrown(() => rollback(input));

    expect(error).toMatchObject({
      workspaceLockRetained: true,
      checkpointRestoreRecoveryRequired: true,
      checkpointRestoreSagaPhase: "recovery_required",
      checkpointRestoreRecoveryCause: {
        code: CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ERROR_CODES.PLAN_INVALID,
      },
    });
    expect(input.store.load(input.operationId).phase).toBe("recovery_required");
    expect(currentOwner(input)).not.toBeNull();
    expect(input.executeWorkspaceRollback).not.toHaveBeenCalled();
  });

  it("rejects incomplete and asynchronous execution evidence", () => {
    const invalid = fixture({
      executeResult: {
        schema: CHECKPOINT_ROLLBACK_RESULT_SCHEMA,
        version: CHECKPOINT_ROLLBACK_RESULT_VERSION,
        engine: "copy",
        rolledBackCount: 1,
        rollbackStateDigest: digest(901),
      },
    });
    const invalidError = captureThrown(() => rollback(invalid));
    expect(invalidError).toMatchObject({
      workspaceLockRetained: true,
      checkpointRestoreRecoveryCause: {
        code: CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ERROR_CODES.RESULT_INVALID,
      },
    });

    const asynchronous = fixture({ executeResult: Promise.resolve({}) });
    const asyncError = captureThrown(() => rollback(asynchronous));
    expect(asyncError).toMatchObject({
      workspaceLockRetained: true,
      checkpointRestoreRecoveryCause: {
        code: CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ERROR_CODES.ASYNC_UNSUPPORTED,
      },
    });
  });

  it("reconciles an exact terminal CAS after its response is lost", () => {
    let loseResponse = true;
    const input = fixture({
      advanceHook: ({ request, callDefault }) => {
        if (request.phase === "rolled_back" && loseResponse) {
          loseResponse = false;
          callDefault();
          const error = new Error("rolled_back response lost");
          error.code = "INJECTED_ROLLED_BACK_RESPONSE_LOST";
          error.commitState = "head_settlement_unknown";
          throw error;
        }
        return callDefault();
      },
    });

    const result = rollback(input);

    expect(result).toMatchObject({
      phase: "rolled_back",
      reconciledFromError: false,
      archived: true,
    });
    expect(
      archivedEvents(input).filter((event) => event.phase === "rolled_back"),
    ).toHaveLength(1);
    expect(currentOwner(input)).toBeNull();
  });

  it("retains when terminal publication is not committed", () => {
    const input = fixture({
      advanceHook: ({ request, callDefault }) => {
        if (request.phase === "rolled_back") {
          const error = new Error("terminal journal unavailable");
          error.code = "INJECTED_TERMINAL_FAILURE";
          throw error;
        }
        return callDefault();
      },
    });

    const error = captureThrown(() => rollback(input));

    expect(error).toMatchObject({
      workspaceLockRetained: true,
      checkpointRestoreSagaPhase: "recovery_required",
      checkpointRestoreRecoveryCause: {
        code: "INJECTED_TERMINAL_FAILURE",
      },
    });
    expect(input.store.load(input.operationId).phase).toBe("recovery_required");
    expect(currentOwner(input)).not.toBeNull();
  });

  it("returns archive warning only after releasing the workspace lease", () => {
    const archiveError = new Error("archive unavailable");
    archiveError.code = "INJECTED_ARCHIVE_FAILURE";
    archiveError.commitState = "archive_not_committed";
    const input = fixture({ archiveError });

    const result = rollback(input);

    expect(result).toMatchObject({
      phase: "rolled_back",
      archived: false,
      warning: {
        code: "INJECTED_ARCHIVE_FAILURE",
        commitState: "archive_not_committed",
      },
    });
    expect(currentOwner(input)).toBeNull();
    expect(input.store.load(input.operationId).phase).toBe("rolled_back");
    expect(input.log.slice(-2)).toEqual(["workspace:released", "archive"]);
  });
});

describe("CheckpointRestorePartialRollbackController authority boundaries", () => {
  it("projects copy checkpoint namespace as null and rejects a non-null namespace", () => {
    const valid = fixture();

    rollback(valid);

    expect(
      valid.prepareWorkspaceRollback.mock.calls[0][0].expected
        .checkpointNamespace,
    ).toBeNull();

    const invalid = fixture({
      createdCheckpointNamespace: "copy-must-not-have-a-namespace",
    });
    const ownerBefore = currentOwner(invalid);
    expect(() => rollback(invalid)).toThrow(
      expect.objectContaining({
        code: CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ERROR_CODES.ACTION_NOT_ALLOWED,
      }),
    );
    expect(currentOwner(invalid)).toEqual(ownerBefore);
    expect(invalid.log).toEqual([]);
  });

  it("accepts an exact canonical mutation set larger than 2000 paths", () => {
    const originalMutationPaths = Array.from(
      { length: 2_001 },
      (_, index) => `bulk/${String(index).padStart(4, "0")}.txt`,
    );
    const input = fixture({
      originalMutationPaths,
      targetCount: originalMutationPaths.length,
    });

    const result = rollback(input);

    expect(result).toMatchObject({
      phase: "rolled_back",
      rolledBackCount: 2_001,
    });
    expect(input.executeWorkspaceRollback).toHaveBeenCalledTimes(1);
  });

  it("fails closed on a thenable lease assertion without journal CAS", () => {
    let retained = false;
    const input = fixture({
      withWorkspaceRecoveryLockSync: (request, callback) =>
        callback({
          recoveryOfOperationId: request.operationId,
          owner: request.expectedOwner,
          assertOwned: () => Promise.resolve(),
          retainForRecovery: () => {
            retained = true;
          },
        }),
    });

    const error = captureThrown(() => rollback(input));

    expect(error).toMatchObject({
      code: CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ERROR_CODES.ASYNC_UNSUPPORTED,
    });
    expect(retained).toBe(true);
    expect(input.store.load(input.operationId).phase).toBe("mutation_started");
    expect(input.prepareWorkspaceRollback).not.toHaveBeenCalled();
  });

  it("re-verifies safety state and preserves a nonzero direct settlement on retry", () => {
    let input;
    let prepareCount = 0;
    let failTerminal = true;
    input = fixture({
      prepareHook: ({ plan }) =>
        prepareCount++ === 0 ? plan : makeSettledVerificationPlan(input, plan),
      advanceHook: ({ request, callDefault }) => {
        if (request.phase === "rolled_back" && failTerminal) {
          failTerminal = false;
          const error = new Error("terminal response not committed");
          error.code = "INJECTED_DIRECT_TERMINAL_FAILURE";
          throw error;
        }
        return callDefault();
      },
    });

    const firstError = captureThrown(() => rollback(input));
    expect(firstError).toMatchObject({ workspaceLockRetained: true });
    expect(input.executeWorkspaceRollback).toHaveBeenCalledTimes(1);

    const result = rollbackCurrent(input);

    expect(result).toMatchObject({
      phase: "rolled_back",
      recoveryRequestId: "rollback-request-1",
      rolledBackCount: 2,
      rollbackStateDigest: input.plan.expectedRollbackStateDigest,
      archived: true,
    });
    expect(input.executeWorkspaceRollback).toHaveBeenCalledTimes(1);
    expect(input.prepareWorkspaceRollback).toHaveBeenCalledTimes(2);
    expect(
      archivedEvents(input)
        .filter((event) => event.phase === "workspace_rolled_back")
        .map((event) => event.evidence.rolledBackCount),
    ).toEqual([2, 2]);
  });

  it("fails closed when a settled retry result digest is well-formed but tampered", () => {
    let input;
    let prepareCount = 0;
    let failTerminal = true;
    let tamperSettlement = false;
    input = fixture({
      prepareHook: ({ plan }) =>
        prepareCount++ === 0 ? plan : makeSettledVerificationPlan(input, plan),
      advanceHook: ({ request, callDefault }) => {
        if (request.phase === "rolled_back" && failTerminal) {
          failTerminal = false;
          const error = new Error("terminal publication failed");
          error.code = "INJECTED_SETTLED_RETRY_FIXTURE";
          throw error;
        }
        return callDefault();
      },
      loadHook: ({ loaded }) => {
        if (!tamperSettlement) return loaded;
        const tampered = JSON.parse(JSON.stringify(loaded));
        const workspaceSettlement = tampered.events.find(
          (event) => event.phase === "workspace_rolled_back",
        );
        workspaceSettlement.evidence.resultDigest = digest(998);
        return tampered;
      },
    });

    const firstError = captureThrown(() => rollback(input));
    expect(firstError).toMatchObject({ workspaceLockRetained: true });
    expect(input.executeWorkspaceRollback).toHaveBeenCalledTimes(1);

    tamperSettlement = true;
    const retryError = captureThrown(() => rollbackCurrent(input));

    expect(retryError).toMatchObject({
      workspaceLockRetained: true,
      checkpointRestoreRecoveryCause: {
        code: CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ERROR_CODES.PLAN_INVALID,
      },
    });
    expect(input.store.load(input.operationId).phase).toBe("recovery_required");
    expect(currentOwner(input)).not.toBeNull();
    expect(input.prepareWorkspaceRollback).toHaveBeenCalledTimes(2);
    expect(input.executeWorkspaceRollback).toHaveBeenCalledTimes(1);
  });
});

describe("CheckpointRestorePartialRollbackController timeline recovery", () => {
  it.each(["copy", "git"])(
    "settles one %s rollback through session authority before saga terminal CAS",
    (restoreKind) => {
      let input;
      const readSessionRecovery = vi.fn(() => makeTimelineProjection(input));
      const withSessionAuthorityTransaction = vi.fn(
        (sessionId, expectedHeadHash, callback) => {
          expect(sessionId).toBe(input.timeline.sessionId);
          expect(expectedHeadHash).toBe(input.timeline.sessionHeadHash);
          return callback({});
        },
      );
      const appendSessionResolution = vi.fn(
        (_transaction, resolutionInput, { expectedHeadHash }) => {
          expect(expectedHeadHash).toBe(input.timeline.sessionHeadHash);
          return makeResolutionReceipt(input.timeline, resolutionInput);
        },
      );
      input = fixture({
        restoreKind,
        restoreSurface: "timeline",
        readSessionRecovery,
        withSessionAuthorityTransaction,
        appendSessionResolution,
      });

      const result = rollback(input);

      expect(result).toMatchObject({
        phase: "rolled_back",
        rolledBackCount: 2,
        sessionRollbackCommitDigest:
          computeCheckpointRestoreSessionRollbackCommitDigest(rawHash(702)),
        archived: true,
      });
      expect(readSessionRecovery).toHaveBeenCalledTimes(1);
      expect(withSessionAuthorityTransaction).toHaveBeenCalledTimes(1);
      expect(appendSessionResolution).toHaveBeenCalledTimes(1);
      expect(input.log.indexOf("workspace:acquire")).toBeLessThan(
        input.log.indexOf("session:read"),
      );
      expect(input.log.indexOf("session:read")).toBeLessThan(
        input.log.indexOf("saga:recovery_required"),
      );
      expect(input.log.indexOf("session:append")).toBeLessThan(
        input.log.indexOf("saga:session_rollback_committed"),
      );
      expect(input.log.slice(-2)).toEqual(["workspace:released", "archive"]);
      expect(
        archivedEvents(input)
          .slice(-7)
          .map((event) => event.phase),
      ).toEqual([
        "recovery_required",
        "recovery_started",
        "rollback_prepared",
        "rollback_started",
        "workspace_rolled_back",
        "session_rollback_committed",
        "rolled_back",
      ]);
    },
  );

  it("reconciles a lost session append response and preserves the historical workspace hash", () => {
    let input;
    let resolutionVisible = false;
    let capturedResolutionInput = null;
    let prepareCount = 0;
    const readSessionRecovery = vi.fn(() =>
      resolutionVisible
        ? makeTimelineProjection(input, {
            classification:
              CHECKPOINT_RESTORE_SESSION_RECONCILIATION.ROLLED_BACK,
            resolutionInput: capturedResolutionInput,
          })
        : makeTimelineProjection(input),
    );
    const withSessionAuthorityTransaction = vi.fn(
      (_sessionId, _expectedHeadHash, callback) => callback({}),
    );
    const appendSessionResolution = vi.fn((_transaction, resolutionInput) => {
      capturedResolutionInput = resolutionInput;
      const error = new Error("session append response lost");
      error.code = "INJECTED_SESSION_RESPONSE_LOSS";
      error.commitState = "unknown";
      throw error;
    });
    input = fixture({
      restoreSurface: "timeline",
      readSessionRecovery,
      withSessionAuthorityTransaction,
      appendSessionResolution,
      prepareHook: ({ plan }) =>
        prepareCount++ === 0 ? plan : makeSettledVerificationPlan(input, plan),
    });

    const firstError = captureThrown(() => rollback(input));

    expect(firstError).toMatchObject({
      workspaceLockRetained: true,
      checkpointRestoreRecoveryCause: {
        code: CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ERROR_CODES.SESSION_CONFLICT,
        commitState: "unknown",
      },
    });
    expect(appendSessionResolution).toHaveBeenCalledTimes(1);
    expect(input.executeWorkspaceRollback).toHaveBeenCalledTimes(1);
    const failedSaga = input.store.load(input.operationId);
    const historicalWorkspaceEvent = failedSaga.events.find(
      (event) => event.phase === "workspace_rolled_back",
    );
    expect(capturedResolutionInput.sagaWorkspaceRolledBackHash).toBe(
      historicalWorkspaceEvent.hash,
    );

    resolutionVisible = true;
    const result = rollbackCurrent(input);

    expect(result).toMatchObject({
      phase: "rolled_back",
      recoveryRequestId: "rollback-request-1",
      rolledBackCount: 2,
      rollbackStateDigest: input.plan.expectedRollbackStateDigest,
      reconciledFromError: true,
      archived: true,
    });
    expect(input.executeWorkspaceRollback).toHaveBeenCalledTimes(1);
    expect(input.prepareWorkspaceRollback).toHaveBeenCalledTimes(2);
    expect(appendSessionResolution).toHaveBeenCalledTimes(1);
    const workspaceEvents = archivedEvents(input).filter(
      (event) => event.phase === "workspace_rolled_back",
    );
    expect(workspaceEvents).toHaveLength(2);
    expect(workspaceEvents[0].hash).toBe(
      capturedResolutionInput.sagaWorkspaceRolledBackHash,
    );
    expect(workspaceEvents[1].hash).not.toBe(workspaceEvents[0].hash);
    expect(
      archivedEvents(input).find(
        (event) => event.phase === "session_rollback_committed",
      ).evidence.sessionRollbackCommitDigest,
    ).toBe(computeCheckpointRestoreSessionRollbackCommitDigest(rawHash(702)));
  });

  it("settles in one attempt when an unknown append is immediately visible as ROLLED_BACK", () => {
    let input;
    let capturedResolutionInput = null;
    const readSessionRecovery = vi.fn(() =>
      capturedResolutionInput
        ? makeTimelineProjection(input, {
            classification:
              CHECKPOINT_RESTORE_SESSION_RECONCILIATION.ROLLED_BACK,
            resolutionInput: capturedResolutionInput,
          })
        : makeTimelineProjection(input),
    );
    const appendSessionResolution = vi.fn((_transaction, resolutionInput) => {
      capturedResolutionInput = resolutionInput;
      const error = new Error("append committed but response was lost");
      error.code = "INJECTED_COMMITTED_RESPONSE_LOSS";
      error.commitState = "unknown";
      throw error;
    });
    input = fixture({
      restoreSurface: "timeline",
      readSessionRecovery,
      withSessionAuthorityTransaction: (
        _sessionId,
        _expectedHeadHash,
        callback,
      ) => callback({}),
      appendSessionResolution,
    });

    const result = rollback(input);

    expect(result).toMatchObject({
      phase: "rolled_back",
      rolledBackCount: 2,
      reconciledFromError: true,
      archived: true,
    });
    expect(readSessionRecovery).toHaveBeenCalledTimes(2);
    expect(appendSessionResolution).toHaveBeenCalledTimes(1);
    expect(input.executeWorkspaceRollback).toHaveBeenCalledTimes(1);
    const historicalWorkspaceEvent = archivedEvents(input).find(
      (event) => event.phase === "workspace_rolled_back",
    );
    expect(capturedResolutionInput.sagaWorkspaceRolledBackHash).toBe(
      historicalWorkspaceEvent.hash,
    );
  });

  it("re-verifies an existing session settlement and republishes only that settlement", () => {
    let input;
    let capturedResolutionInput = null;
    let prepareCount = 0;
    let failTerminal = true;
    const readSessionRecovery = vi.fn(() =>
      capturedResolutionInput
        ? makeTimelineProjection(input, {
            classification:
              CHECKPOINT_RESTORE_SESSION_RECONCILIATION.ROLLED_BACK,
            resolutionInput: capturedResolutionInput,
          })
        : makeTimelineProjection(input),
    );
    const appendSessionResolution = vi.fn((_transaction, resolutionInput) => {
      capturedResolutionInput = resolutionInput;
      return makeResolutionReceipt(input.timeline, resolutionInput);
    });
    input = fixture({
      restoreSurface: "timeline",
      readSessionRecovery,
      withSessionAuthorityTransaction: (
        _sessionId,
        _expectedHeadHash,
        callback,
      ) => callback({}),
      appendSessionResolution,
      prepareHook: ({ plan }) =>
        prepareCount++ === 0 ? plan : makeSettledVerificationPlan(input, plan),
      advanceHook: ({ request, callDefault }) => {
        if (request.phase === "rolled_back" && failTerminal) {
          failTerminal = false;
          const error = new Error("timeline terminal not committed");
          error.code = "INJECTED_TIMELINE_TERMINAL_FAILURE";
          throw error;
        }
        return callDefault();
      },
    });

    const firstError = captureThrown(() => rollback(input));
    expect(firstError).toMatchObject({ workspaceLockRetained: true });
    expect(input.store.load(input.operationId).phase).toBe("recovery_required");

    const result = rollbackCurrent(input);

    expect(result).toMatchObject({
      phase: "rolled_back",
      rolledBackCount: 2,
      reconciledFromError: true,
      archived: true,
    });
    expect(input.executeWorkspaceRollback).toHaveBeenCalledTimes(1);
    expect(input.prepareWorkspaceRollback).toHaveBeenCalledTimes(2);
    expect(appendSessionResolution).toHaveBeenCalledTimes(1);
    const events = archivedEvents(input);
    expect(
      events.filter((event) => event.phase === "workspace_rolled_back"),
    ).toHaveLength(1);
    expect(
      events
        .filter((event) => event.phase === "session_rollback_committed")
        .map((event) => event.evidence.rolledBackCount),
    ).toEqual([2, 2]);
    expect(capturedResolutionInput.sagaWorkspaceRolledBackHash).toBe(
      events.find((event) => event.phase === "workspace_rolled_back").hash,
    );
  });
});

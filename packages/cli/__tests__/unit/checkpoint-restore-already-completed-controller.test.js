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
  CHECKPOINT_RESTORE_ALREADY_COMPLETED_ACTION,
  CHECKPOINT_RESTORE_ALREADY_COMPLETED_ERROR_CODES,
  CHECKPOINT_RESTORE_WORKSPACE_TARGET_VERIFICATION_SCHEMA,
  CHECKPOINT_RESTORE_WORKSPACE_TARGET_VERIFICATION_VERSION,
  CheckpointRestoreAlreadyCompletedController,
} from "../../src/lib/checkpoint-restore-already-completed-controller.js";
import { readCheckpointRestoreSessionRecovery } from "../../src/lib/checkpoint-restore-session-recovery.js";
import {
  CHECKPOINT_TIMELINE_AUDIT_EVENT,
  CHECKPOINT_TIMELINE_INTENT_EVENT,
} from "../../src/lib/checkpoint-timeline-authority.js";
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

function tokenSequence(prefix = "81000000") {
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

function transcriptAuthority(workspaceRoot, action = "restore-code") {
  return {
    revision: "revision-11",
    action,
    turnId: "turn-11",
    checkpointId: "checkpoint-11",
    checkpointIdentity: "git:checkpoint-identity-11",
    workspaceDir: workspaceRoot,
    workspaceScopeIdentity: digest(101),
    workspacePrestateIdentity: `git-tree:${"1".repeat(40)}`,
    workspaceWritePlanIdentity: digest(102),
    workspaceTargetPoststateIdentity: `git-tree:${"2".repeat(40)}`,
    confirmationDigest: digest(103),
  };
}

function sessionTranscript(workspaceRoot) {
  const authority = transcriptAuthority(workspaceRoot);
  const intentHash = rawHash(201);
  const completedHash = rawHash(202);
  const events = Object.freeze([
    Object.freeze({
      type: CHECKPOINT_TIMELINE_INTENT_EVENT,
      timestamp: 1_780_000_000_001,
      data: Object.freeze({
        operationId: "restore_completed_11",
        ...authority,
      }),
      prevHash: null,
      hash: intentHash,
    }),
    Object.freeze({
      type: CHECKPOINT_TIMELINE_AUDIT_EVENT,
      timestamp: 1_780_000_000_002,
      data: Object.freeze({
        operationId: "restore_completed_11",
        ...authority,
        status: "completed",
      }),
      prevHash: intentHash,
      hash: completedHash,
    }),
  ]);
  return Object.freeze({
    authority: Object.freeze(authority),
    events,
    intentCommitDigest: computeCheckpointRestoreDigest(
      "cc-checkpoint-restore-intent-commit-v1",
      intentHash,
    ),
    sessionCommitDigest: computeCheckpointRestoreDigest(
      "cc-checkpoint-restore-session-commit-v1",
      completedHash,
    ),
    prestateDigest: computeCheckpointRestoreDigest(
      "cc-checkpoint-restore-prestate-v1",
      {
        engine: "git",
        scopeIdentity: authority.workspaceScopeIdentity,
        stateIdentity: authority.workspacePrestateIdentity,
      },
    ),
    poststateDigest: computeCheckpointRestoreDigest(
      "cc-checkpoint-restore-poststate-v1",
      {
        engine: "git",
        scopeIdentity: authority.workspaceScopeIdentity,
        stateIdentity: authority.workspaceTargetPoststateIdentity,
      },
    ),
  });
}

function readVerifiedSessionProjection(events, options) {
  return readCheckpointRestoreSessionRecovery(options, {
    readVerifiedProjection: (_sessionId, createProjection) => {
      const projection = createProjection();
      for (const event of events) projection.accept(event);
      return projection.finish({
        headHash: events.at(-1)?.hash ?? null,
        eventCount: events.length,
        readMessages: () => {
          throw new Error("already-completed recovery must not read messages");
        },
      });
    },
  });
}

function retainSaga(
  input,
  {
    basePhase = "workspace_applied",
    restoreSurface = "timeline",
    recoveryTail = null,
  } = {},
) {
  const operationId = input.operationId;
  const timeline = input.timeline;
  let saga = input.store.create({
    operationId,
    evidence: {
      restoreKind: "git",
      restoreSurface,
      checkpointNamespace: "git",
      checkpointId: timeline.authority.checkpointId,
      checkpointIdentity: timeline.authority.checkpointIdentity,
      ...(restoreSurface === "timeline"
        ? { sessionId: input.sessionId, timelineEntryId: "turn-11" }
        : {}),
      workspaceBinding: timeline.authority.workspaceWritePlanIdentity,
      confirmationDigest: timeline.authority.confirmationDigest,
      actorPid: process.pid,
    },
  });
  const retained = captureThrown(() =>
    withWorkspaceLockSync(input.lockOptions(operationId), (lease) => {
      saga = advance(input.store, saga, "locked", {
        workspaceLockOwner: lease.owner,
      });
      saga = advance(input.store, saga, "prepared", {
        prestateDigest: timeline.prestateDigest,
        targetCount: 1,
        workspaceBinding: timeline.authority.workspaceWritePlanIdentity,
      });
      saga = advance(input.store, saga, "intent_committed", {
        intentAuthority:
          restoreSurface === "timeline" ? "session" : "operation",
        intentCommitDigest: timeline.intentCommitDigest,
        ...(restoreSurface === "timeline"
          ? { sessionId: input.sessionId, timelineEntryId: "turn-11" }
          : {}),
      });
      saga = advance(input.store, saga, "safety_ready", {
        safetyId: "safety-11",
        safetyIdentity: "safety-identity-11",
        safetyPlanIdentity: "safety-plan-11",
        safetyCoverage: "full",
      });
      saga = advance(input.store, saga, "mutation_started", {
        targetCount: 1,
      });
      if (basePhase !== "mutation_started") {
        saga = advance(input.store, saga, "workspace_applied", {
          appliedCount: 1,
          poststateDigest: timeline.poststateDigest,
        });
      }
      if (basePhase === "session_committed") {
        saga = advance(input.store, saga, "session_committed", {
          sessionCommitDigest: timeline.sessionCommitDigest,
        });
      }
      if (recoveryTail) {
        saga = advance(input.store, saga, "recovery_required", {
          reason: "prior recovery attempt",
          errorCode: "PRIOR_RECOVERY_REQUIRED",
        });
        if (recoveryTail === "recovery_started") {
          saga = advance(input.store, saga, "recovery_started", {
            workspaceLockOwner: lease.owner,
            recoveryAction: CHECKPOINT_RESTORE_ALREADY_COMPLETED_ACTION,
          });
        }
      }
      lease.retainForRecovery("fixture retained owner");
    }),
  );
  expect(retained).toMatchObject({
    workspaceLockRetained: true,
    retainedOwner: { transactionId: operationId },
  });
  return { saga, owner: retained.retainedOwner };
}

function fixture(options = {}) {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "cc-restore-completed-")),
  );
  roots.push(root);
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(workspace, { recursive: true });
  const workspaceRoot = fs.realpathSync.native(workspace);
  const operationId = "restore_completed_11";
  const sessionId = "session-11";
  const timeline = sessionTranscript(workspaceRoot);
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
  const lockOptions = (id, overrides = {}) => ({
    ...workspaceLockOptions,
    workspaceRoot,
    operationId: id,
    purpose: "checkpoint-restore",
    ...overrides,
  });
  const setup = {
    root,
    workspaceRoot,
    operationId,
    sessionId,
    timeline,
    store,
    lockOptions,
  };
  const retained = retainSaga(setup, options);
  const log = [];

  const controllerStore = {
    load: (...args) => store.load(...args),
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

  const readSessionRecovery = vi.fn((readerOptions) => {
    log.push("session:read");
    const projection = readVerifiedSessionProjection(
      timeline.events,
      readerOptions,
    );
    return options.sessionProjectionOverride
      ? options.sessionProjectionOverride(projection, readerOptions)
      : projection;
  });
  const verifyWorkspaceTarget = vi.fn((request) => {
    log.push("workspace:verify");
    const projection = {
      schema: CHECKPOINT_RESTORE_WORKSPACE_TARGET_VERIFICATION_SCHEMA,
      version: CHECKPOINT_RESTORE_WORKSPACE_TARGET_VERIFICATION_VERSION,
      verified: true,
      exact: true,
      ...request.expected,
    };
    return options.workspaceProjectionOverride
      ? options.workspaceProjectionOverride(projection, request)
      : projection;
  });
  const withRecoveryLock = (lockRequest, callback) => {
    log.push("workspace:acquire");
    try {
      const result = withWorkspaceRecoveryLockSync(lockRequest, callback);
      log.push("workspace:released");
      return result;
    } catch (error) {
      if (error?.workspaceLockRetained) log.push("workspace:retained");
      throw error;
    }
  };
  const controller = new CheckpointRestoreAlreadyCompletedController({
    workspaceRoot,
    store: controllerStore,
    readSessionRecovery,
    verifyWorkspaceTarget,
    workspaceLockOptions,
    withWorkspaceRecoveryLockSync: withRecoveryLock,
  });

  return {
    ...setup,
    retained,
    log,
    controller,
    readSessionRecovery,
    verifyWorkspaceTarget,
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

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("CheckpointRestoreAlreadyCompletedController", () => {
  it("reconciles a response-lost session completion, releases, then archives", () => {
    const input = fixture({ basePhase: "workspace_applied" });

    const result = input.controller.resume(input.operationId, {
      expectedSeq: input.retained.saga.seq,
      expectedHash: input.retained.saga.headHash,
      expectedOwnerDigest: ownerDigest(input),
    });

    expect(result).toMatchObject({
      ok: true,
      action: CHECKPOINT_RESTORE_ALREADY_COMPLETED_ACTION,
      phase: "completed",
      sessionCommitDigest: input.timeline.sessionCommitDigest,
      resultDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      archived: true,
      warning: null,
    });
    expect(currentOwner(input)).toBeNull();
    const events = archivedEvents(input);
    expect(events.slice(-3).map((event) => event.phase)).toEqual([
      "recovery_required",
      "recovery_started",
      "completed",
    ]);
    expect(events.at(-1).evidence).toEqual({
      recoveryAction: CHECKPOINT_RESTORE_ALREADY_COMPLETED_ACTION,
      sessionCommitDigest: input.timeline.sessionCommitDigest,
      resultDigest: result.resultDigest,
    });
    expect(input.readSessionRecovery).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: input.operationId,
        sessionId: input.sessionId,
        expectedIntentCommitDigest: input.timeline.intentCommitDigest,
      }),
    );
    expect(input.readSessionRecovery.mock.calls[0][0]).not.toHaveProperty(
      "expectedSessionCommitDigest",
    );
    expect(input.log).toEqual([
      "workspace:acquire",
      "session:read",
      "workspace:verify",
      "saga:recovery_required",
      "saga:recovery_started",
      "saga:completed",
      "workspace:released",
      "archive",
    ]);
  });

  it("binds an existing session_committed digest before completing", () => {
    const input = fixture({ basePhase: "session_committed" });

    const result = input.controller.resume(input.operationId, {
      expectedSeq: input.retained.saga.seq,
      expectedHash: input.retained.saga.headHash,
      expectedOwnerDigest: ownerDigest(input),
    });

    expect(result.phase).toBe("completed");
    expect(input.readSessionRecovery).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedSessionCommitDigest: input.timeline.sessionCommitDigest,
      }),
    );
  });

  it("restarts a crashed recovery attempt through a fresh recovery_required boundary", () => {
    const input = fixture({
      basePhase: "workspace_applied",
      recoveryTail: "recovery_started",
    });

    input.controller.resume(input.operationId, {
      expectedSeq: input.retained.saga.seq,
      expectedHash: input.retained.saga.headHash,
      expectedOwnerDigest: ownerDigest(input),
    });

    expect(
      archivedEvents(input)
        .slice(-3)
        .map((event) => event.phase),
    ).toEqual(["recovery_required", "recovery_started", "completed"]);
  });

  it.each([
    ["mutation_started", "timeline"],
    ["workspace_applied", "direct"],
  ])(
    "refuses unsupported %s / %s authority before takeover",
    (basePhase, restoreSurface) => {
      const input = fixture({ basePhase, restoreSurface });
      const before = currentOwner(input);

      expect(() =>
        input.controller.resume(input.operationId, {
          expectedSeq: input.retained.saga.seq,
          expectedHash: input.retained.saga.headHash,
          expectedOwnerDigest: ownerDigest(input),
        }),
      ).toThrow(
        expect.objectContaining({
          code: CHECKPOINT_RESTORE_ALREADY_COMPLETED_ERROR_CODES.ACTION_NOT_ALLOWED,
        }),
      );
      expect(currentOwner(input)).toEqual(before);
      expect(input.readSessionRecovery).not.toHaveBeenCalled();
      expect(input.verifyWorkspaceTarget).not.toHaveBeenCalled();
    },
  );

  it("rejects a stale saga CAS before replacing its retained owner", () => {
    const input = fixture();
    const before = currentOwner(input);

    expect(() =>
      input.controller.resume(input.operationId, {
        expectedSeq: input.retained.saga.seq + 1,
        expectedHash: input.retained.saga.headHash,
        expectedOwnerDigest: ownerDigest(input),
      }),
    ).toThrow(
      expect.objectContaining({
        code: CHECKPOINT_RESTORE_ALREADY_COMPLETED_ERROR_CODES.SAGA_CONFLICT,
      }),
    );
    expect(currentOwner(input)).toEqual(before);
    expect(input.log).toEqual([]);
  });

  it("rejects owner drift before session or workspace verification", () => {
    const input = fixture();
    const before = currentOwner(input);

    expect(() =>
      input.controller.resume(input.operationId, {
        expectedSeq: input.retained.saga.seq,
        expectedHash: input.retained.saga.headHash,
        expectedOwnerDigest: digest(999),
      }),
    ).toThrow(
      expect.objectContaining({
        code: CHECKPOINT_RESTORE_ALREADY_COMPLETED_ERROR_CODES.OWNER_CONFLICT,
      }),
    );
    expect(currentOwner(input)).toEqual(before);
    expect(input.log).toEqual([]);
  });

  it("fails closed, journals recovery_required, and retains on session conflict", () => {
    const input = fixture({
      sessionProjectionOverride: (projection) => ({
        ...projection,
        classification: "code-settlement-resumable",
      }),
    });
    const priorOwner = currentOwner(input);

    const error = captureThrown(() =>
      input.controller.resume(input.operationId, {
        expectedSeq: input.retained.saga.seq,
        expectedHash: input.retained.saga.headHash,
        expectedOwnerDigest: ownerDigest(input),
      }),
    );

    expect(error).toMatchObject({
      workspaceLockRetained: true,
      checkpointRestoreRecoveryRequired: true,
      checkpointRestoreSagaPhase: "recovery_required",
      checkpointRestoreRecoveryCause: {
        code: CHECKPOINT_RESTORE_ALREADY_COMPLETED_ERROR_CODES.SESSION_CONFLICT,
      },
    });
    expect(input.store.load(input.operationId).phase).toBe("recovery_required");
    expect(currentOwner(input).token).not.toBe(priorOwner.token);
    expect(input.verifyWorkspaceTarget).not.toHaveBeenCalled();
    expect(input.log).toEqual([
      "workspace:acquire",
      "session:read",
      "saga:recovery_required",
      "workspace:retained",
    ]);
  });

  it("fails closed and retains when the exact workspace target is not verified", () => {
    const input = fixture({
      workspaceProjectionOverride: (projection) => ({
        ...projection,
        exact: false,
      }),
    });

    const error = captureThrown(() =>
      input.controller.resume(input.operationId, {
        expectedSeq: input.retained.saga.seq,
        expectedHash: input.retained.saga.headHash,
        expectedOwnerDigest: ownerDigest(input),
      }),
    );

    expect(error).toMatchObject({
      workspaceLockRetained: true,
      checkpointRestoreRecoveryCause: {
        code: CHECKPOINT_RESTORE_ALREADY_COMPLETED_ERROR_CODES.WORKSPACE_CONFLICT,
      },
    });
    expect(input.store.load(input.operationId).phase).toBe("recovery_required");
    expect(currentOwner(input)).not.toBeNull();
    expect(input.log).toEqual([
      "workspace:acquire",
      "session:read",
      "workspace:verify",
      "saga:recovery_required",
      "workspace:retained",
    ]);
  });

  it("reconciles an exact completed CAS when the advance response is lost", () => {
    let loseCompletedResponse = true;
    const input = fixture({
      advanceHook: ({ request, callDefault }) => {
        if (request.phase === "completed" && loseCompletedResponse) {
          loseCompletedResponse = false;
          callDefault();
          const error = new Error("completed response lost");
          error.code = "INJECTED_COMPLETED_RESPONSE_LOST";
          error.commitState = "head_settlement_unknown";
          throw error;
        }
        return callDefault();
      },
    });

    const result = input.controller.resume(input.operationId, {
      expectedSeq: input.retained.saga.seq,
      expectedHash: input.retained.saga.headHash,
      expectedOwnerDigest: ownerDigest(input),
    });

    expect(result).toMatchObject({
      phase: "completed",
      archived: true,
    });
    expect(
      archivedEvents(input).filter((event) => event.phase === "completed"),
    ).toHaveLength(1);
    expect(currentOwner(input)).toBeNull();
  });

  it("returns an archive warning only after the completed lock is released", () => {
    const archiveError = new Error("archive unavailable");
    archiveError.code = "INJECTED_ARCHIVE_FAILURE";
    archiveError.commitState = "archive_not_committed";
    const input = fixture({ archiveError });

    const result = input.controller.resume(input.operationId, {
      expectedSeq: input.retained.saga.seq,
      expectedHash: input.retained.saga.headHash,
      expectedOwnerDigest: ownerDigest(input),
    });

    expect(result).toMatchObject({
      phase: "completed",
      archived: false,
      warning: {
        code: "INJECTED_ARCHIVE_FAILURE",
        commitState: "archive_not_committed",
      },
    });
    expect(currentOwner(input)).toBeNull();
    expect(input.store.load(input.operationId).phase).toBe("completed");
    expect(input.log.slice(-2)).toEqual(["workspace:released", "archive"]);
  });

  it("retains a replacement owner when completed publication fails before commit", () => {
    const input = fixture({
      advanceHook: ({ request, callDefault }) => {
        if (request.phase === "completed") {
          const error = new Error("completed journal unavailable");
          error.code = "INJECTED_COMPLETED_FAILURE";
          throw error;
        }
        return callDefault();
      },
    });

    const error = captureThrown(() =>
      input.controller.resume(input.operationId, {
        expectedSeq: input.retained.saga.seq,
        expectedHash: input.retained.saga.headHash,
        expectedOwnerDigest: ownerDigest(input),
      }),
    );

    expect(error).toMatchObject({
      workspaceLockRetained: true,
      checkpointRestoreSagaPhase: "recovery_required",
      checkpointRestoreRecoveryCause: {
        code: "INJECTED_COMPLETED_FAILURE",
      },
    });
    expect(input.store.load(input.operationId).phase).toBe("recovery_required");
    expect(currentOwner(input)).not.toBeNull();
  });
});

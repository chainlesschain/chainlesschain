import { describe, expect, it, vi } from "vitest";
import {
  CHECKPOINT_RESTORE_RECOVERY_LIST_SCHEMA,
  CHECKPOINT_RESTORE_RECOVERY_PROJECTION_SCHEMA,
  createCheckpointRestoreRecoveryReader,
  listCheckpointRestoreRecoveries,
  projectCheckpointRestoreRecovery,
  showCheckpointRestoreRecovery,
} from "../../src/lib/checkpoint-restore-recovery.js";

const WORKSPACE_IDENTITY = digest(900);
const OWNER_DIGEST = digest(901);
const OWNER_TOKEN = "private-owner-token-0000000000000001";
const WORKSPACE_ROOT = "C:\\private\\customer\\workspace";

function digest(value) {
  return `sha256:${Number(value).toString(16).padStart(64, "0")}`;
}

function event(operationId, seq, phase, evidence = {}) {
  return Object.freeze({
    operationId,
    seq,
    phase,
    timestamp: 1_780_000_000_000 + seq,
    evidence: Object.freeze({ ...evidence }),
    hash: digest(seq),
  });
}

function saga(events, overrides = {}) {
  const head = events.at(-1);
  const terminal = ["completed", "aborted", "rolled_back"].includes(head.phase);
  return Object.freeze({
    version: 1,
    operationId: head.operationId,
    workspaceRoot: WORKSPACE_ROOT,
    workspaceIdentity: WORKSPACE_IDENTITY,
    seq: head.seq,
    headHash: head.hash,
    phase: head.phase,
    terminal,
    pending: !terminal,
    events: Object.freeze(events),
    orphanTemporaryFiles: Object.freeze([]),
    ...overrides,
  });
}

function recoveryRequiredSaga(operationId = "restore_recovery_1") {
  const owner = Object.freeze({
    identityPolicy: "pid-only-fail-closed",
    pid: 4212,
    purpose: "checkpoint-restore",
    startedAt: 1_780_000_000_000,
    token: OWNER_TOKEN,
    transactionId: operationId,
    workspaceRoot: WORKSPACE_ROOT,
  });
  return saga([
    event(operationId, 1, "created", {
      workspaceRoot: WORKSPACE_ROOT,
      workspaceIdentity: WORKSPACE_IDENTITY,
      restoreKind: "git",
      restoreSurface: "timeline",
      intentAuthority: "session",
      checkpointNamespace: "git",
      checkpointId: "checkpoint-7",
      checkpointIdentity: "immutable-checkpoint-7",
      sessionId: "session-7",
      timelineEntryId: "turn-7",
    }),
    event(operationId, 2, "locked", {
      workspaceLockOwner: owner,
      lockOwnerDigest: OWNER_DIGEST,
    }),
    event(operationId, 3, "prepared", {
      prestateDigest: digest(30),
      targetCount: 2,
    }),
    event(operationId, 4, "intent_committed", {
      intentCommitDigest: digest(40),
      sessionId: "session-7",
      timelineEntryId: "turn-7",
    }),
    event(operationId, 5, "safety_ready", {
      safetyId: "safety-7",
      safetyIdentity: "immutable-safety-7",
      safetyPlanIdentity: "immutable-plan-7",
      safetyCoverage: "full",
    }),
    event(operationId, 6, "mutation_started", { targetCount: 2 }),
    event(operationId, 7, "recovery_required", {
      errorCode: "CHECKPOINT_RESTORE_OUTCOME_UNKNOWN",
      reason: `private failure ${OWNER_TOKEN} at ${WORKSPACE_ROOT}`,
    }),
  ]);
}

function rollbackBinding(recoveryRequestId = "rollback-request-7") {
  return {
    recoveryAction: "rollback-partial-mutation",
    recoveryRequestId,
    safetyId: "safety-7",
    safetyIdentity: "immutable-safety-7",
    safetyPlanIdentity: "immutable-plan-7",
    safetyCoverage: "full",
    rollbackPrestateDigest: digest(70),
    rollbackPlanIdentity: digest(71),
    originalMutationTargetCount: 2,
    targetCount: 1,
  };
}

function rollbackSettlement(recoveryRequestId = "rollback-request-7") {
  return {
    ...rollbackBinding(recoveryRequestId),
    rolledBackCount: 1,
    rollbackStateDigest: digest(72),
    resultDigest: digest(73),
  };
}

function listedPage(items, overrides = {}) {
  const page = [...items];
  page.diagnostics = overrides.diagnostics || [];
  page.truncated = overrides.truncated === true;
  page.budgetExhausted = overrides.budgetExhausted === true;
  page.nextCursor = page.truncated ? overrides.nextCursor : null;
  return page;
}

describe("checkpoint restore recovery read model", () => {
  it("projects a recovery saga with exact fences and no private owner data", () => {
    const projection = projectCheckpointRestoreRecovery(recoveryRequiredSaga());

    expect(projection).toMatchObject({
      schema: CHECKPOINT_RESTORE_RECOVERY_PROJECTION_SCHEMA,
      version: 1,
      operationId: "restore_recovery_1",
      phase: "recovery_required",
      basePhase: "mutation_started",
      status: "recovery_required",
      seq: 7,
      headHash: digest(7),
      workspaceIdentity: WORKSPACE_IDENTITY,
      fence: {
        expectedSeq: 7,
        expectedHash: digest(7),
        ownerAuthority: "unverified",
        recordedOwnerDigest: OWNER_DIGEST,
      },
      restore: {
        kind: "git",
        surface: "timeline",
        intentAuthority: "session",
        checkpointId: "checkpoint-7",
        checkpointIdentity: "immutable-checkpoint-7",
        sessionId: "session-7",
        timelineEntryId: "turn-7",
      },
      progress: { targetCount: 2, appliedCount: null },
      safety: { coverage: "full", complete: true },
      rollback: {
        phase: null,
        recoveryRequestId: null,
        rollbackPrestateDigest: null,
        rollbackPlanIdentity: null,
        originalMutationTargetCount: null,
        targetCount: null,
        rolledBackCount: null,
        rollbackStateDigest: null,
        resultDigest: null,
        sessionRollbackCommitDigest: null,
      },
      authority: {
        workspaceOwnerEvidencePresent: true,
        workspaceOwnerDigestPresent: true,
        complete: true,
      },
      recovery: {
        errorCode: "CHECKPOINT_RESTORE_OUTCOME_UNKNOWN",
        reasonPresent: true,
      },
    });
    expect(projection.actionEligibility.resume).toMatchObject({
      candidate: true,
      eligible: false,
      blockers: expect.arrayContaining([
        "workspace_owner_status_unverified",
        "workspace_state_unverified",
        "session_state_unverified",
      ]),
    });
    expect(projection.actionEligibility.rollback).toMatchObject({
      candidate: true,
      eligible: false,
      blockers: expect.arrayContaining(["safety_checkpoint_unverified"]),
    });
    expect(projection.actionEligibility.release).toMatchObject({
      candidate: false,
      eligible: false,
      blockers: ["saga_is_not_terminal"],
    });

    const serialized = JSON.stringify(projection);
    expect(serialized).not.toContain(OWNER_TOKEN);
    expect(serialized).not.toContain(WORKSPACE_ROOT);
    expect(serialized).not.toContain('"workspaceLockOwner":');
    expect(serialized).not.toContain('checkpoint-restore"');
    expect(serialized).not.toContain("private failure");
    expect(projection).not.toHaveProperty("events");
    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection.actionEligibility.resume.blockers)).toBe(
      true,
    );
    expect(Object.isFrozen(projection.fence)).toBe(true);
  });

  it("preserves bounded pagination and sanitizes list diagnostics", () => {
    const pending = recoveryRequiredSaga("restore_page_a");
    const listPending = vi.fn(() =>
      listedPage([pending], {
        truncated: true,
        nextCursor: "restore_page_a",
        diagnostics: [
          {
            operationId: "restore_page_b",
            status: "corrupt",
            code: "CHECKPOINT_RESTORE_SAGA_CORRUPT",
            recoverable: false,
            workspaceLockOwner: { token: OWNER_TOKEN },
            orphanTemporaryFiles: [OWNER_TOKEN],
          },
        ],
      }),
    );
    const store = { listPending, load: vi.fn() };

    const result = listCheckpointRestoreRecoveries({
      store,
      afterOperationId: "restore_page_0",
      limit: 2,
    });

    expect(listPending).toHaveBeenCalledTimes(1);
    expect(listPending).toHaveBeenCalledWith({
      afterOperationId: "restore_page_0",
      limit: 2,
    });
    expect(result).toMatchObject({
      schema: CHECKPOINT_RESTORE_RECOVERY_LIST_SCHEMA,
      version: 1,
      page: {
        afterOperationId: "restore_page_0",
        limit: 2,
        returned: 1,
        diagnostics: 1,
        truncated: true,
        budgetExhausted: false,
        nextCursor: "restore_page_a",
      },
    });
    expect(result.diagnostics[0]).toEqual(
      expect.objectContaining({
        operationId: "restore_page_b",
        status: "corrupt",
        code: "CHECKPOINT_RESTORE_SAGA_CORRUPT",
        recoverable: false,
      }),
    );
    expect(result.diagnostics[0].actionEligibility.resume.eligible).toBe(false);
    expect(JSON.stringify(result)).not.toContain(OWNER_TOKEN);
    expect(Object.isFrozen(result.page)).toBe(true);
  });

  it("retains an empty continuation cursor when the store exhausts its budget", () => {
    const store = {
      listPending: vi.fn(() =>
        listedPage([], {
          truncated: true,
          budgetExhausted: true,
          nextCursor: "",
        }),
      ),
      load: vi.fn(),
    };

    expect(listCheckpointRestoreRecoveries({ store, limit: 4 }).page).toEqual({
      afterOperationId: "",
      limit: 4,
      returned: 0,
      diagnostics: 0,
      truncated: true,
      budgetExhausted: true,
      nextCursor: "",
    });
  });

  it("uses load for show and exposes no mutation methods", () => {
    const loaded = recoveryRequiredSaga("restore_show_1");
    const store = {
      listPending: vi.fn(() => listedPage([])),
      load: vi.fn(() => loaded),
    };
    const reader = createCheckpointRestoreRecoveryReader({ store });

    const shown = reader.show("restore_show_1");

    expect(store.load).toHaveBeenCalledTimes(1);
    expect(store.load).toHaveBeenCalledWith("restore_show_1");
    expect(shown.operationId).toBe("restore_show_1");
    expect(Object.keys(reader).sort()).toEqual(["list", "show"]);
    expect(Object.isFrozen(reader)).toBe(true);
    expect(
      showCheckpointRestoreRecovery({ store, operationId: "restore_show_1" }),
    ).toEqual(shown);

    const replacement = {
      listPending: vi.fn(() => {
        throw new Error("replacement store must not run");
      }),
      load: vi.fn(),
    };
    expect(reader.list({ store: replacement }).items).toEqual([]);
    expect(replacement.listPending).not.toHaveBeenCalled();
  });

  it("keeps resume and rollback fail-closed until external state is verified", () => {
    const projection = projectCheckpointRestoreRecovery(
      recoveryRequiredSaga("restore_fail_closed"),
    );

    for (const name of ["resume", "rollback"]) {
      expect(projection.actionEligibility[name].candidate).toBe(true);
      expect(projection.actionEligibility[name].eligible).toBe(false);
      expect(projection.actionEligibility[name].prerequisites).toContain(
        "exact_seq_and_head_match",
      );
      expect(projection.actionEligibility[name].prerequisites).toContain(
        "workspace_owner_status_verification",
      );
      expect(projection.actionEligibility[name].prerequisites).toContain(
        "workspace_state_verification",
      );
      expect(projection.actionEligibility[name].prerequisites).toContain(
        "session_state_verification",
      );
    }
  });

  it("aligns abort eligibility with the controller's created/locked support", () => {
    const createdOperationId = "restore_abort_created";
    const created = saga([
      event(createdOperationId, 1, "created", {
        workspaceRoot: WORKSPACE_ROOT,
        workspaceIdentity: WORKSPACE_IDENTITY,
        restoreKind: "copy",
      }),
    ]);
    expect(
      projectCheckpointRestoreRecovery(created).actionEligibility.abort,
    ).toEqual({
      candidate: true,
      eligible: false,
      blockers: ["workspace_owner_status_unverified"],
      prerequisites: [
        "exact_seq_and_head_match",
        "workspace_owner_absence_verification",
      ],
    });

    const lockedOperationId = "restore_abort_locked";
    const locked = saga([
      event(lockedOperationId, 1, "created", {
        workspaceRoot: WORKSPACE_ROOT,
        workspaceIdentity: WORKSPACE_IDENTITY,
        restoreKind: "copy",
      }),
      event(lockedOperationId, 2, "locked", {
        workspaceLockOwner: {
          identityPolicy: "pid-only-fail-closed",
          pid: 4212,
          purpose: "checkpoint-restore",
          startedAt: 1_780_000_000_000,
          token: OWNER_TOKEN,
          transactionId: lockedOperationId,
          workspaceRoot: WORKSPACE_ROOT,
        },
        lockOwnerDigest: OWNER_DIGEST,
      }),
    ]);
    expect(
      projectCheckpointRestoreRecovery(locked).actionEligibility.abort,
    ).toEqual({
      candidate: true,
      eligible: false,
      blockers: ["workspace_owner_status_unverified"],
      prerequisites: [
        "exact_seq_and_head_match",
        "workspace_owner_digest_match",
        "workspace_owner_status_verification",
      ],
    });

    const prepared = saga([
      ...locked.events,
      event(lockedOperationId, 3, "prepared", {
        prestateDigest: digest(88),
        targetCount: 1,
      }),
    ]);
    expect(
      projectCheckpointRestoreRecovery(prepared).actionEligibility.abort,
    ).toMatchObject({
      candidate: true,
      eligible: false,
      blockers: expect.arrayContaining([
        "controller_phase_not_supported",
        "session_intent_state_unverified",
      ]),
      prerequisites: expect.arrayContaining([
        "session_intent_state_verification",
      ]),
    });
  });

  it("enables only a clean terminal release with an owner digest fence", () => {
    const operationId = "restore_terminal_1";
    const owner = {
      identityPolicy: "pid-only-fail-closed",
      pid: 4212,
      purpose: "checkpoint-restore",
      startedAt: 1_780_000_000_000,
      token: OWNER_TOKEN,
      transactionId: operationId,
      workspaceRoot: WORKSPACE_ROOT,
    };
    const terminal = saga([
      event(operationId, 1, "created", {
        workspaceRoot: WORKSPACE_ROOT,
        workspaceIdentity: WORKSPACE_IDENTITY,
        restoreKind: "git",
      }),
      event(operationId, 2, "locked", {
        workspaceLockOwner: owner,
        lockOwnerDigest: OWNER_DIGEST,
      }),
      event(operationId, 3, "aborted", { reason: "cancelled" }),
    ]);

    const projection = projectCheckpointRestoreRecovery(terminal);

    expect(projection.actionEligibility.release).toEqual({
      candidate: true,
      eligible: false,
      blockers: ["workspace_owner_status_unverified"],
      prerequisites: ["exact_seq_and_head_match", "live_workspace_owner_fence"],
    });
    expect(projection.actionEligibility.resume.candidate).toBe(false);
    expect(projection.actionEligibility.rollback.candidate).toBe(false);
    expect(JSON.stringify(projection)).not.toContain(OWNER_TOKEN);
  });

  it("keeps terminal release closed until live owner authority is inspected", () => {
    const operationId = "restore_terminal_unbound";
    const terminal = saga([
      event(operationId, 1, "created", {
        workspaceRoot: WORKSPACE_ROOT,
        workspaceIdentity: WORKSPACE_IDENTITY,
        restoreKind: "copy",
      }),
      event(operationId, 2, "aborted", { reason: "never locked" }),
    ]);
    const unbound = projectCheckpointRestoreRecovery(terminal);
    expect(unbound.actionEligibility.release).toEqual({
      candidate: true,
      eligible: false,
      blockers: ["workspace_owner_status_unverified"],
      prerequisites: ["exact_seq_and_head_match", "live_workspace_owner_fence"],
    });

    const dirty = projectCheckpointRestoreRecovery(
      saga(terminal.events, {
        orphanTemporaryFiles: Object.freeze([".unsettled.tmp"]),
      }),
    );
    expect(dirty.actionEligibility.release).toMatchObject({
      candidate: true,
      eligible: false,
      blockers: expect.arrayContaining(["saga_has_orphan_temporary_files"]),
    });
  });

  it("does not offer rollback before a proven mutation boundary", () => {
    const original = recoveryRequiredSaga("restore_before_mutation");
    const events = original.events.filter((entry) => entry.seq <= 5);
    events.push(
      event("restore_before_mutation", 6, "recovery_required", {
        errorCode: "CHECKPOINT_RESTORE_STOPPED",
        reason: "stopped before mutation",
      }),
    );
    const projection = projectCheckpointRestoreRecovery(saga(events));

    expect(projection.basePhase).toBe("safety_ready");
    expect(projection.actionEligibility.resume.candidate).toBe(true);
    expect(projection.actionEligibility.rollback).toMatchObject({
      candidate: false,
      eligible: false,
      blockers: ["workspace_mutation_not_proven"],
    });
  });

  it("keeps workspace rollback and settlement retries actionable", () => {
    const operationId = "restore_rollback_boundaries";
    const recovery = recoveryRequiredSaga(operationId);
    const owner = recovery.events[1].evidence.workspaceLockOwner;
    const requestId = "rollback-request-7";
    const events = [
      ...recovery.events,
      event(operationId, recovery.events.length + 1, "recovery_started", {
        workspaceLockOwner: owner,
        lockOwnerDigest: OWNER_DIGEST,
        recoveryAction: "rollback-partial-mutation",
        recoveryRequestId: requestId,
      }),
    ];
    const boundaries = [
      {
        phase: "rollback_prepared",
        evidence: rollbackBinding(requestId),
        status: "rollback_in_progress",
        rollbackCandidate: true,
      },
      {
        phase: "rollback_started",
        evidence: rollbackBinding(requestId),
        status: "rollback_in_progress",
        rollbackCandidate: true,
      },
      {
        phase: "workspace_rolled_back",
        evidence: rollbackSettlement(requestId),
        status: "workspace_rolled_back_pending_session",
        rollbackCandidate: true,
      },
      {
        phase: "session_rollback_committed",
        evidence: {
          ...rollbackSettlement(requestId),
          sessionRollbackCommitDigest: digest(74),
        },
        status: "session_rollback_pending_terminal",
        rollbackCandidate: true,
      },
    ];

    for (const boundary of boundaries) {
      events.push(
        event(
          operationId,
          events.length + 1,
          boundary.phase,
          boundary.evidence,
        ),
      );
      const projection = projectCheckpointRestoreRecovery(saga([...events]));

      expect(projection).toMatchObject({
        phase: boundary.phase,
        basePhase: boundary.phase,
        status: boundary.status,
        pending: true,
        terminal: false,
        progress: { targetCount: 1 },
        rollback: {
          phase: boundary.phase,
          recoveryRequestId: requestId,
          rollbackPrestateDigest: digest(70),
          rollbackPlanIdentity: digest(71),
          originalMutationTargetCount: 2,
          targetCount: 1,
        },
        actionEligibility: {
          rollback: {
            candidate: boundary.rollbackCandidate,
            eligible: false,
          },
          resume: { candidate: true, eligible: false },
        },
      });
      expect(projection.actionEligibility.rollback.blockers).toEqual(
        expect.arrayContaining([
          "workspace_owner_status_unverified",
          "workspace_state_unverified",
          "safety_checkpoint_unverified",
          "session_state_unverified",
        ]),
      );
    }

    const settled = projectCheckpointRestoreRecovery(saga(events));
    expect(settled.rollback).toEqual({
      phase: "session_rollback_committed",
      recoveryRequestId: requestId,
      rollbackPrestateDigest: digest(70),
      rollbackPlanIdentity: digest(71),
      originalMutationTargetCount: 2,
      targetCount: 1,
      rolledBackCount: 1,
      rollbackStateDigest: digest(72),
      resultDigest: digest(73),
      sessionRollbackCommitDigest: digest(74),
    });
    expect(JSON.stringify(settled)).not.toContain(OWNER_TOKEN);
    expect(JSON.stringify(settled)).not.toContain(WORKSPACE_ROOT);
  });

  it("projects a zero-target rollback from binding through workspace settlement", () => {
    const operationId = "restore_zero_target_rollback";
    const recovery = recoveryRequiredSaga(operationId);
    const owner = recovery.events[1].evidence.workspaceLockOwner;
    const requestId = "rollback-request-zero";
    const binding = {
      ...rollbackBinding(requestId),
      targetCount: 0,
    };
    const preparedEvents = [
      ...recovery.events,
      event(operationId, recovery.events.length + 1, "recovery_started", {
        workspaceLockOwner: owner,
        lockOwnerDigest: OWNER_DIGEST,
        recoveryAction: "rollback-partial-mutation",
        recoveryRequestId: requestId,
      }),
      event(
        operationId,
        recovery.events.length + 2,
        "rollback_prepared",
        binding,
      ),
    ];

    const prepared = projectCheckpointRestoreRecovery(saga(preparedEvents));
    expect(prepared).toMatchObject({
      basePhase: "rollback_prepared",
      progress: { targetCount: 0 },
      rollback: {
        phase: "rollback_prepared",
        originalMutationTargetCount: 2,
        targetCount: 0,
      },
      actionEligibility: { rollback: { candidate: true } },
    });

    const settled = projectCheckpointRestoreRecovery(
      saga([
        ...preparedEvents,
        event(operationId, preparedEvents.length + 1, "workspace_rolled_back", {
          ...binding,
          rolledBackCount: 0,
          rollbackStateDigest: digest(75),
          resultDigest: digest(76),
        }),
      ]),
    );
    expect(settled).toMatchObject({
      basePhase: "workspace_rolled_back",
      progress: { targetCount: 0 },
      rollback: {
        phase: "workspace_rolled_back",
        originalMutationTargetCount: 2,
        targetCount: 0,
        rolledBackCount: 0,
      },
      actionEligibility: { rollback: { candidate: true } },
    });
  });

  it("projects only the latest recovery request when a new cycle replans rollback", () => {
    const operationId = "restore_rollback_replan";
    const recovery = recoveryRequiredSaga(operationId);
    const owner = recovery.events[1].evidence.workspaceLockOwner;
    const requestOne = "rollback-request-one";
    const requestTwo = "rollback-request-two";
    const events = [
      ...recovery.events,
      event(operationId, 8, "recovery_started", {
        workspaceLockOwner: owner,
        lockOwnerDigest: OWNER_DIGEST,
        recoveryAction: "rollback-partial-mutation",
        recoveryRequestId: requestOne,
      }),
      event(operationId, 9, "rollback_prepared", {
        ...rollbackBinding(requestOne),
        rollbackPlanIdentity: digest(80),
        targetCount: 1,
      }),
      event(operationId, 10, "recovery_required", {
        errorCode: "CHECKPOINT_RESTORE_ROLLBACK_REPLAN_REQUIRED",
        reason: "replan under a fresh recovery request",
      }),
      event(operationId, 11, "recovery_started", {
        workspaceLockOwner: owner,
        lockOwnerDigest: OWNER_DIGEST,
        recoveryAction: "rollback-partial-mutation",
        recoveryRequestId: requestTwo,
      }),
    ];

    const started = projectCheckpointRestoreRecovery(saga(events));
    expect(started).toMatchObject({
      phase: "recovery_started",
      basePhase: "rollback_prepared",
      status: "rollback_in_progress",
      rollback: {
        phase: "recovery_started",
        recoveryRequestId: requestTwo,
        rollbackPrestateDigest: null,
        rollbackPlanIdentity: null,
        originalMutationTargetCount: null,
        targetCount: null,
      },
    });

    const replanned = projectCheckpointRestoreRecovery(
      saga([
        ...events,
        event(operationId, 12, "rollback_prepared", {
          ...rollbackBinding(requestTwo),
          rollbackPrestateDigest: digest(81),
          rollbackPlanIdentity: digest(82),
          targetCount: 2,
        }),
      ]),
    );
    expect(replanned.rollback).toMatchObject({
      phase: "rollback_prepared",
      recoveryRequestId: requestTwo,
      rollbackPrestateDigest: digest(81),
      rollbackPlanIdentity: digest(82),
      originalMutationTargetCount: 2,
      targetCount: 2,
    });
  });

  it("retains one request's prepared authority across settlement retry", () => {
    const operationId = "restore_rollback_same_request_retry";
    const recovery = recoveryRequiredSaga(operationId);
    const owner = recovery.events[1].evidence.workspaceLockOwner;
    const requestId = "rollback-request-stable";
    const events = [
      ...recovery.events,
      event(operationId, 8, "recovery_started", {
        workspaceLockOwner: owner,
        lockOwnerDigest: OWNER_DIGEST,
        recoveryAction: "rollback-partial-mutation",
        recoveryRequestId: requestId,
      }),
      event(operationId, 9, "rollback_prepared", rollbackBinding(requestId)),
      event(operationId, 10, "recovery_required", {
        errorCode: "CHECKPOINT_RESTORE_ROLLBACK_RESPONSE_UNKNOWN",
        reason: "retry the same immutable request",
      }),
      event(operationId, 11, "recovery_started", {
        workspaceLockOwner: owner,
        lockOwnerDigest: OWNER_DIGEST,
        recoveryAction: "rollback-partial-mutation",
        recoveryRequestId: requestId,
      }),
      event(
        operationId,
        12,
        "workspace_rolled_back",
        rollbackSettlement(requestId),
      ),
    ];

    const projection = projectCheckpointRestoreRecovery(saga(events));

    expect(projection).toMatchObject({
      phase: "workspace_rolled_back",
      status: "workspace_rolled_back_pending_session",
      rollback: {
        phase: "workspace_rolled_back",
        recoveryRequestId: requestId,
        rollbackPlanIdentity: digest(71),
        rolledBackCount: 1,
        rollbackStateDigest: digest(72),
        resultDigest: digest(73),
      },
      actionEligibility: {
        rollback: {
          candidate: true,
          blockers: expect.arrayContaining([
            "workspace_owner_status_unverified",
            "workspace_state_unverified",
            "safety_checkpoint_unverified",
            "session_state_unverified",
          ]),
        },
        resume: { candidate: true, eligible: false },
      },
    });
  });

  it.each([
    ["rollbackPrestateDigest", "not-a-hash"],
    ["rollbackPlanIdentity", digest(71).toUpperCase()],
    ["originalMutationTargetCount", -1],
    ["targetCount", 1.5],
  ])("rejects malformed rollback evidence field %s", (field, value) => {
    const operationId = `restore_invalid_${field}`;
    const recovery = recoveryRequiredSaga(operationId);
    const owner = recovery.events[1].evidence.workspaceLockOwner;
    const requestId = "rollback-request-invalid";
    const events = [
      ...recovery.events,
      event(operationId, 8, "recovery_started", {
        workspaceLockOwner: owner,
        lockOwnerDigest: OWNER_DIGEST,
        recoveryAction: "rollback-partial-mutation",
        recoveryRequestId: requestId,
      }),
      event(operationId, 9, "rollback_prepared", {
        ...rollbackBinding(requestId),
        [field]: value,
      }),
    ];

    expect(() => projectCheckpointRestoreRecovery(saga(events))).toThrow(
      new RegExp(field),
    );
  });

  it("rejects request drift and count-inconsistent rollback settlement", () => {
    const operationId = "restore_invalid_rollback_settlement";
    const recovery = recoveryRequiredSaga(operationId);
    const owner = recovery.events[1].evidence.workspaceLockOwner;
    const requestId = "rollback-request-consistent";
    const base = [
      ...recovery.events,
      event(operationId, 8, "recovery_started", {
        workspaceLockOwner: owner,
        lockOwnerDigest: OWNER_DIGEST,
        recoveryAction: "rollback-partial-mutation",
        recoveryRequestId: requestId,
      }),
      event(operationId, 9, "rollback_prepared", rollbackBinding(requestId)),
    ];

    expect(() =>
      projectCheckpointRestoreRecovery(
        saga([
          ...base,
          event(operationId, 10, "rollback_started", {
            ...rollbackBinding(requestId),
            rollbackPlanIdentity: digest(99),
          }),
        ]),
      ),
    ).toThrow(/rollbackPlanIdentity/);

    expect(() =>
      projectCheckpointRestoreRecovery(
        saga([
          ...base,
          event(operationId, 10, "workspace_rolled_back", {
            ...rollbackSettlement(requestId),
            rolledBackCount: 0,
          }),
        ]),
      ),
    ).toThrow(/incomplete or inconsistent/);
  });

  it("fails closed on malformed store projections and pagination", () => {
    const good = recoveryRequiredSaga("restore_malformed");
    expect(() =>
      projectCheckpointRestoreRecovery({
        ...good,
        headHash: digest(999),
      }),
    ).toThrow(/head projection is inconsistent/);

    expect(() =>
      listCheckpointRestoreRecoveries({
        store: { listPending: () => ({}), load: vi.fn() },
      }),
    ).toThrow(/returned no page/);

    expect(() =>
      listCheckpointRestoreRecoveries({
        store: {
          listPending: () =>
            listedPage([], { truncated: true, nextCursor: "../unsafe" }),
          load: vi.fn(),
        },
      }),
    ).toThrow(/pagination metadata is invalid/);

    expect(() =>
      showCheckpointRestoreRecovery({
        store: { listPending: vi.fn(), load: vi.fn() },
        operationId: "../unsafe",
      }),
    ).toThrow(/safe checkpoint restore identifier/);
  });
});

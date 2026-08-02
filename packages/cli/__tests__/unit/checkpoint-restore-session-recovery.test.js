import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ACTION,
  CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_OUTCOME,
  CHECKPOINT_RESTORE_RECOVERY_RESOLUTION_SCHEMA,
  CHECKPOINT_RESTORE_ROLLBACK_CONVERSATION_DISPOSITION,
  CHECKPOINT_RESTORE_SESSION_RECONCILIATION,
  CHECKPOINT_RESTORE_SESSION_RECOVERY_SCHEMA,
  CHECKPOINT_RESTORE_SESSION_RESOLUTION_ERROR_CODES,
  appendCheckpointRestoreRecoveryResolution,
  buildCheckpointRestoreRecoveryResolution,
  computeCheckpointRestoreSessionRollbackCommitDigest,
  createCheckpointRestoreSessionRecoveryReader,
  readCheckpointRestoreSessionRecovery,
  reconcileCheckpointRestoreRecoveryResolutionProjection,
} from "../../src/lib/checkpoint-restore-session-recovery.js";
import {
  CHECKPOINT_RESTORE_RECOVERY_RESOLUTION_EVENT,
  CHECKPOINT_TIMELINE_AUDIT_EVENT,
  CHECKPOINT_TIMELINE_INTENT_EVENT,
} from "../../src/lib/checkpoint-timeline-authority.js";
import { TURN_BINDING_TIMELINE_EVENT } from "../../src/lib/turn-binding-store.js";

const OPERATION_ID = "checkpoint-restore-operation-7";
const SESSION_ID = "session-7";

function digest(value) {
  return `sha256:${Number(value).toString(16).padStart(64, "0")}`;
}

function rawHash(value) {
  return Number(value).toString(16).padStart(64, "0");
}

function commitDigest(domain, eventHash) {
  return `sha256:${createHash("sha256")
    .update(`${domain}\0${JSON.stringify(eventHash)}`)
    .digest("hex")}`;
}

function authority(action = "restore-code", overrides = {}) {
  return {
    revision: "revision-7",
    action,
    turnId: "turn-7",
    checkpointId: "checkpoint-7",
    checkpointIdentity: "git:checkpoint-identity-7",
    workspaceDir: "C:\\workspaces\\project-7",
    workspaceScopeIdentity: digest(10),
    workspacePrestateIdentity: `git-tree:${"1".repeat(40)}`,
    workspaceWritePlanIdentity: digest(11),
    workspaceTargetPoststateIdentity: `git-tree:${"2".repeat(40)}`,
    confirmationDigest: digest(12),
    ...overrides,
  };
}

function intent(action = "restore-code", overrides = {}) {
  return {
    type: CHECKPOINT_TIMELINE_INTENT_EVENT,
    data: {
      operationId: OPERATION_ID,
      ...authority(action),
      ...overrides,
    },
  };
}

function conversationCommit(action = "restore-both", overrides = {}) {
  const expected = authority(action);
  return {
    type: TURN_BINDING_TIMELINE_EVENT,
    data: {
      operationId: OPERATION_ID,
      action,
      sourceRevision: expected.revision,
      turnId: expected.turnId,
      messages: [{ role: "user", content: "historical message" }],
      binding: { turns: [{ turnId: expected.turnId }] },
      ...overrides,
    },
  };
}

function audit(status, action = "restore-code", overrides = {}) {
  return {
    type: CHECKPOINT_TIMELINE_AUDIT_EVENT,
    data: {
      operationId: OPERATION_ID,
      ...authority(action),
      status,
      ...(status === "failed"
        ? {
            failureCode: "CHECKPOINT_RESTORE_OUTCOME_UNKNOWN",
            workspaceState: "unknown",
          }
        : {}),
      ...overrides,
    },
  };
}

function resolutionInput(action = "restore-code", overrides = {}) {
  const expected = authority(action);
  const intentEventHash = overrides.intentEventHash || rawHash(1);
  return {
    operationId: OPERATION_ID,
    recoveryRequestId: "rollback-request-7",
    action,
    recoveryAction: CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ACTION,
    outcome: CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_OUTCOME,
    intentEventHash,
    intentCommitDigest: commitDigest(
      "cc-checkpoint-restore-intent-commit-v1",
      intentEventHash,
    ),
    failedAuditEventHash: null,
    conversationDisposition:
      CHECKPOINT_RESTORE_ROLLBACK_CONVERSATION_DISPOSITION,
    checkpointId: expected.checkpointId,
    checkpointIdentity: expected.checkpointIdentity,
    workspaceScopeIdentity: expected.workspaceScopeIdentity,
    workspaceWritePlanIdentity: expected.workspaceWritePlanIdentity,
    safetyId: "safety-7",
    safetyIdentity: digest(20),
    safetyPlanIdentity: digest(21),
    rollbackPlanIdentity: digest(22),
    rollbackStateDigest: digest(23),
    sagaWorkspaceRolledBackHash: digest(24),
    ...overrides,
  };
}

function resolution(action = "restore-code", overrides = {}) {
  return {
    type: CHECKPOINT_RESTORE_RECOVERY_RESOLUTION_EVENT,
    data: buildCheckpointRestoreRecoveryResolution(
      resolutionInput(action, overrides),
    ),
  };
}

function unrelated(label) {
  return {
    type: "message",
    data: { role: "assistant", content: label },
  };
}

function chain(specifications, start = 1) {
  let previous = null;
  return specifications.map((specification, offset) => {
    const event = {
      ...specification,
      timestamp: 1_780_000_000_000 + offset,
      prevHash: previous,
      hash: rawHash(start + offset),
    };
    previous = event.hash;
    return Object.freeze(event);
  });
}

function verifiedReader(events, authorityOverrides = {}) {
  const readMessages = vi.fn(() => {
    throw new Error("session recovery must not rebuild messages");
  });
  const reader = vi.fn((sessionId, createProjection, options) => {
    expect(sessionId).toBe(SESSION_ID);
    expect(options).toBeTypeOf("object");
    const projection = createProjection();
    for (const event of events) projection.accept(event);
    const defaultAuthority = {
      headHash: events.at(-1)?.hash ?? null,
      eventCount: events.length,
      readMessages,
    };
    return projection.finish({
      ...defaultAuthority,
      ...authorityOverrides,
    });
  });
  reader.readMessages = readMessages;
  return reader;
}

function readTimeline(events, options = {}, readerOptions = {}) {
  const reader = verifiedReader(events, readerOptions);
  const result = readCheckpointRestoreSessionRecovery(
    {
      operationId: OPERATION_ID,
      sessionId: SESSION_ID,
      restoreSurface: "timeline",
      ...options,
    },
    { readVerifiedProjection: reader },
  );
  expect(reader).toHaveBeenCalledTimes(1);
  expect(reader.readMessages).not.toHaveBeenCalled();
  return result;
}

describe("checkpoint restore verified session recovery", () => {
  it("classifies a direct restore without consulting session authority", () => {
    const readVerifiedProjection = vi.fn(() => {
      throw new Error("must not read a session for a direct restore");
    });

    const result = readCheckpointRestoreSessionRecovery(
      {
        operationId: OPERATION_ID,
        restoreSurface: "direct",
      },
      { readVerifiedProjection },
    );

    expect(result).toMatchObject({
      schema: CHECKPOINT_RESTORE_SESSION_RECOVERY_SCHEMA,
      version: 1,
      operationId: OPERATION_ID,
      sessionId: null,
      restoreSurface: "direct",
      classification:
        CHECKPOINT_RESTORE_SESSION_RECONCILIATION.NO_SESSION_DIRECT,
      failClosed: false,
      safeToMutate: false,
      transcript: null,
    });
    expect(result.requiredEvidence).toEqual([
      "exact_saga_head",
      "exact_workspace_owner_or_absence",
      "verified_workspace_state",
    ]);
    expect(readVerifiedProjection).not.toHaveBeenCalled();
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.requiredEvidence)).toBe(true);
  });

  it("classifies an operation absent from a verified transcript as a clean abort", () => {
    const events = chain([unrelated("before"), unrelated("after")]);

    const result = readTimeline(events);

    expect(result).toMatchObject({
      classification: CHECKPOINT_RESTORE_SESSION_RECONCILIATION.CLEAN_ABORT,
      failClosed: false,
      safeToMutate: false,
      issues: [],
      transcript: {
        headHash: events.at(-1).hash,
        eventCount: 2,
        operationEventCount: 0,
        operationTailHash: null,
        eventsAfterOperationTail: null,
      },
      intent: null,
      conversationCommit: null,
      audit: { completed: null, failed: null },
    });
    expect(result.requiredEvidence).toContain("operation_events_still_absent");
  });

  it("projects a code intent and exact saga digest in one forward fold", () => {
    const events = chain([
      unrelated("prefix"),
      intent("restore-code"),
      unrelated("suffix"),
    ]);
    const intentHash = events[1].hash;
    const expectedIntentCommitDigest = commitDigest(
      "cc-checkpoint-restore-intent-commit-v1",
      intentHash,
    );

    const result = readTimeline(events, {
      expectedAction: "restore-code",
      expectedTimelineEntryId: "turn-7",
      expectedCheckpointId: "checkpoint-7",
      expectedCheckpointIdentity: "git:checkpoint-identity-7",
      expectedConfirmationDigest: digest(12),
      expectedIntentCommitDigest,
    });

    expect(result).toMatchObject({
      classification:
        CHECKPOINT_RESTORE_SESSION_RECONCILIATION.CODE_SETTLEMENT_RESUMABLE,
      failClosed: false,
      transcript: {
        headHash: events[2].hash,
        eventCount: 3,
        operationEventCount: 1,
        operationTailHash: intentHash,
        eventsAfterOperationTail: 1,
      },
      intent: {
        index: 2,
        eventHash: intentHash,
        prevHash: events[0].hash,
        intentCommitDigest: expectedIntentCommitDigest,
        authority: {
          action: "restore-code",
          turnId: "turn-7",
          checkpointId: "checkpoint-7",
        },
      },
    });
    expect(result).not.toHaveProperty("events");
    expect(result.requiredEvidence).toContain("verified_intent_commit_digest");
  });

  it("keeps a failed restore-both audit resumable with bounded settlement evidence", () => {
    const events = chain([
      intent("restore-both"),
      conversationCommit(),
      audit("failed", "restore-both"),
    ]);

    const result = readTimeline(events);

    expect(result).toMatchObject({
      classification:
        CHECKPOINT_RESTORE_SESSION_RECONCILIATION.BOTH_SETTLEMENT_RESUMABLE,
      failClosed: false,
      conversationCommit: {
        index: 2,
        eventHash: events[1].hash,
        messageCount: 1,
        bindingTurnCount: 1,
      },
      audit: {
        completed: null,
        failed: {
          index: 3,
          eventHash: events[2].hash,
          failureCode: "CHECKPOINT_RESTORE_OUTCOME_UNKNOWN",
          workspaceState: "unknown",
        },
      },
    });
    expect(result.requiredEvidence).toContain(
      "historical_conversation_and_binding_plan",
    );
    expect(result.requiredEvidence).toContain(
      "durable_recovery_resolution_event",
    );
  });

  it("recognizes a completed code settlement and derives its session digest", () => {
    const events = chain([
      intent("restore-code"),
      audit("completed", "restore-code"),
    ]);
    const expectedSessionCommitDigest = commitDigest(
      "cc-checkpoint-restore-session-commit-v1",
      events[1].hash,
    );

    const result = readTimeline(events, { expectedSessionCommitDigest });

    expect(result).toMatchObject({
      classification:
        CHECKPOINT_RESTORE_SESSION_RECONCILIATION.ALREADY_COMPLETED,
      failClosed: false,
      audit: {
        completed: {
          index: 2,
          eventHash: events[1].hash,
          status: "completed",
          sessionCommitDigest: expectedSessionCommitDigest,
        },
        failed: null,
      },
    });
    expect(result.requiredEvidence).toContain("verified_completed_audit_hash");
  });

  it("requires and verifies the conversation commit before completed restore-both", () => {
    const events = chain([
      unrelated("prefix"),
      intent("restore-both"),
      conversationCommit(),
      audit("completed", "restore-both"),
      unrelated("suffix"),
    ]);

    const result = readTimeline(events);

    expect(result).toMatchObject({
      classification:
        CHECKPOINT_RESTORE_SESSION_RECONCILIATION.ALREADY_COMPLETED,
      transcript: {
        eventCount: 5,
        operationEventCount: 3,
        operationTailHash: events[3].hash,
        eventsAfterOperationTail: 1,
      },
      intent: { index: 2 },
      conversationCommit: { index: 3 },
      audit: { completed: { index: 4 }, failed: null },
    });
  });

  it("classifies one exact intent-only rollback resolution as rolled-back", () => {
    const events = chain([
      intent("restore-code"),
      resolution("restore-code"),
      unrelated("later unrelated activity"),
    ]);
    const sessionRollbackCommitDigest =
      computeCheckpointRestoreSessionRollbackCommitDigest(events[1].hash);

    const result = readTimeline(events, {
      expectedSessionRollbackCommitDigest: sessionRollbackCommitDigest,
    });

    expect(result).toMatchObject({
      classification: CHECKPOINT_RESTORE_SESSION_RECONCILIATION.ROLLED_BACK,
      failClosed: false,
      issues: [],
      transcript: {
        headHash: events[2].hash,
        eventCount: 3,
        operationEventCount: 2,
        operationTailHash: events[1].hash,
        eventsAfterOperationTail: 1,
      },
      audit: { completed: null, failed: null },
      resolution: {
        index: 2,
        eventHash: events[1].hash,
        prevHash: events[0].hash,
        sessionRollbackCommitDigest,
        data: {
          schema: CHECKPOINT_RESTORE_RECOVERY_RESOLUTION_SCHEMA,
          version: 1,
          operationId: OPERATION_ID,
          recoveryRequestId: "rollback-request-7",
          recoveryAction: CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ACTION,
          outcome: CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_OUTCOME,
          conversationDisposition:
            CHECKPOINT_RESTORE_ROLLBACK_CONVERSATION_DISPOSITION,
          sagaWorkspaceRolledBackHash: digest(24),
        },
      },
    });
    expect(result.requiredEvidence).toContain(
      "verified_session_rollback_commit_digest",
    );
    expect(Object.isFrozen(result.resolution)).toBe(true);
    expect(Object.isFrozen(result.resolution.data)).toBe(true);
  });

  it("accepts one failed audit followed by its exact restore-both rollback resolution", () => {
    const events = chain([
      intent("restore-both"),
      audit("failed", "restore-both"),
      resolution("restore-both", { failedAuditEventHash: rawHash(2) }),
    ]);

    const result = readTimeline(events);

    expect(result).toMatchObject({
      classification: CHECKPOINT_RESTORE_SESSION_RECONCILIATION.ROLLED_BACK,
      failClosed: false,
      transcript: {
        operationEventCount: 3,
        operationTailHash: events[2].hash,
        eventsAfterOperationTail: 0,
      },
      conversationCommit: null,
      audit: {
        completed: null,
        failed: { eventHash: events[1].hash },
      },
      resolution: {
        eventHash: events[2].hash,
        data: {
          action: "restore-both",
          failedAuditEventHash: events[1].hash,
        },
      },
    });
  });

  it("fails closed when the expected rollback commit digest disagrees", () => {
    const result = readTimeline(
      chain([intent("restore-code"), resolution("restore-code")]),
      { expectedSessionRollbackCommitDigest: digest(999) },
    );

    expect(result).toMatchObject({
      classification:
        CHECKPOINT_RESTORE_SESSION_RECONCILIATION.CONFLICT_UNKNOWN,
      failClosed: true,
    });
    expect(result.issues).toContain("session_rollback_commit_digest_mismatch");
  });

  it.each([
    [
      "duplicate intents",
      [intent("restore-code"), intent("restore-code")],
      "duplicate_or_out_of_order_intent",
    ],
    [
      "conversation commit before intent",
      [conversationCommit(), intent("restore-both")],
      "conversation_commit_before_intent",
    ],
    [
      "restore-code conversation commit",
      [intent("restore-code"), conversationCommit("restore-code")],
      "code_restore_has_conversation_commit",
    ],
    [
      "restore-both completion without conversation commit",
      [intent("restore-both"), audit("completed", "restore-both")],
      "completed_both_missing_conversation_commit",
    ],
    [
      "both audit outcomes",
      [
        intent("restore-code"),
        audit("failed", "restore-code"),
        audit("completed", "restore-code"),
      ],
      "conflicting_audit_outcomes",
    ],
    [
      "unknown operation event",
      [
        intent("restore-code"),
        {
          type: "checkpoint_restore_future_event",
          data: { operationId: OPERATION_ID },
        },
      ],
      "unknown_operation_event_type",
    ],
  ])("fails closed for %s", (_label, specifications, issue) => {
    const result = readTimeline(chain(specifications));

    expect(result.classification).toBe(
      CHECKPOINT_RESTORE_SESSION_RECONCILIATION.CONFLICT_UNKNOWN,
    );
    expect(result.failClosed).toBe(true);
    expect(result.safeToMutate).toBe(false);
    expect(result.issues).toContain(issue);
    expect(result.requiredEvidence).toEqual([
      "manual_adjudication",
      "verified_transcript_repair_or_authority_restoration",
    ]);
  });

  it.each([
    [
      "malformed resolution schema",
      [
        intent("restore-code"),
        {
          type: CHECKPOINT_RESTORE_RECOVERY_RESOLUTION_EVENT,
          data: {
            ...buildCheckpointRestoreRecoveryResolution(resolutionInput()),
            version: 2,
          },
        },
      ],
      "resolution_shape_invalid",
    ],
    [
      "duplicate resolutions",
      [
        intent("restore-code"),
        resolution("restore-code"),
        resolution("restore-code"),
      ],
      "duplicate_recovery_resolution",
    ],
    [
      "resolution before intent",
      [
        resolution("restore-code", { intentEventHash: rawHash(2) }),
        intent("restore-code"),
      ],
      "resolution_before_intent",
    ],
    [
      "failed audit hash mismatch",
      [
        intent("restore-code"),
        audit("failed", "restore-code"),
        resolution("restore-code"),
      ],
      "resolution_failed_audit_mismatch",
    ],
    [
      "intent authority mismatch",
      [
        intent("restore-code"),
        resolution("restore-code", { checkpointId: "checkpoint-other" }),
      ],
      "resolution_intent_mismatch",
    ],
    [
      "conversation commit",
      [
        intent("restore-both"),
        conversationCommit("restore-both"),
        resolution("restore-both"),
      ],
      "resolution_after_conversation_commit",
    ],
    [
      "failed audit conversation side effect",
      [
        intent("restore-both"),
        audit("failed", "restore-both", { branchSessionId: "branch-7" }),
        resolution("restore-both", { failedAuditEventHash: rawHash(2) }),
      ],
      "rollback_resolution_has_conversation_side_effect",
    ],
    [
      "completed audit",
      [
        intent("restore-code"),
        audit("completed", "restore-code"),
        resolution("restore-code"),
      ],
      "resolution_after_completed_audit",
    ],
    [
      "operation event after resolution",
      [
        intent("restore-code"),
        resolution("restore-code"),
        audit("failed", "restore-code"),
      ],
      "resolution_not_operation_tail",
    ],
  ])("fails closed for rollback %s", (_label, specifications, issue) => {
    const result = readTimeline(chain(specifications));

    expect(result.classification).toBe(
      CHECKPOINT_RESTORE_SESSION_RECONCILIATION.CONFLICT_UNKNOWN,
    );
    expect(result.failClosed).toBe(true);
    expect(result.issues).toContain(issue);
  });

  it("fails closed when intent, commit, audit, or saga evidence disagree", () => {
    const events = chain([
      intent("restore-both"),
      conversationCommit("restore-both", { turnId: "turn-other" }),
      audit("completed", "restore-both", {
        checkpointIdentity: "git:different-checkpoint",
      }),
    ]);

    const result = readTimeline(events, {
      expectedIntentCommitDigest: digest(999),
      expectedSessionCommitDigest: digest(998),
    });

    expect(result.classification).toBe("conflict/unknown");
    expect(result.issues).toEqual(
      expect.arrayContaining([
        "conversation_commit_intent_mismatch",
        "audit_intent_mismatch",
        "intent_commit_digest_mismatch",
        "session_commit_digest_mismatch",
      ]),
    );
  });

  it.each([
    ["broken link", { event: { prevHash: rawHash(999) } }, {}],
    ["invalid event hash", { event: { hash: digest(999) } }, {}],
    ["stale transcript head", {}, { headHash: rawHash(999) }],
    ["wrong transcript count", {}, { eventCount: 99 }],
  ])(
    "fails closed for %s from an injected verified reader",
    (_label, mutation, finish) => {
      const events = chain([intent("restore-code")]);
      events[0] = Object.freeze({ ...events[0], ...mutation.event });

      const result = readTimeline(events, {}, finish);

      expect(result.classification).toBe("conflict/unknown");
      expect(result.issues).toEqual(
        expect.arrayContaining([
          mutation.event
            ? "verified_event_chain_invalid"
            : Object.hasOwn(finish, "headHash")
              ? "transcript_head_mismatch"
              : "transcript_event_count_mismatch",
        ]),
      );
    },
  );

  it("fails closed without leaking an injected verified-reader error", () => {
    const privateMessage = "private path C:\\customer\\secret";
    const error = new Error(privateMessage);
    error.code = "SESSION_TRANSCRIPT_UNVERIFIED";

    const result = readCheckpointRestoreSessionRecovery(
      {
        operationId: OPERATION_ID,
        sessionId: SESSION_ID,
        restoreSurface: "timeline",
      },
      {
        readVerifiedProjection: vi.fn(() => {
          throw error;
        }),
      },
    );

    expect(result).toMatchObject({
      classification: "conflict/unknown",
      failClosed: true,
      safeToMutate: false,
      issues: ["verified_projection_unavailable"],
      errorCode: "SESSION_TRANSCRIPT_UNVERIFIED",
      transcript: null,
    });
    expect(JSON.stringify(result)).not.toContain(privateMessage);
  });

  it.each([
    ["bypasses the fold", () => ({ classification: "already-completed" })],
    [
      "returns a different object",
      (_sessionId, factory) => {
        const projection = factory();
        projection.finish({ headHash: null, eventCount: 0 });
        return {};
      },
    ],
    [
      "reuses the factory",
      (_sessionId, factory) => {
        factory();
        return factory();
      },
    ],
  ])("rejects a verified reader that %s", (_label, readVerifiedProjection) => {
    const result = readCheckpointRestoreSessionRecovery(
      {
        operationId: OPERATION_ID,
        sessionId: SESSION_ID,
        restoreSurface: "timeline",
      },
      { readVerifiedProjection },
    );

    expect(result).toMatchObject({
      classification: "conflict/unknown",
      issues: ["verified_projection_unavailable"],
      errorCode: "CHECKPOINT_RESTORE_SESSION_PROJECTION_INVALID",
    });
  });

  it("retains constant-size state across a long verified transcript", () => {
    const specifications = Array.from({ length: 4_000 }, (_, index) =>
      unrelated(`unrelated-${index}`),
    );
    specifications.splice(2_000, 0, intent("restore-code"));
    const events = chain(specifications, 10_000);

    const result = readTimeline(events);
    const serialized = JSON.stringify(result);

    expect(result.classification).toBe("code-settlement-resumable");
    expect(result.transcript).toMatchObject({
      eventCount: 4_001,
      operationEventCount: 1,
      eventsAfterOperationTail: 2_000,
    });
    expect(result).not.toHaveProperty("events");
    expect(serialized.length).toBeLessThan(5_000);
    expect(serialized).not.toContain("unrelated-3999");
  });

  it("builds one strict immutable rollback resolution envelope", () => {
    const input = resolutionInput();

    const built = buildCheckpointRestoreRecoveryResolution(input);

    expect(built).toEqual({
      schema: CHECKPOINT_RESTORE_RECOVERY_RESOLUTION_SCHEMA,
      version: 1,
      ...input,
    });
    expect(Object.isFrozen(built)).toBe(true);
    expect(
      buildCheckpointRestoreRecoveryResolution({
        ...input,
        recoveryRequestId: "x".repeat(256),
      }).recoveryRequestId,
    ).toHaveLength(256);
    expect(
      buildCheckpointRestoreRecoveryResolution({
        ...input,
        recoveryRequestId: "rollback request 7",
      }).recoveryRequestId,
    ).toBe("rollback request 7");
    expect(() =>
      buildCheckpointRestoreRecoveryResolution({ ...input, unknown: true }),
    ).toThrow(
      expect.objectContaining({
        code: CHECKPOINT_RESTORE_SESSION_RESOLUTION_ERROR_CODES.INVALID_ARGUMENT,
      }),
    );
    expect(() =>
      buildCheckpointRestoreRecoveryResolution({
        ...input,
        intentCommitDigest: digest(999),
      }),
    ).toThrow(
      expect.objectContaining({
        code: CHECKPOINT_RESTORE_SESSION_RESOLUTION_ERROR_CODES.INVALID_ARGUMENT,
      }),
    );
    expect(() =>
      buildCheckpointRestoreRecoveryResolution({
        ...input,
        recoveryRequestId: "x".repeat(257),
      }),
    ).toThrow(
      expect.objectContaining({
        code: CHECKPOINT_RESTORE_SESSION_RESOLUTION_ERROR_CODES.INVALID_ARGUMENT,
      }),
    );
  });

  it.each([
    ["empty", ""],
    ["all whitespace", "   "],
    ["leading whitespace", " rollback-request-7"],
    ["trailing whitespace", "rollback-request-7 "],
    ["control character", "rollback\nrequest-7"],
    ["NUL", "rollback\0request-7"],
    ["overlong", "x".repeat(257)],
  ])(
    "rejects a %s recovery request id in the builder and fold",
    (_label, recoveryRequestId) => {
      const input = resolutionInput("restore-code", { recoveryRequestId });
      expect(() => buildCheckpointRestoreRecoveryResolution(input)).toThrow(
        expect.objectContaining({
          code: CHECKPOINT_RESTORE_SESSION_RESOLUTION_ERROR_CODES.INVALID_ARGUMENT,
        }),
      );

      const valid = buildCheckpointRestoreRecoveryResolution(resolutionInput());
      const result = readTimeline(
        chain([
          intent("restore-code"),
          {
            type: CHECKPOINT_RESTORE_RECOVERY_RESOLUTION_EVENT,
            data: { ...valid, recoveryRequestId },
          },
        ]),
      );
      expect(result).toMatchObject({
        classification:
          CHECKPOINT_RESTORE_SESSION_RECONCILIATION.CONFLICT_UNKNOWN,
        failClosed: true,
      });
      expect(result.issues).toContain("resolution_shape_invalid");
    },
  );

  it("appends one resolution through an exact synchronous transaction head", () => {
    const expectedHeadHash = rawHash(1);
    const eventHash = rawHash(2);
    let currentHeadHash = expectedHeadHash;
    const transaction = {
      currentHeadHash: vi.fn(() => currentHeadHash),
      appendAuthorityEvent: vi.fn((type, data) => {
        const event = {
          type,
          timestamp: 1_780_000_000_001,
          data,
          prevHash: currentHeadHash,
          hash: eventHash,
        };
        currentHeadHash = eventHash;
        return { hash: eventHash, event };
      }),
    };
    const input = resolutionInput();

    const result = appendCheckpointRestoreRecoveryResolution(
      transaction,
      input,
      { expectedHeadHash },
    );

    expect(transaction.appendAuthorityEvent).toHaveBeenCalledWith(
      CHECKPOINT_RESTORE_RECOVERY_RESOLUTION_EVENT,
      buildCheckpointRestoreRecoveryResolution(input),
    );
    expect(result).toEqual({
      eventHash,
      prevHash: expectedHeadHash,
      sessionRollbackCommitDigest: commitDigest(
        "cc-checkpoint-restore-session-rollback-commit-v1",
        eventHash,
      ),
      resolution: buildCheckpointRestoreRecoveryResolution(input),
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("refuses a stale transaction head before attempting an append", () => {
    const transaction = {
      currentHeadHash: vi.fn(() => rawHash(9)),
      appendAuthorityEvent: vi.fn(),
    };

    expect(() =>
      appendCheckpointRestoreRecoveryResolution(
        transaction,
        resolutionInput(),
        { expectedHeadHash: rawHash(1) },
      ),
    ).toThrow(
      expect.objectContaining({
        code: CHECKPOINT_RESTORE_SESSION_RESOLUTION_ERROR_CODES.HEAD_CONFLICT,
      }),
    );
    expect(transaction.appendAuthorityEvent).not.toHaveBeenCalled();
  });

  it("fails closed when a transaction append is asynchronous", () => {
    const transaction = {
      currentHeadHash: vi.fn(() => rawHash(1)),
      appendAuthorityEvent: vi.fn(() => Promise.resolve({})),
    };

    expect(() =>
      appendCheckpointRestoreRecoveryResolution(
        transaction,
        resolutionInput(),
        { expectedHeadHash: rawHash(1) },
      ),
    ).toThrow(
      expect.objectContaining({
        code: CHECKPOINT_RESTORE_SESSION_RESOLUTION_ERROR_CODES.ASYNC_UNSUPPORTED,
        commitState: "unknown",
      }),
    );
  });

  it("projects exact reconciliation evidence when append response is lost", () => {
    const intentEventHash = rawHash(70);
    const input = resolutionInput("restore-code", { intentEventHash });
    let appendedSpecification = null;
    const responseLoss = new Error("simulated response loss");
    responseLoss.code = "SESSION_INDEX_ANCHOR_FAILED";
    responseLoss.commitState = "not-committed";
    const transaction = {
      currentHeadHash: vi.fn(() => intentEventHash),
      appendAuthorityEvent: vi.fn((type, data) => {
        appendedSpecification = { type, data };
        throw responseLoss;
      }),
    };

    expect(() =>
      appendCheckpointRestoreRecoveryResolution(transaction, input, {
        expectedHeadHash: intentEventHash,
      }),
    ).toThrow(responseLoss);
    expect(responseLoss).toMatchObject({
      code: "SESSION_INDEX_ANCHOR_FAILED",
      commitState: "unknown",
    });
    expect(transaction.appendAuthorityEvent).toHaveBeenCalledTimes(1);

    const events = chain([intent("restore-code"), appendedSpecification], 70);
    const result = readTimeline(events);
    expect(result).toMatchObject({
      classification: CHECKPOINT_RESTORE_SESSION_RECONCILIATION.ROLLED_BACK,
      resolution: {
        eventHash: events[1].hash,
        prevHash: intentEventHash,
        sessionRollbackCommitDigest:
          computeCheckpointRestoreSessionRollbackCommitDigest(events[1].hash),
        data: buildCheckpointRestoreRecoveryResolution(input),
      },
    });
    const reconciled = reconcileCheckpointRestoreRecoveryResolutionProjection(
      result,
      input,
      {
        expectedHeadHash: intentEventHash,
        expectedSessionId: SESSION_ID,
      },
    );
    expect(reconciled).toMatchObject({
      eventHash: events[1].hash,
      prevHash: intentEventHash,
      sessionRollbackCommitDigest:
        computeCheckpointRestoreSessionRollbackCommitDigest(events[1].hash),
      resolution: { recoveryRequestId: "rollback-request-7" },
      reconciledFromError: true,
    });
    expect(
      reconcileCheckpointRestoreRecoveryResolutionProjection(
        result,
        { ...input, recoveryRequestId: "different-request" },
        { expectedHeadHash: intentEventHash, expectedSessionId: SESSION_ID },
      ),
    ).toBeNull();
    expect(
      reconcileCheckpointRestoreRecoveryResolutionProjection(result, input, {
        expectedHeadHash: rawHash(99),
        expectedSessionId: SESSION_ID,
      }),
    ).toBeNull();
  });

  it("requires and reconciles only the exact timeline session", () => {
    const intentEventHash = rawHash(80);
    const input = resolutionInput("restore-code", { intentEventHash });
    const result = readTimeline(
      chain(
        [
          intent("restore-code"),
          resolution("restore-code", { intentEventHash }),
        ],
        80,
      ),
    );

    expect(() =>
      reconcileCheckpointRestoreRecoveryResolutionProjection(result, input, {
        expectedHeadHash: intentEventHash,
      }),
    ).toThrow(
      expect.objectContaining({
        code: CHECKPOINT_RESTORE_SESSION_RESOLUTION_ERROR_CODES.INVALID_ARGUMENT,
      }),
    );
    expect(
      reconcileCheckpointRestoreRecoveryResolutionProjection(result, input, {
        expectedHeadHash: intentEventHash,
        expectedSessionId: "session-other",
      }),
    ).toBeNull();
    for (const projection of [
      { ...result, sessionId: undefined },
      { ...result, sessionId: "session-other" },
      { ...result, restoreSurface: "direct" },
    ]) {
      expect(
        reconcileCheckpointRestoreRecoveryResolutionProjection(
          projection,
          input,
          {
            expectedHeadHash: intentEventHash,
            expectedSessionId: SESSION_ID,
          },
        ),
      ).toBeNull();
    }
  });

  it("labels an untagged synchronous append response loss as unknown", () => {
    const responseLoss = new Error("simulated untagged response loss");
    const transaction = {
      currentHeadHash: vi.fn(() => rawHash(1)),
      appendAuthorityEvent: vi.fn(() => {
        throw responseLoss;
      }),
    };

    let thrown = null;
    try {
      appendCheckpointRestoreRecoveryResolution(
        transaction,
        resolutionInput(),
        { expectedHeadHash: rawHash(1) },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      code: CHECKPOINT_RESTORE_SESSION_RESOLUTION_ERROR_CODES.APPEND_UNVERIFIED,
      commitState: "unknown",
    });
    expect(thrown.cause).toBe(responseLoss);
    expect(transaction.appendAuthorityEvent).toHaveBeenCalledTimes(1);
  });

  it("provides a reusable injected reader without adding write capability", () => {
    const events = chain([intent("restore-code")]);
    const readVerifiedProjection = verifiedReader(events);
    const reader = createCheckpointRestoreSessionRecoveryReader({
      readVerifiedProjection,
    });

    const result = reader.read({
      operationId: OPERATION_ID,
      sessionId: SESSION_ID,
      restoreSurface: "timeline",
    });

    expect(result.classification).toBe("code-settlement-resumable");
    expect(Object.keys(reader)).toEqual(["read"]);
    expect(Object.isFrozen(reader)).toBe(true);
    expect(readVerifiedProjection).toHaveBeenCalledTimes(1);
    expect(readVerifiedProjection.readMessages).not.toHaveBeenCalled();
  });
});

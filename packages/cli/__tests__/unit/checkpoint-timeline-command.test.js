import { beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";

const state = vi.hoisted(() => ({
  turns: [],
  checkpoints: [],
  messages: [],
  headHash: "head-1",
  conditional: [],
  audit: [],
  restores: [],
  branches: [],
  transactions: [],
  transactionActive: false,
  onRestore: null,
  gitAvailable: true,
  workspaceRoot: process.cwd(),
  workspaceNonce: "1".repeat(64),
  statusIdentities: [],
  restoreIdentities: [],
  restoreBindings: [],
  failFailedAudit: false,
  failConversationAppend: false,
  failCompletedAudit: false,
  failFinalSettlement: false,
  events: [],
  workspaceLocks: [],
  workspaceLockActive: false,
  onWorkspaceLockWait: null,
  workspaceLockError: null,
  retainedWorkspaceLocks: [],
  sagas: [],
  restoreTargetCount: 1,
  failSagaArchive: false,
  failSagaAdvancePhase: null,
  failPostCommitReload: false,
}));

vi.mock("../../src/lib/turn-binding-store.js", () => ({
  TURN_BINDING_TIMELINE_EVENT: "checkpoint_timeline_commit",
  loadTurnBindingLog: () => ({
    list: () => state.turns.map((turn) => ({ ...turn })),
    pruneFromOffset: (offset) => {
      state.turns = state.turns.filter(
        (turn) => Number(turn.conversationOffset) < Number(offset),
      );
    },
    toJSON: () => ({ turns: state.turns.map((turn) => ({ ...turn })) }),
  }),
}));

vi.mock("../../src/harness/jsonl-session-store.js", () => ({
  findLatestEvent: () => {
    if (
      state.failPostCommitReload &&
      state.conditional.some(
        (event) =>
          event.type === "checkpoint_timeline_action" &&
          event.data?.status === "completed",
      )
    ) {
      const error = new Error("injected post-commit timeline reload failure");
      error.code = "INJECTED_POST_COMMIT_RELOAD_FAILURE";
      throw error;
    }
    return { hash: state.headHash };
  },
  readVerifiedMessages: () => state.messages.map((message) => ({ ...message })),
  withSessionAuthorityTransaction: (_sessionId, expected, task) => {
    state.events.push("session:acquire");
    if (expected !== state.headHash) {
      const error = new Error("stale");
      error.code = "SESSION_REVISION_STALE";
      throw error;
    }
    const transaction = { expected, events: [] };
    let writerPoisoned = false;
    let settlementUnknown = false;
    let retainedRecovery = null;
    state.transactions.push(transaction);
    state.transactionActive = true;
    try {
      try {
        const callbackResult = task({
          retainRecoveryEvidence(evidence) {
            const sanitized = {};
            for (const field of [
              "safetyId",
              "safetyIdentity",
              "safetyPlanIdentity",
              "safetyCoverage",
              "restorePhase",
              "branchSessionId",
            ]) {
              if (typeof evidence?.[field] === "string") {
                sanitized[field] = evidence[field];
              }
            }
            if (Array.isArray(evidence?.createdPaths)) {
              sanitized.createdPaths = evidence.createdPaths.filter(
                (item) => typeof item === "string",
              );
            }
            retainedRecovery = { ...(retainedRecovery || {}), ...sanitized };
            transaction.recoveryEvidence = retainedRecovery;
            return retainedRecovery;
          },
          appendAuthorityEvent(type, data) {
            if (writerPoisoned) {
              const error = new Error("injected poisoned writer");
              error.code = "SESSION_AUTHORITY_TRANSACTION_POISONED";
              error.commitState = "unknown";
              throw error;
            }
            if (
              state.failConversationAppend &&
              type === "checkpoint_timeline_commit"
            ) {
              writerPoisoned = true;
              const error = new Error("injected conversation append failure");
              error.code = "INJECTED_CONVERSATION_APPEND_FAILURE";
              throw error;
            }
            const event = { type, data, expected: state.headHash };
            if (type === "checkpoint_timeline_action_intent") {
              state.events.push("intent");
            }
            transaction.events.push(event);
            state.conditional.push(event);
            state.headHash = `${type}-${state.conditional.length}`;
            if (
              (state.failFailedAudit &&
                type === "checkpoint_timeline_action" &&
                data?.status === "failed") ||
              (state.failCompletedAudit &&
                type === "checkpoint_timeline_action" &&
                data?.status === "completed")
            ) {
              writerPoisoned = true;
              settlementUnknown = true;
              const error = new Error("injected audit anchor failure");
              error.code = "SESSION_INDEX_ANCHOR_FAILED";
              error.commitState = "unknown";
              throw error;
            }
            if (type === "checkpoint_timeline_action") {
              state.audit.push({ type, data });
            }
            return { hash: state.headHash };
          },
        });
        if (state.failFinalSettlement) {
          const error = new Error("injected final settlement failure");
          error.code = "SESSION_INDEX_ANCHOR_FAILED";
          error.commitState = "unknown";
          error.transactionRecoveryEvidence = retainedRecovery;
          throw error;
        }
        if (
          transaction.events.some(
            (event) => typeof event.data?.operationId === "string",
          )
        ) {
          state.events.push("session:settled");
        }
        return callbackResult;
      } catch (operationError) {
        if (!settlementUnknown) throw operationError;
        const settlementError = new Error(
          "injected transaction settlement failure",
        );
        settlementError.code = "SESSION_INDEX_ANCHOR_FAILED";
        settlementError.commitState = "unknown";
        settlementError.transactionError = operationError;
        throw settlementError;
      }
    } finally {
      state.transactionActive = false;
    }
  },
  createBranchSession: (options) => {
    const branch = {
      branchSessionId: options.branchSessionId,
      messages: options.messages.length,
      created: true,
    };
    state.branches.push(branch);
    return branch;
  },
}));

vi.mock("../../src/lib/checkpoint-store.js", () => ({
  isCheckpointAvailable: () => state.gitAvailable,
  listCheckpoints: () =>
    state.checkpoints.map((checkpoint) => ({ ...checkpoint })),
  statusAgainst: (_dir, _checkpointId, options) => {
    state.statusIdentities.push({
      engine: "git",
      identity: options?.expectedIdentity || null,
    });
    return {
      modified:
        state.restoreTargetCount > 0
          ? Array.from(
              { length: state.restoreTargetCount },
              (_, index) => `src/${String.fromCharCode(97 + index)}.js`,
            )
          : [],
      added: [],
      deleted: [],
      workspaceBinding: {
        schema: "cc-checkpoint-workspace-binding/v1",
        version: 1,
        engine: "git",
        workspaceRoot: state.workspaceRoot,
        scopeIdentity: `sha256:${"2".repeat(64)}`,
        prestateIdentity: `git-tree:${state.workspaceNonce.slice(0, 40)}`,
        writePlanIdentity: `sha256:${state.workspaceNonce}`,
        targetPoststateIdentity: `git-tree:${"3".repeat(40)}`,
      },
    };
  },
  rewindTo: (_dir, checkpointId, options) => {
    state.events.push("restore");
    if (state.restoreTargetCount > 0) {
      options?.onSafetyReady?.({
        safetyId: "safety-1",
        safetyIdentity: `git:${"d".repeat(40)}`,
        safetyPlanIdentity: `sha256:${"7".repeat(64)}`,
        safetyCoverage: "full",
      });
      options?.onMutationStarted?.({
        mutationCount: state.restoreTargetCount,
      });
    }
    state.onRestore?.();
    state.restores.push(checkpointId);
    state.restoreIdentities.push({
      engine: "git",
      identity: options?.expectedIdentity || null,
    });
    state.restoreBindings.push(options?.expectedWorkspaceBinding || null);
    options?.onWorkspaceApplied?.({
      mutationCount: state.restoreTargetCount,
      appliedCount: state.restoreTargetCount,
      poststateIdentity: `git-tree:${"3".repeat(40)}`,
    });
    return {
      modified: state.restoreTargetCount,
      recreated: 0,
      deleted: 0,
      safetyId: "safety-1",
      safetyIdentity: `git:${"d".repeat(40)}`,
      safetyPlanIdentity: `sha256:${"7".repeat(64)}`,
      safetyCoverage: "checkpoint",
    };
  },
}));

vi.mock("../../src/lib/file-checkpoint.js", () => ({
  listCheckpoints: () =>
    state.checkpoints.map((checkpoint) => ({ ...checkpoint })),
  diffCheckpoint: (_checkpointId, options) => {
    state.statusIdentities.push({
      engine: "copy",
      identity: options?.expectedIdentity || null,
    });
    return {
      modified:
        state.restoreTargetCount > 0
          ? Array.from(
              { length: state.restoreTargetCount },
              (_, index) => `src/${String.fromCharCode(97 + index)}.js`,
            )
          : [],
      unchanged: [],
      deleted: [],
      workspaceBinding: {
        schema: "cc-checkpoint-workspace-binding/v1",
        version: 1,
        engine: "copy",
        workspaceRoot: state.workspaceRoot,
        scopeIdentity: `sha256:${"4".repeat(64)}`,
        prestateIdentity: `sha256:${state.workspaceNonce}`,
        writePlanIdentity: `sha256:${state.workspaceNonce}`,
        targetPoststateIdentity: `sha256:${"5".repeat(64)}`,
      },
    };
  },
  restoreCheckpoint: (checkpointId, options) => {
    state.events.push("restore");
    if (state.restoreTargetCount > 0) {
      options?.onSafetyReady?.({
        safetyId: "safety-copy-1",
        safetyIdentity: `sha256:${"e".repeat(64)}`,
        safetyPlanIdentity: `sha256:${"8".repeat(64)}`,
        safetyCoverage: "full",
      });
      options?.onMutationStarted?.({
        mutationCount: state.restoreTargetCount,
      });
    }
    state.onRestore?.();
    state.restores.push(checkpointId);
    state.restoreIdentities.push({
      engine: "copy",
      identity: options?.expectedIdentity || null,
    });
    state.restoreBindings.push(options?.expectedWorkspaceBinding || null);
    const restoredPaths = Array.from(
      { length: state.restoreTargetCount },
      (_, index) => `src/${String.fromCharCode(97 + index)}.js`,
    );
    options?.onWorkspaceApplied?.({
      restored: restoredPaths,
      createdPaths: [],
      deletedPaths: [],
      safetyId: state.restoreTargetCount > 0 ? "safety-copy-1" : null,
      safetyIdentity:
        state.restoreTargetCount > 0 ? `sha256:${"e".repeat(64)}` : null,
      safetyPlanIdentity:
        state.restoreTargetCount > 0 ? `sha256:${"8".repeat(64)}` : null,
    });
    return {
      restored: restoredPaths,
      unchanged: [],
      missingBlob: [],
      safetyId: state.restoreTargetCount > 0 ? "safety-copy-1" : null,
      safetyIdentity:
        state.restoreTargetCount > 0 ? `sha256:${"e".repeat(64)}` : null,
      safetyPlanIdentity:
        state.restoreTargetCount > 0 ? `sha256:${"8".repeat(64)}` : null,
      safetyCoverage: "full",
      createdPaths: [],
    };
  },
}));

const { registerCheckpointCommand } =
  await import("../../src/commands/checkpoint.js");

function createTestSagaStore({ workspaceRoot }) {
  const record = {
    workspaceRoot,
    operationId: null,
    events: [],
    archived: false,
  };
  state.sagas.push(record);
  const snapshot = () => {
    const latest = record.events.at(-1);
    return {
      operationId: record.operationId,
      workspaceRoot,
      seq: latest.seq,
      headHash: latest.hash,
      phase: latest.phase,
      terminal: ["completed", "aborted", "rolled_back"].includes(latest.phase),
      pending: !["completed", "aborted", "rolled_back"].includes(latest.phase),
      events: record.events.map((event) => ({
        ...event,
        evidence: { ...event.evidence },
      })),
    };
  };
  return {
    create({ operationId, evidence }) {
      record.operationId = operationId;
      record.events.push({
        seq: 1,
        phase: "created",
        prevHash: null,
        hash: `sha256:${"1".repeat(64)}`,
        evidence: { ...evidence },
      });
      return snapshot();
    },
    load(operationId) {
      if (operationId !== record.operationId) throw new Error("missing saga");
      return snapshot();
    },
    advance(operationId, { expectedSeq, expectedHash, phase, evidence }) {
      const current = snapshot();
      if (
        operationId !== record.operationId ||
        expectedSeq !== current.seq ||
        expectedHash !== current.headHash
      ) {
        const error = new Error("injected saga conflict");
        error.code = "CHECKPOINT_RESTORE_SAGA_CONFLICT";
        throw error;
      }
      const seq = current.seq + 1;
      record.events.push({
        seq,
        phase,
        prevHash: current.headHash,
        hash: `sha256:${String(seq % 16).repeat(64)}`,
        evidence: { ...evidence },
      });
      if (state.failSagaAdvancePhase === phase) {
        const error = new Error("injected committed saga response loss");
        error.code = "CHECKPOINT_RESTORE_SAGA_WRITE_FAILED";
        error.commitState = "head_commit_unknown";
        throw error;
      }
      if (phase === "session_committed" || phase === "completed") {
        state.events.push(`saga:${phase}`);
      }
      return snapshot();
    },
    archiveTerminal(operationId, { expectedSeq, expectedHash }) {
      if (state.failSagaArchive) {
        const error = new Error("injected saga archive failure");
        error.code = "CHECKPOINT_RESTORE_SAGA_WRITE_FAILED";
        throw error;
      }
      const current = snapshot();
      if (
        operationId !== record.operationId ||
        expectedSeq !== current.seq ||
        expectedHash !== current.headHash ||
        !current.terminal
      ) {
        throw new Error("injected saga archive conflict");
      }
      record.archived = true;
      return { archived: true };
    },
  };
}

function withTestWorkspaceLock(options, callback) {
  state.onWorkspaceLockWait?.();
  if (state.workspaceLockError) throw state.workspaceLockError;
  state.workspaceLocks.push({ ...options });
  state.events.push("workspace:acquire");
  state.workspaceLockActive = true;
  let retained = false;
  const lease = {
    canonicalWorkspaceRoot: options.workspaceRoot,
    owner: {
      identityPolicy: "pid-only-fail-closed",
      pid: 12345,
      purpose: "checkpoint-restore",
      startedAt: 1_785_700_000_000,
      token: "unit-test-owner-token-0001",
      transactionId: options.operationId,
      workspaceRoot: options.workspaceRoot,
    },
    assertOwned: () => {
      if (!state.workspaceLockActive) {
        const error = new Error("workspace lock ownership lost");
        error.code = "LOCK_OWNERSHIP_LOST";
        throw error;
      }
    },
    retainForRecovery: (reason) => {
      retained = true;
      state.retainedWorkspaceLocks.push({
        operationId: options.operationId,
        reason,
      });
      const error = new Error("workspace lock retained for recovery");
      error.code = "WORKSPACE_TRANSACTION_RECOVERY_REQUIRED";
      error.operationId = options.operationId;
      error.workspaceLockRetained = true;
      throw error;
    },
  };
  try {
    return callback(lease);
  } finally {
    state.workspaceLockActive = false;
    state.events.push(retained ? "workspace:retain" : "workspace:release");
  }
}

async function invoke(args) {
  const program = new Command();
  registerCheckpointCommand(program, {
    withWorkspaceLockSync: withTestWorkspaceLock,
    createCheckpointRestoreSagaStore: createTestSagaStore,
  });
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await program.parseAsync(args, { from: "user" });
    return JSON.parse(output.mock.calls.at(-1)[0]);
  } finally {
    output.mockRestore();
  }
}

async function previewConfirmation(submission, sessionId = "s1") {
  const preview = await invoke([
    "checkpoint",
    "action",
    "-s",
    sessionId,
    "--submission",
    JSON.stringify(submission),
    "--preview",
    "--json",
  ]);
  expect(preview).toMatchObject({ ok: true, mode: "preview" });
  return preview.confirmationSubmission;
}

describe("checkpoint timeline CLI command authority", () => {
  beforeEach(() => {
    state.turns = [
      {
        turnId: "turn-1",
        conversationOffset: 2,
        fileCheckpointId: "cp-1",
        coverage: "full",
      },
    ];
    state.checkpoints = [
      {
        id: "cp-1",
        label: "before edit",
        createdAt: "2026-08-01T00:00:00.000Z",
        fileCount: 1,
        commit: "a".repeat(40),
        identity: `sha256:${"c".repeat(64)}`,
      },
    ];
    state.messages = [
      { role: "system", content: "system" },
      { role: "user", content: "edit" },
      { role: "assistant", content: "done" },
    ];
    state.headHash = "head-1";
    state.conditional = [];
    state.audit = [];
    state.restores = [];
    state.branches = [];
    state.transactions = [];
    state.transactionActive = false;
    state.onRestore = null;
    state.gitAvailable = true;
    state.workspaceNonce = "1".repeat(64);
    state.statusIdentities = [];
    state.restoreIdentities = [];
    state.restoreBindings = [];
    state.failFailedAudit = false;
    state.failConversationAppend = false;
    state.failCompletedAudit = false;
    state.failFinalSettlement = false;
    state.events = [];
    state.workspaceLocks = [];
    state.workspaceLockActive = false;
    state.onWorkspaceLockWait = null;
    state.workspaceLockError = null;
    state.retainedWorkspaceLocks = [];
    state.sagas = [];
    state.restoreTargetCount = 1;
    state.failSagaArchive = false;
    state.failSagaAdvancePhase = null;
    state.failPostCommitReload = false;
    process.exitCode = undefined;
  });

  it("binds even a forced direct restore to an immediate full-state preflight", async () => {
    state.onRestore = () => {
      expect(state.workspaceLockActive).toBe(true);
    };
    const restored = await invoke([
      "checkpoint",
      "restore",
      "cp-1",
      "-s",
      "s1",
      "--force",
      "--json",
    ]);

    expect(restored).toMatchObject({ safetyId: "safety-1" });
    expect(state.statusIdentities).toEqual([
      { engine: "git", identity: null },
      { engine: "git", identity: null },
    ]);
    expect(state.restoreBindings).toHaveLength(1);
    expect(state.restoreBindings[0]).toMatchObject({
      schema: "cc-checkpoint-workspace-binding/v1",
      engine: "git",
      workspaceRoot: state.workspaceRoot,
    });
    expect(state.workspaceLocks).toEqual([
      expect.objectContaining({
        workspaceRoot: state.workspaceRoot,
        purpose: "checkpoint-restore",
      }),
    ]);
    expect(state.events).toEqual([
      "workspace:acquire",
      "restore",
      "workspace:release",
    ]);
  });

  it("previews read-only, then CAS-claims and commits restore-both", async () => {
    const timeline = await invoke([
      "checkpoint",
      "timeline",
      "-s",
      "s1",
      "--json",
    ]);
    const submission = timeline.entries[0].actions.find(
      (action) => action.action === "restore-both",
    ).submission;
    const encoded = JSON.stringify(submission);

    const preview = await invoke([
      "checkpoint",
      "action",
      "-s",
      "s1",
      "--submission",
      encoded,
      "--preview",
      "--json",
    ]);
    expect(preview).toMatchObject({
      ok: true,
      mode: "preview",
      action: "restore-both",
      revision: timeline.revision,
    });
    expect(state.conditional).toEqual([]);
    expect(state.restores).toEqual([]);
    const confirmation = JSON.stringify(preview.confirmationSubmission);

    const executed = await invoke([
      "checkpoint",
      "action",
      "-s",
      "s1",
      "--submission",
      confirmation,
      "--confirm",
      "--json",
    ]);
    expect(executed).toMatchObject({
      ok: true,
      mode: "executed",
      action: "restore-both",
      operationId: expect.stringMatching(/^checkpoint-restore-/),
      result: {
        code: { safetyId: "safety-1" },
        conversation: { messages: 1 },
      },
    });
    expect(state.restores).toEqual(["cp-1"]);
    expect(state.statusIdentities).toEqual([
      { engine: "git", identity: `git:${"a".repeat(40)}` },
      { engine: "git", identity: `git:${"a".repeat(40)}` },
      { engine: "git", identity: `git:${"a".repeat(40)}` },
    ]);
    expect(state.restoreIdentities).toEqual([
      { engine: "git", identity: `git:${"a".repeat(40)}` },
    ]);
    expect(state.restoreBindings[0]).toMatchObject({
      engine: "git",
      workspaceRoot: state.workspaceRoot,
      prestateIdentity: `git-tree:${"1".repeat(40)}`,
    });
    expect(state.conditional.map((event) => event.type)).toEqual([
      "checkpoint_timeline_action_intent",
      "checkpoint_timeline_commit",
      "checkpoint_timeline_action",
    ]);
    expect(state.transactions).toHaveLength(1);
    expect(state.transactions[0].expected).toBe("head-1");
    expect(state.transactions[0].events).toHaveLength(3);
    expect(state.audit).toEqual([
      expect.objectContaining({ type: "checkpoint_timeline_action" }),
    ]);
    expect(state.sagas).toHaveLength(1);
    expect(state.sagas[0].operationId).toBe(executed.operationId);
    expect(state.sagas[0].archived).toBe(true);
    expect(state.workspaceLocks[0].operationId).toBe(executed.operationId);
    expect(state.sagas[0].events.map((event) => event.phase)).toEqual([
      "created",
      "locked",
      "prepared",
      "intent_committed",
      "safety_ready",
      "mutation_started",
      "workspace_applied",
      "session_committed",
      "completed",
    ]);
    expect(state.sagas[0].events[0].evidence).toMatchObject({
      restoreKind: "git",
      checkpointId: "cp-1",
      checkpointIdentity: `git:${"a".repeat(40)}`,
    });
    expect(state.sagas[0].events[2].evidence).toMatchObject({
      targetCount: 1,
    });
    expect(state.sagas[0].events[4].evidence).toMatchObject({
      safetyCoverage: "full",
      safetyPlanIdentity: `sha256:${"7".repeat(64)}`,
    });
    expect(state.conditional.map((event) => event.data.operationId)).toEqual([
      executed.operationId,
      executed.operationId,
      executed.operationId,
    ]);
    expect(state.events).toEqual([
      "workspace:acquire",
      "session:acquire",
      "intent",
      "restore",
      "session:settled",
      "saga:session_committed",
      "saga:completed",
      "workspace:release",
    ]);
  });

  it("keeps conversation-only confirmation workspace-null and skips the workspace lock", async () => {
    const timeline = await invoke([
      "checkpoint",
      "timeline",
      "-s",
      "s1",
      "--json",
    ]);
    const submission = timeline.entries[0].actions.find(
      (action) => action.action === "restore-conversation",
    ).submission;
    const confirmation = await previewConfirmation(submission);
    expect(confirmation.workspace).toBeNull();

    const executed = await invoke([
      "checkpoint",
      "action",
      "-s",
      "s1",
      "--submission",
      JSON.stringify(confirmation),
      "--confirm",
      "--json",
    ]);

    expect(executed).toMatchObject({
      ok: true,
      action: "restore-conversation",
    });
    expect(state.workspaceLocks).toEqual([]);
    expect(state.restores).toEqual([]);
    expect(state.events).toEqual(["session:acquire", "intent"]);
  });

  it("completes a zero-target restore without inventing safety or mutation evidence", async () => {
    state.restoreTargetCount = 0;
    const timeline = await invoke([
      "checkpoint",
      "timeline",
      "-s",
      "s1",
      "--json",
    ]);
    const submission = timeline.entries[0].actions.find(
      (action) => action.action === "restore-both",
    ).submission;
    const confirmation = await previewConfirmation(submission);

    const executed = await invoke([
      "checkpoint",
      "action",
      "-s",
      "s1",
      "--submission",
      JSON.stringify(confirmation),
      "--confirm",
      "--json",
    ]);

    expect(executed.ok).toBe(true);
    expect(state.sagas[0].events.map((event) => event.phase)).toEqual([
      "created",
      "locked",
      "prepared",
      "intent_committed",
      "workspace_applied",
      "session_committed",
      "completed",
    ]);
    expect(state.sagas[0].events[2].evidence.targetCount).toBe(0);
    expect(state.sagas[0].events[4].evidence.appliedCount).toBe(0);
  });

  it("reports terminal saga archive failure as a warning after a successful restore", async () => {
    state.failSagaArchive = true;
    const timeline = await invoke([
      "checkpoint",
      "timeline",
      "-s",
      "s1",
      "--json",
    ]);
    const submission = timeline.entries[0].actions.find(
      (action) => action.action === "restore-code",
    ).submission;
    const confirmation = await previewConfirmation(submission);

    const executed = await invoke([
      "checkpoint",
      "action",
      "-s",
      "s1",
      "--submission",
      JSON.stringify(confirmation),
      "--confirm",
      "--json",
    ]);

    expect(executed).toMatchObject({ ok: true, action: "restore-code" });
    expect(executed.warnings).toEqual([
      expect.stringContaining("saga archive is pending"),
    ]);
    expect(state.sagas[0].events.at(-1).phase).toBe("completed");
    expect(state.sagas[0].archived).toBe(false);
  });

  it("reconciles a committed saga response loss without replaying the restore", async () => {
    state.failSagaAdvancePhase = "completed";
    const timeline = await invoke([
      "checkpoint",
      "timeline",
      "-s",
      "s1",
      "--json",
    ]);
    const submission = timeline.entries[0].actions.find(
      (action) => action.action === "restore-code",
    ).submission;
    const confirmation = await previewConfirmation(submission);

    const executed = await invoke([
      "checkpoint",
      "action",
      "-s",
      "s1",
      "--submission",
      JSON.stringify(confirmation),
      "--confirm",
      "--json",
    ]);

    expect(executed.ok).toBe(true);
    expect(state.restores).toEqual(["cp-1"]);
    expect(
      state.sagas[0].events.filter((event) => event.phase === "completed"),
    ).toHaveLength(1);
    expect(state.sagas[0].archived).toBe(true);
  });

  it("keeps a committed restore successful when only post-commit timeline reload fails", async () => {
    const timeline = await invoke([
      "checkpoint",
      "timeline",
      "-s",
      "s1",
      "--json",
    ]);
    const submission = timeline.entries[0].actions.find(
      (action) => action.action === "restore-code",
    ).submission;
    const confirmation = await previewConfirmation(submission);
    state.failPostCommitReload = true;

    const executed = await invoke([
      "checkpoint",
      "action",
      "-s",
      "s1",
      "--submission",
      JSON.stringify(confirmation),
      "--confirm",
      "--json",
    ]);

    expect(executed).toMatchObject({
      ok: true,
      action: "restore-code",
      nextRevision: null,
      operationId: expect.stringMatching(/^checkpoint-restore-/),
    });
    expect(executed.warnings).toEqual([
      expect.stringContaining("next timeline revision could not be reloaded"),
    ]);
    expect(state.restores).toEqual(["cp-1"]);
    expect(state.sagas[0]).toMatchObject({ archived: true });
  });

  it("requires a preview-issued confirmation before any code status or write", async () => {
    const timeline = await invoke([
      "checkpoint",
      "timeline",
      "-s",
      "s1",
      "--json",
    ]);
    const submission = timeline.entries[0].actions.find(
      (action) => action.action === "restore-code",
    ).submission;

    const rejected = await invoke([
      "checkpoint",
      "action",
      "-s",
      "s1",
      "--submission",
      JSON.stringify(submission),
      "--confirm",
      "--json",
    ]);

    expect(rejected).toMatchObject({
      ok: false,
      code: "TIMELINE_PREVIEW_REQUIRED",
    });
    expect(state.statusIdentities).toEqual([]);
    expect(state.transactions).toEqual([]);
    expect(state.restores).toEqual([]);
  });

  it("rejects workspace drift while waiting for the lock before intent or restore", async () => {
    const timeline = await invoke([
      "checkpoint",
      "timeline",
      "-s",
      "s1",
      "--json",
    ]);
    const submission = timeline.entries[0].actions.find(
      (action) => action.action === "restore-both",
    ).submission;
    const confirmation = await previewConfirmation(submission);
    state.onWorkspaceLockWait = () => {
      state.workspaceNonce = "6".repeat(64);
    };

    const rejected = await invoke([
      "checkpoint",
      "action",
      "-s",
      "s1",
      "--submission",
      JSON.stringify(confirmation),
      "--confirm",
      "--json",
    ]);

    expect(rejected).toMatchObject({
      ok: false,
      code: "TIMELINE_WORKSPACE_STALE",
    });
    expect(state.statusIdentities).toHaveLength(3);
    expect(state.workspaceLocks).toHaveLength(1);
    expect(state.transactions).toEqual([]);
    expect(state.conditional).toEqual([]);
    expect(state.restores).toEqual([]);
    expect(state.events).toEqual(["workspace:acquire", "workspace:release"]);
    expect(state.sagas[0].events.map((event) => event.phase)).toEqual([
      "created",
      "locked",
      "aborted",
    ]);
    expect(state.sagas[0].archived).toBe(true);
  });

  it.each([
    "WORKSPACE_LOCK_TIMEOUT",
    "WORKSPACE_TRANSACTION_RECOVERY_REQUIRED",
  ])("fails closed on %s before session intent or restore", async (code) => {
    const timeline = await invoke([
      "checkpoint",
      "timeline",
      "-s",
      "s1",
      "--json",
    ]);
    const submission = timeline.entries[0].actions.find(
      (action) => action.action === "restore-code",
    ).submission;
    const confirmation = await previewConfirmation(submission);
    const lockError = new Error("injected workspace lock failure");
    lockError.code = code;
    lockError.ownerTransactionId = "checkpoint-restore-incumbent";
    state.workspaceLockError = lockError;

    const rejected = await invoke([
      "checkpoint",
      "action",
      "-s",
      "s1",
      "--submission",
      JSON.stringify(confirmation),
      "--confirm",
      "--json",
    ]);

    expect(rejected).toMatchObject({
      ok: false,
      code,
      blockingOperationId: "checkpoint-restore-incumbent",
    });
    expect(state.transactions).toEqual([]);
    expect(state.conditional).toEqual([]);
    expect(state.restores).toEqual([]);
    expect(state.events).toEqual([]);
    expect(state.sagas[0].events.map((event) => event.phase)).toEqual([
      "created",
      "aborted",
    ]);
    expect(state.sagas[0].archived).toBe(true);
  });

  it("keeps the writer transaction active across code restore and conversation commit", async () => {
    const timeline = await invoke([
      "checkpoint",
      "timeline",
      "-s",
      "s1",
      "--json",
    ]);
    const submission = timeline.entries[0].actions.find(
      (action) => action.action === "restore-both",
    ).submission;
    state.onRestore = () => {
      expect(state.workspaceLockActive).toBe(true);
      expect(state.transactionActive).toBe(true);
      expect(state.conditional.map((event) => event.type)).toEqual([
        "checkpoint_timeline_action_intent",
      ]);
    };

    const executed = await invoke([
      "checkpoint",
      "action",
      "-s",
      "s1",
      "--submission",
      JSON.stringify(await previewConfirmation(submission)),
      "--confirm",
      "--json",
    ]);

    expect(executed.ok).toBe(true);
    expect(state.transactionActive).toBe(false);
    expect(state.conditional.map((event) => event.type)).toEqual([
      "checkpoint_timeline_action_intent",
      "checkpoint_timeline_commit",
      "checkpoint_timeline_action",
    ]);
  });

  it("records a failed audit and retains recovery authority after restore mutation throws", async () => {
    const timeline = await invoke([
      "checkpoint",
      "timeline",
      "-s",
      "s1",
      "--json",
    ]);
    const submission = timeline.entries[0].actions.find(
      (action) => action.action === "restore-both",
    ).submission;
    state.onRestore = () => {
      const error = new Error("injected restore failure");
      error.code = "INJECTED_RESTORE_FAILURE";
      error.safetyId = "safety-partial-1";
      error.safetyIdentity = `git:${"e".repeat(40)}`;
      error.safetyCoverage = "checkpoint";
      error.restorePhase = "workspace-mutation";
      throw error;
    };

    const rejected = await invoke([
      "checkpoint",
      "action",
      "-s",
      "s1",
      "--submission",
      JSON.stringify(await previewConfirmation(submission)),
      "--confirm",
      "--json",
    ]);

    expect(rejected).toMatchObject({
      ok: false,
      code: "WORKSPACE_TRANSACTION_RECOVERY_REQUIRED",
      operationFailureCode: "INJECTED_RESTORE_FAILURE",
      sagaPhase: "recovery_required",
      recoveryRequired: true,
      workspaceLockRetained: true,
    });
    expect(state.transactionActive).toBe(false);
    expect(state.conditional.map((event) => event.type)).toEqual([
      "checkpoint_timeline_action_intent",
      "checkpoint_timeline_action",
    ]);
    expect(state.audit.at(-1).data).toMatchObject({
      status: "failed",
      failureCode: "INJECTED_RESTORE_FAILURE",
      workspaceState: "unknown",
      safetyCheckpointId: "safety-partial-1",
      safetyCheckpointIdentity: `git:${"e".repeat(40)}`,
      safetyCoverage: "checkpoint",
    });
    expect(state.restores).toEqual([]);
    expect(state.retainedWorkspaceLocks).toHaveLength(1);
  });

  it("retains the safety snapshot when conversation commit fails after restore", async () => {
    const timeline = await invoke([
      "checkpoint",
      "timeline",
      "-s",
      "s1",
      "--json",
    ]);
    const submission = timeline.entries[0].actions.find(
      (action) => action.action === "restore-both",
    ).submission;
    state.failConversationAppend = true;

    const rejected = await invoke([
      "checkpoint",
      "action",
      "-s",
      "s1",
      "--submission",
      JSON.stringify(await previewConfirmation(submission)),
      "--confirm",
      "--json",
    ]);

    expect(rejected).toMatchObject({
      ok: false,
      code: "WORKSPACE_TRANSACTION_RECOVERY_REQUIRED",
      operationFailureCode: "INJECTED_CONVERSATION_APPEND_FAILURE",
      auditFailureCode: "SESSION_AUTHORITY_TRANSACTION_POISONED",
      restorePhase: "workspace-applied",
      safetyCheckpointId: "safety-1",
      safetyCheckpointIdentity: `git:${"d".repeat(40)}`,
      safetyPlanIdentity: `sha256:${"7".repeat(64)}`,
      safetyCoverage: "checkpoint",
      sagaPhase: "recovery_required",
      recoveryRequired: true,
      workspaceLockRetained: true,
    });
    expect(state.restores).toEqual(["cp-1"]);
    expect(state.conditional.map((event) => event.type)).toEqual([
      "checkpoint_timeline_action_intent",
    ]);
    expect(state.audit).toEqual([]);
  });

  it("retains restore evidence when the completed audit settlement is unknown", async () => {
    const timeline = await invoke([
      "checkpoint",
      "timeline",
      "-s",
      "s1",
      "--json",
    ]);
    const submission = timeline.entries[0].actions.find(
      (action) => action.action === "restore-both",
    ).submission;
    state.failCompletedAudit = true;

    const rejected = await invoke([
      "checkpoint",
      "action",
      "-s",
      "s1",
      "--submission",
      JSON.stringify(await previewConfirmation(submission)),
      "--confirm",
      "--json",
    ]);

    expect(rejected).toMatchObject({
      ok: false,
      code: "WORKSPACE_TRANSACTION_RECOVERY_REQUIRED",
      commitState: "unknown",
      operationFailureCode: "SESSION_INDEX_ANCHOR_FAILED",
      auditFailureCode: "SESSION_AUTHORITY_TRANSACTION_POISONED",
      restorePhase: "workspace-applied",
      safetyCheckpointId: "safety-1",
      safetyCheckpointIdentity: `git:${"d".repeat(40)}`,
      safetyCoverage: "checkpoint",
      sagaPhase: "recovery_required",
      recoveryRequired: true,
      workspaceLockRetained: true,
    });
    expect(state.conditional.map((event) => event.type)).toEqual([
      "checkpoint_timeline_action_intent",
      "checkpoint_timeline_commit",
      "checkpoint_timeline_action",
    ]);
    expect(state.audit).toEqual([]);
  });

  it("retains restore evidence when only final transaction settlement fails", async () => {
    const timeline = await invoke([
      "checkpoint",
      "timeline",
      "-s",
      "s1",
      "--json",
    ]);
    const submission = timeline.entries[0].actions.find(
      (action) => action.action === "restore-both",
    ).submission;
    state.failFinalSettlement = true;

    const rejected = await invoke([
      "checkpoint",
      "action",
      "-s",
      "s1",
      "--submission",
      JSON.stringify(await previewConfirmation(submission)),
      "--confirm",
      "--json",
    ]);

    expect(rejected).toMatchObject({
      ok: false,
      code: "WORKSPACE_TRANSACTION_RECOVERY_REQUIRED",
      commitState: "unknown",
      operationFailureCode: "SESSION_INDEX_ANCHOR_FAILED",
      auditFailureCode: null,
      restorePhase: "workspace-applied",
      safetyCheckpointId: "safety-1",
      safetyCheckpointIdentity: `git:${"d".repeat(40)}`,
      safetyCoverage: "checkpoint",
      sagaPhase: "recovery_required",
      recoveryRequired: true,
      workspaceLockRetained: true,
    });
    expect(state.restores).toEqual(["cp-1"]);
    expect(state.conditional.map((event) => event.type)).toEqual([
      "checkpoint_timeline_action_intent",
      "checkpoint_timeline_commit",
      "checkpoint_timeline_action",
    ]);
    expect(state.audit.at(-1).data.status).toBe("completed");
  });

  it("retains the created branch id when only final settlement fails", async () => {
    const timeline = await invoke([
      "checkpoint",
      "timeline",
      "-s",
      "s1",
      "--json",
    ]);
    const submission = timeline.entries[0].actions.find(
      (action) => action.action === "branch",
    ).submission;
    state.failFinalSettlement = true;

    const rejected = await invoke([
      "checkpoint",
      "action",
      "-s",
      "s1",
      "--submission",
      JSON.stringify(await previewConfirmation(submission)),
      "--confirm",
      "--json",
    ]);

    expect(state.branches).toHaveLength(1);
    expect(rejected).toMatchObject({
      ok: false,
      code: "SESSION_INDEX_ANCHOR_FAILED",
      commitState: "unknown",
      operationFailureCode: null,
      branchSessionId: state.branches[0].branchSessionId,
    });
    expect(state.audit.at(-1).data).toMatchObject({
      status: "completed",
      branchSessionId: state.branches[0].branchSessionId,
    });
  });

  it("reports unknown settlement while retaining the failed restore diagnosis", async () => {
    const timeline = await invoke([
      "checkpoint",
      "timeline",
      "-s",
      "s1",
      "--json",
    ]);
    const submission = timeline.entries[0].actions.find(
      (action) => action.action === "restore-both",
    ).submission;
    state.onRestore = () => {
      const error = new Error("injected restore failure");
      error.code = "INJECTED_RESTORE_FAILURE";
      error.safetyId = "safety-unknown-1";
      error.safetyIdentity = `git:${"f".repeat(40)}`;
      error.safetyCoverage = "checkpoint";
      error.restorePhase = "workspace-mutation";
      throw error;
    };
    state.failFailedAudit = true;

    const rejected = await invoke([
      "checkpoint",
      "action",
      "-s",
      "s1",
      "--submission",
      JSON.stringify(await previewConfirmation(submission)),
      "--confirm",
      "--json",
    ]);

    expect(rejected).toMatchObject({
      ok: false,
      code: "WORKSPACE_TRANSACTION_RECOVERY_REQUIRED",
      commitState: "unknown",
      operationFailureCode: "INJECTED_RESTORE_FAILURE",
      auditFailureCode: "SESSION_INDEX_ANCHOR_FAILED",
      restorePhase: "workspace-mutation",
      safetyCheckpointId: "safety-unknown-1",
      safetyCheckpointIdentity: `git:${"f".repeat(40)}`,
      safetyCoverage: "checkpoint",
      sagaPhase: "recovery_required",
      recoveryRequired: true,
      workspaceLockRetained: true,
    });
    expect(state.conditional.map((event) => event.type)).toEqual([
      "checkpoint_timeline_action_intent",
      "checkpoint_timeline_action",
    ]);
    expect(state.audit).toEqual([]);
  });

  it("rejects a submission when its immutable checkpoint target changes", async () => {
    const timeline = await invoke([
      "checkpoint",
      "timeline",
      "-s",
      "s1",
      "--json",
    ]);
    const submission = timeline.entries[0].actions.find(
      (action) => action.action === "restore-code",
    ).submission;
    const confirmation = await previewConfirmation(submission);
    state.checkpoints[0].commit = "b".repeat(40);

    const rejected = await invoke([
      "checkpoint",
      "action",
      "-s",
      "s1",
      "--submission",
      JSON.stringify(confirmation),
      "--confirm",
      "--json",
    ]);

    expect(rejected).toMatchObject({ ok: false, code: "TIMELINE_STALE" });
    expect(state.statusIdentities).toHaveLength(1);
    expect(state.restores).toEqual([]);
  });

  it("passes the copy fallback manifest identity through preview and restore", async () => {
    state.gitAvailable = false;
    const expectedIdentity = `sha256:${"c".repeat(64)}`;
    const timeline = await invoke([
      "checkpoint",
      "timeline",
      "-s",
      "s1",
      "--json",
    ]);
    const submission = timeline.entries[0].actions.find(
      (action) => action.action === "restore-both",
    ).submission;
    expect(submission.checkpointIdentity).toBe(expectedIdentity);
    const confirmation = await previewConfirmation(submission);

    const executed = await invoke([
      "checkpoint",
      "action",
      "-s",
      "s1",
      "--submission",
      JSON.stringify(confirmation),
      "--confirm",
      "--json",
    ]);

    expect(executed.ok).toBe(true);
    expect(state.statusIdentities).toEqual([
      { engine: "copy", identity: expectedIdentity },
      { engine: "copy", identity: expectedIdentity },
      { engine: "copy", identity: expectedIdentity },
    ]);
    expect(state.restoreIdentities).toEqual([
      { engine: "copy", identity: expectedIdentity },
    ]);
  });

  it("rejects an old submission after the authoritative head advances", async () => {
    const timeline = await invoke([
      "checkpoint",
      "timeline",
      "-s",
      "s1",
      "--json",
    ]);
    const submission = timeline.entries[0].actions[0].submission;
    state.headHash = "advanced-head";

    const rejected = await invoke([
      "checkpoint",
      "action",
      "-s",
      "s1",
      "--submission",
      JSON.stringify(submission),
      "--preview",
      "--json",
    ]);
    expect(rejected).toMatchObject({ ok: false, code: "TIMELINE_STALE" });
    expect(state.conditional).toEqual([]);
    expect(state.restores).toEqual([]);
    process.exitCode = undefined;
  });
});

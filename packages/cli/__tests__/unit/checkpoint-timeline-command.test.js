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
  statusIdentities: [],
  restoreIdentities: [],
  failFailedAudit: false,
  failConversationAppend: false,
  failCompletedAudit: false,
  failFinalSettlement: false,
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
  findLatestEvent: () => ({ hash: state.headHash }),
  readVerifiedMessages: () => state.messages.map((message) => ({ ...message })),
  withSessionAuthorityTransaction: (_sessionId, expected, task) => {
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
    return { modified: ["src/a.js"], added: [], deleted: [] };
  },
  rewindTo: (_dir, checkpointId, options) => {
    state.onRestore?.();
    state.restores.push(checkpointId);
    state.restoreIdentities.push({
      engine: "git",
      identity: options?.expectedIdentity || null,
    });
    return {
      modified: 1,
      recreated: 0,
      deleted: 0,
      safetyId: "safety-1",
      safetyIdentity: `git:${"d".repeat(40)}`,
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
    return { modified: ["src/a.js"], unchanged: [], deleted: [] };
  },
  restoreCheckpoint: (checkpointId, options) => {
    state.onRestore?.();
    state.restores.push(checkpointId);
    state.restoreIdentities.push({
      engine: "copy",
      identity: options?.expectedIdentity || null,
    });
    return {
      restored: ["src/a.js"],
      unchanged: [],
      missingBlob: [],
      safetyId: "safety-copy-1",
      safetyIdentity: `sha256:${"e".repeat(64)}`,
      safetyCoverage: "full",
      createdPaths: [],
    };
  },
}));

const { registerCheckpointCommand } =
  await import("../../src/commands/checkpoint.js");

async function invoke(args) {
  const program = new Command();
  registerCheckpointCommand(program);
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await program.parseAsync(args, { from: "user" });
    return JSON.parse(output.mock.calls.at(-1)[0]);
  } finally {
    output.mockRestore();
  }
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
    state.statusIdentities = [];
    state.restoreIdentities = [];
    state.failFailedAudit = false;
    state.failConversationAppend = false;
    state.failCompletedAudit = false;
    state.failFinalSettlement = false;
    process.exitCode = undefined;
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

    const executed = await invoke([
      "checkpoint",
      "action",
      "-s",
      "s1",
      "--submission",
      encoded,
      "--confirm",
      "--json",
    ]);
    expect(executed).toMatchObject({
      ok: true,
      mode: "executed",
      action: "restore-both",
      result: {
        code: { safetyId: "safety-1" },
        conversation: { messages: 1 },
      },
    });
    expect(state.restores).toEqual(["cp-1"]);
    expect(state.statusIdentities).toEqual([
      { engine: "git", identity: `git:${"a".repeat(40)}` },
      { engine: "git", identity: `git:${"a".repeat(40)}` },
    ]);
    expect(state.restoreIdentities).toEqual([
      { engine: "git", identity: `git:${"a".repeat(40)}` },
    ]);
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
      JSON.stringify(submission),
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

  it("records a terminal failed audit without committing conversation after restore throws", async () => {
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
      JSON.stringify(submission),
      "--confirm",
      "--json",
    ]);

    expect(rejected).toMatchObject({
      ok: false,
      code: "INJECTED_RESTORE_FAILURE",
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
      JSON.stringify(submission),
      "--confirm",
      "--json",
    ]);

    expect(rejected).toMatchObject({
      ok: false,
      code: "INJECTED_CONVERSATION_APPEND_FAILURE",
      auditFailureCode: "SESSION_AUTHORITY_TRANSACTION_POISONED",
      restorePhase: "workspace-applied",
      safetyCheckpointId: "safety-1",
      safetyCheckpointIdentity: `git:${"d".repeat(40)}`,
      safetyCoverage: "checkpoint",
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
      JSON.stringify(submission),
      "--confirm",
      "--json",
    ]);

    expect(rejected).toMatchObject({
      ok: false,
      code: "SESSION_INDEX_ANCHOR_FAILED",
      commitState: "unknown",
      operationFailureCode: "SESSION_INDEX_ANCHOR_FAILED",
      auditFailureCode: "SESSION_AUTHORITY_TRANSACTION_POISONED",
      restorePhase: "workspace-applied",
      safetyCheckpointId: "safety-1",
      safetyCheckpointIdentity: `git:${"d".repeat(40)}`,
      safetyCoverage: "checkpoint",
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
      JSON.stringify(submission),
      "--confirm",
      "--json",
    ]);

    expect(rejected).toMatchObject({
      ok: false,
      code: "SESSION_INDEX_ANCHOR_FAILED",
      commitState: "unknown",
      operationFailureCode: null,
      auditFailureCode: null,
      restorePhase: "workspace-applied",
      safetyCheckpointId: "safety-1",
      safetyCheckpointIdentity: `git:${"d".repeat(40)}`,
      safetyCoverage: "checkpoint",
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
      JSON.stringify(submission),
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
      JSON.stringify(submission),
      "--confirm",
      "--json",
    ]);

    expect(rejected).toMatchObject({
      ok: false,
      code: "SESSION_INDEX_ANCHOR_FAILED",
      commitState: "unknown",
      operationFailureCode: "INJECTED_RESTORE_FAILURE",
      auditFailureCode: "SESSION_INDEX_ANCHOR_FAILED",
      restorePhase: "workspace-mutation",
      safetyCheckpointId: "safety-unknown-1",
      safetyCheckpointIdentity: `git:${"f".repeat(40)}`,
      safetyCoverage: "checkpoint",
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
    state.checkpoints[0].commit = "b".repeat(40);

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

    expect(rejected).toMatchObject({ ok: false, code: "TIMELINE_STALE" });
    expect(state.statusIdentities).toEqual([]);
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

    const executed = await invoke([
      "checkpoint",
      "action",
      "-s",
      "s1",
      "--submission",
      JSON.stringify(submission),
      "--confirm",
      "--json",
    ]);

    expect(executed.ok).toBe(true);
    expect(state.statusIdentities).toEqual([
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

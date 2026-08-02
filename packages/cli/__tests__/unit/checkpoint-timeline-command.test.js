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
  appendAuthorityEventIfHead: (_sessionId, type, data, expected) => {
    if (expected !== state.headHash) {
      const error = new Error("stale");
      error.code = "SESSION_REVISION_STALE";
      throw error;
    }
    state.conditional.push({ type, data, expected });
    state.headHash = `${type}-${state.conditional.length}`;
    return { hash: state.headHash };
  },
  appendEvent: (_sessionId, type, data) => {
    state.audit.push({ type, data });
    state.headHash = `${type}-audit`;
    return { hash: state.headHash };
  },
  createBranchSession: vi.fn(),
}));

vi.mock("../../src/lib/checkpoint-store.js", () => ({
  isCheckpointAvailable: () => true,
  listCheckpoints: () =>
    state.checkpoints.map((checkpoint) => ({ ...checkpoint })),
  statusAgainst: () => ({ modified: ["src/a.js"], added: [], deleted: [] }),
  rewindTo: (_dir, checkpointId) => {
    state.restores.push(checkpointId);
    return {
      modified: 1,
      recreated: 0,
      deleted: 0,
      safetyId: "safety-1",
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
    expect(state.conditional.map((event) => event.type)).toEqual([
      "checkpoint_timeline_action_intent",
      "checkpoint_timeline_commit",
    ]);
    expect(state.audit).toEqual([
      expect.objectContaining({ type: "checkpoint_timeline_action" }),
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

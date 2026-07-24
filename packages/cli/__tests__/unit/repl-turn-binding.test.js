/**
 * REPL turn-binding PRODUCER (repl-turn-binding.js) — the interactive mirror of
 * the headless runner's feed: rehydrate the persisted table on the first turn,
 * supersede stale records from a discarded live timeline, persist dirty-gated
 * at each settle, and never let any of it disturb the turn. Hermetic via _deps.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createReplTurnBindingProducer,
  _deps,
} from "../../src/repl/repl-turn-binding.js";
import { TurnBindingLog, TURN_COVERAGE } from "../../src/lib/turn-binding.js";

const originalDeps = { ..._deps };
let snapshots;

beforeEach(() => {
  snapshots = [];
  _deps.loadTurnBindingLog = () => new TurnBindingLog();
  _deps.persistTurnBinding = (sessionId, log) => {
    snapshots.push({ sessionId, data: log.toJSON() });
    return true;
  };
  _deps.now = () => 1_000;
});

afterEach(() => {
  Object.assign(_deps, originalDeps);
});

const toolEvents = [
  { type: "checkpoint", id: "cp-1", tool: "write_file" },
  { type: "tool-executing", tool: "write_file", args: { path: "a.txt" } },
  { type: "tool-result", tool: "write_file", result: { ok: true } },
  { type: "tool-executing", tool: "run_shell", args: { command: "ls" } },
  {
    type: "tool-result",
    tool: "run_shell",
    result: { error: "denied", policy: { decision: "deny", via: "settings" } },
  },
];

describe("createReplTurnBindingProducer", () => {
  it("returns null without a sessionId (nothing to persist into)", () => {
    expect(createReplTurnBindingProducer({})).toBeNull();
    expect(createReplTurnBindingProducer()).toBeNull();
  });

  it("feeds one interactive turn and persists it at settle (honest coverage)", () => {
    const p = createReplTurnBindingProducer({
      sessionId: "sess-R",
      failClosed: false,
    });
    p.beginTurn(2); // messages.length just after the user push
    for (const e of toolEvents) p.handleEvent(e);
    expect(p.persistIfDirty()).toBe(true);

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].sessionId).toBe("sess-R");
    const log = TurnBindingLog.fromJSON(snapshots[0].data);
    const turn = log.list()[0];
    expect(turn.conversationOffset).toBe(2);
    expect(turn.fileCheckpointId).toBe("cp-1");
    expect(turn.toolCallIds).toHaveLength(2);
    expect(turn.permissionDecisionIds[0]).toMatch(/:perm:settings$/);
    expect(turn.coverage).toBe(TURN_COVERAGE.PARTIAL); // shell ran

    // settle again with nothing new → no second snapshot (dirty-gated)
    expect(p.persistIfDirty()).toBe(false);
    expect(snapshots).toHaveLength(1);
  });

  it("a tool-free Q&A turn persists explicit full coverage", () => {
    const p = createReplTurnBindingProducer({ sessionId: "sess-R" });
    p.beginTurn(2);
    expect(p.persistIfDirty()).toBe(true);
    expect(snapshots).toHaveLength(1);
    const turn = TurnBindingLog.fromJSON(snapshots[0].data).list()[0];
    expect(turn.coverage).toBe(TURN_COVERAGE.FULL);
    expect(turn.toolCallIds).toEqual([]);
  });

  it("reports persistence degradation without clearing the dirty snapshot", () => {
    const errors = [];
    _deps.persistTurnBinding = () => false;
    const p = createReplTurnBindingProducer({
      sessionId: "sess-R",
      failClosed: false,
      onError: (error, phase) => errors.push([phase, error.message]),
    });
    p.beginTurn(2);

    expect(p.persistIfDirty()).toBe(false);
    expect(errors).toEqual([
      ["persist", "turn-binding snapshot was not persisted"],
    ]);
    expect(p.lastError()).toBeInstanceOf(Error);

    _deps.persistTurnBinding = originalDeps.persistTurnBinding;
  });

  it("rehydrates the persisted table on first turn and APPENDS to it", () => {
    const prior = new TurnBindingLog();
    prior.startTurn("old:t0", { conversationOffset: 1 });
    prior.recordToolCall("old:t0", "old:c0", { name: "write_file" });
    _deps.loadTurnBindingLog = (id) =>
      id === "sess-R" ? TurnBindingLog.fromJSON(prior.toJSON()) : null;

    const p = createReplTurnBindingProducer({
      sessionId: "sess-R",
      failClosed: false,
    });
    p.beginTurn(4);
    p.handleEvent(toolEvents[1]);
    p.handleEvent(toolEvents[2]);
    p.persistIfDirty();

    const turns = TurnBindingLog.fromJSON(snapshots[0].data).list();
    expect(turns).toHaveLength(2);
    expect(turns[0].turnId).toBe("old:t0");
    expect(turns[0].toolCallIds).toEqual(["old:c0"]);
    expect(turns[1].conversationOffset).toBe(4);
  });

  it("supersedes stale records when re-anchoring after a live rewind/clear", () => {
    // A prior timeline reached offset 6; the live REPL rewound and the next
    // turn re-anchors at offset 4 — the stale offset-4/6 records would shadow
    // the new turn under exact-offset matching, so they must be pruned.
    const prior = new TurnBindingLog();
    prior.startTurn("old:t0", { conversationOffset: 2 });
    prior.startTurn("old:t1", { conversationOffset: 4 });
    prior.startTurn("old:t2", { conversationOffset: 6 });
    _deps.loadTurnBindingLog = () => prior;

    const p = createReplTurnBindingProducer({ sessionId: "sess-R" });
    p.beginTurn(4);
    p.persistIfDirty(); // the prune itself is a persisted change

    const turns = TurnBindingLog.fromJSON(snapshots[0].data).list();
    expect(turns.map((t) => t.turnId)).toEqual(["old:t0", expect.any(String)]);
    expect(turns[1].conversationOffset).toBe(4);
  });

  it("a failed persist keeps the table dirty for the next settle", () => {
    let fail = true;
    _deps.persistTurnBinding = (sessionId, log) => {
      if (fail) return false;
      snapshots.push({ sessionId, data: log.toJSON() });
      return true;
    };
    const p = createReplTurnBindingProducer({
      sessionId: "sess-R",
      failClosed: false,
    });
    p.beginTurn(2);
    p.handleEvent(toolEvents[1]);
    expect(p.persistIfDirty()).toBe(false);
    fail = false;
    expect(p.persistIfDirty()).toBe(true); // still dirty → retried and flushed
    expect(snapshots).toHaveLength(1);
  });

  it("supports explicit advisory mode for diagnostics", () => {
    _deps.loadTurnBindingLog = () => {
      throw new Error("boom");
    };
    const p = createReplTurnBindingProducer({
      sessionId: "sess-R",
      failClosed: false,
    });
    expect(p.beginTurn(2)).toBeNull();
    expect(p.handleEvent(toolEvents[0])).toBe(false);
    expect(p.persistIfDirty()).toBe(false);
  });

  it("fails closed by default when critical binding storage is unavailable", () => {
    _deps.persistTurnBinding = () => {
      throw new Error("binding lock unavailable");
    };
    const p = createReplTurnBindingProducer({ sessionId: "sess-R" });
    p.beginTurn(2);
    expect(() => p.persistIfDirty()).toThrow("binding lock unavailable");
    expect(p.lastError()).toBeInstanceOf(Error);
  });
});

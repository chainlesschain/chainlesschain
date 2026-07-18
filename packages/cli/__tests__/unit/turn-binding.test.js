/**
 * Turn binding table (P1 "显式绑定 Turn、Checkpoint 和恢复") — explicit
 * turn→checkpoint records, honest coverage, and restore planning. Pure module.
 */
import { describe, it, expect } from "vitest";
import {
  TURN_COVERAGE,
  RESTORE_SCOPE,
  classifyToolKind,
  computeCoverage,
  TurnBindingLog,
  resolveRestorePlan,
  selectTurnRange,
  buildTurnBindingFromMarks,
  createTurnBindingFeed,
} from "../../src/lib/turn-binding.js";

describe("classifyToolKind", () => {
  it("flags shell/exec/run_code/spawn as irreversible 'shell'", () => {
    expect(classifyToolKind("run_shell")).toBe("shell");
    expect(classifyToolKind("run_code")).toBe("shell");
    expect(classifyToolKind("spawn_sub_agent")).toBe("shell");
    expect(classifyToolKind("exec")).toBe("shell");
  });
  it("flags file mutators as 'edit'", () => {
    expect(classifyToolKind("write_file")).toBe("edit");
    expect(classifyToolKind("edit_file")).toBe("edit");
    expect(classifyToolKind("apply_patch")).toBe("edit");
  });
  it("treats reads as 'other'", () => {
    expect(classifyToolKind("read_file")).toBe("other");
    expect(classifyToolKind("search_files")).toBe("other");
  });
});

describe("computeCoverage", () => {
  it("side-effects → PARTIAL (can never promise full)", () => {
    expect(
      computeCoverage({
        ranShell: true,
        mutatedFiles: true,
        hasFileCheckpoint: true,
      }),
    ).toBe(TURN_COVERAGE.PARTIAL);
    expect(computeCoverage({ userEditedDuringTurn: true })).toBe(
      TURN_COVERAGE.PARTIAL,
    );
    expect(computeCoverage({ spawnedExternalProcess: true })).toBe(
      TURN_COVERAGE.PARTIAL,
    );
  });
  it("no file mutation → FULL (nothing external to undo)", () => {
    expect(computeCoverage({})).toBe(TURN_COVERAGE.FULL);
  });
  it("mutation WITH checkpoint → FULL; WITHOUT → NONE", () => {
    expect(
      computeCoverage({ mutatedFiles: true, hasFileCheckpoint: true }),
    ).toBe(TURN_COVERAGE.FULL);
    expect(
      computeCoverage({ mutatedFiles: true, hasFileCheckpoint: false }),
    ).toBe(TURN_COVERAGE.NONE);
  });
});

describe("TurnBindingLog", () => {
  it("builds an explicit record with all bound ids", () => {
    const log = new TurnBindingLog();
    log
      .startTurn("t1", { conversationOffset: 3 })
      .recordToolCall("t1", "call-a", { name: "edit_file" })
      .recordPermissionDecision("t1", "ra-1")
      .recordChildAgent("t1", "sub-abc")
      .setWorktree("t1", "agent/t1")
      .bindCheckpoint("t1", "cp0002");
    expect(log.get("t1")).toEqual({
      turnId: "t1",
      conversationOffset: 3,
      fileCheckpointId: "cp0002",
      toolCallIds: ["call-a"],
      permissionDecisionIds: ["ra-1"],
      childAgentIds: ["sub-abc"],
      worktreeId: "agent/t1",
      coverage: TURN_COVERAGE.FULL, // edit + checkpoint
    });
  });

  it("a shell tool call downgrades coverage to PARTIAL", () => {
    const log = new TurnBindingLog();
    log
      .startTurn("t1", { conversationOffset: 0 })
      .recordToolCall("t1", "c1", { name: "run_shell" })
      .bindCheckpoint("t1", "cp0001");
    expect(log.get("t1").coverage).toBe(TURN_COVERAGE.PARTIAL);
  });

  it("bindCheckpoint keeps the EARLIEST (pre-mutation) checkpoint", () => {
    const log = new TurnBindingLog();
    log
      .startTurn("t1")
      .bindCheckpoint("t1", "cp0001")
      .bindCheckpoint("t1", "cp0002");
    expect(log.get("t1").fileCheckpointId).toBe("cp0001");
  });

  it("dedupes ids and preserves insertion order in list()", () => {
    const log = new TurnBindingLog();
    log.startTurn("t1").recordToolCall("t1", "x").recordToolCall("t1", "x");
    log.startTurn("t2");
    expect(log.get("t1").toolCallIds).toEqual(["x"]);
    expect(log.list().map((t) => t.turnId)).toEqual(["t1", "t2"]);
  });

  it("survives a toJSON → fromJSON round-trip (coverage recomputed)", () => {
    const log = new TurnBindingLog();
    log
      .startTurn("t1", { conversationOffset: 5 })
      .recordToolCall("t1", "c", { name: "run_code" })
      .bindCheckpoint("t1", "cp0009");
    const restored = TurnBindingLog.fromJSON(
      JSON.parse(JSON.stringify(log.toJSON())),
    );
    expect(restored.get("t1")).toEqual(log.get("t1"));
    expect(restored.get("t1").coverage).toBe(TURN_COVERAGE.PARTIAL);
  });
});

describe("resolveRestorePlan", () => {
  const fullTurn = {
    turnId: "t1",
    conversationOffset: 4,
    fileCheckpointId: "cp0003",
    coverage: TURN_COVERAGE.FULL,
  };

  it("BOTH restores conversation + files with no warnings on a full turn", () => {
    const plan = resolveRestorePlan(fullTurn, RESTORE_SCOPE.BOTH);
    expect(plan.conversation).toEqual({ truncateTo: 4 });
    expect(plan.files).toEqual({ rewindTo: "cp0003" });
    expect(plan.warnings).toEqual([]);
  });

  it("CONVERSATION-only warns that files stay ahead", () => {
    const plan = resolveRestorePlan(fullTurn, RESTORE_SCOPE.CONVERSATION);
    expect(plan.files).toBeNull();
    expect(plan.warnings.join(" ")).toMatch(/files will NOT be reverted/);
  });

  it("FILES-only surfaces the partial-coverage caveat", () => {
    const partialTurn = { ...fullTurn, coverage: TURN_COVERAGE.PARTIAL };
    const plan = resolveRestorePlan(partialTurn, RESTORE_SCOPE.FILES);
    expect(plan.files).toEqual({ rewindTo: "cp0003" });
    expect(plan.warnings.join(" ")).toMatch(/best-effort/);
    expect(plan.warnings.join(" ")).toMatch(/conversation is NOT rewound/);
  });

  it("warns (does not crash) when there is no checkpoint to restore files", () => {
    const plan = resolveRestorePlan(
      {
        turnId: "t",
        conversationOffset: 2,
        fileCheckpointId: null,
        coverage: TURN_COVERAGE.NONE,
      },
      RESTORE_SCOPE.BOTH,
    );
    expect(plan.files).toBeNull();
    expect(plan.warnings.join(" ")).toMatch(/files cannot be restored/);
  });

  it("handles an unknown turn safely", () => {
    const plan = resolveRestorePlan(null);
    expect(plan.coverage).toBe(TURN_COVERAGE.NONE);
    expect(plan.warnings.join(" ")).toMatch(/nothing to restore/);
  });
});

describe("selectTurnRange (summarize from/up to here)", () => {
  const log = new TurnBindingLog();
  log.startTurn("t1", { conversationOffset: 0 });
  log.startTurn("t2", { conversationOffset: 4 });
  log.startTurn("t3", { conversationOffset: 9 });

  it("selects an inclusive range with bounding offsets", () => {
    const r = selectTurnRange(log, { fromTurnId: "t1", toTurnId: "t2" });
    expect(r.turns.map((t) => t.turnId)).toEqual(["t1", "t2"]);
    expect(r.fromOffset).toBe(0);
    expect(r.toOffset).toBe(4);
  });
  it("null bounds mean start / end", () => {
    const r = selectTurnRange(log, {});
    expect(r.turns.map((t) => t.turnId)).toEqual(["t1", "t2", "t3"]);
    expect(r.toOffset).toBe(9);
  });
  it("normalizes a reversed range", () => {
    const r = selectTurnRange(log, { fromTurnId: "t3", toTurnId: "t1" });
    expect(r.turns.map((t) => t.turnId)).toEqual(["t1", "t2", "t3"]);
  });
});

describe("buildTurnBindingFromMarks (bridge from repl-rewind state)", () => {
  // listUserTurns output (newest-first) + ephemeral checkpoint marks.
  const turns = [
    { n: 1, index: 8 }, // newest turn, user msg at index 8
    { n: 2, index: 2 }, // earlier turn at index 2
  ];
  // marks: atMessageCount strictly > owning turn's index.
  const marks = [
    { atMessageCount: 4, id: "cp0001", tool: "write_file" }, // during turn@2
    { atMessageCount: 6, id: "cp0002", tool: "run_shell" }, // during turn@2
    { atMessageCount: 10, id: "cp0003", tool: "edit_file" }, // during turn@8
  ];

  it("attributes each mark to its owning turn and binds the earliest checkpoint", () => {
    const log = buildTurnBindingFromMarks(turns, marks);
    const t2 = log.get("turn-2");
    expect(t2.conversationOffset).toBe(2);
    expect(t2.fileCheckpointId).toBe("cp0001"); // earliest in the turn
    expect(t2.toolCallIds).toEqual(["cp0001", "cp0002"]);
    // a run_shell mark in the turn → PARTIAL coverage
    expect(t2.coverage).toBe(TURN_COVERAGE.PARTIAL);

    const t8 = log.get("turn-8");
    expect(t8.fileCheckpointId).toBe("cp0003");
    expect(t8.coverage).toBe(TURN_COVERAGE.FULL); // edit + checkpoint, no side-effects
  });

  it("ignores marks with no owning turn (before the first user turn)", () => {
    const log = buildTurnBindingFromMarks(
      [{ n: 1, index: 5 }],
      [
        { atMessageCount: 3, id: "cpX", tool: "write_file" }, // before index 5 → orphan
      ],
    );
    expect(log.get("turn-5").fileCheckpointId).toBeNull();
  });
});

describe("TurnBindingLog.pruneFromOffset (timeline supersede)", () => {
  it("removes records anchored at/after the offset, keeps earlier ones", () => {
    const log = new TurnBindingLog();
    log.startTurn("a:t0", { conversationOffset: 2 });
    log.startTurn("a:t1", { conversationOffset: 4 });
    log.startTurn("a:t2", { conversationOffset: 6 });
    expect(log.pruneFromOffset(4)).toBe(2);
    expect(log.list().map((t) => t.turnId)).toEqual(["a:t0"]);
    expect(log.get("a:t1")).toBeNull();
  });

  it("keeps offset-less records and is a no-op for a non-finite offset", () => {
    const log = new TurnBindingLog();
    log.startTurn("a:t0"); // no offset recorded
    log.startTurn("a:t1", { conversationOffset: 3 });
    expect(log.pruneFromOffset(NaN)).toBe(0);
    expect(log.pruneFromOffset(10)).toBe(0);
    expect(log.list()).toHaveLength(2);
  });
});

describe("createTurnBindingFeed (shared producer core)", () => {
  const events = [
    { type: "checkpoint", id: "cp-1", tool: "write_file" },
    { type: "tool-executing", tool: "write_file", args: { path: "a.txt" } },
    { type: "tool-result", tool: "write_file", result: { ok: true } },
    { type: "tool-executing", tool: "run_shell", args: { command: "ls" } },
    {
      type: "tool-result",
      tool: "run_shell",
      result: {
        error: "denied",
        policy: { decision: "deny", via: "settings" },
      },
    },
    { type: "background-sub-agent-result", subAgentId: "sub-9" },
  ];

  it("synthesizes <nonce>:t/c ids and folds every event kind into the turn", () => {
    const feed = createTurnBindingFeed({ nonce: "N" });
    expect(feed.beginTurn(3)).toBe("N:t0");
    for (const e of events) feed.handleEvent(e);
    const turn = feed.log.get("N:t0");
    expect(turn.conversationOffset).toBe(3);
    expect(turn.fileCheckpointId).toBe("cp-1");
    expect(turn.toolCallIds).toEqual(["N:c0", "N:c1"]);
    // the decision id hangs off the run_shell call (2nd synthesized id)
    expect(turn.permissionDecisionIds).toEqual(["N:c1:perm:settings"]);
    expect(turn.childAgentIds).toEqual(["sub-9"]);
    expect(turn.coverage).toBe(TURN_COVERAGE.PARTIAL); // shell ran → honest
    expect(feed.isDirty()).toBe(true);
  });

  it("beginTurn alone stays clean (dirty-gated) and events before it are ignored", () => {
    const feed = createTurnBindingFeed({ nonce: "N" });
    expect(feed.handleEvent(events[0])).toBe(false); // no current turn yet
    feed.beginTurn(1);
    expect(feed.isDirty()).toBe(false);
    expect(feed.log.list()).toHaveLength(1);
  });

  it("supersede prunes stale same-timeline records and marks dirty", () => {
    const prior = new TurnBindingLog();
    prior.startTurn("old:t0", { conversationOffset: 2 });
    prior.startTurn("old:t1", { conversationOffset: 5 }); // discarded timeline
    const feed = createTurnBindingFeed({ log: prior, nonce: "N" });
    feed.beginTurn(5, { supersede: true }); // re-anchors where old:t1 sat
    expect(feed.isDirty()).toBe(true); // the prune must be persisted
    expect(feed.log.list().map((t) => t.turnId)).toEqual(["old:t0", "N:t0"]);
  });

  it("without supersede (headless append-only) nothing is pruned", () => {
    const prior = new TurnBindingLog();
    prior.startTurn("old:t0", { conversationOffset: 5 });
    const feed = createTurnBindingFeed({ log: prior, nonce: "N" });
    feed.beginTurn(5);
    expect(feed.log.list()).toHaveLength(2);
    expect(feed.isDirty()).toBe(false);
  });

  it("stamps a worktreeId onto the turn record without dirtying by itself", () => {
    const feed = createTurnBindingFeed({ nonce: "N" });
    feed.beginTurn(1, { worktreeId: "agent/task-1" });
    expect(feed.log.get("N:t0").worktreeId).toBe("agent/task-1");
    expect(feed.isDirty()).toBe(false); // tool-free worktree turn writes nothing
    feed.handleEvent(events[1]);
    expect(feed.isDirty()).toBe(true); // real signal → the stamp persists along
  });

  it("clearDirty resets after a persist; new events re-dirty", () => {
    const feed = createTurnBindingFeed({ nonce: "N" });
    feed.beginTurn(1);
    feed.handleEvent(events[1]);
    feed.clearDirty();
    expect(feed.isDirty()).toBe(false);
    feed.handleEvent(events[3]);
    expect(feed.isDirty()).toBe(true);
  });
});

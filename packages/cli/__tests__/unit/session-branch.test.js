/**
 * Session branch planning (P0-3 "从这里分支" — the fourth restore action from
 * CLAUDE_CODE_IDE_INCREMENTAL_GAP_ANALYSIS_2026-07-13.md). Pure module: no RNG,
 * clock, fs or git — deterministic plans + lineage integrity checks.
 */
import { describe, it, expect } from "vitest";
import { TURN_COVERAGE, TurnBindingLog } from "../../src/lib/turn-binding.js";
import {
  deriveBranchId,
  deriveBranchSessionId,
  planSessionBranch,
  validateBranchLineage,
} from "../../src/lib/session-branch.js";

/** A FULL-coverage turn: mutated files WITH a checkpoint, no side-effects. */
function fullTurn() {
  const log = new TurnBindingLog();
  log.startTurn("turn-3", { conversationOffset: 3 });
  log.recordToolCall("turn-3", "tc-1", { name: "write_file" });
  log.bindCheckpoint("turn-3", "cp-abc");
  return log.get("turn-3");
}

describe("deriveBranchId", () => {
  it("is deterministic — same inputs hash to the same id", () => {
    expect(deriveBranchId("s1", "turn-3", 0)).toBe(
      deriveBranchId("s1", "turn-3", 0),
    );
  });
  it("disambiguates two branches off the SAME turn via seq", () => {
    expect(deriveBranchId("s1", "turn-3", 0)).not.toBe(
      deriveBranchId("s1", "turn-3", 1),
    );
  });
  it("differs by parent session and by turn", () => {
    expect(deriveBranchId("s1", "turn-3", 0)).not.toBe(
      deriveBranchId("s2", "turn-3", 0),
    );
    expect(deriveBranchId("s1", "turn-3", 0)).not.toBe(
      deriveBranchId("s1", "turn-4", 0),
    );
  });
});

describe("deriveBranchSessionId", () => {
  it("derives a traversal-safe id (no path separators survive)", () => {
    const id = deriveBranchSessionId("../evil/id", "ab/cd");
    expect(id).not.toContain("/");
    expect(id).not.toContain("\\");
    expect(id).toMatch(/^[A-Za-z0-9._~-]+$/);
  });
  it("embeds the parent and branch id", () => {
    expect(deriveBranchSessionId("s1", "deadbeef")).toBe("s1-b-deadbeef");
  });
});

describe("planSessionBranch", () => {
  it("targets a NEW session, preserves the parent, never inherits grants", () => {
    const plan = planSessionBranch({
      parentSessionId: "s1",
      turn: fullTurn(),
    });
    expect(plan.branchSessionId).not.toBe("s1");
    expect(plan.branchSessionId).toContain("s1-b-");
    expect(plan.preservesParent).toBe(true);
    expect(plan.inheritSessionGrants).toBe(false);
    expect(plan.parentTurnId).toBe("turn-3");
    expect(plan.parentSessionId).toBe("s1");
  });

  it("keeps history up to the branch-point turn (truncate offset)", () => {
    const plan = planSessionBranch({ parentSessionId: "s1", turn: fullTurn() });
    expect(plan.conversationTruncateTo).toBe(3);
    expect(plan.fileCheckpointId).toBe("cp-abc");
    expect(plan.coverage).toBe(TURN_COVERAGE.FULL);
  });

  it("emits no warnings for a clean, read-only FULL branch point", () => {
    // FULL coverage AND no file mutation → nothing irreversible, no collision.
    const log = new TurnBindingLog();
    log.startTurn("turn-0", { conversationOffset: 0 });
    log.recordToolCall("turn-0", "r", { name: "read_file" });
    const plan = planSessionBranch({
      parentSessionId: "s1",
      turn: log.get("turn-0"),
    });
    expect(plan.coverage).toBe(TURN_COVERAGE.FULL);
    expect(plan.requiresWorktree).toBe(false);
    expect(plan.warnings).toEqual([]);
  });

  it("requires a worktree when the branch intends to write", () => {
    const readOnlyLog = new TurnBindingLog();
    readOnlyLog.startTurn("turn-1", { conversationOffset: 1 });
    readOnlyLog.recordToolCall("turn-1", "tc", { name: "read_file" });
    const turn = readOnlyLog.get("turn-1");
    expect(turn.coverage).toBe(TURN_COVERAGE.FULL);

    const readPlan = planSessionBranch({ parentSessionId: "s1", turn });
    expect(readPlan.requiresWorktree).toBe(false);

    const writePlan = planSessionBranch({
      parentSessionId: "s1",
      turn,
      writeIntent: true,
    });
    expect(writePlan.requiresWorktree).toBe(true);
    expect(writePlan.warnings.join(" ")).toContain("isolated worktree");
  });

  it("requires a worktree when the branch point already mutated files", () => {
    // FULL turn that mutated files (has a checkpoint) → a divergent branch that
    // also writes would collide, so default to an isolated worktree.
    const plan = planSessionBranch({ parentSessionId: "s1", turn: fullTurn() });
    expect(plan.requiresWorktree).toBe(true);
  });

  it("warns honestly on PARTIAL coverage (irreversible side-effects)", () => {
    const log = new TurnBindingLog();
    log.startTurn("turn-2", { conversationOffset: 2 });
    log.recordToolCall("turn-2", "sh", { name: "run_shell" });
    log.bindCheckpoint("turn-2", "cp-x");
    const plan = planSessionBranch({
      parentSessionId: "s1",
      turn: log.get("turn-2"),
    });
    expect(plan.coverage).toBe(TURN_COVERAGE.PARTIAL);
    expect(plan.warnings.join(" ")).toContain("irreversible side-effects");
  });

  it("warns when there is no file checkpoint (NONE coverage)", () => {
    const log = new TurnBindingLog();
    log.startTurn("turn-5", { conversationOffset: 5 });
    log.recordToolCall("turn-5", "ed", { name: "edit_file" }); // mutated, no checkpoint
    const turn = log.get("turn-5");
    expect(turn.coverage).toBe(TURN_COVERAGE.NONE);
    const plan = planSessionBranch({ parentSessionId: "s1", turn });
    expect(plan.warnings.join(" ")).toContain("no file checkpoint");
    expect(plan.requiresWorktree).toBe(true); // NONE = mutated files at point
  });

  it("warns and still preserves the parent on a missing conversation offset", () => {
    const log = new TurnBindingLog();
    log.startTurn("turn-9"); // no offset
    const plan = planSessionBranch({
      parentSessionId: "s1",
      turn: log.get("turn-9"),
    });
    expect(plan.conversationTruncateTo).toBeNull();
    expect(plan.warnings.join(" ")).toContain("full parent history");
    expect(plan.preservesParent).toBe(true);
  });

  it("handles an unknown/absent turn without throwing", () => {
    const plan = planSessionBranch({ parentSessionId: "s1", turn: null });
    expect(plan.branchId).toBeNull();
    expect(plan.preservesParent).toBe(true);
    expect(plan.inheritSessionGrants).toBe(false);
    expect(plan.warnings.join(" ")).toContain("nothing to branch from");
  });

  it("honors an explicit branch session id", () => {
    const plan = planSessionBranch({
      parentSessionId: "s1",
      turn: fullTurn(),
      branchSessionId: "my-branch",
    });
    expect(plan.branchSessionId).toBe("my-branch");
  });
});

describe("validateBranchLineage", () => {
  it("accepts a clean tree (root + children)", () => {
    const res = validateBranchLineage([
      { sessionId: "root", parentSessionId: null },
      { sessionId: "b1", parentSessionId: "root" },
      { sessionId: "b2", parentSessionId: "b1" },
    ]);
    expect(res.ok).toBe(true);
    expect(res.cycles).toEqual([]);
    expect(res.orphans).toEqual([]);
  });

  it("flags an orphan (parent not present)", () => {
    const res = validateBranchLineage([
      { sessionId: "b1", parentSessionId: "ghost" },
    ]);
    expect(res.ok).toBe(false);
    expect(res.orphans).toContain("b1");
  });

  it("detects a cycle — a branch cannot be its own ancestor", () => {
    const res = validateBranchLineage([
      { sessionId: "a", parentSessionId: "b" },
      { sessionId: "b", parentSessionId: "a" },
    ]);
    expect(res.ok).toBe(false);
    expect(res.cycles.length).toBe(1);
    expect(res.cycles[0].sort()).toEqual(["a", "b"]);
  });

  it("ignores malformed records", () => {
    const res = validateBranchLineage([null, { parentSessionId: "x" }, 42]);
    expect(res.ok).toBe(true);
  });
});

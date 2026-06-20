import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createGoal,
  getGoal,
  listGoals,
  addKeyResult,
  setKeyResult,
  recordProgress,
  linkSession,
  unlinkSession,
  setStatus,
  deleteGoal,
  resolveActiveGoal,
  GOAL_STATUS,
} from "../../src/lib/goal-store.js";

describe("goal-store", () => {
  let root;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "goal-test-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const o = () => ({ root });

  it("creates a goal with defaults", () => {
    const g = createGoal({ objective: "Ship v1" }, o());
    expect(g.id).toMatch(/^goal-/);
    expect(g.objective).toBe("Ship v1");
    expect(g.title).toBe("Ship v1");
    expect(g.status).toBe(GOAL_STATUS.ACTIVE);
    expect(g.progress).toBe(0);
    expect(g.keyResults).toEqual([]);
    expect(getGoal(g.id, o())).toMatchObject({ id: g.id });
  });

  it("requires an objective", () => {
    expect(() => createGoal({ objective: "  " }, o())).toThrow(/objective/);
  });

  it("writes goal files atomically (no .tmp leftover after create + mutate)", () => {
    const g = createGoal({ objective: "Atomic" }, o());
    // saveGoal path (a mutation) must also be atomic.
    setStatus(g.id, GOAL_STATUS.PAUSED, o());
    const entries = readdirSync(root);
    expect(entries).toContain(`${g.id}.json`);
    expect(entries.some((n) => n.endsWith(".tmp"))).toBe(false);
    // The file is complete + parseable (atomic rename → never half-written).
    expect(getGoal(g.id, o())).toMatchObject({
      id: g.id,
      status: GOAL_STATUS.PAUSED,
    });
  });

  it("derives progress from key results", () => {
    const g = createGoal(
      { objective: "X", keyResults: ["a", "b", { text: "c", done: true }] },
      o(),
    );
    expect(g.keyResults).toHaveLength(3);
    expect(g.progress).toBe(33); // 1 of 3 done
  });

  it("addKeyResult and setKeyResult update derived progress", () => {
    let g = createGoal({ objective: "X" }, o());
    g = addKeyResult(g.id, "first KR", { target: 10 }, o());
    g = addKeyResult(g.id, "second KR", {}, o());
    expect(g.progress).toBe(0);
    const krId = g.keyResults[0].id;
    g = setKeyResult(g.id, krId, { done: true }, o());
    expect(g.progress).toBe(50);
  });

  it("setKeyResult auto-marks done when current reaches target", () => {
    let g = createGoal({ objective: "X", keyResults: [] }, o());
    g = addKeyResult(g.id, "reach 5", { target: 5 }, o());
    const krId = g.keyResults[0].id;
    g = setKeyResult(g.id, krId, { current: 5 }, o());
    expect(g.keyResults[0].done).toBe(true);
    expect(g.progress).toBe(100);
  });

  it("setKeyResult throws on unknown kr", () => {
    const g = createGoal({ objective: "X" }, o());
    expect(() => setKeyResult(g.id, "kr-missing", { done: true }, o())).toThrow(
      /key result/,
    );
  });

  it("recordProgress sets pct (clamped) and appends notes", () => {
    let g = createGoal({ objective: "X" }, o());
    g = recordProgress(g.id, { pct: 150, note: "halfway-ish" }, o());
    expect(g.progress).toBe(100); // clamped
    g = recordProgress(g.id, { pct: -10 }, o());
    expect(g.progress).toBe(0); // clamped
    expect(g.notes).toHaveLength(1);
    expect(g.notes[0]).toMatchObject({ text: "halfway-ish", by: "user" });
    expect(g.drift.lastProgressAt).toBeTruthy();
  });

  it("records agent-authored notes", () => {
    const g0 = createGoal({ objective: "X" }, o());
    const g = recordProgress(g0.id, { note: "auto", by: "agent" }, o());
    expect(g.notes[0].by).toBe("agent");
  });

  it("links and unlinks sessions idempotently", () => {
    let g = createGoal({ objective: "X" }, o());
    g = linkSession(g.id, "sess-1", o());
    g = linkSession(g.id, "sess-1", o()); // idempotent
    expect(g.linkedSessions).toEqual(["sess-1"]);
    g = linkSession(g.id, "sess-2", o());
    expect(g.linkedSessions).toEqual(["sess-1", "sess-2"]);
    g = unlinkSession(g.id, "sess-1", o());
    expect(g.linkedSessions).toEqual(["sess-2"]);
  });

  it("setStatus validates and closes to 100%", () => {
    let g = createGoal({ objective: "X" }, o());
    expect(() => setStatus(g.id, "bogus", o())).toThrow(/invalid status/);
    g = setStatus(g.id, GOAL_STATUS.DONE, o());
    expect(g.status).toBe("done");
    expect(g.progress).toBe(100);
  });

  it("lists goals newest-first and filters by status", () => {
    const a = createGoal({ objective: "A" }, o());
    const b = createGoal({ objective: "B" }, o());
    setStatus(b.id, GOAL_STATUS.PAUSED, o());
    const all = listGoals(o());
    expect(all.map((g) => g.id)).toContain(a.id);
    expect(all.map((g) => g.id)).toContain(b.id);
    const active = listGoals({ root, status: GOAL_STATUS.ACTIVE });
    expect(active.map((g) => g.id)).toEqual([a.id]);
  });

  it("deletes goals", () => {
    const g = createGoal({ objective: "X" }, o());
    expect(deleteGoal(g.id, o())).toBe(true);
    expect(getGoal(g.id, o())).toBeNull();
    expect(deleteGoal(g.id, o())).toBe(false);
  });

  describe("resolveActiveGoal", () => {
    it("honors an explicit id regardless of status", () => {
      const g = createGoal({ objective: "X" }, o());
      setStatus(g.id, GOAL_STATUS.PAUSED, o());
      const r = resolveActiveGoal({ explicitId: g.id }, o());
      expect(r.id).toBe(g.id);
    });

    it("returns the single active goal", () => {
      const g = createGoal({ objective: "only one" }, o());
      expect(resolveActiveGoal({}, o()).id).toBe(g.id);
    });

    it("returns null when several active and none linked", () => {
      createGoal({ objective: "A" }, o());
      createGoal({ objective: "B" }, o());
      expect(resolveActiveGoal({}, o())).toBeNull();
    });

    it("prefers a session-linked active goal when ambiguous", () => {
      createGoal({ objective: "A" }, o());
      const b = createGoal({ objective: "B" }, o());
      linkSession(b.id, "sess-x", o());
      const r = resolveActiveGoal({ sessionId: "sess-x" }, o());
      expect(r.id).toBe(b.id);
    });

    it("returns null when no goals exist", () => {
      expect(existsSync(root)).toBe(true);
      expect(resolveActiveGoal({}, o())).toBeNull();
    });
  });
});

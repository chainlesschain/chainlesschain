/**
 * Unit tests for OutcomeFeedback — quality signal pipeline
 * for the autonomous learning loop.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  TrajectoryStore,
  _deps as trajDeps,
} from "../../src/lib/learning/trajectory-store.js";
import {
  OutcomeFeedback,
  autoScore,
  hasRetries,
  detectCorrection,
} from "../../src/lib/learning/outcome-feedback.js";

// Mock instinct-manager and evolution-system to avoid DB side effects
vi.mock("../../src/lib/instinct-manager.js", () => ({
  INSTINCT_CATEGORIES: {
    TOOL_PREFERENCE: "tool_preference",
    CODING_STYLE: "coding_style",
    RESPONSE_FORMAT: "response_format",
    LANGUAGE: "language",
    WORKFLOW: "workflow",
    BEHAVIOR: "behavior",
  },
  recordInstinct: vi.fn(() => ({ id: "mock", isNew: true })),
  ensureInstinctsTable: vi.fn(),
}));

vi.mock("../../src/lib/evolution-system.js", () => ({
  assessCapability: vi.fn(() => ({ id: "mock", score: 0.5 })),
  ensureEvolutionTables: vi.fn(),
}));

describe("outcome-feedback", () => {
  let db;
  let store;
  let feedback;
  let idCounter;

  beforeEach(() => {
    db = new MockDatabase();
    idCounter = 0;
    trajDeps.generateId = vi.fn(() => `traj-${++idCounter}`);
    store = new TrajectoryStore(db);
    feedback = new OutcomeFeedback(db, store);
    vi.clearAllMocks();
  });

  // ── hasRetries ──────────────────────────────────────

  describe("hasRetries", () => {
    it("returns false for empty chain", () => {
      expect(hasRetries([])).toBe(false);
    });

    it("returns false for single tool call", () => {
      expect(hasRetries([{ tool: "read_file" }])).toBe(false);
    });

    it("returns false for different consecutive tools", () => {
      expect(
        hasRetries([
          { tool: "read_file" },
          { tool: "edit_file" },
          { tool: "run_shell" },
        ]),
      ).toBe(false);
    });

    it("returns true for consecutive same tool", () => {
      expect(hasRetries([{ tool: "run_shell" }, { tool: "run_shell" }])).toBe(
        true,
      );
    });

    it("returns true when retry is in middle of chain", () => {
      expect(
        hasRetries([
          { tool: "read_file" },
          { tool: "run_shell" },
          { tool: "run_shell" },
          { tool: "edit_file" },
        ]),
      ).toBe(true);
    });
  });

  // ── autoScore ───────────────────────────────────────

  describe("autoScore", () => {
    it("returns 0.5 for empty tool chain", () => {
      expect(autoScore({ toolChain: [] })).toBe(0.5);
    });

    it("returns 0.8 for perfect execution (no errors, no retries, final success)", () => {
      const score = autoScore({
        toolChain: [
          { tool: "read_file", status: "completed" },
          { tool: "edit_file", status: "completed" },
        ],
      });
      expect(score).toBeCloseTo(0.8, 5); // 0.5 + 0.2 (no errors) + 0.1 (final success)
    });

    it("returns 0.3 for high error rate", () => {
      const score = autoScore({
        toolChain: [
          { tool: "t1", status: "error" },
          { tool: "t2", status: "error" },
          { tool: "t3", status: "completed" },
        ],
      });
      // 0.5 - 0.3 (error rate >50%) + 0.1 (final success) = 0.3
      expect(score).toBeCloseTo(0.3, 5);
    });

    it("penalizes retries", () => {
      const score = autoScore({
        toolChain: [
          { tool: "run_shell", status: "completed" },
          { tool: "run_shell", status: "completed" },
        ],
      });
      // 0.5 + 0.2 (no errors) - 0.1 (retries) + 0.1 (final success) = 0.7
      expect(score).toBe(0.7);
    });

    it("handles all-error chain", () => {
      const score = autoScore({
        toolChain: [
          { tool: "t1", status: "error" },
          { tool: "t2", status: "error" },
        ],
      });
      // 0.5 - 0.3 (error rate >50%) = 0.2
      // final tool is error, no +0.1
      // retries: t1 != t2 so no -0.1
      expect(score).toBe(0.2);
    });

    it("clamps score to 0-1", () => {
      // Even worst case should not go below 0
      const score = autoScore({
        toolChain: [
          { tool: "t1", status: "error" },
          { tool: "t1", status: "error" },
        ],
      });
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    it("treats 'failed' as error", () => {
      const score = autoScore({
        toolChain: [
          { tool: "t1", status: "failed" },
          { tool: "t2", status: "completed" },
        ],
      });
      // 50% error rate (not >50%) so no -0.3
      // 0.5 + 0.1 (final success) = 0.6
      expect(score).toBe(0.6);
    });
  });

  // ── detectCorrection ────────────────────────────────

  describe("detectCorrection", () => {
    const prevTraj = {
      toolChain: [
        { tool: "edit_file", args: { path: "src/auth.js" }, result: "ok" },
      ],
    };

    it("returns false for null inputs", () => {
      expect(detectCorrection(null, prevTraj).isCorrection).toBe(false);
      expect(detectCorrection("hello", null).isCorrection).toBe(false);
    });

    it("detects English negation patterns", () => {
      expect(detectCorrection("That's not right", prevTraj).isCorrection).toBe(
        true,
      );
      expect(detectCorrection("wrong, redo it", prevTraj).isCorrection).toBe(
        true,
      );
      expect(detectCorrection("don't do that", prevTraj).isCorrection).toBe(
        true,
      );
      expect(detectCorrection("try again please", prevTraj).isCorrection).toBe(
        true,
      );
      expect(detectCorrection("That is incorrect", prevTraj).isCorrection).toBe(
        true,
      );
    });

    it("detects Chinese negation patterns", () => {
      expect(detectCorrection("不对，重新来", prevTraj).isCorrection).toBe(
        true,
      );
      expect(detectCorrection("错了", prevTraj).isCorrection).toBe(true);
      expect(detectCorrection("别这样做", prevTraj).isCorrection).toBe(true);
    });

    it("returns false for normal follow-up messages", () => {
      expect(
        detectCorrection("thanks, looks good", prevTraj).isCorrection,
      ).toBe(false);
      expect(detectCorrection("now deploy it", prevTraj).isCorrection).toBe(
        false,
      );
      expect(detectCorrection("what about tests?", prevTraj).isCorrection).toBe(
        false,
      );
    });

    it("detects reference to previous file with correction language", () => {
      const result = detectCorrection(
        "actually edit src/auth.js instead with a different approach",
        prevTraj,
      );
      expect(result.isCorrection).toBe(true);
      expect(result.detail).toContain("src/auth.js");
    });

    it("does not flag file reference without correction language", () => {
      const result = detectCorrection(
        "now also look at src/auth.js for other issues",
        prevTraj,
      );
      expect(result.isCorrection).toBe(false);
    });
  });

  // ── OutcomeFeedback.scoreTrajectory ─────────────────

  describe("scoreTrajectory", () => {
    it("auto-scores and backfills the trajectory", () => {
      const id = store.startTrajectory("s1", "test");
      store.appendToolCall(id, {
        tool: "read_file",
        args: {},
        result: "ok",
        durationMs: 10,
        status: "completed",
      });
      store.completeTrajectory(id, { finalResponse: "done" });

      const score = feedback.scoreTrajectory(id);
      expect(score).toBeCloseTo(0.8, 5); // no errors + final success

      const traj = store.getTrajectory(id);
      expect(traj.outcomeScore).toBeCloseTo(0.8, 5);
      expect(traj.outcomeSource).toBe("auto");
    });

    it("returns 0.5 for nonexistent trajectory", () => {
      expect(feedback.scoreTrajectory("nonexistent")).toBe(0.5);
    });
  });

  // ── OutcomeFeedback.recordUserFeedback ──────────────

  describe("recordUserFeedback", () => {
    it("records positive feedback as score 1.0", () => {
      const id = store.startTrajectory("s1", "test");
      feedback.recordUserFeedback(id, { rating: "positive" });

      const traj = store.getTrajectory(id);
      expect(traj.outcomeScore).toBe(1.0);
      expect(traj.outcomeSource).toBe("user");
    });

    it("records negative feedback as score 0.0", () => {
      const id = store.startTrajectory("s1", "test");
      feedback.recordUserFeedback(id, { rating: "negative" });

      const traj = store.getTrajectory(id);
      expect(traj.outcomeScore).toBe(0.0);
    });

    it("records numeric feedback clamped to 0-1", () => {
      const id = store.startTrajectory("s1", "test");
      feedback.recordUserFeedback(id, { rating: 0.75 });

      const traj = store.getTrajectory(id);
      expect(traj.outcomeScore).toBe(0.75);
    });

    it("overrides auto-score with user source", () => {
      const id = store.startTrajectory("s1", "test");
      store.appendToolCall(id, {
        tool: "t1",
        args: {},
        result: "ok",
        durationMs: 0,
        status: "completed",
      });
      store.completeTrajectory(id, { finalResponse: "done" });

      // Auto score first
      feedback.scoreTrajectory(id);
      expect(store.getTrajectory(id).outcomeSource).toBe("auto");

      // User override
      feedback.recordUserFeedback(id, { rating: "negative" });
      const traj = store.getTrajectory(id);
      expect(traj.outcomeScore).toBe(0.0);
      expect(traj.outcomeSource).toBe("user");
    });
  });

  // ── OutcomeFeedback.checkCorrection ─────────────────

  describe("checkCorrection", () => {
    it("detects correction and downgrades score", () => {
      const id = store.startTrajectory("s1", "test");
      store.appendToolCall(id, {
        tool: "edit_file",
        args: { path: "a.js" },
        result: "ok",
        durationMs: 0,
        status: "completed",
      });
      store.completeTrajectory(id, { finalResponse: "done" });
      feedback.scoreTrajectory(id);

      const result = feedback.checkCorrection("wrong, redo it", id);
      expect(result.isCorrection).toBe(true);

      const traj = store.getTrajectory(id);
      // Score should be downgraded by 0.3
      expect(traj.outcomeScore).toBeLessThan(0.8);
    });

    it("does not downgrade for non-correction", () => {
      const id = store.startTrajectory("s1", "test");
      store.appendToolCall(id, {
        tool: "t1",
        args: {},
        result: "ok",
        durationMs: 0,
        status: "completed",
      });
      store.completeTrajectory(id, { finalResponse: "done" });
      feedback.scoreTrajectory(id);

      const result = feedback.checkCorrection(
        "great, now do the next step",
        id,
      );
      expect(result.isCorrection).toBe(false);

      const traj = store.getTrajectory(id);
      expect(traj.outcomeScore).toBeCloseTo(0.8, 5); // unchanged
    });

    it("returns false for nonexistent trajectory", () => {
      const result = feedback.checkCorrection("wrong", "nonexistent");
      expect(result.isCorrection).toBe(false);
    });
  });

  // ── OutcomeFeedback.propagateFeedback ───────────────

  describe("propagateFeedback", () => {
    it("propagates high score to instinct as tool preference", async () => {
      const { recordInstinct } =
        await import("../../src/lib/instinct-manager.js");

      const id = store.startTrajectory("s1", "test");
      store.appendToolCall(id, {
        tool: "read_file",
        args: {},
        result: "ok",
        durationMs: 0,
        status: "completed",
      });
      store.appendToolCall(id, {
        tool: "edit_file",
        args: {},
        result: "ok",
        durationMs: 0,
        status: "completed",
      });
      store.completeTrajectory(id, { finalResponse: "done" });
      store.setOutcomeScore(id, 0.9, "auto");

      feedback.propagateFeedback(id);

      expect(recordInstinct).toHaveBeenCalledWith(
        db,
        "tool_preference",
        expect.stringContaining("read_file"),
      );
    });

    it("propagates low score to instinct as workflow to avoid", async () => {
      const { recordInstinct } =
        await import("../../src/lib/instinct-manager.js");

      const id = store.startTrajectory("s1", "test");
      store.appendToolCall(id, {
        tool: "run_shell",
        args: {},
        result: "fail",
        durationMs: 0,
        status: "error",
      });
      store.completeTrajectory(id, { finalResponse: "failed" });
      store.setOutcomeScore(id, 0.2, "auto");

      feedback.propagateFeedback(id);

      expect(recordInstinct).toHaveBeenCalledWith(
        db,
        "workflow",
        expect.stringContaining("avoid"),
      );
    });

    it("propagates to evolution system", async () => {
      const { assessCapability } =
        await import("../../src/lib/evolution-system.js");

      const id = store.startTrajectory("s1", "test");
      store.appendToolCall(id, {
        tool: "read_file",
        args: {},
        result: "ok",
        durationMs: 0,
        status: "completed",
      });
      store.completeTrajectory(id, { finalResponse: "done" });
      store.setOutcomeScore(id, 0.85, "auto");

      feedback.propagateFeedback(id);

      expect(assessCapability).toHaveBeenCalledWith(
        db,
        "read_file",
        0.85,
        "tool",
      );
    });

    it("no-ops for unscored trajectory", () => {
      const id = store.startTrajectory("s1", "test");
      // No score set
      feedback.propagateFeedback(id); // should not throw
    });

    it("no-ops for nonexistent trajectory", () => {
      feedback.propagateFeedback("nonexistent"); // should not throw
    });

    it("does not propagate mid-range scores to instinct", async () => {
      const { recordInstinct } =
        await import("../../src/lib/instinct-manager.js");
      vi.clearAllMocks();

      const id = store.startTrajectory("s1", "test");
      store.appendToolCall(id, {
        tool: "t1",
        args: {},
        result: "ok",
        durationMs: 0,
        status: "completed",
      });
      store.completeTrajectory(id, { finalResponse: "done" });
      store.setOutcomeScore(id, 0.5, "auto");

      feedback.propagateFeedback(id);

      expect(recordInstinct).not.toHaveBeenCalled();
    });
  });
});

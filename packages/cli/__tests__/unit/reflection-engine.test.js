/**
 * Unit tests for ReflectionEngine — periodic self-review of
 * accumulated trajectory data and learning statistics.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  TrajectoryStore,
  _deps as trajDeps,
} from "../../src/lib/learning/trajectory-store.js";
import {
  ReflectionEngine,
  computeToolStats,
  computeScoreTrend,
  findErrorProneTools,
  buildReflectionPrompt,
  _deps as reflDeps,
} from "../../src/lib/learning/reflection-engine.js";

describe("reflection-engine", () => {
  let db;
  let store;
  let idCounter;

  beforeEach(() => {
    db = new MockDatabase();
    idCounter = 0;
    trajDeps.generateId = vi.fn(() => `traj-${++idCounter}`);
    reflDeps.now = () => new Date("2026-04-12T12:00:00Z").getTime();
    store = new TrajectoryStore(db);
  });

  // Helper to create a scored trajectory
  function createTrajectory(tools, score, statuses) {
    const id = store.startTrajectory("s1", "test task");
    tools.forEach((t, i) => {
      store.appendToolCall(id, {
        tool: t,
        args: {},
        result: "ok",
        durationMs: 10,
        status: statuses ? statuses[i] : "completed",
      });
    });
    store.completeTrajectory(id, { finalResponse: "done" });
    if (score != null) {
      store.setOutcomeScore(id, score, "auto");
    }
    return id;
  }

  // ── computeToolStats ──────────────────────────────

  describe("computeToolStats", () => {
    it("computes usage counts and error rates", () => {
      const trajs = [
        {
          toolChain: [
            { tool: "read_file", status: "completed" },
            { tool: "edit_file", status: "completed" },
            { tool: "read_file", status: "error" },
          ],
        },
      ];

      const { toolUsage, totalTools } = computeToolStats(trajs);
      expect(totalTools).toBe(3);
      expect(toolUsage.read_file.count).toBe(2);
      expect(toolUsage.read_file.errorRate).toBe(0.5);
      expect(toolUsage.edit_file.count).toBe(1);
      expect(toolUsage.edit_file.errorRate).toBe(0);
    });

    it("handles empty trajectories", () => {
      const { toolUsage, totalTools } = computeToolStats([]);
      expect(totalTools).toBe(0);
      expect(Object.keys(toolUsage)).toHaveLength(0);
    });

    it("counts across multiple trajectories", () => {
      const trajs = [
        { toolChain: [{ tool: "a", status: "completed" }] },
        {
          toolChain: [
            { tool: "a", status: "completed" },
            { tool: "b", status: "error" },
          ],
        },
      ];

      const { toolUsage, totalTools } = computeToolStats(trajs);
      expect(totalTools).toBe(3);
      expect(toolUsage.a.count).toBe(2);
      expect(toolUsage.b.count).toBe(1);
      expect(toolUsage.b.errorRate).toBe(1);
    });

    it("treats 'failed' as error", () => {
      const { toolUsage } = computeToolStats([
        { toolChain: [{ tool: "t1", status: "failed" }] },
      ]);
      expect(toolUsage.t1.errorRate).toBe(1);
    });
  });

  // ── computeScoreTrend ─────────────────────────────

  describe("computeScoreTrend", () => {
    it("returns stable for single trajectory", () => {
      const result = computeScoreTrend([{ outcomeScore: 0.8 }]);
      expect(result.trend).toBe("stable");
      expect(result.avgScore).toBe(0.8);
    });

    it("detects improving trend", () => {
      const trajs = [
        { outcomeScore: 0.3 },
        { outcomeScore: 0.4 },
        { outcomeScore: 0.7 },
        { outcomeScore: 0.9 },
      ];
      const result = computeScoreTrend(trajs);
      expect(result.trend).toBe("improving");
      expect(result.recentAvg).toBeGreaterThan(result.avgScore - 0.5);
    });

    it("detects declining trend", () => {
      const trajs = [
        { outcomeScore: 0.9 },
        { outcomeScore: 0.8 },
        { outcomeScore: 0.3 },
        { outcomeScore: 0.2 },
      ];
      const result = computeScoreTrend(trajs);
      expect(result.trend).toBe("declining");
    });

    it("returns stable for consistent scores", () => {
      const trajs = [
        { outcomeScore: 0.7 },
        { outcomeScore: 0.72 },
        { outcomeScore: 0.68 },
        { outcomeScore: 0.71 },
      ];
      const result = computeScoreTrend(trajs);
      expect(result.trend).toBe("stable");
    });

    it("skips unscored trajectories", () => {
      const trajs = [
        { outcomeScore: null },
        { outcomeScore: 0.5 },
        { outcomeScore: null },
        { outcomeScore: 0.9 },
      ];
      const result = computeScoreTrend(trajs);
      expect(result.trend).toBe("improving");
    });

    it("returns stable for empty input", () => {
      const result = computeScoreTrend([]);
      expect(result.trend).toBe("stable");
      expect(result.avgScore).toBe(0);
    });
  });

  // ── findErrorProneTools ───────────────────────────

  describe("findErrorProneTools", () => {
    it("finds tools above error threshold", () => {
      const usage = {
        read_file: { count: 10, errorRate: 0.1 },
        run_shell: { count: 5, errorRate: 0.6 },
        edit_file: { count: 3, errorRate: 0.4 },
      };
      const result = findErrorProneTools(usage);
      expect(result).toHaveLength(2);
      expect(result[0].tool).toBe("run_shell");
      expect(result[1].tool).toBe("edit_file");
    });

    it("returns empty for all-clean tools", () => {
      const usage = {
        a: { count: 10, errorRate: 0.0 },
        b: { count: 5, errorRate: 0.1 },
      };
      expect(findErrorProneTools(usage)).toHaveLength(0);
    });

    it("filters by minimum count", () => {
      const usage = {
        rare: { count: 1, errorRate: 1.0 }, // < 2 calls, skip
        frequent: { count: 5, errorRate: 0.5 },
      };
      const result = findErrorProneTools(usage);
      expect(result).toHaveLength(1);
      expect(result[0].tool).toBe("frequent");
    });

    it("respects custom threshold", () => {
      const usage = {
        a: { count: 10, errorRate: 0.2 },
      };
      expect(findErrorProneTools(usage, 0.1)).toHaveLength(1);
      expect(findErrorProneTools(usage, 0.3)).toHaveLength(0);
    });
  });

  // ── buildReflectionPrompt ─────────────────────────

  describe("buildReflectionPrompt", () => {
    it("builds system + user messages", () => {
      const messages = buildReflectionPrompt({
        totalTrajectories: 50,
        scoredCount: 40,
        avgScore: 0.75,
        recentAvg: 0.82,
        trend: "improving",
        topTools: [{ tool: "read_file", count: 100, errorRate: 0.05 }],
        errorProneTools: [{ tool: "run_shell", errorRate: 0.4, count: 20 }],
        synthesizedCount: 3,
      });

      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe("system");
      expect(messages[1].content).toContain("50");
      expect(messages[1].content).toContain("improving");
      expect(messages[1].content).toContain("read_file");
      expect(messages[1].content).toContain("run_shell");
    });

    it("handles empty data", () => {
      const messages = buildReflectionPrompt({});
      expect(messages).toHaveLength(2);
      expect(messages[1].content).toContain("undefined");
    });
  });

  // ── ReflectionEngine.reflect ──────────────────────

  describe("reflect", () => {
    it("produces a report from trajectories", async () => {
      createTrajectory(["read_file", "edit_file"], 0.8);
      createTrajectory(["read_file", "run_shell"], 0.6);
      createTrajectory(["run_shell", "run_shell"], 0.3, ["error", "completed"]);

      const engine = new ReflectionEngine(db, null, store);
      const report = await engine.reflect();

      expect(report.totalTrajectories).toBe(3);
      expect(report.scoredCount).toBe(3);
      expect(report.avgScore).toBeGreaterThan(0);
      expect(report.topTools.length).toBeGreaterThan(0);
      expect(report.timestamp).toBeTruthy();
      expect(report.llmAnalysis).toBeNull();
    });

    it("returns empty report when no trajectories", async () => {
      const engine = new ReflectionEngine(db, null, store);
      const report = await engine.reflect();

      expect(report.totalTrajectories).toBe(0);
      expect(report.note).toContain("No trajectories");
    });

    it("includes LLM analysis when llmChat provided", async () => {
      createTrajectory(["read_file"], 0.9);

      const mockLLM = vi.fn().mockResolvedValue(
        JSON.stringify({
          summary: "Good performance overall",
          strengths: ["Efficient file reading"],
          weaknesses: [],
          recommendations: [],
        }),
      );

      const engine = new ReflectionEngine(db, mockLLM, store);
      const report = await engine.reflect();

      expect(report.llmAnalysis).toBeTruthy();
      expect(report.llmAnalysis.summary).toContain("Good");
      expect(mockLLM).toHaveBeenCalled();
    });

    it("handles LLM failure gracefully", async () => {
      createTrajectory(["read_file"], 0.9);

      const mockLLM = vi.fn().mockRejectedValue(new Error("offline"));
      const engine = new ReflectionEngine(db, mockLLM, store);
      const report = await engine.reflect();

      expect(report.llmAnalysis).toBeNull();
      expect(report.totalTrajectories).toBe(1);
    });

    it("saves report to skill_improvement_log", async () => {
      createTrajectory(["read_file"], 0.8);

      const engine = new ReflectionEngine(db, null, store);
      await engine.reflect();

      const logs = db.data.get("skill_improvement_log") || [];
      const reflectionLog = logs.find((l) => l.trigger_type === "reflection");
      expect(reflectionLog).toBeDefined();
      expect(reflectionLog.skill_name).toBe("_reflection");
    });
  });

  // ── ReflectionEngine.getLatestReport ──────────────

  describe("getLatestReport", () => {
    it("returns null when no reports exist", () => {
      const engine = new ReflectionEngine(db, null, store);
      expect(engine.getLatestReport()).toBeNull();
    });

    it("returns the most recent report", async () => {
      createTrajectory(["read_file"], 0.8);

      const engine = new ReflectionEngine(db, null, store);
      await engine.reflect();

      const latest = engine.getLatestReport();
      expect(latest).toBeTruthy();
      expect(latest.totalTrajectories).toBe(1);
    });
  });

  // ── ReflectionEngine.isReflectionDue ──────────────

  describe("isReflectionDue", () => {
    it("returns true when no previous reflection", () => {
      const engine = new ReflectionEngine(db, null, store);
      expect(engine.isReflectionDue()).toBe(true);
    });

    it("returns false shortly after reflection", async () => {
      createTrajectory(["read_file"], 0.8);

      const engine = new ReflectionEngine(db, null, store, {
        reflectionInterval: 24 * 60 * 60 * 1000, // 24h
      });
      await engine.reflect();

      // Same time — not due
      expect(engine.isReflectionDue()).toBe(false);
    });

    it("returns true after interval has passed", async () => {
      createTrajectory(["read_file"], 0.8);

      const engine = new ReflectionEngine(db, null, store, {
        reflectionInterval: 1000, // 1 second
      });

      // Reflect at time T
      reflDeps.now = () => new Date("2026-04-12T12:00:00Z").getTime();
      await engine.reflect();

      // Check at T + 2s — should be due
      reflDeps.now = () => new Date("2026-04-12T12:00:02Z").getTime();
      expect(engine.isReflectionDue()).toBe(true);
    });
  });

  // ── Error-prone tools in reflection ───────────────

  describe("error-prone tools in report", () => {
    it("identifies error-prone tools in reflection report", async () => {
      // Create trajectories with shell errors
      for (let i = 0; i < 3; i++) {
        createTrajectory(["run_shell", "run_shell"], 0.3, ["error", "error"]);
      }
      // And some clean ones
      createTrajectory(["read_file", "edit_file"], 0.9);

      const engine = new ReflectionEngine(db, null, store);
      const report = await engine.reflect();

      expect(report.errorProneTools.length).toBeGreaterThan(0);
      const shellTool = report.errorProneTools.find(
        (t) => t.tool === "run_shell",
      );
      expect(shellTool).toBeDefined();
      expect(shellTool.errorRate).toBe(1.0);
    });
  });
});

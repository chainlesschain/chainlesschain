/**
 * Integration tests for the Autonomous Learning Loop.
 *
 * Tests the full pipeline across modules:
 *   TrajectoryStore → OutcomeFeedback → SkillSynthesizer → SkillImprover → ReflectionEngine
 *
 * Uses MockDatabase to avoid filesystem deps, but exercises real cross-module interactions.
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
} from "../../src/lib/learning/outcome-feedback.js";
import {
  SkillSynthesizer,
  _deps as synthDeps,
} from "../../src/lib/learning/skill-synthesizer.js";
import {
  SkillImprover,
  _deps as impDeps,
} from "../../src/lib/learning/skill-improver.js";
import {
  ReflectionEngine,
  _deps as reflDeps,
} from "../../src/lib/learning/reflection-engine.js";

// Mock instinct-manager and evolution-system to avoid side effects
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

describe("learning-loop integration", () => {
  let db;
  let store;
  let feedback;
  let idCounter;

  beforeEach(() => {
    db = new MockDatabase();
    idCounter = 0;
    trajDeps.generateId = vi.fn(() => `traj-${++idCounter}`);
    reflDeps.now = () => new Date("2026-04-12T12:00:00Z").getTime();
    store = new TrajectoryStore(db);
    feedback = new OutcomeFeedback(db, store);
    vi.clearAllMocks();
  });

  // ── Hooks → TrajectoryStore → OutcomeFeedback ─────

  describe("store → feedback pipeline", () => {
    it("records a full user turn and auto-scores it", () => {
      const trajectoryId = store.startTrajectory(
        "integration-1",
        "refactor the auth module",
      );
      expect(trajectoryId).toBe("traj-1");

      // Agent uses tools
      store.appendToolCall(trajectoryId, {
        tool: "read_file",
        args: { path: "auth.js" },
        result: "code...",
        durationMs: 15,
        status: "completed",
      });
      store.appendToolCall(trajectoryId, {
        tool: "edit_file",
        args: { path: "auth.js" },
        result: "ok",
        durationMs: 25,
        status: "completed",
      });
      store.appendToolCall(trajectoryId, {
        tool: "run_shell",
        args: { cmd: "npm test" },
        result: "pass",
        durationMs: 3000,
        status: "completed",
      });

      // Agent responds
      const traj = store.completeTrajectory(trajectoryId, {
        finalResponse: "Auth module refactored",
        tags: ["refactor"],
      });
      expect(traj.toolCount).toBe(3);
      expect(traj.complexityLevel).toBe("moderate");

      // Auto-score via OutcomeFeedback
      const score = feedback.scoreTrajectory("traj-1");
      expect(score).toBeCloseTo(0.8, 5); // no errors + final success

      // Verify score is persisted
      const scored = store.getTrajectory("traj-1");
      expect(scored.outcomeScore).toBeCloseTo(0.8, 5);
      expect(scored.outcomeSource).toBe("auto");
    });

    it("detects user correction and downgrades score", () => {
      // First turn: agent does something
      const trajectoryId = store.startTrajectory(
        "integration-2",
        "fix the login bug",
      );
      store.appendToolCall(trajectoryId, {
        tool: "edit_file",
        args: { path: "login.js" },
        result: "ok",
        durationMs: 10,
        status: "completed",
      });
      store.completeTrajectory(trajectoryId, { finalResponse: "Fixed" });
      feedback.scoreTrajectory("traj-1");

      const before = store.getTrajectory("traj-1");
      expect(before.outcomeScore).toBeCloseTo(0.8, 5);

      // User corrects: "wrong, that's not right"
      const result = feedback.checkCorrection(
        "wrong, redo the login fix",
        "traj-1",
      );
      expect(result.isCorrection).toBe(true);

      const after = store.getTrajectory("traj-1");
      expect(after.outcomeScore).toBeLessThan(before.outcomeScore);
    });

    it("propagates high score to instinct system", async () => {
      const { recordInstinct } =
        await import("../../src/lib/instinct-manager.js");

      const trajectoryId = store.startTrajectory("integration-3", "deploy app");
      store.appendToolCall(trajectoryId, {
        tool: "read_file",
        args: {},
        result: "ok",
        durationMs: 5,
        status: "completed",
      });
      store.appendToolCall(trajectoryId, {
        tool: "run_shell",
        args: {},
        result: "ok",
        durationMs: 100,
        status: "completed",
      });
      store.completeTrajectory(trajectoryId, { finalResponse: "Deployed" });

      // Score high enough for instinct propagation
      store.setOutcomeScore("traj-1", 0.9, "user");
      feedback.propagateFeedback("traj-1");

      expect(recordInstinct).toHaveBeenCalledWith(
        db,
        "tool_preference",
        expect.stringContaining("read_file"),
      );
    });
  });

  // ── TrajectoryStore → SkillSynthesizer ────────────

  describe("store → synthesizer pipeline", () => {
    let mockLLM;

    beforeEach(() => {
      mockLLM = vi.fn();
      synthDeps.fs = {
        promises: {
          mkdir: vi.fn(async () => {}),
          writeFile: vi.fn(async () => {}),
          lstat: vi.fn(async () => ({
            isSymbolicLink: () => false,
            isDirectory: () => true,
          })),
          realpath: vi.fn(async (value) => value),
        },
      };
      synthDeps.path = { join: (...args) => args.join("/") };
    });

    it("synthesizes a skill from multiple similar high-scoring trajectories", async () => {
      // Simulate 3 similar coding sessions via hooks
      const tools = [
        "read_file",
        "edit_file",
        "run_shell",
        "read_file",
        "edit_file",
        "run_shell",
      ];
      for (let i = 0; i < 3; i++) {
        const trajectoryId = store.startTrajectory(
          `synth-${i}`,
          "refactor code",
        );
        for (const t of tools) {
          store.appendToolCall(trajectoryId, {
            tool: t,
            args: {},
            result: "ok",
            durationMs: 10,
            status: "completed",
          });
        }
        store.completeTrajectory(trajectoryId, { finalResponse: "done" });
        feedback.scoreTrajectory(trajectoryId);

        // Bump score to eligible range
        store.setOutcomeScore(`traj-${i + 1}`, 0.85, "auto");
      }

      mockLLM.mockResolvedValue(
        JSON.stringify({
          name: "code-refactor",
          description: "Refactor code workflow",
          procedure: ["Read target file", "Apply refactoring", "Run tests"],
          pitfalls: ["Backup before refactoring"],
          verification: "All tests pass",
          tools: ["read_file", "edit_file", "run_shell"],
        }),
      );

      const synthesizer = new SkillSynthesizer(db, mockLLM, store, {
        minToolCount: 5,
        minScore: 0.7,
        minSimilar: 2,
        candidateOutputDir: "/candidates",
        activeSkillsDirs: ["/skills"],
        evaluateCandidate: vi.fn(async () => ({ accepted: true })),
      });

      const result = await synthesizer.synthesize();
      expect(result.created.length).toBeGreaterThanOrEqual(1);
      expect(result.created).toContain("code-refactor");

      // Verify at least one trajectory is marked as synthesized
      const allTrajs = store.getRecent({ limit: 10 });
      const synthesized = allTrajs.filter(
        (t) => t.synthesizedSkill === "code-refactor",
      );
      expect(synthesized.length).toBeGreaterThanOrEqual(1);

      // Verify SKILL.md was written
      expect(synthDeps.fs.promises.writeFile).toHaveBeenCalledWith(
        expect.stringContaining("code-refactor/1.0.0/SKILL.md"),
        expect.stringContaining("code-refactor"),
        { encoding: "utf-8", flag: "wx" },
      );
    });
  });

  // ── SkillSynthesizer → SkillImprover ──────────────

  describe("synthesizer → improver pipeline", () => {
    let mockLLM;
    let skillContent;

    beforeEach(() => {
      mockLLM = vi.fn();
      skillContent = `---
name: code-refactor
version: 1.0.0
category: auto-learned
---

## Procedure
1. Read file
2. Edit file
3. Run tests

## Pitfalls
- Backup first

## Verification
Tests pass
`;
      impDeps.fs = {
        promises: {
          mkdir: vi.fn(async () => {}),
          writeFile: vi.fn(async () => {}),
          readFile: vi.fn(async () => skillContent),
          lstat: vi.fn(async (value) => {
            const isFile = String(value).endsWith("SKILL.md");
            return {
              size: isFile ? Buffer.byteLength(skillContent, "utf8") : 0,
              isSymbolicLink: () => false,
              isFile: () => isFile,
              isDirectory: () => !isFile,
            };
          }),
          realpath: vi.fn(async (value) => value),
        },
      };
      impDeps.path = { join: (...args) => args.join("/") };
    });

    it("improves a synthesized skill when a better trajectory appears", async () => {
      // Create original synthesized trajectory
      const id1 = store.startTrajectory("s1", "refactor");
      store.appendToolCall(id1, {
        tool: "read_file",
        args: {},
        result: "ok",
        durationMs: 10,
        status: "completed",
      });
      store.completeTrajectory(id1, { finalResponse: "done" });
      store.setOutcomeScore(id1, 0.7, "auto");
      store.markSynthesized(id1, "code-refactor");

      // Better trajectory appears
      const id2 = store.startTrajectory("s2", "refactor v2");
      store.appendToolCall(id2, {
        tool: "read_file",
        args: {},
        result: "ok",
        durationMs: 5,
        status: "completed",
      });
      store.appendToolCall(id2, {
        tool: "edit_file",
        args: {},
        result: "ok",
        durationMs: 5,
        status: "completed",
      });
      store.completeTrajectory(id2, { finalResponse: "done better" });
      store.setOutcomeScore(id2, 0.95, "user");

      mockLLM.mockResolvedValue(
        JSON.stringify({
          improvements: "Added editing step for more complete workflow",
          mergedProcedure: [
            "Read file",
            "Edit with improvements",
            "Run tests",
            "Verify output",
          ],
          mergedPitfalls: ["Backup first", "Check file permissions"],
          updatedVerification: "Tests pass + output verified",
          confidence: 0.9,
        }),
      );

      const improver = new SkillImprover(db, mockLLM, store, {
        skillsDir: "/skills",
        candidateOutputDir: "/candidates",
      });
      const result = await improver.improveFromBetterTrajectory(
        "code-refactor",
        {
          userIntent: "refactor v2",
          outcomeScore: 0.95,
          toolChain: [
            { tool: "read_file", args: {}, status: "completed" },
            { tool: "edit_file", args: {}, status: "completed" },
          ],
        },
      );

      expect(result.improved).toBe(false);
      expect(result.candidateCreated).toBe(true);
      expect(result.status).toBe("candidate");

      // Check version was bumped
      const writtenContent = impDeps.fs.promises.writeFile.mock.calls[0][1];
      expect(writtenContent).toContain("version: 1.1.0");
      expect(writtenContent).toContain("Edit with improvements");

      // Check improvement log
      const logs = db.data.get("skill_improvement_log") || [];
      const impLog = logs.find((l) => l.trigger_type === "better_trajectory");
      expect(impLog).toBeDefined();
    });

    it("repairs a skill after execution error", async () => {
      mockLLM.mockResolvedValue(
        JSON.stringify({
          diagnosis: "Missing npm install step",
          fixedProcedure: [
            "Install dependencies",
            "Read file",
            "Edit file",
            "Run tests",
          ],
          newPitfalls: ["Always run npm install first"],
          confidence: 0.85,
        }),
      );

      const improver = new SkillImprover(db, mockLLM, store, {
        skillsDir: "/skills",
        candidateOutputDir: "/candidates",
      });
      const result = await improver.repairFromError("code-refactor", {
        error: "npm: command not found",
        toolChain: [{ tool: "run_shell", status: "error" }],
        userIntent: "refactor code",
      });

      expect(result.improved).toBe(false);
      expect(result.candidateCreated).toBe(true);
      expect(result.reason).toContain("npm install");
    });
  });

  // ── Full pipeline → ReflectionEngine ──────────────

  describe("full pipeline → reflection", () => {
    it("reflection report captures data from the entire pipeline", async () => {
      // Simulate several user sessions
      for (let i = 0; i < 5; i++) {
        const id = store.startTrajectory(`session-${i}`, `task ${i}`);
        store.appendToolCall(id, {
          tool: i % 2 === 0 ? "read_file" : "run_shell",
          args: {},
          result: i < 3 ? "ok" : "fail",
          durationMs: 100,
          status: i < 3 ? "completed" : "error",
        });
        store.completeTrajectory(id, { finalResponse: `done ${i}` });
        const score = autoScore(store.getTrajectory(id));
        store.setOutcomeScore(id, score, "auto");
      }

      const engine = new ReflectionEngine(db, null, store);
      const report = await engine.reflect();

      expect(report.totalTrajectories).toBe(5);
      expect(report.scoredCount).toBe(5);
      expect(report.topTools.length).toBeGreaterThan(0);
      expect(report.avgScore).toBeGreaterThan(0);

      // Verify report was persisted
      const latest = engine.getLatestReport();
      expect(latest).toBeTruthy();
      expect(latest.totalTrajectories).toBe(5);
    });
  });

  // ── Multi-turn conversation ───────────────────────

  describe("multi-turn conversation tracking", () => {
    it("tracks multiple turns independently within a session", () => {
      // Turn 1
      const firstId = store.startTrajectory("multi-turn", "read the config");
      store.appendToolCall(firstId, {
        tool: "read_file",
        args: { path: "config.json" },
        result: "{}",
        durationMs: 5,
        status: "completed",
      });
      store.completeTrajectory(firstId, { finalResponse: "Config loaded" });

      // Turn 2
      const secondId = store.startTrajectory("multi-turn", "update the config");
      store.appendToolCall(secondId, {
        tool: "read_file",
        args: { path: "config.json" },
        result: "{}",
        durationMs: 5,
        status: "completed",
      });
      store.appendToolCall(secondId, {
        tool: "edit_file",
        args: { path: "config.json" },
        result: "ok",
        durationMs: 10,
        status: "completed",
      });
      store.completeTrajectory(secondId, { finalResponse: "Config updated" });

      // Turn 3 — with error
      const thirdId = store.startTrajectory("multi-turn", "deploy");
      store.appendToolCall(thirdId, {
        tool: "run_shell",
        args: { cmd: "deploy" },
        result: "fail",
        durationMs: 5000,
        status: "error",
      });
      store.completeTrajectory(thirdId, { finalResponse: "Deploy failed" });

      // Verify 3 independent trajectories
      const trajs = store.listBySession("multi-turn");
      expect(trajs).toHaveLength(3);

      // Score them and check
      feedback.scoreTrajectory("traj-1");
      feedback.scoreTrajectory("traj-2");
      feedback.scoreTrajectory("traj-3");

      const t1 = store.getTrajectory("traj-1");
      const t2 = store.getTrajectory("traj-2");
      const t3 = store.getTrajectory("traj-3");

      expect(t1.outcomeScore).toBeCloseTo(0.8, 5); // 1 tool, no errors, final success
      expect(t2.outcomeScore).toBeCloseTo(0.8, 5); // 2 tools, no errors, final success
      expect(t3.outcomeScore).toBe(0.2); // 1 tool, 100% error rate

      // Stats reflect the session
      const stats = store.getStats();
      expect(stats.total).toBe(3);
      expect(stats.scored).toBe(3);
    });
  });

  // ── Edge cases ────────────────────────────────────

  describe("edge cases", () => {
    it("handles rapid score overrides: auto → user → correction", () => {
      const id = store.startTrajectory("s1", "test");
      store.appendToolCall(id, {
        tool: "t1",
        args: {},
        result: "ok",
        durationMs: 0,
        status: "completed",
      });
      store.completeTrajectory(id, { finalResponse: "done" });

      // Auto score
      feedback.scoreTrajectory(id);
      expect(store.getTrajectory(id).outcomeScore).toBeCloseTo(0.8, 5);
      expect(store.getTrajectory(id).outcomeSource).toBe("auto");

      // User overrides
      feedback.recordUserFeedback(id, { rating: "positive" });
      expect(store.getTrajectory(id).outcomeScore).toBe(1.0);
      expect(store.getTrajectory(id).outcomeSource).toBe("user");

      // Correction downgrades
      feedback.checkCorrection("wrong, redo it", id);
      expect(store.getTrajectory(id).outcomeScore).toBe(0.7);
    });

    it("stats reflect scored and synthesized counts correctly", () => {
      // Create 3 trajectories, score 2, synthesize 1
      const id1 = store.startTrajectory("s1", "test1");
      store.appendToolCall(id1, {
        tool: "t1",
        args: {},
        result: "ok",
        durationMs: 0,
        status: "completed",
      });
      store.completeTrajectory(id1, { finalResponse: "done" });
      store.setOutcomeScore(id1, 0.9, "auto");
      store.markSynthesized(id1, "my-skill");

      const id2 = store.startTrajectory("s1", "test2");
      store.completeTrajectory(id2, { finalResponse: "done" });
      store.setOutcomeScore(id2, 0.5, "auto");

      const id3 = store.startTrajectory("s1", "test3");
      store.completeTrajectory(id3, { finalResponse: "done" });

      const stats = store.getStats();
      expect(stats.total).toBe(3);
      expect(stats.scored).toBe(2);
      expect(stats.synthesized).toBe(1);
    });
  });
});

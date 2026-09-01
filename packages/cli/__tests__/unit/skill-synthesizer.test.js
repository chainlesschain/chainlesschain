/**
 * Unit tests for SkillSynthesizer — auto-generates SKILL.md from
 * high-quality complex execution trajectories.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  TrajectoryStore,
  _deps as trajDeps,
} from "../../src/lib/learning/trajectory-store.js";
import {
  SkillSynthesizer,
  extractToolNames,
  toolChainFingerprint,
  fingerprintsOverlap,
  generateSkillName,
  isSafeSkillName,
  buildExtractionPrompt,
  generateSkillMd,
  _deps as synthDeps,
} from "../../src/lib/learning/skill-synthesizer.js";

function configureTrustedCandidateFs(promises) {
  promises.realpath = vi.fn(async (value) => value);
  promises.lstat = vi.fn(async () => ({
    size: 0,
    isSymbolicLink: () => false,
    isFile: () => false,
    isDirectory: () => true,
  }));
}

describe("skill-synthesizer", () => {
  let db;
  let store;
  let idCounter;

  beforeEach(() => {
    db = new MockDatabase();
    idCounter = 0;
    trajDeps.generateId = vi.fn(() => `traj-${++idCounter}`);
    store = new TrajectoryStore(db);
  });

  // ── extractToolNames ──────────────────────────────

  describe("extractToolNames", () => {
    it("returns unique tool names", () => {
      const names = extractToolNames([
        { tool: "read_file" },
        { tool: "edit_file" },
        { tool: "read_file" },
      ]);
      expect(names).toEqual(["read_file", "edit_file"]);
    });

    it("returns empty array for null/empty input", () => {
      expect(extractToolNames(null)).toEqual([]);
      expect(extractToolNames([])).toEqual([]);
    });
  });

  // ── toolChainFingerprint ──────────────────────────

  describe("toolChainFingerprint", () => {
    it("returns sorted comma-separated tool names", () => {
      const fp = toolChainFingerprint([
        { tool: "edit_file" },
        { tool: "read_file" },
        { tool: "run_shell" },
        { tool: "read_file" },
      ]);
      expect(fp).toBe("edit_file,read_file,run_shell");
    });

    it("returns empty string for empty chain", () => {
      expect(toolChainFingerprint([])).toBe("");
    });
  });

  // ── fingerprintsOverlap ───────────────────────────

  describe("fingerprintsOverlap", () => {
    it("returns true for identical fingerprints", () => {
      expect(fingerprintsOverlap("a,b,c", "a,b,c")).toBe(true);
    });

    it("returns true for high overlap", () => {
      // Jaccard: {a,b,c} ∩ {a,b,d} = {a,b} / {a,b,c,d} = 2/4 = 0.5
      // threshold default 0.7 → false at 0.5
      expect(fingerprintsOverlap("a,b,c", "a,b,d")).toBe(false);
      // {a,b,c} ∩ {a,b,c,d} = 3/4 = 0.75 → true
      expect(fingerprintsOverlap("a,b,c", "a,b,c,d")).toBe(true);
    });

    it("returns false for empty fingerprints", () => {
      expect(fingerprintsOverlap("", "")).toBe(false);
      expect(fingerprintsOverlap("a", "")).toBe(false);
    });

    it("respects custom threshold", () => {
      // {a,b} ∩ {a,c} = {a} / {a,b,c} = 1/3 ≈ 0.33
      expect(fingerprintsOverlap("a,b", "a,c", 0.3)).toBe(true);
      expect(fingerprintsOverlap("a,b", "a,c", 0.5)).toBe(false);
    });
  });

  // ── generateSkillName ─────────────────────────────

  describe("generateSkillName", () => {
    it("converts user intent to kebab-case", () => {
      expect(generateSkillName("Deploy to production")).toBe(
        "deploy-to-production",
      );
    });

    it("limits to 4 words", () => {
      expect(generateSkillName("run all unit tests in parallel mode")).toBe(
        "run-all-unit-tests",
      );
    });

    it("strips special characters", () => {
      expect(generateSkillName("fix bug #123!")).toBe("fix-bug-123");
    });

    it("returns default for empty/null input", () => {
      expect(generateSkillName(null)).toBe("auto-learned-skill");
      expect(generateSkillName("")).toBe("auto-learned-skill");
    });

    it("handles Chinese text", () => {
      const name = generateSkillName("修复登录问题");
      expect(name.length).toBeGreaterThan(0);
      expect(name).not.toBe("auto-learned-skill");
    });
  });

  describe("isSafeSkillName", () => {
    it("accepts ordinary and Unicode names but rejects path traversal", () => {
      expect(isSafeSkillName("deploy-app")).toBe(true);
      expect(isSafeSkillName("修复登录问题")).toBe(true);
      expect(isSafeSkillName("../active-skill")).toBe(false);
      expect(isSafeSkillName("nested/skill")).toBe(false);
    });
  });

  // ── buildExtractionPrompt ─────────────────────────

  describe("buildExtractionPrompt", () => {
    it("builds system + user message pair", () => {
      const messages = buildExtractionPrompt({
        userIntent: "deploy app",
        toolChain: [
          {
            tool: "run_shell",
            args: { cmd: "npm build" },
            status: "completed",
            durationMs: 500,
          },
        ],
        finalResponse: "Deployed successfully",
      });

      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe("system");
      expect(messages[0].content).toContain("skill extraction");
      expect(messages[1].role).toBe("user");
      expect(messages[1].content).toContain("deploy app");
      expect(messages[1].content).toContain("run_shell");
    });

    it("handles empty trajectory", () => {
      const messages = buildExtractionPrompt({});
      expect(messages).toHaveLength(2);
      expect(messages[1].content).toContain("unknown");
    });

    it("truncates long args", () => {
      const longArg = "a".repeat(500);
      const messages = buildExtractionPrompt({
        toolChain: [
          { tool: "t1", args: { data: longArg }, status: "completed" },
        ],
      });
      // Args truncated to 200 chars in JSON.stringify slice
      expect(messages[1].content.length).toBeLessThan(1000);
    });
  });

  // ── generateSkillMd ───────────────────────────────

  describe("generateSkillMd", () => {
    it("generates valid SKILL.md content", () => {
      const md = generateSkillMd(
        {
          name: "deploy-app",
          description: "Deploy application",
          procedure: ["Build the app", "Push to registry", "Deploy"],
          pitfalls: ["Check env vars first"],
          verification: "Curl the health endpoint",
          tools: ["run_shell", "read_file"],
        },
        "traj-1",
        0.85,
      );

      expect(md).toContain("name: deploy-app");
      expect(md).toContain("description: Deploy application");
      expect(md).toContain("version: 1.0.0");
      expect(md).toContain("category: auto-learned");
      expect(md).toContain("tools: [run_shell, read_file]");
      expect(md).toContain("1. Build the app");
      expect(md).toContain("2. Push to registry");
      expect(md).toContain("- Check env vars first");
      expect(md).toContain("Curl the health endpoint");
      expect(md).toContain("Trajectory ID: traj-1");
      expect(md).toContain("Confidence: 0.85");
    });

    it("handles empty/missing fields gracefully", () => {
      const md = generateSkillMd({}, "traj-2");
      expect(md).toContain("auto-learned");
      expect(md).toContain("tools: []");
      expect(md).toContain("1. Follow the extracted workflow");
      expect(md).toContain("None identified yet");
    });
  });

  // ── SkillSynthesizer class ────────────────────────

  describe("SkillSynthesizer.synthesize", () => {
    let mockLLM;
    let mockEvaluator;
    let synthesizer;
    const mockFs = {
      promises: {
        mkdir: vi.fn(async () => {}),
        writeFile: vi.fn(async () => {}),
      },
    };
    const mockPath = {
      join: (...args) => args.join("/"),
    };

    beforeEach(() => {
      mockLLM = vi.fn();
      mockEvaluator = vi.fn(async () => ({ accepted: true }));
      synthDeps.fs = mockFs;
      synthDeps.path = mockPath;
      vi.clearAllMocks();
      mockFs.promises.mkdir.mockResolvedValue(undefined);
      mockFs.promises.writeFile.mockResolvedValue(undefined);
      configureTrustedCandidateFs(mockFs.promises);
    });

    function createScoredTrajectory(tools, score) {
      const id = store.startTrajectory("s1", "test task");
      for (const t of tools) {
        store.appendToolCall(id, {
          tool: t,
          args: {},
          result: "ok",
          durationMs: 10,
          status: "completed",
        });
      }
      store.completeTrajectory(id, { finalResponse: "done" });
      store.setOutcomeScore(id, score, "auto");
      return id;
    }

    it("synthesizes a skill from eligible trajectories", async () => {
      // Create 3 similar trajectories with 6 tools each (>= minToolCount 5)
      const tools = [
        "read_file",
        "edit_file",
        "run_shell",
        "read_file",
        "edit_file",
        "run_shell",
      ];
      createScoredTrajectory(tools, 0.9);
      createScoredTrajectory(tools, 0.85);
      createScoredTrajectory(tools, 0.8);

      mockLLM.mockResolvedValue(
        JSON.stringify({
          name: "edit-and-test",
          description: "Edit files and run tests",
          procedure: ["Read file", "Edit file", "Run tests"],
          pitfalls: ["Check syntax"],
          verification: "Tests pass",
          tools: ["read_file", "edit_file", "run_shell"],
        }),
      );

      synthesizer = new SkillSynthesizer(db, mockLLM, store, {
        minToolCount: 5,
        minScore: 0.7,
        minSimilar: 2,
        candidateOutputDir: "/candidates",
        activeSkillsDirs: ["/skills"],
        evaluateCandidate: mockEvaluator,
      });

      const result = await synthesizer.synthesize();
      expect(result.status).toBe("completed");
      expect(result.created.length).toBeGreaterThanOrEqual(1);
      expect(mockFs.promises.writeFile).toHaveBeenCalled();
      expect(mockEvaluator).toHaveBeenCalled();
    });

    it("fails closed before querying trajectories when required dependencies are absent", async () => {
      const findCandidates = vi.spyOn(store, "findComplexUnprocessed");
      synthesizer = new SkillSynthesizer(db, null, store);

      const result = await synthesizer.synthesize();

      expect(result).toMatchObject({
        status: "unavailable",
        code: "LEARNING_SYNTHESIS_UNAVAILABLE",
        created: [],
        skipped: [],
        missingDependencies: [
          "llm",
          "candidate-output-registry",
          "candidate-evaluator",
          "active-skill-registry-roots",
        ],
      });
      expect(findCandidates).not.toHaveBeenCalled();
    });

    it("rejects a candidate registry that overlaps an active skill tree", async () => {
      const findCandidates = vi.spyOn(store, "findComplexUnprocessed");
      synthesizer = new SkillSynthesizer(db, mockLLM, store, {
        candidateOutputDir: "/skills/candidates",
        activeSkillsDirs: ["/skills"],
        evaluateCandidate: mockEvaluator,
      });

      const result = await synthesizer.synthesize();

      expect(result).toMatchObject({
        status: "unavailable",
        created: [],
        blockers: ["candidate-output-overlaps-active-skill-tree"],
      });
      expect(findCandidates).not.toHaveBeenCalled();
      expect(mockFs.promises.writeFile).not.toHaveBeenCalled();
    });

    it("rejects an incomplete active skill root contract", async () => {
      synthesizer = new SkillSynthesizer(db, mockLLM, store, {
        candidateOutputDir: "/candidates",
        activeSkillsDirs: ["/skills", null],
        evaluateCandidate: mockEvaluator,
      });

      expect(await synthesizer.synthesize()).toMatchObject({
        status: "unavailable",
        blockers: ["active-skill-registry-roots-invalid"],
        created: [],
      });
    });

    it("does not create or persist a candidate rejected by the evaluator", async () => {
      const tools = ["a", "b", "c", "d", "e", "f"];
      createScoredTrajectory(tools, 0.9);
      createScoredTrajectory(tools, 0.85);
      createScoredTrajectory(tools, 0.8);
      mockLLM.mockResolvedValue(
        JSON.stringify({
          name: "rejected-skill",
          procedure: ["Step 1"],
          tools: ["a"],
        }),
      );
      mockEvaluator.mockResolvedValue({
        accepted: false,
        reason: "regression",
      });
      synthesizer = new SkillSynthesizer(db, mockLLM, store, {
        minToolCount: 5,
        minScore: 0.7,
        minSimilar: 2,
        candidateOutputDir: "/candidates",
        activeSkillsDirs: ["/skills"],
        evaluateCandidate: mockEvaluator,
      });

      const result = await synthesizer.synthesize();

      expect(result.created).toEqual([]);
      expect(result.skipped.some((item) => item.includes("regression"))).toBe(
        true,
      );
      expect(mockFs.promises.writeFile).not.toHaveBeenCalled();
      expect(
        store.getRecent({ limit: 10 }).every((t) => !t.synthesizedSkill),
      ).toBe(true);
    });

    it("does not report creation when candidate persistence fails", async () => {
      const tools = ["a", "b", "c", "d", "e", "f"];
      createScoredTrajectory(tools, 0.9);
      createScoredTrajectory(tools, 0.85);
      createScoredTrajectory(tools, 0.8);
      mockLLM.mockResolvedValue(
        JSON.stringify({
          name: "write-failure",
          procedure: ["Step 1"],
          tools: ["a"],
        }),
      );
      mockFs.promises.writeFile.mockRejectedValue(new Error("disk full"));
      synthesizer = new SkillSynthesizer(db, mockLLM, store, {
        minToolCount: 5,
        minScore: 0.7,
        minSimilar: 2,
        candidateOutputDir: "/candidates",
        activeSkillsDirs: ["/skills"],
        evaluateCandidate: mockEvaluator,
      });

      const result = await synthesizer.synthesize();

      expect(result.created).not.toContain("write-failure");
      expect(result.skipped.some((item) => item.includes("disk full"))).toBe(
        true,
      );
    });

    it("skips trajectories with insufficient similar matches", async () => {
      // Only 1 trajectory — needs minSimilar=2
      createScoredTrajectory(["a", "b", "c", "d", "e", "f"], 0.9);

      synthesizer = new SkillSynthesizer(db, mockLLM, store, {
        minToolCount: 5,
        minScore: 0.7,
        minSimilar: 2,
        candidateOutputDir: "/candidates",
        activeSkillsDirs: ["/skills"],
        evaluateCandidate: mockEvaluator,
      });

      const result = await synthesizer.synthesize();
      expect(result.created).toHaveLength(0);
      expect(result.skipped.some((s) => s.includes("insufficient"))).toBe(true);
    });

    it("skips when LLM returns not_applicable", async () => {
      const tools = ["a", "b", "c", "d", "e", "f"];
      createScoredTrajectory(tools, 0.9);
      createScoredTrajectory(tools, 0.85);
      createScoredTrajectory(tools, 0.8);

      mockLLM.mockResolvedValue(JSON.stringify({ not_applicable: true }));

      synthesizer = new SkillSynthesizer(db, mockLLM, store, {
        minToolCount: 5,
        minScore: 0.7,
        minSimilar: 2,
        candidateOutputDir: "/candidates",
        activeSkillsDirs: ["/skills"],
        evaluateCandidate: mockEvaluator,
      });

      const result = await synthesizer.synthesize();
      expect(result.created).toHaveLength(0);
      expect(result.skipped.some((s) => s.includes("not applicable"))).toBe(
        true,
      );
    });

    it("skips duplicate fingerprints", async () => {
      const tools = ["a", "b", "c", "d", "e", "f"];
      const id1 = createScoredTrajectory(tools, 0.9);
      createScoredTrajectory(tools, 0.85);
      createScoredTrajectory(tools, 0.8);

      // Mark first as already synthesized
      store.markSynthesized(id1, "existing-skill");

      mockLLM.mockResolvedValue(
        JSON.stringify({
          name: "new-skill",
          description: "desc",
          procedure: ["Step 1"],
          pitfalls: [],
          verification: "check",
          tools: ["a"],
        }),
      );

      synthesizer = new SkillSynthesizer(db, mockLLM, store, {
        minToolCount: 5,
        minScore: 0.7,
        minSimilar: 2,
        candidateOutputDir: "/candidates",
        activeSkillsDirs: ["/skills"],
        evaluateCandidate: mockEvaluator,
      });

      const result = await synthesizer.synthesize();
      // The remaining trajectories have the same fingerprint as the synthesized one
      expect(result.skipped.some((s) => s.includes("duplicate"))).toBe(true);
    });

    it("reports unavailable without a candidate registry and evaluator", async () => {
      const tools = ["a", "b", "c", "d", "e", "f"];
      createScoredTrajectory(tools, 0.9);
      createScoredTrajectory(tools, 0.85);
      createScoredTrajectory(tools, 0.8);

      mockLLM.mockResolvedValue(
        JSON.stringify({
          name: "mem-skill",
          description: "desc",
          procedure: ["Step 1"],
          pitfalls: [],
          verification: "ok",
          tools: ["a"],
        }),
      );

      synthesizer = new SkillSynthesizer(db, mockLLM, store, {
        minToolCount: 5,
        minScore: 0.7,
        minSimilar: 2,
      });

      const result = await synthesizer.synthesize();
      expect(result).toMatchObject({
        status: "unavailable",
        code: "LEARNING_SYNTHESIS_UNAVAILABLE",
        created: [],
        skipped: [],
        missingDependencies: [
          "candidate-output-registry",
          "candidate-evaluator",
          "active-skill-registry-roots",
        ],
      });
      expect(mockFs.promises.writeFile).not.toHaveBeenCalled();
      expect(mockLLM).not.toHaveBeenCalled();
    });

    it("handles LLM errors gracefully", async () => {
      const tools = ["a", "b", "c", "d", "e", "f"];
      createScoredTrajectory(tools, 0.9);
      createScoredTrajectory(tools, 0.85);
      createScoredTrajectory(tools, 0.8);

      mockLLM.mockRejectedValue(new Error("LLM offline"));

      synthesizer = new SkillSynthesizer(db, mockLLM, store, {
        minToolCount: 5,
        minScore: 0.7,
        minSimilar: 2,
        candidateOutputDir: "/candidates",
        activeSkillsDirs: ["/skills"],
        evaluateCandidate: mockEvaluator,
      });

      const result = await synthesizer.synthesize();
      expect(result.created).toHaveLength(0);
      expect(result.skipped.some((s) => s.includes("error"))).toBe(true);
    });

    it("handles malformed LLM JSON response", async () => {
      const tools = ["a", "b", "c", "d", "e", "f"];
      createScoredTrajectory(tools, 0.9);
      createScoredTrajectory(tools, 0.85);
      createScoredTrajectory(tools, 0.8);

      mockLLM.mockResolvedValue("This is not JSON at all");

      synthesizer = new SkillSynthesizer(db, mockLLM, store, {
        minToolCount: 5,
        minScore: 0.7,
        minSimilar: 2,
        candidateOutputDir: "/candidates",
        activeSkillsDirs: ["/skills"],
        evaluateCandidate: mockEvaluator,
      });

      const result = await synthesizer.synthesize();
      expect(result.created).toHaveLength(0);
    });
  });

  // ── _extractPattern ───────────────────────────────

  describe("SkillSynthesizer._extractPattern", () => {
    it("returns null when llmChat is null", async () => {
      const synth = new SkillSynthesizer(db, null, store);
      const result = await synth._extractPattern({ toolChain: [] });
      expect(result).toBeNull();
    });

    it("parses valid JSON from LLM response", async () => {
      const mockLLM = vi
        .fn()
        .mockResolvedValue(
          'Some text before {"name":"test","procedure":["a"]} and after',
        );
      const synth = new SkillSynthesizer(db, mockLLM, store);
      const result = await synth._extractPattern({ toolChain: [] });
      expect(result).toEqual({ name: "test", procedure: ["a"] });
    });

    it("returns null for non-JSON response", async () => {
      const mockLLM = vi.fn().mockResolvedValue("No JSON here");
      const synth = new SkillSynthesizer(db, mockLLM, store);
      const result = await synth._extractPattern({ toolChain: [] });
      expect(result).toBeNull();
    });
  });

  // ── _isDuplicate ──────────────────────────────────

  describe("SkillSynthesizer._isDuplicate", () => {
    it("returns false when no synthesized trajectories exist", () => {
      const synth = new SkillSynthesizer(db, null, store);
      expect(synth._isDuplicate("a,b,c")).toBe(false);
    });

    it("returns true when a matching synthesized trajectory exists", () => {
      const id = store.startTrajectory("s1", "test");
      store.appendToolCall(id, {
        tool: "a",
        args: {},
        result: "ok",
        durationMs: 0,
        status: "completed",
      });
      store.appendToolCall(id, {
        tool: "b",
        args: {},
        result: "ok",
        durationMs: 0,
        status: "completed",
      });
      store.appendToolCall(id, {
        tool: "c",
        args: {},
        result: "ok",
        durationMs: 0,
        status: "completed",
      });
      store.completeTrajectory(id, { finalResponse: "done" });
      store.markSynthesized(id, "existing");

      const synth = new SkillSynthesizer(db, null, store);
      expect(synth._isDuplicate("a,b,c")).toBe(true);
    });

    it("returns false for non-overlapping fingerprints", () => {
      const id = store.startTrajectory("s1", "test");
      store.appendToolCall(id, {
        tool: "x",
        args: {},
        result: "ok",
        durationMs: 0,
        status: "completed",
      });
      store.appendToolCall(id, {
        tool: "y",
        args: {},
        result: "ok",
        durationMs: 0,
        status: "completed",
      });
      store.completeTrajectory(id, { finalResponse: "done" });
      store.markSynthesized(id, "other");

      const synth = new SkillSynthesizer(db, null, store);
      expect(synth._isDuplicate("a,b,c")).toBe(false);
    });
  });

  // ── _persistSkill ─────────────────────────────────

  describe("SkillSynthesizer._persistSkill", () => {
    it("writes an immutable versioned SKILL.md to the candidate registry", async () => {
      const created = new Set();
      const mockFs = {
        promises: {
          mkdir: vi.fn(async (value) => {
            created.add(value);
          }),
          writeFile: vi.fn(async () => {}),
          lstat: vi.fn(async (value) => {
            if (!created.has(value)) {
              throw Object.assign(new Error("missing"), { code: "ENOENT" });
            }
            return {
              isSymbolicLink: () => false,
              isDirectory: () => true,
            };
          }),
          realpath: vi.fn(async (value) => value),
        },
      };
      synthDeps.fs = mockFs;
      synthDeps.path = { join: (...args) => args.join("/") };

      const synth = new SkillSynthesizer(db, vi.fn(), store, {
        candidateOutputDir: "/out",
        activeSkillsDirs: ["/skills"],
        evaluateCandidate: vi.fn(),
      });
      const result = await synth._persistSkill("my-skill", "# content");

      expect(mockFs.promises.mkdir).toHaveBeenCalledWith(
        "/out/my-skill/1.0.0",
        { recursive: false, mode: 0o700 },
      );
      expect(mockFs.promises.writeFile).toHaveBeenCalledWith(
        "/out/my-skill/1.0.0/SKILL.md",
        "# content",
        { encoding: "utf-8", flag: "wx" },
      );
      expect(result.skillDir).toBe("/out/my-skill/1.0.0");
      expect(result.skillFile).toBe("/out/my-skill/1.0.0/SKILL.md");
    });

    it("fails closed when filesystem identity support is unavailable", async () => {
      const writeFile = vi.fn();
      synthDeps.fs = {
        promises: { mkdir: vi.fn(), writeFile },
      };
      const synth = new SkillSynthesizer(db, vi.fn(), store, {
        candidateOutputDir: "/out",
        activeSkillsDirs: ["/skills"],
        evaluateCandidate: vi.fn(),
      });

      await expect(
        synth._persistSkill("my-skill", "# content"),
      ).rejects.toThrow("filesystem identity support unavailable");
      expect(writeFile).not.toHaveBeenCalled();
    });

    it("rejects a candidate root that resolves into an active skill tree", async () => {
      const writeFile = vi.fn();
      synthDeps.fs = {
        promises: {
          mkdir: vi.fn(),
          writeFile,
          lstat: vi.fn(async () => ({
            isSymbolicLink: () => false,
            isDirectory: () => true,
          })),
          realpath: vi.fn(async () => "/skills"),
        },
      };
      const synth = new SkillSynthesizer(db, vi.fn(), store, {
        candidateOutputDir: "/out",
        activeSkillsDirs: ["/skills"],
        evaluateCandidate: vi.fn(),
      });

      await expect(
        synth._persistSkill("my-skill", "# content"),
      ).rejects.toThrow("resolves into an active skill tree");
      expect(writeFile).not.toHaveBeenCalled();
    });
  });
});

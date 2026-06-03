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
  buildExtractionPrompt,
  generateSkillMd,
  _deps as synthDeps,
} from "../../src/lib/learning/skill-synthesizer.js";

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
      synthDeps.fs = mockFs;
      synthDeps.path = mockPath;
      vi.clearAllMocks();
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
        outputDir: "/skills",
      });

      const result = await synthesizer.synthesize();
      expect(result.created.length).toBeGreaterThanOrEqual(1);
      expect(mockFs.promises.writeFile).toHaveBeenCalled();
    });

    it("skips trajectories with insufficient similar matches", async () => {
      // Only 1 trajectory — needs minSimilar=2
      createScoredTrajectory(["a", "b", "c", "d", "e", "f"], 0.9);

      synthesizer = new SkillSynthesizer(db, mockLLM, store, {
        minToolCount: 5,
        minScore: 0.7,
        minSimilar: 2,
        outputDir: "/skills",
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
        outputDir: "/skills",
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
        outputDir: "/skills",
      });

      const result = await synthesizer.synthesize();
      // The remaining trajectories have the same fingerprint as the synthesized one
      expect(result.skipped.some((s) => s.includes("duplicate"))).toBe(true);
    });

    it("works without outputDir (in-memory only)", async () => {
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
        // no outputDir
      });

      const result = await synthesizer.synthesize();
      expect(result.created).toContain("mem-skill");
      // No file writes
      expect(mockFs.promises.writeFile).not.toHaveBeenCalled();
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
        outputDir: "/skills",
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
        outputDir: "/skills",
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
    it("writes SKILL.md to output directory", async () => {
      const mockFs = {
        promises: {
          mkdir: vi.fn(async () => {}),
          writeFile: vi.fn(async () => {}),
        },
      };
      synthDeps.fs = mockFs;
      synthDeps.path = { join: (...args) => args.join("/") };

      const synth = new SkillSynthesizer(db, null, store, {
        outputDir: "/out",
      });
      const result = await synth._persistSkill("my-skill", "# content");

      expect(mockFs.promises.mkdir).toHaveBeenCalledWith("/out/my-skill", {
        recursive: true,
      });
      expect(mockFs.promises.writeFile).toHaveBeenCalledWith(
        "/out/my-skill/SKILL.md",
        "# content",
        "utf-8",
      );
      expect(result.skillDir).toBe("/out/my-skill");
      expect(result.skillFile).toBe("/out/my-skill/SKILL.md");
    });
  });
});

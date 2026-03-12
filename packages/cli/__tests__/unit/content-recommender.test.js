import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  CLIContentRecommender,
  _deps,
} from "../../src/lib/content-recommender.js";

describe("CLIContentRecommender", () => {
  let recommender;
  let originalDeps;

  beforeEach(() => {
    originalDeps = { ..._deps };
    recommender = new CLIContentRecommender();
  });

  afterEach(() => {
    Object.assign(_deps, originalDeps);
  });

  // ── buildToolFeatures ──

  describe("buildToolFeatures", () => {
    it("builds TF-IDF features for tools", () => {
      recommender.buildToolFeatures([
        { name: "read_file", description: "Read a file from the filesystem" },
        {
          name: "write_file",
          description: "Write content to a file on the filesystem",
        },
        {
          name: "run_shell",
          description: "Execute a shell command in the terminal",
        },
      ]);

      expect(recommender._toolFeatures.size).toBe(3);
      expect(recommender._toolFeatures.has("read_file")).toBe(true);
    });

    it("handles empty tools array", () => {
      recommender.buildToolFeatures([]);
      expect(recommender._toolFeatures.size).toBe(0);
    });

    it("handles null input", () => {
      recommender.buildToolFeatures(null);
      expect(recommender._toolFeatures.size).toBe(0);
    });
  });

  // ── calculateSimilarity ──

  describe("calculateSimilarity", () => {
    it("returns similarity between related tools", () => {
      recommender.buildToolFeatures([
        { name: "read_file", description: "Read a file from the filesystem" },
        {
          name: "write_file",
          description: "Write content to a file on the filesystem",
        },
        {
          name: "run_shell",
          description: "Execute a command in the shell terminal",
        },
      ]);

      const filesSim = recommender.calculateSimilarity(
        "read_file",
        "write_file",
      );
      const fileCmdSim = recommender.calculateSimilarity(
        "read_file",
        "run_shell",
      );

      // File tools should be more similar to each other than to shell
      expect(filesSim).toBeGreaterThan(0);
      expect(filesSim).toBeGreaterThan(fileCmdSim);
    });

    it("returns 0 for unknown tools", () => {
      expect(recommender.calculateSimilarity("unknown1", "unknown2")).toBe(0);
    });

    it("returns 0 when one tool is unknown", () => {
      recommender.buildToolFeatures([
        { name: "read_file", description: "Read a file" },
      ]);
      expect(recommender.calculateSimilarity("read_file", "unknown")).toBe(0);
    });
  });

  // ── recordToolUse ──

  describe("recordToolUse", () => {
    it("records tool usage", () => {
      recommender.recordToolUse("read_file");
      expect(recommender._toolUsageLog.length).toBe(1);
    });

    it("builds chain frequency from consecutive uses", () => {
      recommender.recordToolUse("read_file");
      recommender.recordToolUse("edit_file");
      recommender.recordToolUse("run_shell");

      expect(recommender._chainFrequency.get("read_file→edit_file")).toBe(1);
      expect(recommender._chainFrequency.get("edit_file→run_shell")).toBe(1);
    });

    it("increments chain frequency for repeated patterns", () => {
      for (let i = 0; i < 3; i++) {
        recommender.recordToolUse("read_file");
        recommender.recordToolUse("edit_file");
      }

      expect(recommender._chainFrequency.get("read_file→edit_file")).toBe(3);
    });

    it("bounds the log at 1000", () => {
      for (let i = 0; i < 1100; i++) {
        recommender.recordToolUse("tool_" + (i % 5));
      }
      expect(recommender._toolUsageLog.length).toBeLessThanOrEqual(1000);
    });
  });

  // ── recommendNextTool ──

  describe("recommendNextTool", () => {
    it("recommends based on chain frequency", () => {
      // Build pattern: read_file → edit_file (3x), read_file → write_file (1x)
      for (let i = 0; i < 3; i++) {
        recommender.recordToolUse("read_file");
        recommender.recordToolUse("edit_file");
      }
      recommender.recordToolUse("read_file");
      recommender.recordToolUse("write_file");

      const recs = recommender.recommendNextTool("read_file");
      expect(recs.length).toBeGreaterThan(0);
      expect(recs[0].tool).toBe("edit_file");
      expect(recs[0].confidence).toBe(0.75); // 3/4
    });

    it("returns empty for tool with no history", () => {
      const recs = recommender.recommendNextTool("unknown_tool");
      expect(recs).toEqual([]);
    });

    it("limits recommendations to 5", () => {
      // Create many chains from same tool
      for (let i = 0; i < 10; i++) {
        recommender.recordToolUse("start_tool");
        recommender.recordToolUse("target_" + i);
      }

      const recs = recommender.recommendNextTool("start_tool");
      expect(recs.length).toBeLessThanOrEqual(5);
    });
  });

  // ── recommendSkill ──

  describe("recommendSkill", () => {
    it("recommends skills matching query", () => {
      const skills = [
        {
          id: "code-review",
          description: "Review code for issues and improvements",
          category: "development",
        },
        {
          id: "summarize",
          description: "Summarize text content",
          category: "writing",
        },
        {
          id: "translate",
          description: "Translate text between languages",
          category: "writing",
        },
      ];

      const recs = recommender.recommendSkill("review my code", skills);
      expect(recs.length).toBeGreaterThan(0);
      expect(recs[0].skillId).toBe("code-review");
    });

    it("returns empty for no matches", () => {
      const skills = [
        {
          id: "code-review",
          description: "Review code",
          category: "development",
        },
      ];

      const recs = recommender.recommendSkill("", skills);
      expect(recs).toEqual([]);
    });

    it("returns empty for empty skills", () => {
      expect(recommender.recommendSkill("test", [])).toEqual([]);
    });
  });

  // ── getChainStats ──

  describe("getChainStats", () => {
    it("returns empty stats initially", () => {
      const stats = recommender.getChainStats();
      expect(stats.totalUsages).toBe(0);
      expect(stats.uniqueChains).toBe(0);
      expect(stats.topChains).toEqual([]);
    });

    it("returns correct stats after usage", () => {
      recommender.recordToolUse("read_file");
      recommender.recordToolUse("edit_file");
      recommender.recordToolUse("run_shell");

      const stats = recommender.getChainStats();
      expect(stats.totalUsages).toBe(3);
      expect(stats.uniqueChains).toBe(2);
    });
  });

  // ── getSimilarityMatrix ──

  describe("getSimilarityMatrix", () => {
    it("returns matrix of tool similarities", () => {
      recommender.buildToolFeatures([
        { name: "read_file", description: "Read a file" },
        { name: "write_file", description: "Write a file" },
      ]);

      const matrix = recommender.getSimilarityMatrix();
      expect(matrix).toHaveProperty("read_file");
      expect(matrix).toHaveProperty("write_file");
      expect(matrix.read_file).toHaveProperty("write_file");
    });
  });
});

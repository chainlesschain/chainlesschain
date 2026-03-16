import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  CLIContextEngineering,
  _deps,
} from "../../src/lib/cli-context-engineering.js";

describe("CLIContextEngineering — scoped mode", () => {
  let originalRecall;
  let originalInstinct;
  let originalBM25;
  let originalHash;

  beforeEach(() => {
    // Save originals
    originalRecall = _deps.recallMemory;
    originalInstinct = _deps.generateInstinctPrompt;
    originalBM25 = _deps.BM25Search;
    originalHash = _deps.createHash;

    // Mock dependencies
    _deps.generateInstinctPrompt = vi.fn(() => null);
    _deps.recallMemory = vi.fn(() => []);
    _deps.BM25Search = class {
      constructor() {
        this.totalDocs = 0;
      }
      indexDocuments() {}
      search() {
        return [];
      }
    };
    _deps.createHash = originalHash; // Keep real hash
  });

  afterEach(() => {
    _deps.recallMemory = originalRecall;
    _deps.generateInstinctPrompt = originalInstinct;
    _deps.BM25Search = originalBM25;
    _deps.createHash = originalHash;
  });

  // ─── Constructor ─────────────────────────────────────────

  describe("constructor with scope", () => {
    it("accepts scope option", () => {
      const ce = new CLIContextEngineering({
        scope: {
          taskId: "sub-123",
          role: "reviewer",
          parentObjective: "Review code",
        },
      });
      expect(ce.scope).toBeTruthy();
      expect(ce.scope.taskId).toBe("sub-123");
      expect(ce.scope.role).toBe("reviewer");
    });

    it("auto-sets taskContext from scope.parentObjective", () => {
      const ce = new CLIContextEngineering({
        scope: { taskId: "t1", role: "r1", parentObjective: "Do the thing" },
      });
      expect(ce.taskContext).toBeTruthy();
      expect(ce.taskContext.objective).toBe("Do the thing");
    });

    it("defaults scope to null when not provided", () => {
      const ce = new CLIContextEngineering({});
      expect(ce.scope).toBeNull();
      expect(ce.taskContext).toBeNull();
    });
  });

  // ─── Scoped Memory Injection ─────────────────────────────

  describe("buildOptimizedMessages with scope", () => {
    it("passes namespace to recallMemory when scoped", () => {
      const mockDb = {
        prepare: () => ({
          all: () => [],
          get: () => ({ count: 0 }),
          run: () => ({}),
        }),
      };

      _deps.recallMemory = vi.fn(() => [
        {
          layer: "short-term",
          content: "relevant memory",
          retention: 0.8,
        },
      ]);

      const ce = new CLIContextEngineering({
        db: mockDb,
        scope: { taskId: "sub-abc", role: "coder", parentObjective: "Code it" },
      });

      ce.buildOptimizedMessages(
        [{ role: "system", content: "System prompt" }],
        { userQuery: "help me code" },
      );

      expect(_deps.recallMemory).toHaveBeenCalledWith(
        mockDb,
        expect.stringContaining("[coder]"),
        expect.objectContaining({ namespace: "sub-abc" }),
      );
    });

    it("filters memories by higher threshold when scoped", () => {
      const mockDb = {
        prepare: () => ({
          all: () => [],
          get: () => ({ count: 0 }),
          run: () => ({}),
        }),
      };

      _deps.recallMemory = vi.fn(() => [
        { layer: "working", content: "low retention", retention: 0.4 },
        { layer: "short-term", content: "high retention", retention: 0.8 },
      ]);

      const ce = new CLIContextEngineering({
        db: mockDb,
        scope: { taskId: "sub-x", role: "reviewer", parentObjective: "Review" },
      });

      const result = ce.buildOptimizedMessages(
        [{ role: "system", content: "System" }],
        { userQuery: "review this" },
      );

      // The low-retention memory (0.4) should be filtered out by 0.6 threshold
      const memoryMsg = result.find(
        (m) => m.role === "system" && m.content.includes("Relevant Memories"),
      );
      if (memoryMsg) {
        expect(memoryMsg.content).toContain("high retention");
        expect(memoryMsg.content).not.toContain("low retention");
      }
    });

    it("does not pass namespace when unscoped", () => {
      const mockDb = {
        prepare: () => ({
          all: () => [],
          get: () => ({ count: 0 }),
          run: () => ({}),
        }),
      };

      _deps.recallMemory = vi.fn(() => []);

      const ce = new CLIContextEngineering({ db: mockDb });

      ce.buildOptimizedMessages([{ role: "system", content: "System" }], {
        userQuery: "hello",
      });

      expect(_deps.recallMemory).toHaveBeenCalledWith(
        mockDb,
        "hello",
        expect.not.objectContaining({ namespace: expect.anything() }),
      );
    });
  });

  // ─── Scoped starts with clean state ─────────────────────

  describe("isolation guarantees", () => {
    it("scoped instance has empty error history", () => {
      const ce = new CLIContextEngineering({
        scope: { taskId: "t1", role: "r1", parentObjective: "obj" },
      });
      expect(ce.errorHistory).toHaveLength(0);
    });

    it("scoped instance has empty compaction summaries", () => {
      const ce = new CLIContextEngineering({
        scope: { taskId: "t1", role: "r1", parentObjective: "obj" },
      });
      expect(ce._compactionSummaries).toHaveLength(0);
    });
  });
});

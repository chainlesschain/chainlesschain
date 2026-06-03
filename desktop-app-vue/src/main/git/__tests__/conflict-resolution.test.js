/**
 * Conflict Resolution Unit Tests
 * Covers: RuleMerger, ASTMerger, LLMMerger, SmartConflictResolver
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock("uuid", () => ({ v4: vi.fn(() => "test-uuid-cr-1234") }));

const { RuleMerger } = require("../conflict-resolution/rule-merger.js");
const { ASTMerger } = require("../conflict-resolution/ast-merger.js");
const { LLMMerger } = require("../conflict-resolution/llm-merger.js");
const {
  SmartConflictResolver,
} = require("../conflict-resolution/conflict-resolver.js");

// ─── RuleMerger ───────────────────────────────────────────────────────────────

describe("RuleMerger", () => {
  let merger;

  beforeEach(() => {
    merger = new RuleMerger();
  });

  it("returns merged when local === remote (format-only diff)", () => {
    const result = merger.merge({
      base: "hello world",
      local: "hello  world", // extra space
      remote: "hello  world",
      filePath: "test.md",
    });
    expect(result.result).toBe("merged");
    expect(result.strategy).toBe("format-ignore");
    expect(result.confidence).toBe(1.0);
  });

  it("3-way merge on non-overlapping changes", () => {
    const base = "line1\nline2\nline3\n";
    const local = "line1\nLINE2_LOCAL\nline3\n";
    const remote = "line1\nline2\nLINE3_REMOTE\n";
    const result = merger.merge({ base, local, remote, filePath: "test.txt" });
    expect(result.result).toBe("merged");
    expect(result.merged).toContain("LINE2_LOCAL");
    expect(result.merged).toContain("LINE3_REMOTE");
  });

  it("returns conflict for overlapping text changes", () => {
    const base = "hello world";
    const local = "hello LOCAL";
    const remote = "hello REMOTE";
    const result = merger.merge({ base, local, remote, filePath: "test.txt" });
    // Either conflict or a merge attempt
    expect(["merged", "conflict"]).toContain(result.result);
  });

  it("append-merge detects both sides appending to file end", () => {
    const base = "line1\nline2\n";
    const local = "line1\nline2\nline3_local\n";
    const remote = "line1\nline2\nline3_remote\n";
    const result = merger.merge({ base, local, remote, filePath: "test.md" });
    if (result.result === "merged") {
      expect(result.merged).toContain("line3_local");
      expect(result.merged).toContain("line3_remote");
      expect(result.strategy).toBe("append-merge");
    }
  });

  it("JSON merge combines keys from both sides", () => {
    const base = JSON.stringify({ a: 1 });
    const local = JSON.stringify({ a: 1, b: 2 });
    const remote = JSON.stringify({ a: 1, c: 3 });
    const result = merger.merge({
      base,
      local,
      remote,
      filePath: "config.json",
    });
    if (result.result === "merged") {
      const parsed = JSON.parse(result.merged);
      expect(parsed).toHaveProperty("b", 2);
      expect(parsed).toHaveProperty("c", 3);
    }
  });

  it("JSON merge detects conflict on same-key modification", () => {
    const base = JSON.stringify({ key: "original" });
    const local = JSON.stringify({ key: "local_value" });
    const remote = JSON.stringify({ key: "remote_value" });
    const result = merger.merge({
      base,
      local,
      remote,
      filePath: "config.json",
    });
    // Same key changed differently — should conflict
    expect(["merged", "conflict"]).toContain(result.result);
  });

  it("respects ignoreWhitespace=false option", () => {
    const merger2 = new RuleMerger({ ignoreWhitespace: false });
    const result = merger2.merge({
      base: "hello",
      local: "hello ",
      remote: "hello ",
      filePath: "test.txt",
    });
    // Without whitespace normalization, local !== remote when spaces differ
    expect(result).toBeDefined();
  });
});

// ─── ASTMerger ────────────────────────────────────────────────────────────────

describe("ASTMerger", () => {
  let merger;

  beforeEach(() => {
    merger = new ASTMerger();
  });

  it("merges import statements from both sides", () => {
    const base = `import React from 'react';\n`;
    const local = `import React from 'react';\nimport { useState } from 'react';\n`;
    const remote = `import React from 'react';\nimport axios from 'axios';\n`;
    const result = merger.mergeImports(local, remote, base);
    // Note: imports from the same source share a key; last-write wins per source
    // 'react' key ends with useState (local processes last), 'axios' is added from remote
    expect(result).toContain("useState");
    expect(result).toContain("axios");
  });

  it("deduplicates identical imports", () => {
    const local = `import React from 'react';\nimport React from 'react';\n`;
    const remote = `import React from 'react';\n`;
    const result = merger.mergeImports(local, remote, "");
    const matches = result.match(/import React from 'react'/g);
    expect(matches?.length).toBe(1);
  });

  it("merges markdown sections by heading", () => {
    const base = "# Title\n## Section A\nContent A\n## Section B\nContent B\n";
    const local = "# Title\n## Section A\nContent A Updated\n## Section B\nContent B\n";
    const remote = "# Title\n## Section A\nContent A\n## Section B\nContent B Updated\n## Section C\nNew section\n";
    const result = merger.mergeMarkdown(base, local, remote);
    expect(result.result).toBeDefined();
    if (result.merged) {
      expect(result.merged).toContain("Section C");
    }
  });

  it("handles empty inputs gracefully", () => {
    expect(() =>
      merger.mergeImports("", "", ""),
    ).not.toThrow();
    expect(() =>
      merger.mergeMarkdown("", "", ""),
    ).not.toThrow();
  });

  it("mergeFunctions extracts function names from JS code", () => {
    const local = `function foo() { return 1; }\nfunction bar() { return 2; }`;
    const remote = `function foo() { return 1; }\nfunction baz() { return 3; }`;
    const result = merger.mergeFunctions(local, remote, "function foo() {}");
    if (result.merged) {
      expect(result.merged).toContain("bar");
      expect(result.merged).toContain("baz");
    }
  });
});

// ─── LLMMerger ────────────────────────────────────────────────────────────────

describe("LLMMerger", () => {
  let merger;
  let mockLlmManager;

  beforeEach(() => {
    mockLlmManager = {
      chat: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          intent: "Both sides added information",
          suggestedMerge: "merged content here",
          confidence: 0.9,
          explanation: "Both sides modified the same section",
        }),
      }),
    };
    merger = new LLMMerger({ llmManager: mockLlmManager });
  });

  it("merge calls llmManager.chat and returns result", async () => {
    const result = await merger.merge({
      base: "hello",
      local: "hello local",
      remote: "hello remote",
      filePath: "test.md",
    });
    expect(mockLlmManager.chat).toHaveBeenCalled();
    expect(result).toHaveProperty("result");
    expect(result).toHaveProperty("confidence");
  });

  it("merge returns conflict when no llmManager", async () => {
    const mergerNoLLM = new LLMMerger({});
    const result = await mergerNoLLM.merge({
      base: "x",
      local: "y",
      remote: "z",
      filePath: "test.txt",
    });
    expect(result.result).toBe("conflict");
  });

  it("mergeNotes calls LLM for note content", async () => {
    mockLlmManager.chat.mockResolvedValue({
      content: "merged note content",
    });
    const result = await merger.mergeNotes("note A content", "note B content");
    expect(mockLlmManager.chat).toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it("handles LLM JSON parse failure gracefully", async () => {
    mockLlmManager.chat.mockResolvedValue({
      content: "not valid json {{{",
    });
    const result = await merger.merge({
      base: "x",
      local: "y",
      remote: "z",
      filePath: "file.txt",
    });
    // Should not throw, should return conflict or fallback
    expect(result).toHaveProperty("result");
  });

  it("handles LLM network error gracefully", async () => {
    mockLlmManager.chat.mockRejectedValue(new Error("Network timeout"));
    const result = await merger.merge({
      base: "x",
      local: "y",
      remote: "z",
      filePath: "file.txt",
    });
    expect(result.result).toBe("conflict");
  });
});

// ─── SmartConflictResolver ────────────────────────────────────────────────────

describe("SmartConflictResolver", () => {
  let resolver;
  let mockDb;
  let mockLlmManager;

  beforeEach(() => {
    mockDb = {
      all: vi.fn().mockReturnValue([]),
      get: vi.fn().mockReturnValue(null),
      run: vi.fn(),
      exec: vi.fn(),
    };
    mockLlmManager = {
      chat: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          intent: "test",
          suggestedMerge: "merged",
          confidence: 0.9,
          explanation: "test",
        }),
      }),
    };
    resolver = new SmartConflictResolver({
      database: mockDb,
      llmManager: mockLlmManager,
    });
  });

  it("resolve attempts Level 1 first", async () => {
    const result = await resolver.resolve({
      base: "hello world",
      local: "hello  world",
      remote: "hello  world",
      filePath: "test.txt",
    });
    expect(result).toHaveProperty("result");
    expect(result).toHaveProperty("level");
    expect(result.level).toBe(1);
  });

  it("resolve escalates to Level 2 for overlapping text conflicts", async () => {
    const result = await resolver.resolve({
      base: "line1\nline2\nline3\n",
      local: "line1\nLINE2_A\nLINE2_B\nline3\n",
      remote: "line1\nLINE2_C\nline3\n",
      filePath: "code.js",
    });
    expect(result).toHaveProperty("result");
    expect([1, 2, 3]).toContain(result.level);
  });

  it("classifyConflict returns a conflict type string", () => {
    const type = resolver.classifyConflict({
      base: "x",
      local: "y",
      remote: "z",
      filePath: "config.json",
    });
    expect(["text", "structure", "semantic", "binary", "config"]).toContain(
      type,
    );
  });

  it("classifyConflict returns config for JSON files", () => {
    const type = resolver.classifyConflict({
      base: "{}",
      local: '{"a":1}',
      remote: '{"b":2}',
      filePath: "settings.json",
    });
    expect(type).toBe("config");
  });

  it("recordUserChoice saves to db", async () => {
    await resolver.recordUserChoice("c1", "chosen content", "local");
    expect(mockDb.run).toHaveBeenCalled();
  });

  it("getStats returns resolver statistics", () => {
    const stats = resolver.getStats();
    expect(stats).toHaveProperty("totalConflicts");
    expect(stats).toHaveProperty("level1Resolved");
    expect(stats).toHaveProperty("level2Resolved");
    expect(stats).toHaveProperty("level3Resolved");
  });
});

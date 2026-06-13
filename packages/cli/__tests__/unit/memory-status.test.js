/**
 * `/memory` REPL command (Claude-Code parity) — render the project-memory
 * files (loadProjectInstructions result) auto-loaded into the system prompt.
 */
import { describe, it, expect } from "vitest";
import { renderMemoryFiles } from "../../src/repl/memory-status.js";

describe("renderMemoryFiles", () => {
  it("lists files with scope, path, bytes, and a total + precedence note", () => {
    const out = renderMemoryFiles({
      files: [
        { path: "/proj/cc.md", scope: "project", bytes: 1200 },
        { path: "/proj/.claude/rules/cli.md", scope: "rule", bytes: 800 },
      ],
      warnings: [],
    });
    expect(out).toContain("Project memory (auto-loaded");
    expect(out).toContain("[project] /proj/cc.md  1200B");
    expect(out).toContain("[rule   ] /proj/.claude/rules/cli.md  800B");
    expect(out).toContain("2 file(s), 2000B total");
    expect(out).toContain("precedence cc.md > CLAUDE.md > AGENTS.md");
  });

  it("flags truncation and surfaces warnings", () => {
    const out = renderMemoryFiles({
      files: [
        {
          path: "/proj/CLAUDE.md",
          scope: "project",
          bytes: 48000,
          truncated: true,
        },
      ],
      warnings: ["budget exhausted — remaining files skipped"],
    });
    expect(out).toContain("(truncated)");
    expect(out).toContain("⚠ budget exhausted");
  });

  it("notes when project memory is disabled", () => {
    const out = renderMemoryFiles(
      { files: [{ path: "/proj/cc.md", scope: "project", bytes: 10 }] },
      { enabled: false },
    );
    expect(out).toContain("⚠ disabled via CC_PROJECT_MEMORY=0");
    // still lists what WOULD load
    expect(out).toContain("/proj/cc.md");
  });

  it("handles no files / malformed input", () => {
    expect(renderMemoryFiles({ files: [] })).toContain("(none found");
    expect(renderMemoryFiles(null)).toContain("(none found");
    expect(renderMemoryFiles(undefined)).toContain("Project memory");
  });
});

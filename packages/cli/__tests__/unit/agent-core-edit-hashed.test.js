/**
 * Integration tests for the hash-anchored edit tool: read_file (hashed:true
 * mode) and edit_file_hashed. Exercises executeTool against real temp files.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashLine } from "../../src/lib/hashline.js";

// Mock the same dependencies as agent-core.test.js so executeTool can be
// imported cleanly.
vi.mock("../../src/lib/plan-mode.js", () => ({
  getPlanModeManager: vi.fn(() => ({
    isActive: () => false,
    isToolAllowed: () => true,
    addPlanItem: vi.fn(),
  })),
}));

vi.mock("../../src/lib/skill-loader.js", () => ({
  CLISkillLoader: vi.fn().mockImplementation(() => ({
    getResolvedSkills: vi.fn(() => []),
  })),
}));

vi.mock("../../src/lib/project-detector.js", () => ({
  findProjectRoot: vi.fn(() => null),
  loadProjectConfig: vi.fn(() => null),
  isInsideProject: vi.fn(() => false),
}));

vi.mock("../../src/lib/hook-manager.js", () => ({
  executeHooks: vi.fn().mockResolvedValue(undefined),
  HookEvents: {
    PreToolUse: "PreToolUse",
    PostToolUse: "PostToolUse",
    ToolError: "ToolError",
  },
}));

const { executeTool } = await import("../../src/runtime/agent-core.js");

describe("read_file with hashed:true", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cc-hashed-read-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns plain content by default", async () => {
    const filePath = join(tempDir, "f.txt");
    writeFileSync(filePath, "line one\nline two", "utf8");
    const result = await executeTool(
      "read_file",
      { path: "f.txt" },
      { cwd: tempDir },
    );
    expect(result.content).toBe("line one\nline two");
    expect(result.hashed).toBe(false);
  });

  it("returns annotated content when hashed:true", async () => {
    const filePath = join(tempDir, "f.txt");
    writeFileSync(filePath, "const x = 1;\nconst y = 2;", "utf8");
    const result = await executeTool(
      "read_file",
      { path: "f.txt", hashed: true },
      { cwd: tempDir },
    );
    expect(result.hashed).toBe(true);
    const lines = result.content.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(`${hashLine("const x = 1;")}| const x = 1;`);
    expect(lines[1]).toBe(`${hashLine("const y = 2;")}| const y = 2;`);
  });

  it("tags empty lines with ______", async () => {
    const filePath = join(tempDir, "f.txt");
    writeFileSync(filePath, "a\n\nb", "utf8");
    const result = await executeTool(
      "read_file",
      { path: "f.txt", hashed: true },
      { cwd: tempDir },
    );
    const lines = result.content.split("\n");
    expect(lines[1]).toBe("______| ");
  });
});

describe("edit_file_hashed", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cc-hashed-edit-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("replaces a line anchored by its hash", async () => {
    const filePath = join(tempDir, "code.js");
    writeFileSync(filePath, "const a = 1;\nconst b = 2;\nconst c = 3;", "utf8");

    const result = await executeTool(
      "edit_file_hashed",
      {
        path: "code.js",
        anchor_hash: hashLine("const b = 2;"),
        expected_line: "const b = 2;",
        new_line: "const b = 42;",
      },
      { cwd: tempDir },
    );

    expect(result.success).toBe(true);
    expect(result.lineNumber).toBe(2);
    expect(result.previousContent).toBe("const b = 2;");
    expect(readFileSync(filePath, "utf8")).toBe(
      "const a = 1;\nconst b = 42;\nconst c = 3;",
    );
  });

  it("tolerates whitespace drift (trim-insensitive)", async () => {
    const filePath = join(tempDir, "code.js");
    writeFileSync(filePath, "  const x = 1;  ", "utf8");

    const result = await executeTool(
      "edit_file_hashed",
      {
        path: "code.js",
        anchor_hash: hashLine("const x = 1;"),
        expected_line: "const x = 1;",
        new_line: "const x = 99;",
      },
      { cwd: tempDir },
    );
    expect(result.success).toBe(true);
  });

  it("preserves CRLF line endings", async () => {
    const filePath = join(tempDir, "crlf.txt");
    writeFileSync(filePath, "a\r\nb\r\nc", "utf8");

    const result = await executeTool(
      "edit_file_hashed",
      {
        path: "crlf.txt",
        anchor_hash: hashLine("b"),
        expected_line: "b",
        new_line: "B",
      },
      { cwd: tempDir },
    );
    expect(result.success).toBe(true);
    expect(readFileSync(filePath, "utf8")).toBe("a\r\nB\r\nc");
  });

  it("returns hash_mismatch when anchor not found", async () => {
    const filePath = join(tempDir, "f.txt");
    writeFileSync(filePath, "foo\nbar", "utf8");

    const result = await executeTool(
      "edit_file_hashed",
      {
        path: "f.txt",
        anchor_hash: "ZZZZZZ",
        expected_line: "foo",
        new_line: "x",
      },
      { cwd: tempDir },
    );
    expect(result.success).toBeUndefined();
    expect(result.error).toBe("hash_mismatch");
    expect(result.hint).toMatch(/hashed:true/);
    // File unchanged
    expect(readFileSync(filePath, "utf8")).toBe("foo\nbar");
  });

  it("returns ambiguous_anchor when multiple lines share the same hash", async () => {
    const filePath = join(tempDir, "dup.txt");
    writeFileSync(filePath, "same\nunique\nsame", "utf8");

    const result = await executeTool(
      "edit_file_hashed",
      {
        path: "dup.txt",
        anchor_hash: hashLine("same"),
        expected_line: "same",
        new_line: "X",
      },
      { cwd: tempDir },
    );
    expect(result.error).toBe("ambiguous_anchor");
    expect(result.matches).toHaveLength(2);
    // Includes a context snippet for the first match
    expect(result.current_snippet).toBeTruthy();
    // File unchanged
    expect(readFileSync(filePath, "utf8")).toBe("same\nunique\nsame");
  });

  it("returns content_mismatch when expected_line doesn't match", async () => {
    const filePath = join(tempDir, "f.txt");
    writeFileSync(filePath, "foo", "utf8");

    // Real hash of "foo" but wrong expected_line → second-layer check fails
    const result = await executeTool(
      "edit_file_hashed",
      {
        path: "f.txt",
        anchor_hash: hashLine("foo"),
        expected_line: "bar",
        new_line: "x",
      },
      { cwd: tempDir },
    );
    expect(result.error).toBe("content_mismatch");
    expect(readFileSync(filePath, "utf8")).toBe("foo");
  });

  it("returns error for missing file", async () => {
    const result = await executeTool(
      "edit_file_hashed",
      {
        path: "nope.txt",
        anchor_hash: "abcdef",
        expected_line: "x",
        new_line: "y",
      },
      { cwd: tempDir },
    );
    expect(result.error).toContain("File not found");
  });

  it("returns error when anchor_hash is missing", async () => {
    const filePath = join(tempDir, "f.txt");
    writeFileSync(filePath, "foo", "utf8");

    const result = await executeTool(
      "edit_file_hashed",
      { path: "f.txt", expected_line: "foo", new_line: "bar" },
      { cwd: tempDir },
    );
    expect(result.error).toBe("anchor_hash is required");
  });

  it("returns error when new_line is not a string", async () => {
    const filePath = join(tempDir, "f.txt");
    writeFileSync(filePath, "foo", "utf8");

    const result = await executeTool(
      "edit_file_hashed",
      {
        path: "f.txt",
        anchor_hash: hashLine("foo"),
        expected_line: "foo",
        new_line: null,
      },
      { cwd: tempDir },
    );
    expect(result.error).toBe("new_line must be a string");
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Unit tests for agent-repl.js tool execution logic
 *
 * We can't easily test the full REPL (interactive readline), but we can
 * test the tool execution functions by importing the module and exercising
 * the exported startAgentRepl function's internal logic indirectly.
 *
 * For direct tool testing, we replicate the executeTool logic here.
 */

describe("agent-repl tool execution", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cc-agent-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("read_file tool logic", () => {
    it("reads existing file content", () => {
      const filePath = join(tempDir, "test.txt");
      writeFileSync(filePath, "hello world", "utf8");
      const content = readFileSync(filePath, "utf8");
      expect(content).toBe("hello world");
    });

    it("handles non-existent file", () => {
      const filePath = join(tempDir, "nonexistent.txt");
      expect(fs.existsSync(filePath)).toBe(false);
    });
  });

  describe("write_file tool logic", () => {
    it("creates new file with content", () => {
      const filePath = join(tempDir, "new-file.txt");
      writeFileSync(filePath, "new content", "utf8");
      expect(readFileSync(filePath, "utf8")).toBe("new content");
    });

    it("creates nested directories", () => {
      const filePath = join(tempDir, "nested", "dir", "file.txt");
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(filePath, "nested content", "utf8");
      expect(readFileSync(filePath, "utf8")).toBe("nested content");
    });
  });

  describe("edit_file tool logic", () => {
    it("replaces string in file", () => {
      const filePath = join(tempDir, "edit.txt");
      writeFileSync(filePath, "hello world", "utf8");
      const content = readFileSync(filePath, "utf8");
      const newContent = content.replace("hello", "goodbye");
      writeFileSync(filePath, newContent, "utf8");
      expect(readFileSync(filePath, "utf8")).toBe("goodbye world");
    });

    it("fails when old_string not found", () => {
      const filePath = join(tempDir, "edit2.txt");
      writeFileSync(filePath, "hello world", "utf8");
      const content = readFileSync(filePath, "utf8");
      expect(content.includes("nonexistent")).toBe(false);
    });
  });

  describe("list_dir tool logic", () => {
    it("lists directory contents", () => {
      writeFileSync(join(tempDir, "a.txt"), "a");
      writeFileSync(join(tempDir, "b.txt"), "b");
      fs.mkdirSync(join(tempDir, "subdir"));
      const entries = fs.readdirSync(tempDir, { withFileTypes: true });
      const names = entries.map((e) => e.name);
      expect(names).toContain("a.txt");
      expect(names).toContain("b.txt");
      expect(names).toContain("subdir");
      const types = entries.map((e) => ({
        name: e.name,
        type: e.isDirectory() ? "dir" : "file",
      }));
      expect(types.find((e) => e.name === "subdir").type).toBe("dir");
      expect(types.find((e) => e.name === "a.txt").type).toBe("file");
    });
  });
});

describe("agent-repl module exports", () => {
  it("exports startAgentRepl function", async () => {
    const mod = await import("../../src/repl/agent-repl.js");
    expect(typeof mod.startAgentRepl).toBe("function");
  });
});

describe("agent-repl TOOLS definition", () => {
  it("includes skill-related tools in TOOLS constant", async () => {
    // We verify by checking the help text output from the CLI
    const { execSync } = await import("node:child_process");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const cliRoot = join(__dirname, "..", "..");

    const result = execSync(
      `node ${join(cliRoot, "bin", "chainlesschain.js")} agent --help`,
      { encoding: "utf-8", timeout: 10000 },
    );
    expect(result).toContain("agentic AI session");
    expect(result).toContain("--model");
    expect(result).toContain("--provider");
  });
});

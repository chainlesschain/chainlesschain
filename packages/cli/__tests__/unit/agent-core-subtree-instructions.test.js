import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import {
  executeTool,
  _resetSubtreeInstructionLoaders,
} from "../../src/runtime/agent-core.js";

// Lazy subtree instruction injection (large-monorepo lever): cc.md / CLAUDE.md /
// AGENTS.md that sit BELOW the startup cwd are NOT loaded up front — they are
// injected onto the tool result the FIRST time a tool accesses a path inside
// that subtree, exactly once per subtree per process. These tests drive the real
// read_file / list_dir / write_file tools against a temp monorepo tree.

describe("subtree instruction injection", () => {
  let root;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-subtree-"));
    // baseDir (root) file loaded at startup; subtree carries its own rules.
    fs.mkdirSync(path.join(root, "packages", "sub"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "packages", "sub", "CLAUDE.md"),
      "SUBTREE RULE: indent with tabs here.\n",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(root, "packages", "sub", "code.js"),
      "export const hello = 1;\n",
      "utf-8",
    );
    // A file directly under root — NO intervening subtree instructions.
    fs.writeFileSync(path.join(root, "top.js"), "const x = 1;\n", "utf-8");
    _resetSubtreeInstructionLoaders();
  });

  afterEach(() => {
    _resetSubtreeInstructionLoaders();
    fs.rmSync(root, { recursive: true, force: true });
    delete process.env.CC_SUBTREE_INSTRUCTIONS;
  });

  it("attaches a subtree's CLAUDE.md the first time a read enters it", async () => {
    const res = await executeTool(
      "read_file",
      { path: "packages/sub/code.js" },
      { cwd: root },
    );
    expect(res.content).toContain("hello");
    expect(Array.isArray(res.subtreeInstructions)).toBe(true);
    expect(res.subtreeInstructions).toHaveLength(1);
    expect(res.subtreeInstructions[0].content).toContain("SUBTREE RULE");
    expect(res.subtreeInstructions[0].scope).toBe("project");
  });

  it("does not re-inject the same subtree on a second access (dedup)", async () => {
    const first = await executeTool(
      "read_file",
      { path: "packages/sub/code.js" },
      { cwd: root },
    );
    expect(first.subtreeInstructions).toHaveLength(1);

    const second = await executeTool(
      "read_file",
      { path: "packages/sub/code.js" },
      { cwd: root },
    );
    expect(second.content).toContain("hello");
    expect(second.subtreeInstructions).toBeUndefined();
  });

  it("attaches nothing when the accessed file has no subtree instructions", async () => {
    const res = await executeTool(
      "read_file",
      { path: "top.js" },
      { cwd: root },
    );
    expect(res.content).toContain("const x = 1");
    expect(res.subtreeInstructions).toBeUndefined();
  });

  it("list_dir into a subtree also injects its instructions", async () => {
    const res = await executeTool(
      "list_dir",
      { path: "packages/sub" },
      { cwd: root },
    );
    expect(Array.isArray(res.entries)).toBe(true);
    expect(res.subtreeInstructions).toHaveLength(1);
    expect(res.subtreeInstructions[0].content).toContain("SUBTREE RULE");
  });

  it("write_file creating a file in a subtree injects its instructions", async () => {
    const res = await executeTool(
      "write_file",
      { path: "packages/sub/new.js", content: "export const y = 2;\n" },
      { cwd: root },
    );
    expect(res.success).toBe(true);
    expect(res.subtreeInstructions).toHaveLength(1);
    expect(res.subtreeInstructions[0].content).toContain("SUBTREE RULE");
  });

  it("CC_SUBTREE_INSTRUCTIONS=0 disables injection entirely", async () => {
    process.env.CC_SUBTREE_INSTRUCTIONS = "0";
    const res = await executeTool(
      "read_file",
      { path: "packages/sub/code.js" },
      { cwd: root },
    );
    expect(res.content).toContain("hello");
    expect(res.subtreeInstructions).toBeUndefined();
  });

  it("injects each nested subtree level shallowest-first", async () => {
    // Add a deeper level with its own instructions.
    fs.mkdirSync(path.join(root, "packages", "sub", "deep"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(root, "packages", "sub", "deep", "AGENTS.md"),
      "DEEP RULE.\n",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(root, "packages", "sub", "deep", "d.js"),
      "const d = 1;\n",
      "utf-8",
    );
    const res = await executeTool(
      "read_file",
      { path: "packages/sub/deep/d.js" },
      { cwd: root },
    );
    // Both packages/sub/CLAUDE.md and packages/sub/deep/AGENTS.md are new.
    expect(res.subtreeInstructions).toHaveLength(2);
    expect(res.subtreeInstructions[0].content).toContain("SUBTREE RULE");
    expect(res.subtreeInstructions[1].content).toContain("DEEP RULE");
  });
});

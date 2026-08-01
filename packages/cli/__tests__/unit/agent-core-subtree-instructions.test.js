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
// that subtree, exactly once per subtree per session. These tests drive the real
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

  it("defers the first write before any effect, then permits an explicit retry", async () => {
    const target = path.join(root, "packages", "sub", "new.js");
    const first = await executeTool(
      "write_file",
      { path: "packages/sub/new.js", content: "export const y = 2;\n" },
      { cwd: root, sessionId: "write-session" },
    );
    expect(first).toMatchObject({
      mutationPerformed: false,
      policy: { decision: "deferred", via: "subtree-instructions" },
    });
    expect(first.subtreeInstructions).toHaveLength(1);
    expect(first.subtreeInstructions[0].content).toContain("SUBTREE RULE");
    expect(fs.existsSync(target)).toBe(false);

    const retried = await executeTool(
      "write_file",
      { path: "packages/sub/new.js", content: "export const y = 2;\n" },
      { cwd: root, sessionId: "write-session" },
    );
    expect(retried.success).toBe(true);
    expect(fs.readFileSync(target, "utf8")).toContain("y = 2");
  });

  it("defers the first edit before changing bytes, then permits an explicit retry", async () => {
    const target = path.join(root, "packages", "sub", "code.js");
    const original = fs.readFileSync(target, "utf8");
    const args = {
      path: "packages/sub/code.js",
      old_string: "hello = 1",
      new_string: "hello = 2",
    };

    const first = await executeTool("edit_file", args, {
      cwd: root,
      sessionId: "edit-session",
    });
    expect(first).toMatchObject({
      mutationPerformed: false,
      policy: { decision: "deferred", via: "subtree-instructions" },
    });
    expect(fs.readFileSync(target, "utf8")).toBe(original);

    const retried = await executeTool("edit_file", args, {
      cwd: root,
      sessionId: "edit-session",
    });
    expect(retried.success).toBe(true);
    expect(fs.readFileSync(target, "utf8")).toContain("hello = 2");
  });

  it("loads source and target rules atomically before moving a file", async () => {
    const source = path.join(root, "packages", "sub", "code.js");
    const targetDir = path.join(root, "packages", "other", "deep");
    const target = path.join(targetDir, "code.js");
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(
      path.join(targetDir, "AGENTS.md"),
      "TARGET RULE: preserve exports.\n",
      "utf-8",
    );
    const args = {
      path: "packages/sub/code.js",
      target_path: "packages/other/deep/code.js",
    };

    const first = await executeTool("move_file", args, {
      cwd: root,
      sessionId: "move-session",
    });
    expect(first).toMatchObject({
      mutationPerformed: false,
      policy: { decision: "deferred", via: "subtree-instructions" },
    });
    expect(first.subtreeInstructions).toHaveLength(2);
    expect(first.subtreeInstructions.map((item) => item.content)).toEqual([
      expect.stringContaining("SUBTREE RULE"),
      expect.stringContaining("TARGET RULE"),
    ]);
    expect(fs.existsSync(source)).toBe(true);
    expect(fs.existsSync(target)).toBe(false);

    const retried = await executeTool("move_file", args, {
      cwd: root,
      sessionId: "move-session",
    });
    expect(retried.success).toBe(true);
    expect(fs.existsSync(source)).toBe(false);
    expect(fs.existsSync(target)).toBe(true);
  });

  it("defers the first notebook edit before changing notebook JSON", async () => {
    const target = path.join(root, "packages", "sub", "notebook.ipynb");
    const original = JSON.stringify({
      cells: [
        {
          cell_type: "code",
          id: "cell-a",
          metadata: {},
          source: ["x = 1\n"],
          outputs: [],
          execution_count: null,
        },
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    });
    fs.writeFileSync(target, original, "utf-8");
    const args = {
      path: "packages/sub/notebook.ipynb",
      cell_id: "cell-a",
      new_source: "x = 2\n",
    };

    const first = await executeTool("notebook_edit", args, {
      cwd: root,
      sessionId: "notebook-session",
    });
    expect(first).toMatchObject({
      mutationPerformed: false,
      policy: { decision: "deferred", via: "subtree-instructions" },
    });
    expect(fs.readFileSync(target, "utf8")).toBe(original);

    const retried = await executeTool("notebook_edit", args, {
      cwd: root,
      sessionId: "notebook-session",
    });
    expect(retried.success).toBe(true);
    expect(JSON.parse(fs.readFileSync(target, "utf8")).cells[0].source).toEqual(
      ["x = 2\n"],
    );
  });

  it("does not share committed subtree state across sessions", async () => {
    const firstSession = await executeTool(
      "read_file",
      { path: "packages/sub/code.js" },
      { cwd: root, sessionId: "session-a" },
    );
    const secondSession = await executeTool(
      "read_file",
      { path: "packages/sub/code.js" },
      { cwd: root, sessionId: "session-b" },
    );

    expect(firstSession.subtreeInstructions).toHaveLength(1);
    expect(secondSession.subtreeInstructions).toHaveLength(1);
  });

  it("defers delete before the target disappears", async () => {
    const target = path.join(root, "packages", "sub", "code.js");
    const result = await executeTool(
      "delete_file",
      { path: "packages/sub/code.js" },
      { cwd: root, sessionId: "delete-session" },
    );

    expect(result.mutationPerformed).toBe(false);
    expect(result.subtreeInstructions).toHaveLength(1);
    expect(fs.existsSync(target)).toBe(true);
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

/**
 * read_file notebook rendering (Claude Code Read parity) + renderNotebook pure
 * helper. A .ipynb is shown as a compact cell listing (index/id/type/source,
 * outputs hidden) so the model can target cells for notebook_edit; raw:true
 * returns the underlying JSON.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mock the same deps as agent-core.test.js so executeTool imports cleanly.
vi.mock("../../src/lib/plan-mode.js", () => ({
  getPlanModeManager: vi.fn(() => ({
    isActive: () => false,
    isToolAllowed: () => true,
    addPlanItem: vi.fn(),
  })),
}));
vi.mock("../../src/lib/skill-loader.js", () => ({
  CLISkillLoader: vi.fn(function () {
    return { getResolvedSkills: vi.fn(() => []) };
  }),
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

const { executeTool, renderNotebook } =
  await import("../../src/runtime/agent-core.js");

const NB = JSON.stringify({
  cells: [
    {
      cell_type: "code",
      id: "c1",
      source: ["x = 1\n", "print(x)\n"],
      outputs: [{ output_type: "stream", text: ["1\n"] }],
      execution_count: 2,
    },
    { cell_type: "markdown", id: "m1", source: ["# Title\n"] },
  ],
  nbformat: 4,
  nbformat_minor: 5,
});

describe("renderNotebook", () => {
  it("lists cells with index/id/type/source and hides outputs", () => {
    const v = renderNotebook(NB);
    expect(v).toContain("Cell 0 [code id=c1]");
    expect(v).toContain("x = 1");
    expect(v).toContain("output(s) hidden");
    expect(v).toContain("Cell 1 [markdown id=m1]");
    expect(v).toContain("# Title");
    // raw output payloads never leak into the rendering
    expect(v).not.toContain("output_type");
  });

  it("returns null for non-notebook input (caller falls back to raw)", () => {
    expect(renderNotebook("not json {")).toBeNull();
    expect(renderNotebook(JSON.stringify({ foo: 1 }))).toBeNull();
  });
});

describe("read_file — .ipynb rendering", () => {
  let tempDir;
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cc-nbread-"));
  });
  afterEach(() => rmSync(tempDir, { recursive: true, force: true }));

  it("renders a notebook compactly by default", async () => {
    writeFileSync(join(tempDir, "n.ipynb"), NB, "utf8");
    const result = await executeTool(
      "read_file",
      { path: "n.ipynb" },
      { cwd: tempDir },
    );
    expect(result.notebook).toBe(true);
    expect(result.content).toContain("Cell 0 [code id=c1]");
    expect(result.content).not.toContain("output_type"); // outputs hidden
  });

  it("returns raw JSON when raw:true", async () => {
    writeFileSync(join(tempDir, "n.ipynb"), NB, "utf8");
    const result = await executeTool(
      "read_file",
      { path: "n.ipynb", raw: true },
      { cwd: tempDir },
    );
    expect(result.notebook).toBeUndefined();
    expect(result.content).toContain("output_type"); // raw JSON includes outputs
    expect(() => JSON.parse(result.content)).not.toThrow();
  });

  it("falls back to raw for a malformed .ipynb", async () => {
    writeFileSync(join(tempDir, "bad.ipynb"), "{ not valid", "utf8");
    const result = await executeTool(
      "read_file",
      { path: "bad.ipynb" },
      { cwd: tempDir },
    );
    expect(result.notebook).toBeUndefined();
    expect(result.content).toBe("{ not valid");
  });

  it("leaves non-.ipynb files unchanged", async () => {
    writeFileSync(join(tempDir, "f.txt"), "plain text", "utf8");
    const result = await executeTool(
      "read_file",
      { path: "f.txt" },
      { cwd: tempDir },
    );
    expect(result.notebook).toBeUndefined();
    expect(result.content).toBe("plain text");
  });
});

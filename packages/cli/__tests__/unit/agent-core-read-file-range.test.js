/**
 * read_file offset/limit line-range paging (Claude-Code Read parity) — lets the
 * agent page a large file past the size cap instead of being stuck at its head.
 * Exercises executeTool against real temp files.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

const { executeTool } = await import("../../src/runtime/agent-core.js");

describe("read_file offset/limit line ranges", () => {
  let dir;
  const lines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`);
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cc-readrange-"));
    writeFileSync(join(dir, "f.txt"), lines.join("\n"), "utf8");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const read = (args) =>
    executeTool("read_file", { path: "f.txt", ...args }, { cwd: dir });

  it("reads the whole file with no range (unchanged behavior)", async () => {
    const r = await read({});
    expect(r.content).toBe(lines.join("\n"));
    expect(r.range).toBeUndefined();
  });

  it("offset+limit returns just that line window with a range descriptor", async () => {
    const r = await read({ offset: 5, limit: 3 });
    expect(r.content).toBe("line5\nline6\nline7");
    expect(r.range).toEqual({ startLine: 5, endLine: 7, totalLines: 20 });
  });

  it("offset alone reads to end", async () => {
    const r = await read({ offset: 18 });
    expect(r.content).toBe("line18\nline19\nline20");
    expect(r.range).toEqual({ startLine: 18, endLine: 20, totalLines: 20 });
  });

  it("limit alone reads from the top", async () => {
    const r = await read({ limit: 2 });
    expect(r.content).toBe("line1\nline2");
    expect(r.range).toEqual({ startLine: 1, endLine: 2, totalLines: 20 });
  });

  it("coerces numeric-string args ('5'/'3') the model may emit", async () => {
    const r = await read({ offset: "5", limit: "3" });
    expect(r.content).toBe("line5\nline6\nline7");
  });

  it("a limit past EOF clamps endLine to the file length", async () => {
    const r = await read({ offset: 19, limit: 100 });
    expect(r.content).toBe("line19\nline20");
    expect(r.range).toEqual({ startLine: 19, endLine: 20, totalLines: 20 });
  });

  it("an offset past EOF returns empty content, not an error", async () => {
    const r = await read({ offset: 99 });
    expect(r.content).toBe("");
    expect(r.error).toBeUndefined();
  });

  it("ignores zero / negative / non-numeric range args (full read)", async () => {
    expect((await read({ offset: 0 })).content).toBe(lines.join("\n"));
    expect((await read({ limit: -3 })).content).toBe(lines.join("\n"));
    expect((await read({ offset: "abc" })).content).toBe(lines.join("\n"));
  });

  it("works with hashed:true (each ranged line keeps its hash tag)", async () => {
    const r = await read({ offset: 2, limit: 2, hashed: true });
    const out = r.content.split("\n");
    expect(out).toHaveLength(2);
    // annotateLines prefixes a tag; the underlying content is still line2/line3
    expect(r.content).toMatch(/line2/);
    expect(r.content).toMatch(/line3/);
    expect(r.range).toEqual({ startLine: 2, endLine: 3, totalLines: 20 });
  });
});

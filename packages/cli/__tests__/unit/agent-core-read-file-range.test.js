/**
 * read_file offset/limit line-range paging (Claude-Code Read parity) — lets the
 * agent page a large file past the size cap instead of being stuck at its head.
 * Exercises executeTool against real temp files.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fs from "node:fs";

vi.mock("../../src/lib/plan-mode.js", () => {
  const planModeManager = {
    isActive: () => false,
    isToolAllowed: () => true,
    addPlanItem: vi.fn(),
  };
  return { getPlanModeManager: vi.fn(() => planModeManager) };
});
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

const { executeTool, capToolResultString, toolResultForModel } =
  await import("../../src/runtime/agent-core.js");

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

  it("reports the actual page boundary and preserves its cursor after JSON serialization", async () => {
    const largeLines = Array.from(
      { length: 1500 },
      (_, i) => `${i + 1}: "quoted" \\ ${"内容".repeat(45)}`,
    );
    writeFileSync(join(dir, "f.txt"), largeLines.join("\n"), "utf8");
    const first = await read({ offset: 1, limit: 1500 });
    const visible = JSON.parse(capToolResultString(JSON.stringify(first)));
    expect(visible.truncated).toBe(true);
    expect(visible.range.endLine).toBeLessThan(1500);
    expect(visible.nextRead.offset).toBe(visible.range.endLine + 1);
    expect(visible.content.trimEnd().split("\n")).toEqual(
      largeLines.slice(0, visible.range.endLine),
    );
    const next = await read(visible.nextRead);
    expect(next.content.startsWith(largeLines[visible.range.endLine])).toBe(
      true,
    );
  });

  it("does not reinject an unchanged page, but rereads after edits or compaction", async () => {
    const first = await read({ offset: 1, limit: 5 });
    const original = toolResultForModel("read_file", first, []);
    const messages = [
      { role: "tool", tool_call_id: "read-1", content: original },
    ];
    const duplicate = await read({ offset: 1, limit: 5 });
    expect(
      JSON.parse(toolResultForModel("read_file", duplicate, messages)),
    ).toMatchObject({
      alreadyRead: true,
      previousToolCallId: "read-1",
      nextRead: { offset: 6 },
    });
    writeFileSync(join(dir, "f.txt"), "changed content", "utf8");
    const changed = await read({ offset: 1, limit: 5 });
    expect(
      JSON.parse(toolResultForModel("read_file", changed, messages)).content,
    ).toBe("changed content");
    messages[0].content = "[earlier file content compacted]";
    expect(
      JSON.parse(toolResultForModel("read_file", first, messages)).content,
    ).toBe(first.content);
  });

  it("caches repeated reads within a run and invalidates the cache when the file changes", async () => {
    const filePath = join(dir, "f.txt");
    const readSpy = vi.spyOn(fs, "readFileSync");
    const context = { cwd: dir, readFileCache: new Map() };
    try {
      const first = await executeTool(
        "read_file",
        { path: "f.txt", limit: 2 },
        context,
      );
      const second = await executeTool(
        "read_file",
        { path: "f.txt", limit: 2 },
        context,
      );
      expect(second.content).toBe(first.content);
      expect(readSpy.mock.calls.filter(([p]) => p === filePath)).toHaveLength(
        1,
      );
      writeFileSync(filePath, "modified file contents", "utf8");
      const changed = await executeTool(
        "read_file",
        { path: "f.txt", limit: 2 },
        context,
      );
      expect(changed.content).toBe("modified file contents");
      expect(readSpy.mock.calls.filter(([p]) => p === filePath)).toHaveLength(
        2,
      );
    } finally {
      readSpy.mockRestore();
    }
  });
});

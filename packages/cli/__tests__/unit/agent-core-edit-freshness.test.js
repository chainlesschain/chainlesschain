/**
 * Read-freshness (edit-concurrency) guard: an edit is refused when the file
 * changed on disk since the agent last read/wrote it, so a concurrent external
 * edit is not silently clobbered. Exercises executeTool against real temp files.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  utimesSync,
} from "node:fs";
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

const { executeTool, _resetFileFreshness } =
  await import("../../src/runtime/agent-core.js");

// Bump a file's mtime into the future to simulate an external write, robust to
// coarse filesystem mtime resolution.
function touchFuture(filePath) {
  const now = new Date(Date.now() + 60_000);
  utimesSync(filePath, now, now);
}

describe("edit-freshness guard", () => {
  let tempDir;
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cc-fresh-"));
    _resetFileFreshness();
    delete process.env.CC_EDIT_FRESHNESS;
  });
  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    delete process.env.CC_EDIT_FRESHNESS;
  });

  it("refuses edit_file when the file changed on disk after the last read", async () => {
    const fp = join(tempDir, "f.txt");
    writeFileSync(fp, "hello world", "utf8");
    await executeTool("read_file", { path: "f.txt" }, { cwd: tempDir });
    // External process rewrites the file.
    writeFileSync(fp, "hello CONCURRENT world", "utf8");
    touchFuture(fp);
    const res = await executeTool(
      "edit_file",
      { path: "f.txt", old_string: "hello", new_string: "hi" },
      { cwd: tempDir },
    );
    expect(res.error).toMatch(/changed on disk since you last read it/);
    // The concurrent content is preserved — not clobbered.
    expect(readFileSync(fp, "utf8")).toBe("hello CONCURRENT world");
  });

  it("allows the edit after the agent re-reads the changed file", async () => {
    const fp = join(tempDir, "f.txt");
    writeFileSync(fp, "hello world", "utf8");
    await executeTool("read_file", { path: "f.txt" }, { cwd: tempDir });
    writeFileSync(fp, "fresh content here", "utf8");
    touchFuture(fp);
    // Re-read → re-baselines the mtime.
    await executeTool("read_file", { path: "f.txt" }, { cwd: tempDir });
    const res = await executeTool(
      "edit_file",
      { path: "f.txt", old_string: "fresh", new_string: "brand-new" },
      { cwd: tempDir },
    );
    expect(res.success).toBe(true);
    expect(readFileSync(fp, "utf8")).toBe("brand-new content here");
  });

  it("permits sequential agent edits (its own writes re-baseline the mtime)", async () => {
    const fp = join(tempDir, "f.txt");
    writeFileSync(fp, "a\nb\nc", "utf8");
    await executeTool("read_file", { path: "f.txt" }, { cwd: tempDir });
    const r1 = await executeTool(
      "edit_file",
      { path: "f.txt", old_string: "a", new_string: "A" },
      { cwd: tempDir },
    );
    expect(r1.success).toBe(true);
    // A second edit right after — must NOT be blocked by the mtime its own first
    // edit produced.
    const r2 = await executeTool(
      "edit_file",
      { path: "f.txt", old_string: "b", new_string: "B" },
      { cwd: tempDir },
    );
    expect(r2.success).toBe(true);
    expect(readFileSync(fp, "utf8")).toBe("A\nB\nc");
  });

  it("does NOT block an edit to a file the agent never read (first-touch)", async () => {
    const fp = join(tempDir, "f.txt");
    writeFileSync(fp, "untracked content", "utf8");
    const res = await executeTool(
      "edit_file",
      { path: "f.txt", old_string: "untracked", new_string: "tracked" },
      { cwd: tempDir },
    );
    expect(res.success).toBe(true);
  });

  it("also guards write_file overwriting a concurrently-changed file", async () => {
    const fp = join(tempDir, "f.txt");
    writeFileSync(fp, "v1", "utf8");
    await executeTool("read_file", { path: "f.txt" }, { cwd: tempDir });
    writeFileSync(fp, "v2-external", "utf8");
    touchFuture(fp);
    const res = await executeTool(
      "write_file",
      { path: "f.txt", content: "v3-agent" },
      { cwd: tempDir },
    );
    expect(res.error).toMatch(/changed on disk/);
    expect(readFileSync(fp, "utf8")).toBe("v2-external");
  });

  it("CC_EDIT_FRESHNESS=0 disables the guard", async () => {
    const fp = join(tempDir, "f.txt");
    writeFileSync(fp, "hello world", "utf8");
    await executeTool("read_file", { path: "f.txt" }, { cwd: tempDir });
    writeFileSync(fp, "hello CONCURRENT world", "utf8");
    touchFuture(fp);
    process.env.CC_EDIT_FRESHNESS = "0";
    const res = await executeTool(
      "edit_file",
      { path: "f.txt", old_string: "hello", new_string: "hi" },
      { cwd: tempDir },
    );
    expect(res.success).toBe(true);
  });
});

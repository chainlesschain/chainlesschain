/**
 * Diff-apply idempotency (P0-2): a resumed `edit_file` whose old_string is
 * already gone but whose new_string is present reports a no-op success instead
 * of a misleading "old_string not found" error — and writes nothing. A genuine
 * mismatch (neither present) still errors.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  statSync,
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

describe("edit_file idempotent replay", () => {
  let tempDir;
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cc-idem-"));
    _resetFileFreshness();
    delete process.env.CC_EDIT_FRESHNESS;
  });
  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    delete process.env.CC_EDIT_FRESHNESS;
  });

  it("reports already-applied (no write) when new_string is present and old is gone", async () => {
    const fp = join(tempDir, "f.js");
    // The file already reflects the intended edit's RESULT.
    writeFileSync(fp, "const a = 2;\n", "utf8");
    const before = statSync(fp).mtimeMs;
    const res = await executeTool(
      "edit_file",
      { path: "f.js", old_string: "const a = 1;", new_string: "const a = 2;" },
      { cwd: tempDir },
    );
    expect(res.success).toBe(true);
    expect(res.alreadyApplied).toBe(true);
    expect(res.idempotencyKey).toMatch(/^edit_[0-9a-f]{40}$/);
    // No write occurred — mtime unchanged, content untouched.
    expect(statSync(fp).mtimeMs).toBe(before);
    expect(readFileSync(fp, "utf8")).toBe("const a = 2;\n");
  });

  it("still errors when neither old nor new is present (genuine mismatch)", async () => {
    const fp = join(tempDir, "f.js");
    writeFileSync(fp, "something else entirely\n", "utf8");
    const res = await executeTool(
      "edit_file",
      { path: "f.js", old_string: "const a = 1;", new_string: "const a = 2;" },
      { cwd: tempDir },
    );
    expect(res.success).toBeUndefined();
    expect(res.error).toMatch(/old_string not found/);
  });

  it("performs the edit normally when old_string is present", async () => {
    const fp = join(tempDir, "f.js");
    writeFileSync(fp, "const a = 1;\n", "utf8");
    const res = await executeTool(
      "edit_file",
      { path: "f.js", old_string: "const a = 1;", new_string: "const a = 2;" },
      { cwd: tempDir },
    );
    expect(res.success).toBe(true);
    expect(res.alreadyApplied).toBeUndefined();
    expect(readFileSync(fp, "utf8")).toBe("const a = 2;\n");
  });
});

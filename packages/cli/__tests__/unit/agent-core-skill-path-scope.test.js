/**
 * Integration: list_skills / run_skill drop skills whose `paths:` frontmatter
 * scopes them to a different subtree than the agent's cwd (large-monorepo lazy
 * skill surface). Skills are injected via context.skillLoader; the project root
 * is pinned via a mocked findProjectRoot so relCwd is deterministic.
 */
import { describe, it, expect, vi } from "vitest";
import path from "node:path";

const ROOT = path.join(path.sep, "repo");

vi.mock("../../src/lib/project-detector.js", () => ({
  findProjectRoot: vi.fn(() => ROOT),
  loadProjectConfig: vi.fn(() => null),
  isInsideProject: vi.fn(() => false),
}));

vi.mock("../../src/lib/plan-mode.js", () => ({
  getPlanModeManager: vi.fn(() => ({
    isActive: () => false,
    isToolAllowed: () => true,
    addPlanItem: vi.fn(),
  })),
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

const skills = [
  {
    id: "global",
    dirName: "global",
    category: "x",
    source: "s",
    hasHandler: false,
    description: "everywhere",
    paths: null,
  },
  {
    id: "cli-only",
    dirName: "cli-only",
    category: "x",
    source: "s",
    hasHandler: false,
    description: "cli subtree",
    paths: ["packages/cli/**"],
  },
];
const skillLoader = { getResolvedSkills: () => skills };

describe("list_skills path-scope filtering", () => {
  it("drops an out-of-scope skill for the agent's cwd", async () => {
    const res = await executeTool(
      "list_skills",
      {},
      { skillLoader, cwd: path.join(ROOT, "android-app") },
    );
    expect(res.skills.map((s) => s.id)).toEqual(["global"]);
  });

  it("keeps an in-scope skill when the cwd matches its paths", async () => {
    const res = await executeTool(
      "list_skills",
      {},
      { skillLoader, cwd: path.join(ROOT, "packages", "cli") },
    );
    expect(res.skills.map((s) => s.id).sort()).toEqual(["cli-only", "global"]);
  });

  it("run_skill cannot resolve an out-of-scope skill by name", async () => {
    const res = await executeTool(
      "run_skill",
      { skill_name: "cli-only" },
      { skillLoader, cwd: path.join(ROOT, "android-app") },
    );
    // Filtered out of the candidate set → reported as not found (scoped away).
    expect(res.error).toMatch(/not found|no handler/i);
  });
});

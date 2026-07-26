import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  normalizeAgentSandbox,
  resolveSandboxPolicyPath,
} from "../../src/lib/agent-sandbox.js";

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

function makeDirectoryLink(target, link) {
  fs.symlinkSync(
    target,
    link,
    process.platform === "win32" ? "junction" : "dir",
  );
}

describe("agent workspace path guard", () => {
  let base;
  let workspace;
  let outside;
  let outsideFile;

  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), "cc-workspace-guard-"));
    workspace = path.join(base, "workspace");
    outside = path.join(base, "outside");
    fs.mkdirSync(workspace);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(workspace, "inside.txt"), "inside", "utf8");
    outsideFile = path.join(outside, "secret.txt");
    fs.writeFileSync(outsideFile, "outside-secret", "utf8");
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it("allows relative and absolute paths inside the workspace", async () => {
    expect(
      resolveSandboxPolicyPath("inside.txt", { cwd: workspace }),
    ).toMatchObject({ ok: true, path: path.join(workspace, "inside.txt") });
    expect(
      resolveSandboxPolicyPath(path.join(workspace, "inside.txt"), {
        cwd: workspace,
      }),
    ).toMatchObject({ ok: true });

    const relative = await executeTool(
      "read_file",
      { path: "inside.txt" },
      { cwd: workspace },
    );
    const absolute = await executeTool(
      "read_file",
      { path: path.join(workspace, "inside.txt") },
      { cwd: workspace },
    );
    expect(relative.content).toBe("inside");
    expect(absolute.content).toBe("inside");
  });

  it("blocks absolute and .. paths that escape the workspace", async () => {
    const escapedRelative = path.relative(workspace, outsideFile);
    for (const requested of [outsideFile, escapedRelative]) {
      const resolved = resolveSandboxPolicyPath(requested, { cwd: workspace });
      expect(resolved).toMatchObject({
        ok: false,
        reason: "outside-workspace",
      });

      const result = await executeTool(
        "read_file",
        { path: requested },
        { cwd: workspace },
      );
      expect(result.content).toBeUndefined();
      expect(result.error).toMatch(/Workspace Path Guard/);
      expect(result.policy).toMatchObject({
        decision: "deny",
        via: "workspace-path-guard",
        reason: "outside-workspace",
      });
    }
  });

  it("guards every built-in read surface before it can inspect an outside path", async () => {
    const calls = [
      ["read_file", { path: outsideFile }],
      ["list_dir", { path: outside }],
      [
        "search_files",
        { pattern: "secret", directory: outside, content_search: true },
      ],
      [
        "code_intelligence",
        { action: "document_symbols", file: outsideFile },
      ],
      ["publish_artifact", { path: outsideFile, title: "secret" }],
    ];

    for (const [name, args] of calls) {
      const result = await executeTool(name, args, { cwd: workspace });
      expect(result.error, name).toMatch(/Workspace Path Guard/);
      expect(result.policy?.via, name).toBe("workspace-path-guard");
    }
  });

  it("guards mutation sources and destinations without changing outside data", async () => {
    const insideSource = path.join(workspace, "move-me.txt");
    fs.writeFileSync(insideSource, "move", "utf8");
    const calls = [
      ["write_file", { path: outsideFile, content: "changed" }],
      [
        "edit_file",
        { path: outsideFile, old_string: "outside", new_string: "changed" },
      ],
      [
        "edit_file_hashed",
        { path: outsideFile, anchor_hash: "abcdef", new_line: "changed" },
      ],
      ["delete_file", { path: outsideFile }],
      [
        "notebook_edit",
        { path: outsideFile, cell_index: 0, source: "changed" },
      ],
      [
        "move_file",
        { path: outsideFile, target_path: path.join(workspace, "moved.txt") },
      ],
      [
        "move_file",
        {
          path: insideSource,
          target_path: path.join(outside, "escaped-move.txt"),
        },
      ],
    ];

    for (const [name, args] of calls) {
      const result = await executeTool(name, args, { cwd: workspace });
      expect(result.error, name).toMatch(/Workspace Path Guard/);
      expect(result.policy?.via, name).toBe("workspace-path-guard");
    }
    expect(fs.readFileSync(outsideFile, "utf8")).toBe("outside-secret");
    expect(fs.existsSync(insideSource)).toBe(true);
    expect(fs.existsSync(path.join(outside, "escaped-move.txt"))).toBe(false);
  });

  it("realpath-checks directory links and write parents before access", async () => {
    const escapeLink = path.join(workspace, "escape");
    makeDirectoryLink(outside, escapeLink);

    const read = await executeTool(
      "read_file",
      { path: path.join("escape", "secret.txt") },
      { cwd: workspace },
    );
    const list = await executeTool(
      "list_dir",
      { path: "escape" },
      { cwd: workspace },
    );
    const write = await executeTool(
      "write_file",
      { path: path.join("escape", "created.txt"), content: "escaped" },
      { cwd: workspace },
    );

    for (const result of [read, list, write]) {
      expect(result.error).toMatch(/Workspace Path Guard/);
      expect(result.policy?.reason).toBe("outside-workspace");
    }
    expect(fs.existsSync(path.join(outside, "created.txt"))).toBe(false);
  });

  it.runIf(process.platform !== "win32")(
    "blocks an existing file symlink whose target is outside",
    async () => {
      const link = path.join(workspace, "secret-link.txt");
      fs.symlinkSync(outsideFile, link, "file");

      const read = await executeTool(
        "read_file",
        { path: "secret-link.txt" },
        { cwd: workspace },
      );
      const write = await executeTool(
        "write_file",
        { path: "secret-link.txt", content: "changed" },
        { cwd: workspace },
      );
      expect(read.error).toMatch(/Workspace Path Guard/);
      expect(write.error).toMatch(/Workspace Path Guard/);
      expect(fs.readFileSync(outsideFile, "utf8")).toBe("outside-secret");
    },
  );

  it("allows links that resolve inside the workspace", async () => {
    const target = path.join(workspace, "real-dir");
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, "safe.txt"), "safe", "utf8");
    makeDirectoryLink(target, path.join(workspace, "safe-link"));

    const result = await executeTool(
      "read_file",
      { path: path.join("safe-link", "safe.txt") },
      { cwd: workspace },
    );
    expect(result.error).toBeUndefined();
    expect(result.content).toBe("safe");
  });

  it("honors explicit additional roots and sandbox allow/deny paths", async () => {
    const allowedFile = path.join(outside, "allowed.txt");
    fs.writeFileSync(allowedFile, "allowed", "utf8");
    const additional = await executeTool(
      "read_file",
      { path: allowedFile },
      { cwd: workspace, additionalDirectories: [outside] },
    );
    expect(additional.content).toBe("allowed");

    const sandbox = normalizeAgentSandbox(true, {
      cwd: workspace,
      settings: {
        filesystem: {
          allowRead: [outside],
          allowWrite: [outside],
          denyRead: [outsideFile],
        },
      },
    });
    const allowed = await executeTool(
      "read_file",
      { path: allowedFile },
      { cwd: workspace, sandbox },
    );
    const denied = await executeTool(
      "read_file",
      { path: outsideFile },
      { cwd: workspace, sandbox },
    );
    const write = await executeTool(
      "write_file",
      { path: path.join(outside, "policy-write.txt"), content: "ok" },
      { cwd: workspace, sandbox },
    );

    expect(allowed.content).toBe("allowed");
    expect(denied.policy).toMatchObject({
      via: "workspace-path-guard",
      reason: "denied-by-policy",
    });
    expect(write.success).toBe(true);
    expect(fs.readFileSync(path.join(outside, "policy-write.txt"), "utf8")).toBe(
      "ok",
    );
  });
});

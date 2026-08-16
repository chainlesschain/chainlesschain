import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  normalizeAgentSandbox,
  resolveSandboxPolicyPath,
} from "../../src/lib/agent-sandbox.js";

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

const { executeTool, normalizeExactFileMutationScope } =
  await import("../../src/runtime/agent-core.js");

function makeDirectoryLink(target, link) {
  fs.symlinkSync(
    target,
    link,
    process.platform === "win32" ? "junction" : "dir",
  );
}

function canonicalRealpath(candidate) {
  const realpath = fs.realpathSync.native || fs.realpathSync;
  return path.resolve(realpath(candidate));
}

async function withAffectedWindowsPathDeviceProjection(action) {
  const versionsDescriptor = Object.getOwnPropertyDescriptor(
    process,
    "versions",
  );
  const originalLstat = fs.lstatSync.bind(fs);
  Object.defineProperty(process, "versions", {
    ...versionsDescriptor,
    value: { ...process.versions, uv: "1.49.1" },
  });
  const lstatSpy = vi.spyOn(fs, "lstatSync").mockImplementation((...args) => {
    const stats = originalLstat(...args);
    if (typeof stats.dev !== "bigint") return stats;
    return new Proxy(stats, {
      get(current, property, receiver) {
        if (property === "dev") return 0n;
        const value = Reflect.get(current, property, receiver);
        return typeof value === "function" ? value.bind(current) : value;
      },
    });
  });
  try {
    return await action();
  } finally {
    lstatSpy.mockRestore();
    Object.defineProperty(process, "versions", versionsDescriptor);
  }
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
      ["code_intelligence", { action: "document_symbols", file: outsideFile }],
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
    expect(
      fs.readFileSync(path.join(outside, "policy-write.txt"), "utf8"),
    ).toBe("ok");
  });

  it("enforces an exact repo-relative file set before a mutation", async () => {
    const sourceDir = path.join(workspace, "src");
    fs.mkdirSync(sourceDir);
    fs.writeFileSync(path.join(sourceDir, "widget.js"), "old", "utf8");
    fs.writeFileSync(path.join(sourceDir, "widget.js.bak"), "sibling", "utf8");
    const scope = {
      exact: true,
      worktreeRoot: canonicalRealpath(workspace),
      allowedPaths: ["src/widget.js"],
    };

    const allowed = await executeTool(
      "write_file",
      { path: "src/widget.js", content: "updated" },
      {
        cwd: workspace,
        fileMutationScope: scope,
        hermeticExecution: true,
      },
    );
    expect(allowed.success).toBe(true);
    expect(fs.readFileSync(path.join(sourceDir, "widget.js"), "utf8")).toBe(
      "updated",
    );

    for (const requestedPath of [
      "src/widget.js.bak",
      "src/../src/widget.js",
      outsideFile,
    ]) {
      const denied = await executeTool(
        "write_file",
        { path: requestedPath, content: "forbidden" },
        {
          cwd: workspace,
          fileMutationScope: scope,
          hermeticExecution: true,
        },
      );
      expect(denied.policy?.via, requestedPath).toBe(
        "exact-file-mutation-scope",
      );
    }
    expect(fs.readFileSync(path.join(sourceDir, "widget.js.bak"), "utf8")).toBe(
      "sibling",
    );
    expect(fs.readFileSync(outsideFile, "utf8")).toBe("outside-secret");
  });

  it("keeps a bound ancestor valid when its directory link count changes", async () => {
    const target = path.join(workspace, "apfs-directory-entry.txt");
    fs.writeFileSync(target, "old", "utf8");
    const normalized = normalizeExactFileMutationScope(
      {
        exact: true,
        worktreeRoot: canonicalRealpath(workspace),
        allowedPaths: ["apfs-directory-entry.txt"],
      },
      { cwd: workspace },
    );

    const originalLstat = fs.lstatSync.bind(fs);
    let observedLinkCountDrift = false;
    const lstatSpy = vi.spyOn(fs, "lstatSync").mockImplementation((...args) => {
      const stats = originalLstat(...args);
      const candidate = path.resolve(String(args[0]));
      const stagingExists = fs
        .readdirSync(normalized.worktreeRoot)
        .some((name) => name.startsWith(".chainlesschain-fix-"));
      if (
        candidate !== normalized.worktreeRoot ||
        !stats.isDirectory() ||
        !stagingExists
      ) {
        return stats;
      }
      observedLinkCountDrift = true;
      return new Proxy(stats, {
        get(current, property, receiver) {
          if (property === "nlink") return current.nlink + 1n;
          const value = Reflect.get(current, property, receiver);
          return typeof value === "function" ? value.bind(current) : value;
        },
      });
    });

    try {
      const result = await executeTool(
        "write_file",
        { path: "apfs-directory-entry.txt", content: "updated" },
        {
          cwd: workspace,
          fileMutationScope: normalized,
          hermeticExecution: true,
        },
      );

      expect(result.success).toBe(true);
      expect(observedLinkCountDrift).toBe(true);
      expect(fs.readFileSync(target, "utf8")).toBe("updated");
    } finally {
      lstatSpy.mockRestore();
    }
  });

  it.runIf(process.platform === "win32")(
    "accepts the affected Node 22.12 Windows pathname device projection",
    async () => {
      const target = path.join(workspace, "windows-device-projection.txt");
      fs.writeFileSync(target, "old", "utf8");

      const result = await withAffectedWindowsPathDeviceProjection(async () => {
        const normalized = normalizeExactFileMutationScope(
          {
            exact: true,
            worktreeRoot: canonicalRealpath(workspace),
            allowedPaths: ["windows-device-projection.txt"],
          },
          { cwd: workspace },
        );
        return executeTool(
          "write_file",
          { path: "windows-device-projection.txt", content: "updated" },
          {
            cwd: workspace,
            fileMutationScope: normalized,
            hermeticExecution: true,
          },
        );
      });

      expect(result.success).toBe(true);
      expect(fs.readFileSync(target, "utf8")).toBe("updated");
    },
  );

  it.runIf(process.platform === "win32")(
    "rejects a real staging-path replacement under the Windows projection bridge",
    async () => {
      const target = path.join(workspace, "windows-stage-race.txt");
      const relocatedStage = path.join(outside, "windows-original-stage.tmp");
      fs.writeFileSync(target, "original", "utf8");

      let injected = false;
      const result = await withAffectedWindowsPathDeviceProjection(async () => {
        const normalized = normalizeExactFileMutationScope(
          {
            exact: true,
            worktreeRoot: canonicalRealpath(workspace),
            allowedPaths: ["windows-stage-race.txt"],
          },
          { cwd: workspace },
        );
        const originalOpen = fs.openSync.bind(fs);
        const openSpy = vi
          .spyOn(fs, "openSync")
          .mockImplementation((candidate, flags, mode) => {
            const accessFlags = Number(flags);
            const isReadOnly =
              (accessFlags &
                (Number(fs.constants.O_WRONLY) |
                  Number(fs.constants.O_RDWR))) ===
              0;
            if (
              !injected &&
              isReadOnly &&
              path
                .basename(path.resolve(String(candidate)))
                .startsWith(".chainlesschain-fix-")
            ) {
              injected = true;
              fs.renameSync(candidate, relocatedStage);
              fs.writeFileSync(candidate, "attacker-replacement", "utf8");
            }
            return originalOpen(candidate, flags, mode);
          });
        try {
          return await executeTool(
            "write_file",
            { path: "windows-stage-race.txt", content: "replacement" },
            {
              cwd: workspace,
              fileMutationScope: normalized,
              hermeticExecution: true,
            },
          );
        } finally {
          openSpy.mockRestore();
        }
      });

      expect(injected).toBe(true);
      expect(result).toMatchObject({
        cleanupRequired: true,
        unsettledStage: expect.stringMatching(/^\.chainlesschain-fix-/),
        policy: {
          via: "exact-file-mutation-scope",
          reason: "bound-write-failed",
        },
      });
      expect(result.error).toContain(
        "staged file path changed identity or content",
      );
      expect(fs.readFileSync(target, "utf8")).toBe("original");
      expect(fs.readFileSync(relocatedStage, "utf8")).toBe("replacement");
      expect(
        fs.readFileSync(path.join(workspace, result.unsettledStage), "utf8"),
      ).toBe("attacker-replacement");
    },
  );

  it("rejects filesystem aliases and detects a parent identity swap", async () => {
    const escape = path.join(workspace, "escape");
    makeDirectoryLink(outside, escape);
    const unsafe = await executeTool(
      "write_file",
      { path: "escape/created.txt", content: "forbidden" },
      {
        cwd: workspace,
        fileMutationScope: {
          exact: true,
          worktreeRoot: canonicalRealpath(workspace),
          allowedPaths: ["escape/created.txt"],
        },
      },
    );
    expect(unsafe.policy).toMatchObject({
      via: "exact-file-mutation-scope",
      reason: "invalid-scope",
    });
    expect(fs.existsSync(path.join(outside, "created.txt"))).toBe(false);

    const stableParent = path.join(workspace, "stable");
    fs.mkdirSync(stableParent);
    fs.writeFileSync(path.join(stableParent, "created.txt"), "stable", "utf8");
    const normalized = normalizeExactFileMutationScope(
      {
        exact: true,
        worktreeRoot: canonicalRealpath(workspace),
        allowedPaths: ["stable/created.txt"],
      },
      { cwd: workspace },
    );
    fs.unlinkSync(path.join(stableParent, "created.txt"));
    fs.rmdirSync(stableParent);
    makeDirectoryLink(outside, stableParent);

    const swapped = await executeTool(
      "write_file",
      { path: "stable/created.txt", content: "forbidden" },
      {
        cwd: workspace,
        fileMutationScope: normalized,
        hermeticExecution: true,
      },
    );
    expect(swapped.policy).toMatchObject({
      via: "exact-file-mutation-scope",
      reason: "outside-workspace",
    });
    expect(fs.existsSync(path.join(outside, "created.txt"))).toBe(false);
  });

  it("rejects hard-linked targets before and after exact-scope binding", async () => {
    const linkedAtAdmission = path.join(workspace, "linked-at-admission.txt");
    fs.linkSync(outsideFile, linkedAtAdmission);
    const staticResult = await executeTool(
      "write_file",
      { path: "linked-at-admission.txt", content: "forbidden" },
      {
        cwd: workspace,
        hermeticExecution: true,
        fileMutationScope: {
          exact: true,
          worktreeRoot: canonicalRealpath(workspace),
          allowedPaths: ["linked-at-admission.txt"],
        },
      },
    );
    expect(staticResult.policy).toMatchObject({
      via: "exact-file-mutation-scope",
      reason: "invalid-scope",
    });

    const swappedPath = path.join(workspace, "swapped.txt");
    fs.writeFileSync(swappedPath, "safe", "utf8");
    const normalized = normalizeExactFileMutationScope(
      {
        exact: true,
        worktreeRoot: canonicalRealpath(workspace),
        allowedPaths: ["swapped.txt"],
      },
      { cwd: workspace },
    );
    fs.unlinkSync(swappedPath);
    fs.linkSync(outsideFile, swappedPath);

    const swappedResult = await executeTool(
      "write_file",
      { path: "swapped.txt", content: "forbidden" },
      {
        cwd: workspace,
        hermeticExecution: true,
        fileMutationScope: normalized,
      },
    );
    expect(swappedResult.policy).toMatchObject({
      via: "exact-file-mutation-scope",
      reason: "path-identity-changed",
    });
    expect(fs.readFileSync(outsideFile, "utf8")).toBe("outside-secret");
  });

  it("never mutates a bound inode moved outside at the atomic replace boundary", async () => {
    const target = path.join(workspace, "race.txt");
    const relocated = path.join(outside, "relocated-race.txt");
    fs.writeFileSync(target, "original", "utf8");
    const normalized = normalizeExactFileMutationScope(
      {
        exact: true,
        worktreeRoot: canonicalRealpath(workspace),
        allowedPaths: ["race.txt"],
      },
      { cwd: workspace },
    );
    const boundTarget = normalized.bindings[0].absolutePath;

    const originalRename = fs.renameSync.bind(fs);
    let injected = false;
    const renameSpy = vi
      .spyOn(fs, "renameSync")
      .mockImplementation((source, destination) => {
        if (!injected && destination === boundTarget) {
          injected = true;
          originalRename(boundTarget, relocated);
        }
        return originalRename(source, destination);
      });

    try {
      const result = await executeTool(
        "write_file",
        { path: "race.txt", content: "replacement" },
        {
          cwd: workspace,
          hermeticExecution: true,
          fileMutationScope: normalized,
        },
      );

      expect(result.success).toBe(true);
      expect(injected).toBe(true);
      expect(fs.readFileSync(relocated, "utf8")).toBe("original");
      expect(fs.readFileSync(target, "utf8")).toBe("replacement");

      const followup = await executeTool(
        "edit_file",
        {
          path: "race.txt",
          old_string: "replacement",
          new_string: "settled",
        },
        {
          cwd: workspace,
          hermeticExecution: true,
          fileMutationScope: normalized,
        },
      );
      expect(followup.success).toBe(true);
      expect(fs.readFileSync(relocated, "utf8")).toBe("original");
      expect(fs.readFileSync(target, "utf8")).toBe("settled");
      expect(
        fs
          .readdirSync(workspace)
          .some((name) => name.startsWith(".chainlesschain-fix-")),
      ).toBe(false);
    } finally {
      renameSpy.mockRestore();
    }
  });

  it("fails closed when the bound target moves while replacement bytes stage", async () => {
    const target = path.join(workspace, "stage-race.txt");
    const relocated = path.join(outside, "relocated-stage-race.txt");
    fs.writeFileSync(target, "original", "utf8");
    const normalized = normalizeExactFileMutationScope(
      {
        exact: true,
        worktreeRoot: canonicalRealpath(workspace),
        allowedPaths: ["stage-race.txt"],
      },
      { cwd: workspace },
    );
    const boundTarget = normalized.bindings[0].absolutePath;

    const originalFstat = fs.fstatSync.bind(fs);
    let injected = false;
    const fstatSpy = vi.spyOn(fs, "fstatSync").mockImplementation((...args) => {
      const stats = originalFstat(...args);
      if (!injected) {
        injected = true;
        fs.renameSync(boundTarget, relocated);
      }
      return stats;
    });

    try {
      const result = await executeTool(
        "write_file",
        { path: "stage-race.txt", content: "forbidden" },
        {
          cwd: workspace,
          hermeticExecution: true,
          fileMutationScope: normalized,
        },
      );

      expect(result.policy).toMatchObject({
        via: "exact-file-mutation-scope",
        reason: "bound-write-failed",
      });
      expect(injected).toBe(true);
      expect(fs.existsSync(target)).toBe(false);
      expect(fs.readFileSync(relocated, "utf8")).toBe("original");
      expect(result).toMatchObject({
        cleanupRequired: true,
        unsettledStage: expect.stringMatching(/^\.chainlesschain-fix-/),
      });
      expect(fs.existsSync(path.join(workspace, result.unsettledStage))).toBe(
        true,
      );
    } finally {
      fstatSpy.mockRestore();
    }
  });

  it("does not unlink an unknown file substituted at the failed staging path", async () => {
    const target = path.join(workspace, "cleanup-race.txt");
    const relocatedStage = path.join(outside, "relocated-staging.tmp");
    fs.writeFileSync(target, "original", "utf8");
    const normalized = normalizeExactFileMutationScope(
      {
        exact: true,
        worktreeRoot: canonicalRealpath(workspace),
        allowedPaths: ["cleanup-race.txt"],
      },
      { cwd: workspace },
    );
    const boundTarget = normalized.bindings[0].absolutePath;

    const originalRename = fs.renameSync.bind(fs);
    let substitutedPath;
    const renameSpy = vi
      .spyOn(fs, "renameSync")
      .mockImplementation((source, destination) => {
        if (!substitutedPath && destination === boundTarget) {
          substitutedPath = source;
          originalRename(source, relocatedStage);
          fs.linkSync(outsideFile, source);
          throw new Error("injected rename failure");
        }
        return originalRename(source, destination);
      });

    try {
      const result = await executeTool(
        "write_file",
        { path: "cleanup-race.txt", content: "replacement" },
        {
          cwd: workspace,
          hermeticExecution: true,
          fileMutationScope: normalized,
        },
      );

      expect(result.policy).toMatchObject({
        via: "exact-file-mutation-scope",
        reason: "bound-write-failed",
      });
      expect(substitutedPath).toBeTruthy();
      expect(fs.readFileSync(target, "utf8")).toBe("original");
      expect(fs.readFileSync(outsideFile, "utf8")).toBe("outside-secret");
      expect(fs.readFileSync(substitutedPath, "utf8")).toBe("outside-secret");
    } finally {
      renameSpy.mockRestore();
      if (substitutedPath && fs.existsSync(substitutedPath)) {
        fs.unlinkSync(substitutedPath);
      }
      if (fs.existsSync(relocatedStage)) fs.unlinkSync(relocatedStage);
    }
  });

  it("rejects NTFS ADS and all other non-portable colon paths", async () => {
    const result = await executeTool(
      "write_file",
      { path: "inside.txt:secret", content: "forbidden" },
      {
        cwd: workspace,
        hermeticExecution: true,
        fileMutationScope: {
          exact: true,
          worktreeRoot: canonicalRealpath(workspace),
          allowedPaths: ["inside.txt:secret"],
        },
      },
    );

    expect(result.policy).toMatchObject({
      via: "exact-file-mutation-scope",
      reason: "invalid-scope",
    });
    expect(fs.readFileSync(path.join(workspace, "inside.txt"), "utf8")).toBe(
      "inside",
    );
    if (process.platform !== "win32") {
      expect(fs.existsSync(path.join(workspace, "inside.txt:secret"))).toBe(
        false,
      );
    }
  });
});

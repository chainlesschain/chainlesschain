import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const worktreeMocks = vi.hoisted(() => ({
  setup: vi.fn(),
  finish: vi.fn(),
}));
const supervisorMocks = vi.hoisted(() => ({
  launch: vi.fn(),
  isStartedError: vi.fn((error) => error?.workerStarted === true),
  insertBeforeTerminator: vi.fn((argv, additions) => {
    const out = [...argv];
    const index = out.indexOf("--");
    out.splice(index === -1 ? out.length : index, 0, ...additions);
    return out;
  }),
  buildFollowUpArgv: vi.fn((argv) =>
    argv.filter((arg) => arg !== "-p" && arg !== "do work"),
  ),
}));
const policyMocks = vi.hoisted(() => ({
  resolve: vi.fn(),
}));

vi.mock("../../src/lib/agent-worktree.js", () => ({
  setupAgentWorktree: worktreeMocks.setup,
  finishAgentWorktree: worktreeMocks.finish,
}));

vi.mock("../../src/lib/background-agent-supervisor.js", () => ({
  launchBackgroundAgent: supervisorMocks.launch,
  buildFollowUpArgv: supervisorMocks.buildFollowUpArgv,
  isBackgroundWorkerStartedError: supervisorMocks.isStartedError,
  insertArgumentsBeforeOptionTerminator: supervisorMocks.insertBeforeTerminator,
}));

vi.mock("../../src/lib/background-worktree-policy.js", () => ({
  resolveBackgroundWorktreePolicy: policyMocks.resolve,
}));

vi.mock("../../src/lib/config-manager.js", () => ({
  loadConfig: () => ({ llm: {} }),
  saveConfig: vi.fn(),
}));

import { registerAgentCommand } from "../../src/commands/agent.js";

const canonicalPath = realpathSync.native || realpathSync;

describe("cc agent background worktree dispatch", () => {
  let root;
  let repoRoot;
  let worktreePath;
  let originalArgv;
  let originalCwd;
  let stdout;
  let stderr;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "cc-bg-wt-dispatch-"));
    repoRoot = join(root, "repo");
    worktreePath = join(repoRoot, ".worktrees", "cc-agent-test");
    mkdirSync(worktreePath, { recursive: true });
    originalArgv = process.argv;
    originalCwd = process.cwd();
    process.chdir(repoRoot);
    process.argv = [
      process.execPath,
      "cc",
      "agent",
      "--bg",
      "--worktree",
      "-p",
      "do work",
    ];

    worktreeMocks.setup.mockReset();
    worktreeMocks.finish.mockReset();
    worktreeMocks.finish.mockReturnValue({
      removed: true,
      kept: false,
      reason: "unchanged",
    });
    supervisorMocks.launch.mockReset();
    supervisorMocks.isStartedError.mockClear();
    supervisorMocks.insertBeforeTerminator.mockClear();
    supervisorMocks.buildFollowUpArgv.mockClear();
    policyMocks.resolve.mockReset();
    policyMocks.resolve.mockImplementation(({ background, worktree }) => {
      if (worktree === false) {
        return {
          enabled: false,
          source: "explicit-disable",
          reason: "worktree explicitly disabled",
          repoRoot: null,
        };
      }
      return {
        enabled: worktree === true || background === true,
        source: worktree === true ? "explicit" : "background-git-default",
        reason: "test policy",
        repoRoot,
      };
    });
    worktreeMocks.setup.mockReturnValue({
      path: worktreePath,
      repoRoot,
      branch: "cc-agent-test",
      baseSha: "a".repeat(40),
    });
    supervisorMocks.launch.mockImplementation((input) => ({
      id: "bg-test",
      status: "running",
      ...input,
      worktreePath,
      branch: "cc-agent-test",
    }));
    stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stdout.mockRestore();
    stderr.mockRestore();
    process.argv = originalArgv;
    process.chdir(originalCwd);
    rmSync(root, { recursive: true, force: true });
  });

  it("creates one worktree, transfers it to the supervisor, and strips the child flag", async () => {
    const program = new Command();
    program.exitOverride();
    registerAgentCommand(program);

    await program.parseAsync(["agent", "--bg", "--worktree", "-p", "do work"], {
      from: "user",
    });

    expect(worktreeMocks.setup).toHaveBeenCalledWith({
      cwd: repoRoot,
      requireCleanSource: true,
    });
    expect(supervisorMocks.launch).toHaveBeenCalledTimes(1);
    const launch = supervisorMocks.launch.mock.calls[0][0];
    expect(launch.cwd).toBe(worktreePath);
    expect(launch.worktree).toEqual({
      path: worktreePath,
      repoRoot,
      branch: "cc-agent-test",
      baseSha: "a".repeat(40),
    });
    expect(launch.argv).not.toContain("--bg");
    expect(launch.argv).not.toContain("--background");
    expect(launch.argv).not.toContain("--worktree");
    expect(launch.followUpArgv).not.toContain("--worktree");
    expect(launch.argv).toContain("--session");
    expect(launch.governance).toEqual({
      permissionMode: "default",
      resourceBudget: { maxTurns: null, maxCostUsd: null },
    });
    expect(process.cwd().replace(/^\/private\//, "/")).toBe(repoRoot);

    // Ownership was transferred: the foreground exit/finish path must not
    // reap the directory out from under the detached worker.
    expect(worktreeMocks.finish).not.toHaveBeenCalled();
  });

  it("defaults a background Git task to one isolated worktree", async () => {
    process.argv = [
      process.execPath,
      "cc",
      "agent",
      "--bg",
      "--add-dir",
      repoRoot,
      "-p",
      "do work",
    ];
    const program = new Command();
    program.exitOverride();
    registerAgentCommand(program);

    await program.parseAsync(
      ["agent", "--bg", "--add-dir", repoRoot, "-p", "do work"],
      { from: "user" },
    );

    expect(policyMocks.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ background: true, worktree: undefined }),
    );
    expect(worktreeMocks.setup).toHaveBeenCalledOnce();
    const launch = supervisorMocks.launch.mock.calls[0][0];
    expect(launch.cwd).toBe(worktreePath);
    expect(launch.worktree?.path).toBe(worktreePath);
    expect(launch.argv).not.toContain("--worktree");
    expect(launch.argv).not.toContain("--no-worktree");
    expect(launch.argv[launch.argv.indexOf("--add-dir") + 1]).toBe(
      canonicalPath(worktreePath),
    );
    expect(
      launch.followUpArgv[launch.followUpArgv.indexOf("--add-dir") + 1],
    ).toBe(canonicalPath(worktreePath));
    expect(process.cwd().replace(/^\/private\//, "/")).toBe(repoRoot);
    expect(worktreeMocks.finish).not.toHaveBeenCalled();
  });

  it("creates a default background worktree from the detector's canonical repo root", async () => {
    const aliasedCwd = join(repoRoot, "aliased-subdir");
    mkdirSync(aliasedCwd, { recursive: true });
    process.chdir(aliasedCwd);
    process.argv = [process.execPath, "cc", "agent", "--bg", "-p", "do work"];
    const program = new Command();
    program.exitOverride();
    registerAgentCommand(program);

    await program.parseAsync(["agent", "--bg", "-p", "do work"], {
      from: "user",
    });

    expect(worktreeMocks.setup).toHaveBeenCalledWith({
      cwd: repoRoot,
      requireCleanSource: true,
    });
  });

  it("honors --no-worktree and strips the parent-only decision from child argv", async () => {
    process.argv = [
      process.execPath,
      "cc",
      "agent",
      "--bg",
      "--no-worktree",
      "-p",
      "do work",
    ];
    const program = new Command();
    program.exitOverride();
    registerAgentCommand(program);

    await program.parseAsync(
      ["agent", "--bg", "--no-worktree", "-p", "do work"],
      { from: "user" },
    );

    expect(worktreeMocks.setup).not.toHaveBeenCalled();
    const launch = supervisorMocks.launch.mock.calls[0][0];
    expect(launch.cwd).toBe(repoRoot);
    expect(launch.worktree).toBeNull();
    expect(launch.argv).not.toContain("--worktree");
    expect(launch.argv).not.toContain("--no-worktree");
    expect(launch.followUpArgv).not.toContain("--no-worktree");
  });

  it("inserts the generated session option before a positional terminator", async () => {
    process.argv = [
      process.execPath,
      "cc",
      "agent",
      "--bg",
      "--",
      "literal-task",
      "--session",
      "literal-value",
    ];
    const program = new Command();
    program.exitOverride();
    registerAgentCommand(program);

    await program.parseAsync(
      ["agent", "--bg", "--", "literal-task", "--session", "literal-value"],
      { from: "user" },
    );

    const argv = supervisorMocks.launch.mock.calls[0][0].argv;
    const terminator = argv.indexOf("--");
    const generatedSession = argv.indexOf("--session");
    expect(generatedSession).toBeGreaterThan(-1);
    expect(generatedSession).toBeLessThan(terminator);
    expect(argv.slice(terminator)).toEqual([
      "--",
      "literal-task",
      "--session",
      "literal-value",
    ]);
  });

  it("cleans the isolated worktree synchronously when background launch throws", async () => {
    process.argv = [process.execPath, "cc", "agent", "--bg", "-p", "do work"];
    supervisorMocks.launch.mockImplementationOnce(() => {
      throw new Error("detached spawn failed");
    });
    const program = new Command();
    program.exitOverride();
    registerAgentCommand(program);

    await expect(
      program.parseAsync(["agent", "--bg", "-p", "do work"], {
        from: "user",
      }),
    ).rejects.toThrow("detached spawn failed");

    expect(worktreeMocks.finish).toHaveBeenCalledWith(
      expect.objectContaining({ path: worktreePath, repoRoot }),
    );
    expect(process.cwd().replace(/^\/private\//, "/")).toBe(repoRoot);
  });

  it("retains the worktree when the detached worker started before launch finalization failed", async () => {
    process.argv = [process.execPath, "cc", "agent", "--bg", "-p", "do work"];
    const error = Object.assign(new Error("state publication failed"), {
      workerStarted: true,
    });
    supervisorMocks.launch.mockImplementationOnce(() => {
      throw error;
    });
    const program = new Command();
    program.exitOverride();
    registerAgentCommand(program);

    await expect(
      program.parseAsync(["agent", "--bg", "-p", "do work"], {
        from: "user",
      }),
    ).rejects.toBe(error);

    expect(supervisorMocks.isStartedError).toHaveBeenCalledWith(error);
    expect(worktreeMocks.finish).not.toHaveBeenCalled();
    expect(process.cwd().replace(/^\/private\//, "/")).toBe(repoRoot);
  });

  it("cleans a created worktree when entering its directory fails", async () => {
    const missingWorktree = join(repoRoot, ".worktrees", "missing");
    worktreeMocks.setup.mockReturnValueOnce({
      path: missingWorktree,
      repoRoot,
      branch: "cc-agent-missing",
      baseSha: "b".repeat(40),
    });
    const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit:${code}`);
    });
    process.argv = [process.execPath, "cc", "agent", "--bg", "-p", "do work"];
    const program = new Command();
    program.exitOverride();
    registerAgentCommand(program);

    try {
      await expect(
        program.parseAsync(["agent", "--bg", "-p", "do work"], {
          from: "user",
        }),
      ).rejects.toThrow("process.exit:1");
    } finally {
      exit.mockRestore();
    }

    expect(worktreeMocks.finish).toHaveBeenCalledWith(
      expect.objectContaining({
        path: missingWorktree,
        repoRoot,
        branch: "cc-agent-missing",
      }),
    );
    expect(process.cwd().replace(/^\/private\//, "/")).toBe(repoRoot);
  });
});

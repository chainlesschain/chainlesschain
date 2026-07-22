import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const worktreeMocks = vi.hoisted(() => ({
  setup: vi.fn(),
  finish: vi.fn(),
}));
const supervisorMocks = vi.hoisted(() => ({
  launch: vi.fn(),
  buildFollowUpArgv: vi.fn((argv) =>
    argv.filter((arg) => arg !== "-p" && arg !== "do work"),
  ),
}));

vi.mock("../../src/lib/agent-worktree.js", () => ({
  setupAgentWorktree: worktreeMocks.setup,
  finishAgentWorktree: worktreeMocks.finish,
}));

vi.mock("../../src/lib/background-agent-supervisor.js", () => ({
  launchBackgroundAgent: supervisorMocks.launch,
  buildFollowUpArgv: supervisorMocks.buildFollowUpArgv,
}));

vi.mock("../../src/lib/config-manager.js", () => ({
  loadConfig: () => ({ llm: {} }),
  saveConfig: vi.fn(),
}));

import { registerAgentCommand } from "../../src/commands/agent.js";

describe("cc agent --bg --worktree dispatch", () => {
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
    supervisorMocks.launch.mockReset();
    supervisorMocks.buildFollowUpArgv.mockClear();
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

    expect(worktreeMocks.setup).toHaveBeenCalledWith({ cwd: repoRoot });
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
    expect(process.cwd().replace(/^\/private\//, "/")).toBe(repoRoot);

    // Ownership was transferred: the foreground exit/finish path must not
    // reap the directory out from under the detached worker.
    expect(worktreeMocks.finish).not.toHaveBeenCalled();
  });
});

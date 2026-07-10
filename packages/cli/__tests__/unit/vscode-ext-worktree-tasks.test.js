import { describe, expect, it } from "vitest";

import {
  buildAheadArgs,
  buildBranchDeleteArgs,
  buildMergeAbortArgs,
  buildMergeArgs,
  buildMergePreviewArgs,
  buildNewTaskCommand,
  buildShortstatArgs,
  buildWorktreeListArgs,
  buildWorktreeRemoveArgs,
  isTaskBranch,
  parseMergePreview,
  parseWorktreeList,
  summarizeShortstat,
} from "../../../vscode-extension/src/worktree-tasks.js";

const PORCELAIN = [
  "worktree C:/repo",
  "HEAD 1111111111111111111111111111111111111111",
  "branch refs/heads/main",
  "",
  "worktree C:/repo/.cc-worktrees/cc-agent-20260710-ab12",
  "HEAD 2222222222222222222222222222222222222222",
  "branch refs/heads/cc-agent-20260710-ab12",
  "",
  "worktree C:/elsewhere/feature",
  "HEAD 3333333333333333333333333333333333333333",
  "branch refs/heads/feature/other",
  "",
  "worktree C:/repo/.cc-worktrees/detached",
  "HEAD 4444444444444444444444444444444444444444",
  "detached",
  "",
].join("\n");

describe("worktree list parsing", () => {
  it("marks the main checkout and agent task branches", () => {
    const rows = parseWorktreeList(PORCELAIN);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({
      branch: "main",
      main: true,
      isTask: false,
    });
    expect(rows[1]).toMatchObject({
      branch: "cc-agent-20260710-ab12",
      main: false,
      isTask: true,
    });
    // A human feature branch is NOT an agent task.
    expect(rows[2]).toMatchObject({ branch: "feature/other", isTask: false });
    // Detached worktrees carry no branch and never count as tasks.
    expect(rows[3]).toMatchObject({ branch: "", isTask: false });
    expect(parseWorktreeList("")).toEqual([]);
  });

  it("recognizes all three task-branch prefixes", () => {
    expect(isTaskBranch("cc-agent-x")).toBe(true);
    expect(isTaskBranch("batch/unit-1")).toBe(true);
    expect(isTaskBranch("agent/task-9")).toBe(true);
    expect(isTaskBranch("main")).toBe(false);
    expect(isTaskBranch("")).toBe(false);
  });
});

describe("merge preview parsing", () => {
  it("classifies clean / conflict / unknown", () => {
    expect(parseMergePreview({ code: 0, stdout: "abc123\n" })).toEqual({
      risk: "clean",
      files: [],
    });
    const conflicted = parseMergePreview({
      code: 1,
      stdout: [
        "deadbeefcafe",
        "src/a.js",
        "src/b.js",
        "",
        "Auto-merging src/a.js",
        "CONFLICT (content): ...",
      ].join("\n"),
    });
    expect(conflicted.risk).toBe("conflict");
    expect(conflicted.files).toEqual(["src/a.js", "src/b.js"]);
    // Older git without --write-tree → unknown, never a guess.
    expect(
      parseMergePreview({
        code: 129,
        stderr: "error: unknown option `write-tree'",
      }),
    ).toEqual({ risk: "unknown", files: [] });
  });
});

describe("shortstat + argv + new-task command", () => {
  it("summarizes shortstat compactly", () => {
    expect(
      summarizeShortstat(" 3 files changed, 40 insertions(+), 2 deletions(-)"),
    ).toBe("+40 −2 (3 files)");
    expect(summarizeShortstat(" 1 file changed, 5 insertions(+)")).toBe(
      "+5 −0 (1 file)",
    );
    expect(summarizeShortstat("")).toBe("no diff");
  });

  it("builds the git argv", () => {
    expect(buildWorktreeListArgs()).toEqual([
      "worktree",
      "list",
      "--porcelain",
    ]);
    expect(buildAheadArgs("abc", "b1")).toEqual([
      "rev-list",
      "--count",
      "abc..b1",
    ]);
    expect(buildShortstatArgs("abc", "b1")).toEqual([
      "diff",
      "--shortstat",
      "abc...b1",
    ]);
    expect(buildMergePreviewArgs("main", "b1")).toEqual([
      "merge-tree",
      "--write-tree",
      "--name-only",
      "main",
      "b1",
    ]);
    expect(buildMergeArgs("b1")).toEqual(["merge", "--no-ff", "b1"]);
    expect(buildMergeAbortArgs()).toEqual(["merge", "--abort"]);
    expect(buildWorktreeRemoveArgs("/wt")).toEqual([
      "worktree",
      "remove",
      "--force",
      "/wt",
    ]);
    expect(buildBranchDeleteArgs("b1")).toEqual(["branch", "-D", "b1"]);
  });

  it("builds a shell-safe new-task command", () => {
    expect(buildNewTaskCommand("fix the tests", { windows: true })).toBe(
      'cc agent --worktree -p "fix the tests"',
    );
    expect(
      buildNewTaskCommand("fix the tests", { command: "clc", windows: false }),
    ).toBe("clc agent --worktree -p 'fix the tests'");
    // Quotes/backticks in the task are stripped, not escaped.
    expect(buildNewTaskCommand('say "hi" `now`', { windows: true })).toBe(
      'cc agent --worktree -p "say  hi   now"',
    );
  });
});

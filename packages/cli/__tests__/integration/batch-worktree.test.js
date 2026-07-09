/**
 * Integration: cc batch against a REAL git repo + REAL worktrees. The agent is
 * stubbed (injected runAgent that writes a file) — everything else (worktree
 * create/remove, git diff numstat, commit, merge preview/merge) is real, so
 * this exercises the actual isolation + integration path end-to-end.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { runBatchCommand } from "../../src/commands/batch.js";
import {
  createWorktree,
  removeWorktree,
  previewWorktreeMerge,
  mergeWorktree,
} from "../../src/harness/worktree-isolator.js";

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

describe("cc batch — real worktree integration", () => {
  let repo;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "cc-batch-repo-"));
    git(["init", "-q", "-b", "main"], repo);
    git(["config", "user.email", "t@test"], repo);
    git(["config", "user.name", "test"], repo);
    git(["config", "commit.gpgsign", "false"], repo);
    fs.writeFileSync(path.join(repo, "README.md"), "base\n");
    git(["add", "-A"], repo);
    git(["commit", "-qm", "init"], repo);
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("runs two independent units in real worktrees and merges both", async () => {
    const unitsFile = path.join(repo, "units.json");
    fs.writeFileSync(
      unitsFile,
      JSON.stringify({
        units: [
          { key: "add-a", prompt: "create a.txt" },
          { key: "add-b", prompt: "create b.txt" },
        ],
      }),
    );

    // Injected "agent": writes the file its prompt names, in the worktree cwd.
    const runAgent = async (prompt, cwd) => {
      const file = prompt.includes("a.txt") ? "a.txt" : "b.txt";
      fs.writeFileSync(path.join(cwd, file), `content for ${file}\n`);
      return { code: 0 };
    };

    const logs = [];
    const code = await runBatchCommand(
      { units: unitsFile, merge: true, json: true },
      {
        repoDir: repo,
        log: (m) => logs.push(m),
        err: (m) => logs.push("ERR:" + m),
        // Real worktree + git deps; only the agent is stubbed.
        batchDeps: {
          createWorktree: (key, branch) => createWorktree(repo, branch).path,
          removeWorktree: (p, opts) => removeWorktree(repo, p, opts),
          runAgent,
          runTest: async () => ({ code: 0 }),
          diffStat: realDiffStat,
          commit: realCommit,
          previewMerge: (branch) => previewWorktreeMerge(repo, branch),
          mergeBranch: (branch, message) =>
            mergeWorktree(repo, branch, { message }),
          branchFor: (key) => `batch/${key}`,
        },
      },
    );

    expect(code).toBe(0);
    const out = JSON.parse(logs.join("\n"));
    expect(out.summary).toMatchObject({ total: 2, done: 2, merged: 2 });

    // Both files actually landed on main.
    git(["checkout", "-q", "main"], repo);
    expect(fs.existsSync(path.join(repo, "a.txt"))).toBe(true);
    expect(fs.existsSync(path.join(repo, "b.txt"))).toBe(true);
  });

  it("reports a real merge conflict without clobbering base", async () => {
    const unitsFile = path.join(repo, "units.json");
    fs.writeFileSync(
      unitsFile,
      JSON.stringify({
        units: [
          { key: "edit-1", prompt: "first" },
          { key: "edit-2", prompt: "second" },
        ],
      }),
    );
    // Both units edit the SAME line of README → second merge conflicts.
    const runAgent = async (prompt, cwd) => {
      fs.writeFileSync(path.join(cwd, "README.md"), `changed by ${prompt}\n`);
      return { code: 0 };
    };

    const logs = [];
    const code = await runBatchCommand(
      { units: unitsFile, merge: true, json: true },
      {
        repoDir: repo,
        log: (m) => logs.push(m),
        err: (m) => logs.push("ERR:" + m),
        batchDeps: {
          createWorktree: (key, branch) => createWorktree(repo, branch).path,
          removeWorktree: (p, opts) => removeWorktree(repo, p, opts),
          runAgent,
          runTest: async () => ({ code: 0 }),
          diffStat: realDiffStat,
          commit: realCommit,
          previewMerge: (branch) => previewWorktreeMerge(repo, branch),
          mergeBranch: (branch, message) =>
            mergeWorktree(repo, branch, { message }),
          branchFor: (key) => `batch/${key}`,
        },
      },
    );

    expect(code).toBe(0); // no test/agent failure — a conflict is a report, not an error
    const out = JSON.parse(logs.join("\n"));
    // First merges; second conflicts.
    expect(out.summary.merged).toBe(1);
    expect(out.summary.conflicted).toBe(1);
  });
});

function realDiffStat(cwd) {
  execFileSync("git", ["add", "-A"], { cwd });
  const numstat = execFileSync("git", ["diff", "--cached", "--numstat"], {
    cwd,
    encoding: "utf8",
  });
  let filesChanged = 0;
  let insertions = 0;
  let deletions = 0;
  for (const line of numstat.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const [a, d] = t.split("\t");
    filesChanged += 1;
    insertions += a === "-" ? 0 : parseInt(a, 10) || 0;
    deletions += d === "-" ? 0 : parseInt(d, 10) || 0;
  }
  return { filesChanged, insertions, deletions };
}

function realCommit(cwd, message) {
  try {
    execFileSync("git", ["add", "-A"], { cwd });
    execFileSync("git", ["commit", "-m", message, "--no-verify"], { cwd });
    return true;
  } catch {
    return false;
  }
}

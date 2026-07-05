import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

// Regression: `cc agent --worktree` creates an isolated git worktree FIRST
// (before flag validation), then several `process.exit(1)` validation guards
// exited without running the cleanup — leaving an orphan (empty, changed-
// nothing) worktree + branch on disk that the command otherwise promises to
// auto-remove.

const CLI_DIR = fileURLToPath(new URL("../..", import.meta.url));
const BIN = join(CLI_DIR, "bin", "chainlesschain.js");

function git(cmd, cwd) {
  return execSync(`git ${cmd}`, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

describe("cc agent --worktree cleanup on early-exit validation guard", () => {
  let repo;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "ccwt-repo-"));
    git("init", repo);
    git("config user.email t@t.t", repo);
    git("config user.name t", repo);
    writeFileSync(join(repo, "README.md"), "# repo\n");
    git("add -A", repo);
    git("commit -m init", repo);
  });

  afterEach(() => {
    try {
      rmSync(repo, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  it("removes the isolated worktree when a validation guard exits before the run", () => {
    // --permission-prompt-tool without --mcp-config fails validation AFTER the
    // worktree is created (agent.js). The worktree changed nothing, so cleanup
    // must remove it rather than orphan it.
    let exitCode = 0;
    try {
      execSync(
        `node "${BIN}" agent --worktree --permission-prompt-tool foo -p "hi"`,
        {
          cwd: repo,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 90000,
        },
      );
    } catch (err) {
      exitCode = err.status ?? 1;
    }

    expect(exitCode).toBe(1); // the validation guard fired
    const worktrees = git("worktree list", repo);
    expect(worktrees).not.toContain("cc-agent-");
  });
});

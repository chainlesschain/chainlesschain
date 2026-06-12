/**
 * cc agent --worktree glue (CC 2.1.171 parity) — real temp git repos:
 * setup creates an isolated branch worktree; finish removes when the session
 * changed nothing and keeps (with a merge hint) when it did.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  setupAgentWorktree,
  finishAgentWorktree,
} from "../../src/lib/agent-worktree.js";

let repo;

function git(cmd, cwd = repo) {
  return execSync(`git ${cmd}`, { cwd, encoding: "utf8" });
}

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "cc-wt-"));
  git("init -b main");
  git('config user.email "t@t"');
  git('config user.name "t"');
  fs.writeFileSync(path.join(repo, "a.txt"), "base", "utf-8");
  git("add a.txt");
  git('commit -m base --no-verify');
});

afterEach(() => {
  try {
    fs.rmSync(repo, { recursive: true, force: true });
  } catch {
    /* Windows file locks — best-effort */
  }
});

describe("setupAgentWorktree", () => {
  it("creates a worktree on a fresh cc-agent-* branch with the base sha", () => {
    const info = setupAgentWorktree({ cwd: repo });
    expect(fs.existsSync(info.path)).toBe(true);
    expect(info.branch).toMatch(/^cc-agent-/);
    expect(info.repoRoot).toBe(repo);
    expect(info.baseSha).toMatch(/^[0-9a-f]{40}$/);
    expect(fs.readFileSync(path.join(info.path, "a.txt"), "utf-8")).toBe(
      "base",
    );
  });

  it("throws outside a git repository", () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), "cc-wt-plain-"));
    try {
      expect(() => setupAgentWorktree({ cwd: plain })).toThrow(/git repo/i);
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });
});

describe("finishAgentWorktree", () => {
  it("removes the worktree when the session changed nothing", () => {
    const info = setupAgentWorktree({ cwd: repo });
    const fin = finishAgentWorktree(info);
    expect(fin.removed).toBe(true);
    expect(fs.existsSync(info.path)).toBe(false);
    expect(git("branch --list " + info.branch).trim()).toBe(""); // branch gone
  });

  it("keeps the worktree on uncommitted changes, with a merge hint", () => {
    const info = setupAgentWorktree({ cwd: repo });
    fs.writeFileSync(path.join(info.path, "new.txt"), "work", "utf-8");
    const fin = finishAgentWorktree(info);
    expect(fin.kept).toBe(true);
    expect(fin.reason).toBe("uncommitted changes");
    expect(fin.mergeHint).toContain(info.branch);
    expect(fs.existsSync(info.path)).toBe(true);
  });

  it("keeps the worktree when the session committed", () => {
    const info = setupAgentWorktree({ cwd: repo });
    fs.writeFileSync(path.join(info.path, "done.txt"), "x", "utf-8");
    git("add done.txt", info.path);
    git('commit -m work --no-verify', info.path);
    const fin = finishAgentWorktree(info);
    expect(fin.kept).toBe(true);
    expect(fin.reason).toBe("new commits");
  });
});

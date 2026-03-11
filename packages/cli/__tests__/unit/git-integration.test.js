import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock child_process and fs
vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("fs", () => ({
  default: {},
  existsSync: vi.fn(),
  writeFileSync: vi.fn(),
  chmodSync: vi.fn(),
}));

import { execSync } from "child_process";
import { existsSync, writeFileSync, chmodSync } from "fs";
import {
  isGitRepo,
  gitExec,
  gitInit,
  gitStatus,
  getCurrentBranch,
  gitAutoCommit,
  gitLog,
  gitHistoryAnalyze,
  installHooks,
} from "../../src/lib/git-integration.js";

describe("Git Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── isGitRepo ────────────────────────────────────────────────

  describe("isGitRepo", () => {
    it("should return true if .git exists", () => {
      existsSync.mockReturnValue(true);
      expect(isGitRepo("/test")).toBe(true);
    });

    it("should return false if .git does not exist", () => {
      existsSync.mockReturnValue(false);
      expect(isGitRepo("/test")).toBe(false);
    });
  });

  // ─── gitExec ──────────────────────────────────────────────────

  describe("gitExec", () => {
    it("should execute git command and return output", () => {
      execSync.mockReturnValue("main\n");
      const result = gitExec("rev-parse --abbrev-ref HEAD", "/test");
      expect(result).toBe("main");
      expect(execSync).toHaveBeenCalledWith(
        "git rev-parse --abbrev-ref HEAD",
        expect.objectContaining({ cwd: "/test" }),
      );
    });

    it("should throw on error with stderr message", () => {
      execSync.mockImplementation(() => {
        const err = new Error("Command failed");
        err.stderr = Buffer.from("fatal: not a git repository");
        throw err;
      });

      expect(() => gitExec("status", "/test")).toThrow(
        "fatal: not a git repository",
      );
    });
  });

  // ─── gitInit ──────────────────────────────────────────────────

  describe("gitInit", () => {
    it("should initialize a new repo", () => {
      existsSync.mockReturnValue(false);
      execSync.mockReturnValue("");

      const result = gitInit("/test");
      expect(result.initialized).toBe(true);
      expect(execSync).toHaveBeenCalledWith("git init", expect.any(Object));
    });

    it("should report already initialized", () => {
      existsSync.mockReturnValue(true);

      const result = gitInit("/test");
      expect(result.initialized).toBe(false);
      expect(result.message).toContain("Already");
    });
  });

  // ─── gitStatus ────────────────────────────────────────────────

  describe("gitStatus", () => {
    it("should return not-a-repo status", () => {
      existsSync.mockReturnValue(false);
      const status = gitStatus("/test");
      expect(status.isRepo).toBe(false);
    });

    it("should parse porcelain status", () => {
      existsSync.mockReturnValue(true);
      execSync
        .mockReturnValueOnce(" M src/index.js\n?? newfile.txt\n") // porcelain (raw, not trimmed)
        .mockReturnValueOnce("main\n"); // branch via gitExec (trimmed)

      const status = gitStatus("/test");
      expect(status.isRepo).toBe(true);
      expect(status.branch).toBe("main");
      expect(status.files).toHaveLength(2);
      expect(status.files[0].status).toBe("M");
      expect(status.files[0].file).toBe("src/index.js");
      expect(status.clean).toBe(false);
    });

    it("should report clean repo", () => {
      existsSync.mockReturnValue(true);
      execSync
        .mockReturnValueOnce("") // porcelain
        .mockReturnValueOnce("main\n"); // branch

      const status = gitStatus("/test");
      expect(status.clean).toBe(true);
      expect(status.files).toHaveLength(0);
    });
  });

  // ─── getCurrentBranch ─────────────────────────────────────────

  describe("getCurrentBranch", () => {
    it("should return branch name", () => {
      execSync.mockReturnValue("feature/test\n");
      expect(getCurrentBranch("/test")).toBe("feature/test");
    });

    it("should return unknown on error", () => {
      execSync.mockImplementation(() => {
        throw new Error("not a repo");
      });
      expect(getCurrentBranch("/test")).toBe("unknown");
    });
  });

  // ─── gitAutoCommit ────────────────────────────────────────────

  describe("gitAutoCommit", () => {
    it("should throw if not a git repo", () => {
      existsSync.mockReturnValue(false);
      expect(() => gitAutoCommit("/test")).toThrow("Not a git repository");
    });

    it("should return not committed when clean", () => {
      existsSync.mockReturnValue(true);
      execSync
        .mockReturnValueOnce("") // status --porcelain
        .mockReturnValueOnce("main\n"); // branch

      const result = gitAutoCommit("/test");
      expect(result.committed).toBe(false);
    });

    it("should commit with custom message", () => {
      existsSync.mockReturnValue(true);
      execSync
        .mockReturnValueOnce(" M file.txt\n") // status --porcelain
        .mockReturnValueOnce("main\n") // branch
        .mockReturnValueOnce("") // add -A
        .mockReturnValueOnce("") // commit
        .mockReturnValueOnce("abc1234\n"); // rev-parse

      const result = gitAutoCommit("/test", "custom message");
      expect(result.committed).toBe(true);
      expect(result.hash).toBe("abc1234");
      expect(result.message).toBe("custom message");
    });

    it("should generate auto message when not provided", () => {
      existsSync.mockReturnValue(true);
      execSync
        .mockReturnValueOnce(" M file1.txt\n M file2.txt\n")
        .mockReturnValueOnce("main\n")
        .mockReturnValueOnce("")
        .mockReturnValueOnce("")
        .mockReturnValueOnce("def5678\n");

      const result = gitAutoCommit("/test");
      expect(result.committed).toBe(true);
      expect(result.message).toContain("2 file(s) changed");
    });
  });

  // ─── gitLog ───────────────────────────────────────────────────

  describe("gitLog", () => {
    it("should return empty array for non-repo", () => {
      existsSync.mockReturnValue(false);
      expect(gitLog("/test")).toEqual([]);
    });

    it("should parse log output", () => {
      existsSync.mockReturnValue(true);
      execSync.mockReturnValue(
        "abc123full|abc1234|feat: add feature|2024-01-15 10:00:00|Author Name\ndef456full|def4567|fix: bug fix|2024-01-14 09:00:00|Other Author",
      );

      const log = gitLog("/test", 5);
      expect(log).toHaveLength(2);
      expect(log[0].shortHash).toBe("abc1234");
      expect(log[0].subject).toBe("feat: add feature");
      expect(log[1].author).toBe("Other Author");
    });

    it("should handle errors gracefully", () => {
      existsSync.mockReturnValue(true);
      execSync.mockImplementation(() => {
        throw new Error("no commits");
      });
      expect(gitLog("/test")).toEqual([]);
    });
  });

  // ─── gitHistoryAnalyze ────────────────────────────────────────

  describe("gitHistoryAnalyze", () => {
    it("should throw if not a repo", () => {
      existsSync.mockReturnValue(false);
      expect(() => gitHistoryAnalyze("/test")).toThrow("Not a git repository");
    });

    it("should return analysis data", () => {
      existsSync.mockReturnValue(true);
      execSync
        .mockReturnValueOnce("42\n") // rev-list --count
        .mockReturnValueOnce("2023-01-01 00:00:00\n") // first commit
        .mockReturnValueOnce("2024-01-15 10:00:00\n") // last commit
        .mockReturnValueOnce("  30\tAlice\n  12\tBob\n") // shortlog
        .mockReturnValueOnce("a.js\nb.js\nc.js\n"); // ls-files

      const analysis = gitHistoryAnalyze("/test");
      expect(analysis.totalCommits).toBe(42);
      expect(analysis.contributors).toHaveLength(2);
      expect(analysis.contributors[0].author).toBe("Alice");
      expect(analysis.contributors[0].commits).toBe(30);
      expect(analysis.trackedFiles).toBe(3);
    });
  });

  // ─── installHooks ──────────────────────────────────────────

  describe("installHooks", () => {
    it("should throw if not a git repo", () => {
      existsSync.mockReturnValue(false);
      expect(() => installHooks("/test")).toThrow("Not a git repository");
    });
  });
});

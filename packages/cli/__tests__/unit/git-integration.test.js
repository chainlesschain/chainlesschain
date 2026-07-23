import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock child_process and fs
vi.mock("child_process", () => ({
  execSync: vi.fn(),
  // gitExecArgs (argv, no shell) routes free-text commit messages here.
  spawnSync: vi.fn(() => ({ status: 0, stdout: "" })),
}));

vi.mock("fs", () => ({
  default: {},
  existsSync: vi.fn(),
  writeFileSync: vi.fn(),
  chmodSync: vi.fn(),
}));

import { execSync, spawnSync } from "child_process";
import { existsSync, writeFileSync, chmodSync } from "fs";
import {
  _deps,
  isGitRepo,
  gitExec,
  gitInit,
  gitStatus,
  getCurrentBranch,
  gitAutoCommit,
  gitLog,
  gitHistoryAnalyze,
  installHooks,
  assertSafeGitRef,
  assertSafeGitPath,
} from "../../src/lib/git-integration.js";

describe("assertSafeGitRef (shell-injection guard for interpolated git refs)", () => {
  it("accepts legitimate branch/base refs", () => {
    for (const ref of [
      "HEAD",
      "main",
      "origin/main",
      "agent/task-123",
      "feature/my.thing_v2",
      "v1.2.3",
    ]) {
      expect(() => assertSafeGitRef(ref)).not.toThrow();
    }
  });

  it("rejects shell metacharacters / command substitution", () => {
    for (const ref of [
      "x$(whoami)",
      "x`id`",
      "a;rm -rf ~",
      "a && b",
      "a|b",
      "a b", // space
      "a\nb",
      'a"b',
    ]) {
      expect(() => assertSafeGitRef(ref)).toThrow(/Unsafe/);
    }
  });

  it("rejects flag injection, ranges, and bad refnames", () => {
    expect(() => assertSafeGitRef("--upload-pack=evil")).toThrow(/Unsafe/);
    expect(() => assertSafeGitRef("a..b")).toThrow(/Unsafe/);
    expect(() => assertSafeGitRef("a//b")).toThrow(/Unsafe/);
    expect(() => assertSafeGitRef("foo/")).toThrow(/Unsafe/);
    expect(() => assertSafeGitRef("foo.lock")).toThrow(/Unsafe/);
  });

  it("rejects empty / non-string", () => {
    expect(() => assertSafeGitRef("")).toThrow(/Invalid/);
    expect(() => assertSafeGitRef(null)).toThrow(/Invalid/);
    expect(() => assertSafeGitRef(undefined)).toThrow(/Invalid/);
  });
});

describe("assertSafeGitPath (shell-injection guard for interpolated file paths)", () => {
  it("accepts ordinary repo-relative paths", () => {
    for (const p of [
      "src/index.js",
      "a/b/c.test.ts",
      "file with spaces.md",
      "weird-but-ok_name.v2.json",
      "pkg/Foo+Bar@1.txt",
    ]) {
      expect(() => assertSafeGitPath(p)).not.toThrow();
    }
  });

  it("rejects shell metacharacters / command substitution", () => {
    for (const p of [
      'x"; rm -rf ~; echo "',
      "x$(whoami).js",
      "x`id`.js",
      "a;b",
      "a|b",
      "a&b",
      "a>b",
      "a\nb",
    ]) {
      expect(() => assertSafeGitPath(p)).toThrow(/Unsafe/);
    }
  });

  it("rejects traversal, absolute paths, and flag injection", () => {
    expect(() => assertSafeGitPath("../etc/passwd")).toThrow(/Unsafe/);
    expect(() => assertSafeGitPath("/etc/passwd")).toThrow(/Unsafe/);
    expect(() => assertSafeGitPath("C:/Windows/x")).toThrow(/Unsafe/);
    expect(() => assertSafeGitPath("--output=evil")).toThrow(/Unsafe/);
  });

  it("rejects empty / non-string", () => {
    expect(() => assertSafeGitPath("")).toThrow(/Invalid/);
    expect(() => assertSafeGitPath(null)).toThrow(/Invalid/);
  });
});

describe("Git Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _deps.execSync = execSync;
    _deps.spawnSync = spawnSync;
    // clearAllMocks wipes the default impl; restore the success return.
    spawnSync.mockReturnValue({ status: 0, stdout: "" });
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
        expect.objectContaining({
          cwd: "/test",
          origin: "git-integration:shell",
          policy: "allow",
          scope: "git",
        }),
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

    it("raises maxBuffer to 64 MB so a large diff/log can't ENOBUFS", () => {
      // Parity with gitExecArgs — git diff/log/worktree-list output on a big
      // repo exceeds execSync's 1 MB default and would spuriously fail.
      execSync.mockReturnValue("");
      gitExec("log --oneline", "/test");
      expect(execSync).toHaveBeenCalledWith(
        "git log --oneline",
        expect.objectContaining({ maxBuffer: 64 * 1024 * 1024 }),
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
        .mockReturnValueOnce("abc1234\n"); // rev-parse (commit goes via spawnSync)

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
        .mockReturnValueOnce("def5678\n");

      const result = gitAutoCommit("/test");
      expect(result.committed).toBe(true);
      expect(result.message).toContain("2 file(s) changed");
    });

    it("commits the message via argv (no shell) so $()/backticks can't inject", () => {
      existsSync.mockReturnValue(true);
      execSync
        .mockReturnValueOnce(" M file.txt\n") // status --porcelain
        .mockReturnValueOnce("main\n") // branch
        .mockReturnValueOnce("") // add -A
        .mockReturnValueOnce(" feed00d\n"); // rev-parse

      const evil = "$(touch PWNED)`touch PWNED`; rm -rf ~";
      const result = gitAutoCommit("/test", evil);
      expect(result.committed).toBe(true);
      // The message went through spawnSync as a verbatim argv element — never a
      // shell string — so the substitution is inert and stored literally.
      expect(spawnSync).toHaveBeenCalledWith(
        "git",
        ["commit", "-m", evil],
        expect.objectContaining({
          cwd: "/test",
          origin: "git-integration:argv",
          policy: "allow",
          scope: "git",
          shell: false,
        }),
      );
      // And `git commit -m "<evil>"` was never built as a shell command.
      for (const call of execSync.mock.calls) {
        expect(call[0]).not.toContain("commit -m");
      }
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
      // Format is "%H|%h|%ai|%an|%s" — subject is last.
      execSync.mockReturnValue(
        "abc123full|abc1234|2024-01-15 10:00:00|Author Name|feat: add feature\ndef456full|def4567|2024-01-14 09:00:00|Other Author|fix: bug fix",
      );

      const log = gitLog("/test", 5);
      expect(log).toHaveLength(2);
      expect(log[0].shortHash).toBe("abc1234");
      expect(log[0].subject).toBe("feat: add feature");
      expect(log[0].date).toBe("2024-01-15 10:00:00");
      expect(log[1].author).toBe("Other Author");
    });

    it("parses a subject that itself contains the pipe delimiter", () => {
      existsSync.mockReturnValue(true);
      // Subject "fix: handle a|b|c case" contains pipes; date/author must stay
      // intact and the full subject must be reassembled.
      execSync.mockReturnValue(
        "abc123full|abc1234|2024-01-15 10:00:00|Author Name|fix: handle a|b|c case",
      );

      const log = gitLog("/test");
      expect(log).toHaveLength(1);
      expect(log[0].subject).toBe("fix: handle a|b|c case");
      expect(log[0].date).toBe("2024-01-15 10:00:00");
      expect(log[0].author).toBe("Author Name");
    });

    it("should handle errors gracefully", () => {
      existsSync.mockReturnValue(true);
      execSync.mockImplementation(() => {
        throw new Error("no commits");
      });
      expect(gitLog("/test")).toEqual([]);
    });

    it("coerces a non-numeric limit to a safe integer (no shell injection)", () => {
      existsSync.mockReturnValue(true);
      execSync.mockReturnValue("");
      // A hostile limit would otherwise be interpolated into the shell string.
      // parseInt keeps only the leading digits (5) and drops the payload.
      gitLog("/test", "5; touch PWNED");
      const cmd = execSync.mock.calls[0][0];
      expect(cmd).toContain("log --oneline --no-decorate -5 ");
      expect(cmd).not.toContain("touch PWNED");
      expect(cmd).not.toContain(";");

      // A fully non-numeric limit falls back to the default 10.
      execSync.mockClear();
      gitLog("/test", "$(touch PWNED)");
      const cmd2 = execSync.mock.calls[0][0];
      expect(cmd2).toContain("log --oneline --no-decorate -10 ");
      expect(cmd2).not.toContain("touch PWNED");
      expect(cmd2).not.toContain("$(");
    });

    it("uses a valid numeric limit verbatim and clamps absurd values", () => {
      existsSync.mockReturnValue(true);
      execSync.mockReturnValue("");
      gitLog("/test", 5);
      expect(execSync.mock.calls[0][0]).toContain("-5 ");
      execSync.mockClear();
      gitLog("/test", 999999);
      expect(execSync.mock.calls[0][0]).toContain("-10000 "); // clamped
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

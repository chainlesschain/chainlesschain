import { describe, expect, it, vi } from "vitest";

import {
  findGitRepositoryRootStrict,
  resolveBackgroundWorktreePolicy,
} from "../../src/lib/background-worktree-policy.js";

function resolve(overrides = {}) {
  return resolveBackgroundWorktreePolicy({
    background: true,
    worktree: undefined,
    inputFormat: "text",
    permissionMode: "default",
    cwd: "/repo/subdir",
    findProjectRoot: () => "/repo",
    ...overrides,
  });
}

describe("background worktree policy", () => {
  it("distinguishes a missing Git marker from an unreadable one", () => {
    const missing = new Error("missing");
    missing.code = "ENOENT";
    expect(
      findGitRepositoryRootStrict("/repo/subdir", {
        realpath: (value) => value,
        stat: () => {
          throw missing;
        },
      }),
    ).toBeNull();

    const denied = new Error("denied");
    denied.code = "EACCES";
    expect(() =>
      findGitRepositoryRootStrict("/repo/subdir", {
        realpath: (value) => value,
        stat: () => {
          throw denied;
        },
      }),
    ).toThrow("denied");
  });

  it("walks the canonical cwd when an alias points inside a repository", () => {
    const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
    const stat = vi.fn((candidate) => {
      if (candidate === "/canonical/repo/.git") return {};
      throw missing;
    });
    const pathApi = {
      resolve: (value) => value,
      join: (...parts) => parts.join("/").replace(/\/{2,}/g, "/"),
      dirname: (value) => value.slice(0, value.lastIndexOf("/")) || "/",
    };

    expect(
      findGitRepositoryRootStrict("/alias/subdir", {
        realpath: () => "/canonical/repo/subdir",
        stat,
        pathApi,
      }),
    ).toBe("/canonical/repo");
    expect(stat).not.toHaveBeenCalledWith("/alias/.git");
  });

  it("isolates mutation-capable background agents in a git repository", () => {
    expect(resolve()).toEqual({
      enabled: true,
      source: "background-git-default",
      reason: "mutation-capable background agent in a git repository",
      repoRoot: "/repo",
    });
  });

  it("preserves explicit --worktree and --no-worktree precedence", () => {
    const detector = vi.fn(() => "/repo");

    expect(
      resolve({ background: false, worktree: true, findProjectRoot: detector }),
    ).toMatchObject({
      enabled: true,
      source: "explicit",
      repoRoot: "/repo",
    });
    expect(
      resolve({ worktree: false, findProjectRoot: detector }),
    ).toMatchObject({
      enabled: false,
      source: "explicit-disable",
    });
    expect(detector).toHaveBeenCalledOnce();
  });

  it("fails closed when explicit --worktree repository identity is absent", () => {
    expect(() =>
      resolve({ worktree: true, findProjectRoot: () => null }),
    ).toThrow(/requires a Git repository/i);
  });

  it("does not trust plan mode to make extension tools read-only", () => {
    expect(resolve({ permissionMode: "plan" })).toMatchObject({
      enabled: true,
      source: "background-git-default",
    });
  });

  it("shares only foreground, stream-json, or non-git defaults", () => {
    expect(resolve({ background: false })).toMatchObject({
      enabled: false,
      source: "foreground-default",
    });
    expect(resolve({ inputFormat: "stream-json" })).toMatchObject({
      enabled: false,
      source: "stream-json-foreground",
    });
    expect(resolve({ findProjectRoot: () => null })).toMatchObject({
      enabled: false,
      source: "non-git-default",
    });
  });

  it("propagates repository detection failures instead of sharing silently", () => {
    expect(() =>
      resolve({
        findProjectRoot: () => {
          throw new Error("repository identity unavailable");
        },
      }),
    ).toThrow("repository identity unavailable");
  });
});

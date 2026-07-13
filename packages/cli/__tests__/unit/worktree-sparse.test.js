/**
 * Pure worktree sparse-checkout + dependency-symlink planning (P1 large
 * monorepo). Pure + deterministic — no fs/git/clock.
 */
import { describe, it, expect } from "vitest";
import { resolve, join } from "node:path";
import {
  isSafeRelPath,
  normalizeSparsePaths,
  isContainedPath,
  planSymlinkDirectories,
} from "../../src/lib/worktree-sparse.js";

describe("worktree-sparse: isSafeRelPath", () => {
  it("accepts safe repo-relative dirs", () => {
    expect(isSafeRelPath("packages/cli")).toBe(true);
    expect(isSafeRelPath("node_modules")).toBe(true);
    expect(isSafeRelPath("a/b/c")).toBe(true);
  });
  it("rejects absolute, traversal, flag, and metachar paths", () => {
    expect(isSafeRelPath("/etc/passwd")).toBe(false);
    expect(isSafeRelPath("C:\\Windows")).toBe(false);
    expect(isSafeRelPath("../secret")).toBe(false);
    expect(isSafeRelPath("packages/../../x")).toBe(false);
    expect(isSafeRelPath("--output=x")).toBe(false);
    expect(isSafeRelPath("a;rm -rf")).toBe(false);
    expect(isSafeRelPath("")).toBe(false);
    expect(isSafeRelPath(null)).toBe(false);
  });
});

describe("worktree-sparse: normalizeSparsePaths", () => {
  it("returns null for absent / all-invalid input (full checkout)", () => {
    expect(normalizeSparsePaths(null)).toBe(null);
    expect(normalizeSparsePaths(undefined)).toBe(null);
    expect(normalizeSparsePaths([])).toBe(null);
    expect(normalizeSparsePaths(["../evil", "/abs"])).toBe(null);
  });
  it("normalizes slashes, dedupes, sorts, drops unsafe", () => {
    expect(
      normalizeSparsePaths(["packages\\cli\\", "/packages/cli", "backend"]),
    ).toEqual(["backend", "packages/cli"]);
  });
  it("accepts a single string", () => {
    expect(normalizeSparsePaths("packages/cli")).toEqual(["packages/cli"]);
  });
});

describe("worktree-sparse: isContainedPath", () => {
  const root = resolve("/tmp/repo");
  it("treats the root itself and descendants as contained", () => {
    expect(isContainedPath(root, root)).toBe(true);
    expect(isContainedPath(join(root, "a/b"), root)).toBe(true);
  });
  it("rejects siblings and escapes", () => {
    expect(isContainedPath(resolve("/tmp/repo-evil"), root)).toBe(false);
    expect(isContainedPath(resolve("/tmp/other"), root)).toBe(false);
    expect(isContainedPath(resolve(root, "../x"), root)).toBe(false);
  });
});

describe("worktree-sparse: planSymlinkDirectories", () => {
  const repoDir = resolve("/tmp/repo");
  const worktreePath = resolve("/tmp/repo/.worktrees/task");

  it("plans source-in-repo, dest-in-worktree for approved dirs", () => {
    const plan = planSymlinkDirectories(
      ["node_modules", "packages/cli/node_modules"],
      {
        repoDir,
        worktreePath,
      },
    );
    expect(plan).toEqual([
      {
        name: "node_modules",
        source: join(repoDir, "node_modules"),
        dest: join(worktreePath, "node_modules"),
      },
      {
        name: "packages/cli/node_modules",
        source: join(repoDir, "packages/cli/node_modules"),
        dest: join(worktreePath, "packages/cli/node_modules"),
      },
    ]);
  });

  it("returns [] for absent input and dedupes", () => {
    expect(planSymlinkDirectories(null, { repoDir, worktreePath })).toEqual([]);
    expect(
      planSymlinkDirectories(["node_modules", "node_modules"], {
        repoDir,
        worktreePath,
      }),
    ).toHaveLength(1);
  });

  it("fails closed on traversal / absolute / flag names", () => {
    for (const bad of ["../node_modules", "/etc", "--x", "a/../../b"]) {
      expect(() =>
        planSymlinkDirectories([bad], { repoDir, worktreePath }),
      ).toThrow(/Unsafe symlink directory/);
    }
  });

  it("requires repoDir and worktreePath", () => {
    expect(() => planSymlinkDirectories(["node_modules"], {})).toThrow(
      /requires repoDir and worktreePath/,
    );
  });
});

"use strict";

/**
 * project-root tests (previously untested) — the git-root walk shared by the
 * .claude/.chainlesschain discovery layers (permission rules, output-styles,
 * slash-commands, sub-agents). A bug here means a subdir run silently drops the
 * project's config (a safety gap), so the walk + defensive bail-to-null branches
 * are pinned here. Fake fs/path via the deps seam; no real I/O.
 */

import { describe, it, expect } from "vitest";
import pathDefault from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { findGitProjectRoot, projectRootBase } = require("../project-root.cjs");

const P = pathDefault.posix;

/** fs whose existsSync(`${dir}/.git`) is true for dirs in the given set. */
function fsWithGit(gitDirs, { throwAt } = {}) {
  const set = new Set(gitDirs);
  return {
    existsSync(p) {
      if (throwAt && p === throwAt) throw new Error("EACCES");
      return p.endsWith("/.git") && set.has(p.slice(0, -"/.git".length));
    },
  };
}

describe("findGitProjectRoot", () => {
  it("returns cwd when .git is right there", () => {
    expect(
      findGitProjectRoot("/proj", { fs: fsWithGit(["/proj"]), path: P }),
    ).toBe("/proj");
  });

  it("walks up to the nearest ancestor containing .git", () => {
    expect(
      findGitProjectRoot("/proj/src/app", {
        fs: fsWithGit(["/proj"]),
        path: P,
      }),
    ).toBe("/proj");
  });

  it("returns null when no .git is found", () => {
    expect(findGitProjectRoot("/a/b/c", { fs: fsWithGit([]), path: P })).toBe(
      null,
    );
  });

  it("keeps walking when existsSync throws on an intermediate dir", () => {
    // .git lives at /proj; checking /proj/src/.git throws but the walk continues
    const fs = fsWithGit(["/proj"], { throwAt: "/proj/src/.git" });
    expect(findGitProjectRoot("/proj/src/app", { fs, path: P })).toBe("/proj");
  });

  it("bails to null when fs has no existsSync", () => {
    expect(findGitProjectRoot("/proj", { fs: {}, path: P })).toBe(null);
  });

  it("bails to null when path lacks dirname/join", () => {
    expect(
      findGitProjectRoot("/proj", { fs: fsWithGit(["/proj"]), path: {} }),
    ).toBe(null);
  });

  it("works without path.resolve (falls back to String(cwd))", () => {
    const noResolve = { dirname: P.dirname, join: P.join };
    expect(
      findGitProjectRoot("/proj/sub", {
        fs: fsWithGit(["/proj"]),
        path: noResolve,
      }),
    ).toBe("/proj");
  });
});

describe("projectRootBase", () => {
  it("returns the root when cwd is a strict subdirectory", () => {
    expect(
      projectRootBase("/proj/src", { fs: fsWithGit(["/proj"]), path: P }),
    ).toBe("/proj");
  });

  it("returns null when cwd IS the root (own dirs already cover it)", () => {
    expect(
      projectRootBase("/proj", { fs: fsWithGit(["/proj"]), path: P }),
    ).toBe(null);
  });

  it("returns null when no root is found", () => {
    expect(projectRootBase("/x/y", { fs: fsWithGit([]), path: P })).toBe(null);
  });
});

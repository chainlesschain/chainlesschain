/**
 * project-root — locate the nearest ancestor project root by walking up from a
 * starting directory until a `.git` marker is found.
 *
 * Shared by the `.claude` / `.chainlesschain` discovery layers (settings.json
 * permission rules, output-styles, slash-commands, sub-agents) so that running
 * `cc` from a project SUBDIRECTORY still picks up the project-root config —
 * Claude-Code 2.1.178 "closest `.claude` directory wins" parity. This mirrors
 * the git-root resolution already used by skill-loader + project-instructions,
 * which previously left these four layers as the only cwd-only stragglers (so a
 * subdir run silently dropped the project's permission rules — a safety gap).
 *
 * A single `.cjs` module so the CJS `settings-loader` can `require` it and the
 * ESM loaders can `import` it — one source of truth for the walk.
 *
 * DEFENSIVE BY DESIGN: callers thread their own (often mocked) `fs` / `path`
 * through `deps`. If `.git` is not found via that `fs`, or the injected `path`
 * lacks `dirname` / `resolve`, the walk bails to `null` and the caller keeps its
 * existing cwd-only behavior unchanged — keeping the heavily-mocked unit tests
 * green while real runs (real `node:path`) walk up correctly.
 */

const fsDefault = require("node:fs");
const pathDefault = require("node:path");

const _deps = { fs: fsDefault, path: pathDefault };

/**
 * Walk up from `cwd` to the nearest directory containing `.git`. Returns the
 * resolved root path, or `null` when none is found (or deps are unusable).
 * @param {string} cwd
 * @param {{ fs?: object, path?: object }} [deps]
 */
function findGitProjectRoot(cwd, deps = {}) {
  const fs = deps.fs || _deps.fs;
  const path = deps.path || _deps.path;
  if (!fs || typeof fs.existsSync !== "function") return null;
  if (!path || typeof path.dirname !== "function" || typeof path.join !== "function") {
    return null;
  }
  let dir;
  try {
    dir = typeof path.resolve === "function" ? path.resolve(cwd || ".") : String(cwd || ".");
  } catch {
    return null;
  }
  // Bounded walk (64 levels) so a malformed `dirname` can never spin forever.
  for (let i = 0; i < 64 && dir; i++) {
    try {
      if (fs.existsSync(path.join(dir, ".git"))) return dir;
    } catch {
      /* unreadable dir → keep walking up */
    }
    let parent;
    try {
      parent = path.dirname(dir);
    } catch {
      return null;
    }
    if (!parent || parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * The extra project-root base directory to ADD to a cwd-based discovery list
 * when running from a subdirectory. Returns the git root when it exists AND is a
 * strict ancestor of `cwd`; returns `null` when `cwd` is itself the root (its
 * own dirs already cover it) or no root is found.
 * @param {string} cwd
 * @param {{ fs?: object, path?: object }} [deps]
 */
function projectRootBase(cwd, deps = {}) {
  const root = findGitProjectRoot(cwd, deps);
  if (!root) return null;
  const path = deps.path || _deps.path;
  let resolvedCwd = cwd;
  try {
    if (path && typeof path.resolve === "function") resolvedCwd = path.resolve(cwd || ".");
  } catch {
    /* fall through with raw cwd */
  }
  return root === resolvedCwd ? null : root;
}

module.exports = { findGitProjectRoot, projectRootBase, _deps };

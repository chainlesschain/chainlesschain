/**
 * Worktree sparse-checkout + dependency-symlink planning (pure core).
 *
 * P1 "large monorepo" pillar: only check out the packages a task needs
 * (`worktree.sparsePaths`) and reuse explicitly-approved dependency
 * directories from the main checkout via junction/symlink
 * (`worktree.symlinkDirectories`), with junction/symlink escape defense.
 *
 * Pure + deterministic: no fs, no git, no clock. The isolator does the
 * actual sparse-checkout and link creation from the plans produced here.
 */

import { resolve, join } from "node:path";

/**
 * Safe repo-relative path predicate — mirrors the reject rules of
 * `git-integration.assertSafeGitPath` but as a boolean, so callers can
 * filter/normalize instead of throwing. Rejects absolute paths, `..`
 * traversal, flag injection, empty strings, and shell metacharacters.
 */
export function isSafeRelPath(p) {
  if (typeof p !== "string") return false;
  const s = p.trim();
  if (s.length === 0) return false;
  return (
    /^[A-Za-z0-9._/+@=, -]+$/.test(s) && // safe chars only
    !s.startsWith("-") && // no flag injection
    !s.startsWith("/") && // no absolute (posix)
    !/^[A-Za-z]:/.test(s) && // no absolute (windows drive)
    !s.includes("..") // no traversal
  );
}

/**
 * Normalize a raw relative path to git's forward-slash form. Converts
 * backslash separators (Windows-style `packages\cli`) and trims trailing
 * slashes, but keeps any LEADING slash so absolute paths are still rejected
 * by the safety check (never silently reinterpreted as repo-relative).
 */
function toGitRel(p) {
  return String(p).trim().replace(/\\/g, "/").replace(/\/+$/, "");
}

/**
 * Normalize a raw path (backslash → slash, trim slashes) THEN validate — so
 * Windows-style config (`packages\cli`) is accepted, not silently dropped.
 * Returns the safe git-relative form, or null when unsafe/empty.
 */
function safeGitRel(raw) {
  if (typeof raw !== "string") return null;
  const rel = toGitRel(raw);
  if (rel.length === 0) return null;
  return isSafeRelPath(rel) ? rel : null;
}

/**
 * Validate + normalize sparse-checkout include paths.
 *
 * @param {string[]|string|null|undefined} paths
 * @returns {string[]|null} sorted, de-duped, forward-slash repo-relative
 *   directories, or null when nothing valid is requested (caller keeps a
 *   full checkout — byte-identical to the no-sparse path).
 */
export function normalizeSparsePaths(paths) {
  if (paths == null) return null;
  const list = Array.isArray(paths) ? paths : [paths];
  const seen = new Set();
  for (const raw of list) {
    const rel = safeGitRel(raw);
    if (rel) seen.add(rel);
  }
  if (seen.size === 0) return null;
  return [...seen].sort();
}

/** True when `child` resolves to `parent` itself or a descendant of it. */
export function isContainedPath(child, parent) {
  const p = resolve(parent);
  const c = resolve(child);
  if (c === p) return true;
  // Append a separator so `/repo-evil` is not treated as inside `/repo`.
  const sep = p.endsWith("/") || p.endsWith("\\") ? "" : "/";
  const cNorm = c.replace(/\\/g, "/");
  const pNorm = (p + sep).replace(/\\/g, "/");
  return cNorm.startsWith(pNorm);
}

/**
 * Plan dependency-directory links from the main checkout into a worktree.
 *
 * Each entry must be an explicitly-approved, safe repo-relative directory
 * (e.g. `node_modules`, `packages/cli/node_modules`). The plan asserts both
 * lexical safety (no `..`, no absolute, no flag) AND resolved containment:
 * the source stays inside `repoDir` and the destination stays inside
 * `worktreePath`. This defeats junction/symlink escape where a crafted name
 * would place the link (or its target) outside the intended roots.
 *
 * @throws {Error} on any unsafe/escaping entry — fail-closed, never a
 *   silent skip, so a bad config cannot quietly link outside the sandbox.
 * @returns {{name:string, source:string, dest:string}[]}
 */
export function planSymlinkDirectories(dirs, { repoDir, worktreePath } = {}) {
  if (dirs == null) return [];
  if (!repoDir || !worktreePath) {
    throw new Error("planSymlinkDirectories requires repoDir and worktreePath");
  }
  const list = Array.isArray(dirs) ? dirs : [dirs];
  const plan = [];
  const seen = new Set();
  for (const raw of list) {
    const rel = safeGitRel(raw);
    if (!rel) {
      throw new Error(`Unsafe symlink directory: ${JSON.stringify(raw)}`);
    }
    if (seen.has(rel)) continue;
    seen.add(rel);

    const source = resolve(join(repoDir, rel));
    const dest = resolve(join(worktreePath, rel));
    if (!isContainedPath(source, repoDir)) {
      throw new Error(`Symlink source escapes repo: ${JSON.stringify(raw)}`);
    }
    if (!isContainedPath(dest, worktreePath)) {
      throw new Error(
        `Symlink target escapes worktree: ${JSON.stringify(raw)}`,
      );
    }
    plan.push({ name: rel, source, dest });
  }
  return plan;
}

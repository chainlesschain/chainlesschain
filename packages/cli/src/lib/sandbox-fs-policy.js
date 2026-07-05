/**
 * Sandbox filesystem path policy (Phase 1) — decide whether a Shell subprocess
 * (or the agent's own file tools) may read/write a given path under
 * `sandbox.filesystem.{allowRead,denyRead,allowWrite,denyWrite}` (here the
 * legacy `{read, write, denied}` shape). OS-level ENFORCEMENT is platform
 * specific (bubblewrap `--bind`/`--ro-bind`/`--tmpfs`, seatbelt), but the POLICY
 * DECISION is pure, shared, and must get the tricky cases right — the twin of
 * `sandbox-network-policy.js`. The prior check used raw `filePath.startsWith()`,
 * which let three attacks through:
 *
 *   - PATH TRAVERSAL: `/tmp/../etc/passwd` starts with an allowed `/tmp` but
 *     resolves OUTSIDE it. We `path.resolve` first so `..` is collapsed.
 *   - BOUNDARY CONFUSION: `/tmpfoo` starts with `/tmp` yet is a different tree.
 *     We compare with `path.relative` (a real path boundary), not a substring.
 *   - SYMLINK ESCAPE: an allowed dir containing a symlink to `/etc` would read
 *     `/etc`. We resolve symlinks (of the longest existing ancestor) before the
 *     boundary check, and resolve the policy roots the same way so they stay
 *     comparable.
 *
 * Default-DENY: a path must match an allow root for the requested mode and must
 * not fall under any deny root. This mirrors the previous behaviour (an empty
 * allow list denied everything) while fixing the bypasses.
 */

import fs from "node:fs";
import path from "node:path";

/** Real path of `abs`, resolving symlinks of the LONGEST EXISTING ancestor and
 * re-appending the non-existent tail — so a symlinked existing parent is caught
 * even when the leaf (e.g. a not-yet-created write target) does not exist. */
function resolveReal(abs, realpath) {
  let cur = abs;
  const tail = [];
  // Bounded by the path depth; each iteration strips one segment.
  for (;;) {
    try {
      const real = realpath(cur);
      return tail.length ? path.join(real, ...tail.reverse()) : real;
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return abs; // hit the root, nothing on this path exists
      tail.push(path.basename(cur));
      cur = parent;
    }
  }
}

/** Is `target` the same as, or nested inside, `root`? Uses a real path boundary
 * (via `path.relative`) so `/tmpfoo` is NOT inside `/tmp` and `..` can't sneak
 * out. Cross-platform (handles Windows drive letters + separators). */
export function isWithinRoot(root, target) {
  if (!root) return false;
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function normalizeRoot(root, cwd, realpath) {
  return resolveReal(path.resolve(cwd, String(root)), realpath);
}

/**
 * Evaluate filesystem access for a target path under a policy.
 *
 * @param {string} target  a path (relative resolves against `cwd`)
 * @param {object} opts
 * @param {"read"|"write"} [opts.mode="read"]
 * @param {{read?:string[], write?:string[], denied?:string[]}} [opts.policy]
 * @param {string} [opts.cwd]        base for relative targets/roots
 * @param {(p:string)=>string} [opts.realpath]  injectable for tests
 * @returns {{allowed:boolean, path:string|null, reason:string}}
 */
export function evaluatePathAccess(target, opts = {}) {
  const {
    mode = "read",
    policy = {},
    cwd = process.cwd(),
    realpath = fs.realpathSync,
  } = opts;

  if (target == null || String(target).trim() === "") {
    return { allowed: false, path: null, reason: "empty path" };
  }
  if (mode !== "read" && mode !== "write") {
    return { allowed: false, path: null, reason: `unknown mode "${mode}"` };
  }

  const abs = path.resolve(cwd, String(target)); // collapses `..`
  const real = resolveReal(abs, realpath); // resolves symlink escapes

  const denied = policy.denied || [];
  for (const d of denied) {
    if (isWithinRoot(normalizeRoot(d, cwd, realpath), real)) {
      return { allowed: false, path: real, reason: `denied by ${d}` };
    }
  }

  const allowList = (mode === "read" ? policy.read : policy.write) || [];
  for (const a of allowList) {
    if (isWithinRoot(normalizeRoot(a, cwd, realpath), real)) {
      return { allowed: true, path: real, reason: `within ${a}` };
    }
  }

  // Default-deny: not under any allowed root for this mode.
  return {
    allowed: false,
    path: real,
    reason: allowList.length
      ? `outside all allowed ${mode} roots`
      : `no allowed ${mode} roots`,
  };
}

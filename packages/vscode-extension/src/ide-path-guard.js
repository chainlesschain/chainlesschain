/**
 * Pure path-boundary guard for the IDE MCP tools (openDiff / openMultiDiff /
 * getDiagnostics-with-path). The agent supplies these paths over the bridge,
 * so without a boundary it could point a write-capable tool at ANY file the
 * editor process can touch (absolute paths outside the workspace, `..`
 * traversal, UNC `\\host\share` targets).
 *
 * Rules (mirrors the CLI's sandbox-fs-policy `isWithinRoot` idea, but kept as
 * an independent, dependency-free twin so the extension has no cross-package
 * import):
 *   - `path.resolve` folds `..` before any check.
 *   - UNC / device paths (`\\host\share`, `//host/share`, `\\?\...`) are
 *     rejected outright — the bridge is same-machine, workspace-scoped.
 *   - The resolved path must fall inside ONE of the workspace folders,
 *     decided with `path.relative` (so `/tmpfoo` is NOT inside `/tmp` and a
 *     sibling `C:\work2` is NOT inside `C:\work`).
 *   - Windows comparison is case-insensitive (`c:\WS` == `C:\ws`).
 *   - A relative input resolves against the FIRST workspace folder.
 *
 * No `vscode` dependency; unit-tested from the CLI suite. Never throws — the
 * result is always `{ ok:true, resolved }` or `{ ok:false, reason }`.
 */

const path = require("path");

/** First path segment is `..` (exactly), i.e. the target escapes the root. */
function escapesRoot(rel, P) {
  return rel === ".." || rel.startsWith(".." + P.sep) || P.isAbsolute(rel);
}

/** Leading double slash/backslash = UNC or device path (\\?\, \\.\, //host). */
function isUncLike(s) {
  return /^[\\/]{2}/.test(s);
}

/** Normalize the caller's folder list to non-empty path strings. */
function normalizeFolders(workspaceFolders) {
  if (!Array.isArray(workspaceFolders)) return [];
  return workspaceFolders
    .map((f) => {
      if (typeof f === "string") return f;
      if (f && typeof f === "object") return f.path || f.fsPath || null;
      return null;
    })
    .filter((s) => typeof s === "string" && s.trim().length > 0);
}

/**
 * Validate a tool-supplied path against the open workspace folders.
 *
 * @param {string} rawPath  the path the agent passed to the tool
 * @param {Array<string|{path?:string,fsPath?:string}>} workspaceFolders
 * @param {object} [opts]
 * @param {string} [opts.platform]  override for tests ("win32" | "linux" | …);
 *                                  defaults to process.platform
 * @returns {{ok:true, resolved:string} | {ok:false, reason:string}}
 */
function validateIdeToolPath(rawPath, workspaceFolders, opts = {}) {
  try {
    const platform = opts.platform || process.platform;
    const win = platform === "win32";
    const P = win ? path.win32 : path.posix;

    if (typeof rawPath !== "string" || rawPath.trim().length === 0) {
      return { ok: false, reason: "path must be a non-empty string" };
    }
    if (rawPath.includes("\0")) {
      return { ok: false, reason: "path contains a NUL byte" };
    }
    if (isUncLike(rawPath)) {
      return {
        ok: false,
        reason: "UNC / device paths (\\\\host\\share) are not allowed",
      };
    }

    const folders = normalizeFolders(workspaceFolders);
    if (folders.length === 0) {
      return {
        ok: false,
        reason: "no workspace folder is open to contain this path",
      };
    }

    // Relative paths resolve against the first workspace folder; resolve()
    // folds any `..` so the containment check below sees the real target.
    const resolved = P.isAbsolute(rawPath)
      ? P.resolve(rawPath)
      : P.resolve(folders[0], rawPath);
    if (isUncLike(resolved)) {
      return {
        ok: false,
        reason: "UNC / device paths (\\\\host\\share) are not allowed",
      };
    }

    for (const folder of folders) {
      const root = P.resolve(folder);
      // Case-insensitive on Windows; path.relative gives an absolute path for
      // cross-drive targets, and a leading ".." for siblings/escapes.
      const rel = win
        ? P.relative(root.toLowerCase(), resolved.toLowerCase())
        : P.relative(root, resolved);
      if (rel === "" || !escapesRoot(rel, P)) {
        return { ok: true, resolved };
      }
    }
    return {
      ok: false,
      reason: `path resolves outside every workspace folder: ${resolved}`,
    };
  } catch (e) {
    // A guard must never take the MCP server down — and an input weird enough
    // to break path handling is exactly what we want to refuse (fail-closed).
    return {
      ok: false,
      reason: `path validation error: ${(e && e.message) || e}`,
    };
  }
}

module.exports = { validateIdeToolPath };

/**
 * workspace-roots — pure helpers for multi-root LSP workspaces (P2 LSP slice,
 * CLAUDE_CODE_CLI_INCREMENTAL_GAP_ANALYSIS_2026-07-12 §"LSP 与 Code Review").
 *
 * A session started with `--add-dir` works across several project roots, but
 * `code_intelligence` always keyed its shared language-server pool on the cwd
 * alone — a query for a file living in an additional root spawned (or reused)
 * the WRONG project's server, and `workspace_symbols` could only ever see the
 * cwd project. These helpers make root selection explicit and testable:
 *
 *  - `workspaceRootsFor(cwd, additionalDirectories)` — the deduped, resolved
 *    root list (cwd first, mirroring the roots the system prompt advertises).
 *  - `pickRootForFile(file, roots)` — the root that CONTAINS the file
 *    (deepest match wins so nested roots resolve to the more specific
 *    project); falls back to the first root (cwd) for out-of-root files,
 *    which is the pre-multi-root behavior.
 *  - `mergeWorkspaceSymbolResults(results, roots)` — fold per-root
 *    `workspaceSymbols` outcomes into one: available when ANY root answered,
 *    symbols concatenated in root order and stamped with their `root` so
 *    same-named symbols from different projects stay unambiguous.
 *
 * Pure + IO-free (path math only) so agent-core can consume them without any
 * new export surface of its own.
 */

import path from "node:path";

/** Case-fold for prefix comparison on case-insensitive filesystems. */
function fold(p) {
  return process.platform === "win32" ? p.toLowerCase() : p;
}

/**
 * Resolved, deduped workspace roots — cwd first, then each additional
 * directory. Non-string/empty entries are dropped; never returns empty (falls
 * back to process.cwd()).
 */
export function workspaceRootsFor(cwd, additionalDirectories) {
  const out = [];
  const seen = new Set();
  const push = (dir) => {
    if (typeof dir !== "string" || dir.trim() === "") return;
    const resolved = path.resolve(dir);
    const key = fold(resolved);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(resolved);
  };
  push(cwd || process.cwd());
  for (const d of Array.isArray(additionalDirectories)
    ? additionalDirectories
    : []) {
    push(d);
  }
  if (out.length === 0) out.push(path.resolve(process.cwd()));
  return out;
}

/**
 * The workspace root that contains `file` — deepest containing root wins
 * (nested roots resolve to the more specific project). Files outside every
 * root fall back to the FIRST root (cwd), preserving the single-root
 * behavior byte-for-byte.
 */
export function pickRootForFile(file, roots) {
  const list = Array.isArray(roots) && roots.length > 0 ? roots : null;
  if (!list) return path.resolve(process.cwd());
  if (typeof file !== "string" || file.trim() === "") return list[0];
  const f = fold(path.resolve(file));
  let best = null;
  for (const root of list) {
    const r = fold(path.resolve(root));
    if (f === r || f.startsWith(r + path.sep)) {
      if (best === null || r.length > fold(best).length) {
        best = path.resolve(root);
      }
    }
  }
  return best || list[0];
}

/**
 * Merge per-root `workspaceSymbols` results (same order as `roots`).
 * Any available root makes the merged result available; each symbol is
 * stamped with its `root`. All-unavailable folds the reasons together so the
 * caller still sees WHY (first reason wins the summary, all are listed).
 */
export function mergeWorkspaceSymbolResults(results, roots = []) {
  const list = Array.isArray(results) ? results : [];
  const symbols = [];
  const reasons = [];
  let anyAvailable = false;
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (r && r.available) {
      anyAvailable = true;
      for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
        symbols.push(roots[i] ? { ...s, root: roots[i] } : s);
      }
    } else if (r) {
      reasons.push(
        roots[i]
          ? `${roots[i]}: ${r.reason || "unavailable"}`
          : r.reason || "unavailable",
      );
    }
  }
  if (!anyAvailable) {
    return {
      available: false,
      reason: reasons.join("; ") || "language server unavailable",
    };
  }
  return { available: true, symbols };
}

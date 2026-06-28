/**
 * Pure helper for the `/add-dir` REPL command — resolve + validate a directory
 * the user wants to add as an extra working root mid-session, and render the
 * current root list. Kept pure (fs/os injected) so it's deterministic and
 * unit-testable; the REPL handler does the side effects (push + reprompt).
 *
 * Claude Code's /add-dir parity: the agent can then read / search / edit under
 * the new root (it is threaded into each turn's options.additionalDirectories
 * and advertised in the system prompt).
 */
import nodePath from "path";
import nodeFs from "fs";
import nodeOs from "os";

const realDeps = {
  existsSync: nodeFs.existsSync,
  statSync: nodeFs.statSync,
  homedir: nodeOs.homedir,
};

/** Expand a leading `~` / `~/…` to the home directory. */
function expandHome(input, homedir) {
  if (input === "~") return homedir;
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return nodePath.join(homedir, input.slice(2));
  }
  return input;
}

/**
 * Resolve and validate a candidate working root.
 * @param {string} input    raw user argument (relative, absolute, or ~-prefixed)
 * @param {object} opts      { cwd, existing?: string[], deps? }
 * @returns {{ok:boolean, dir?:string, reason?:string, alreadyPresent?:boolean}}
 */
export function resolveAddDir(input, { cwd, existing = [], deps } = {}) {
  const d = { ...realDeps, ...(deps || {}) };
  const raw = String(input || "").trim();
  if (!raw) return { ok: false, reason: "usage: /add-dir <dir>" };
  const abs = nodePath.resolve(cwd, expandHome(raw, d.homedir()));
  if (!d.existsSync(abs)) {
    return { ok: false, reason: `no such directory: ${abs}` };
  }
  let isDir = false;
  try {
    isDir = d.statSync(abs).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) return { ok: false, reason: `not a directory: ${abs}` };
  const primary = nodePath.resolve(cwd);
  const known = new Set([primary, ...existing.map((p) => nodePath.resolve(p))]);
  if (known.has(abs)) return { ok: true, dir: abs, alreadyPresent: true };
  return { ok: true, dir: abs, alreadyPresent: false };
}

/**
 * Render the current working roots (primary cwd + extra roots) as a block.
 * @param {string} cwd
 * @param {string[]} extraRoots
 */
export function formatAddDirRoots(cwd, extraRoots) {
  const extras = Array.isArray(extraRoots) ? extraRoots : [];
  const lines = [`Working roots (${1 + extras.length}):`, `  ${cwd}  (primary)`];
  for (const r of extras) lines.push(`  ${r}`);
  if (extras.length === 0) {
    lines.push("  (no extra roots — add one with /add-dir <dir>)");
  }
  return lines.join("\n");
}

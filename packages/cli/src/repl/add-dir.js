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
  const lines = [
    `Working roots (${1 + extras.length}):`,
    `  ${cwd}  (primary)`,
  ];
  for (const r of extras) lines.push(`  ${r}`);
  if (extras.length === 0) {
    lines.push("  (no extra roots — add one with /add-dir <dir>)");
  }
  return lines.join("\n");
}

/**
 * The full workspace root list a session advertises to MCP servers (`roots/list`):
 * the primary cwd first, then each extra `--add-dir` / `/add-dir` root, all
 * resolved absolute and de-duplicated (the primary is dropped from the extras if
 * a caller re-added it). Pure. Mirrors what the system prompt advertises so an
 * MCP server sees the same roots the model does.
 *
 * @param {string} cwd            primary working directory
 * @param {string[]} extraRoots   additional roots
 * @returns {string[]}            deduped absolute dirs, primary first
 */
export function workspaceRootDirs(cwd, extraRoots) {
  const primary = nodePath.resolve(cwd);
  const out = [primary];
  const seen = new Set([primary]);
  for (const r of Array.isArray(extraRoots) ? extraRoots : []) {
    if (!r) continue;
    const abs = nodePath.resolve(cwd, String(r));
    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push(abs);
  }
  return out;
}

/**
 * Best-effort broadcast of a changed workspace-root list to every connected MCP
 * client (via `client.setRoots(dirs)`, which advertises the new list AND fires
 * `notifications/roots/list_changed` only when it actually changed). Skips
 * nullish/duplicate clients and any without `setRoots`; a failing client never
 * disturbs the others or the caller. Returns the number of clients notified.
 * Claude-Code 2.1.203 roots-change parity for the `/add-dir` (and startup
 * `--add-dir`) vector, mirroring what `/cd` already does via
 * `notifyRootsListChanged`.
 *
 * @param {Array<object|null|undefined>} clients   MCP clients (may repeat/null)
 * @param {string[]} dirs                           absolute root dirs
 * @returns {number}
 */
export function notifyMcpRootsChanged(clients, dirs) {
  let notified = 0;
  const seen = new Set();
  for (const c of Array.isArray(clients) ? clients : []) {
    if (!c || seen.has(c) || typeof c.setRoots !== "function") continue;
    seen.add(c);
    try {
      c.setRoots(dirs);
      notified += 1;
    } catch {
      /* best-effort — one server's failure must not block the rest */
    }
  }
  return notified;
}

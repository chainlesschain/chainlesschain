/**
 * Project-memory loader — file-based project instructions for `cc agent`
 * (Claude-Code CLAUDE.md-hierarchy parity, with our own file name).
 *
 * The primary instruction file is **`cc.md`** (ChainlessChain branding);
 * `CLAUDE.md` and `AGENTS.md` are accepted as compatibility fallbacks so any
 * repo that already carries Claude-Code/agent memory works with zero setup.
 *
 * Discovery order (first existing name wins per location):
 *
 *   1. user scope   : `~/.chainlesschain/cc.md`, else `~/.claude/CLAUDE.md`
 *   2. project scope: per directory from <git-root> down to <cwd> —
 *                     `cc.md` → `CLAUDE.md` → `AGENTS.md`
 *                     (root-first, so deeper files refine shallower ones)
 *   3. local scope  : `cc.local.md` → `CLAUDE.local.md` next to each project
 *                     file (gitignored personal notes)
 *
 * `@path` import lines inside an instruction file pull in the referenced file
 * (resolved relative to the importing file; `~/` works too), recursively up to
 * MAX_IMPORT_DEPTH with cycle protection. Tokens inside fenced code blocks and
 * tokens that don't resolve to a real file (npm scopes like `@scope/pkg`,
 * emails) are ignored silently.
 *
 * Loading is fail-open: any I/O error yields an empty block — composing the
 * system prompt must never crash because of a bad memory file. All fs access
 * goes through an injectable `deps` seam (project `_deps` philosophy) and all
 * reads are explicit UTF-8 (encoding.md rule).
 *
 * Disable globally with `CC_PROJECT_MEMORY=0`, per-call with
 * `projectMemory: false` on composeSystemPrompt.
 */

import fsDefault from "fs";
import pathDefault from "path";
import osDefault from "os";

export const DEFAULT_MAX_FILE_BYTES = 48 * 1024; // per instruction/import file
export const DEFAULT_MAX_TOTAL_BYTES = 192 * 1024; // whole block budget
export const MAX_IMPORT_DEPTH = 5;

/** Per-directory project file names, first match wins. */
export const PROJECT_FILE_NAMES = ["cc.md", "CLAUDE.md", "AGENTS.md"];
/** Local (gitignored) companion names, first match wins. */
export const LOCAL_FILE_NAMES = ["cc.local.md", "CLAUDE.local.md"];

// Same boundary rule as file-ref-expander: `@` at start / after whitespace or
// an opening bracket-quote, so emails and decorative @ never match.
const IMPORT_TOKEN_RE = /(^|[\s("'`[{])@([^\s"'`)\]}]+)/g;

function resolveDeps(opts) {
  return {
    fs: opts.deps?.fs || fsDefault,
    path: opts.deps?.path || pathDefault,
    os: opts.deps?.os || osDefault,
  };
}

function isFile(fs, p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** First existing candidate among `names` inside `dir`, or null. */
function firstExisting(fs, path, dir, names) {
  for (const name of names) {
    const p = path.join(dir, name);
    if (isFile(fs, p)) return p;
  }
  return null;
}

/** Walk up from cwd looking for a `.git` marker; null when not in a repo. */
export function findProjectRoot(cwd, opts = {}) {
  const { fs, path } = resolveDeps(opts);
  let dir = path.resolve(cwd);
  for (;;) {
    try {
      if (fs.existsSync(path.join(dir, ".git"))) return dir;
    } catch {
      /* keep walking */
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Ordered instruction-file discovery (user → project root → … → cwd, with the
 * local companion right after its project file). Only existing files are
 * returned. Deduped by absolute path (covers cwd == home corner cases).
 *
 * @returns {Array<{path:string, scope:"user"|"project"|"local"}>}
 */
export function findInstructionFiles(opts = {}) {
  const { fs, path, os } = resolveDeps(opts);
  const cwd = path.resolve(opts.cwd || process.cwd());
  const home = opts.home || os.homedir() || "";

  const seen = new Set();
  const out = [];
  const push = (p, scope) => {
    if (!p) return;
    const abs = path.resolve(p);
    if (seen.has(abs) || !isFile(fs, abs)) return;
    seen.add(abs);
    out.push({ path: abs, scope });
  };

  if (home) {
    push(
      firstExisting(fs, path, home, [
        path.join(".chainlesschain", "cc.md"),
        path.join(".claude", "CLAUDE.md"),
      ]),
      "user",
    );
  }

  const root = findProjectRoot(cwd, opts) || cwd;
  const chain = [];
  let dir = cwd;
  for (;;) {
    chain.unshift(dir);
    if (dir === root) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const d of chain) {
    push(firstExisting(fs, path, d, PROJECT_FILE_NAMES), "project");
    push(firstExisting(fs, path, d, LOCAL_FILE_NAMES), "local");
  }
  return out;
}

/**
 * Collect `@path` import tokens from instruction text, skipping fenced code
 * blocks (``` / ~~~). Line-level scanning is good enough for memory files,
 * which use imports on their own prose lines.
 */
export function collectImportTokens(text) {
  const found = [];
  let inFence = false;
  for (const line of String(text).split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    IMPORT_TOKEN_RE.lastIndex = 0;
    let m;
    while ((m = IMPORT_TOKEN_RE.exec(line)) !== null) {
      if (m[2]) found.push(m[2]);
    }
  }
  return found;
}

function readCapped(fs, abs, maxFileBytes) {
  const buf = fs.readFileSync(abs);
  const truncated = buf.length > maxFileBytes;
  const content = (truncated ? buf.slice(0, maxFileBytes) : buf).toString(
    "utf-8",
  );
  return { content, bytes: buf.length, truncated };
}

/**
 * Load the full instruction set: hierarchy files + recursive imports.
 *
 * @param {object} [opts] { cwd, home, deps, maxFileBytes, maxTotalBytes }
 * @returns {{ files: Array<{path,scope,bytes,truncated,content}>, warnings: string[] }}
 */
export function loadProjectInstructions(opts = {}) {
  const { fs, path, os } = resolveDeps(opts);
  const home = opts.home || os.homedir() || "";
  const maxFileBytes = Number.isFinite(opts.maxFileBytes)
    ? opts.maxFileBytes
    : DEFAULT_MAX_FILE_BYTES;
  const maxTotalBytes = Number.isFinite(opts.maxTotalBytes)
    ? opts.maxTotalBytes
    : DEFAULT_MAX_TOTAL_BYTES;

  const roots = findInstructionFiles(opts);
  const visited = new Set(roots.map((r) => r.path));
  const out = [];
  const warnings = [];
  let total = 0;

  // Queue of { abs, scope, depth } — imports inherit "import" scope.
  const queue = roots.map((r) => ({ abs: r.path, scope: r.scope, depth: 0 }));

  while (queue.length) {
    const { abs, scope, depth } = queue.shift();
    if (total >= maxTotalBytes) {
      warnings.push(
        `project-memory budget (${maxTotalBytes} bytes) exhausted — remaining files skipped`,
      );
      break;
    }
    let entry;
    try {
      entry = readCapped(fs, abs, maxFileBytes);
    } catch (err) {
      warnings.push(`${abs} — cannot read: ${err.message}`);
      continue;
    }
    total += Math.min(entry.bytes, maxFileBytes);
    out.push({ path: abs, scope, ...entry });

    if (depth >= MAX_IMPORT_DEPTH) continue;
    const baseDir = path.dirname(abs);
    for (const raw of collectImportTokens(entry.content)) {
      let target = raw;
      if (target.startsWith("~/") || target === "~") {
        if (!home) continue;
        target = path.join(home, target.slice(1));
      }
      const resolved = path.resolve(baseDir, target);
      if (visited.has(resolved) || !isFile(fs, resolved)) continue; // silent:
      // non-files are decorative @tokens (npm scopes, emails), not imports.
      visited.add(resolved);
      queue.push({ abs: resolved, scope: "import", depth: depth + 1 });
    }
  }
  return { files: out, warnings };
}

function escapeAttr(s) {
  return String(s).replace(/"/g, "&quot;");
}

/** Render loaded instructions as a single system-prompt block ("" if none). */
export function renderProjectInstructionsBlock(loaded) {
  const files = loaded?.files || [];
  if (!files.length) return "";
  const parts = [
    '<project-instructions note="project memory auto-loaded from cc.md / CLAUDE.md / AGENTS.md; follow these as authoritative project conventions">',
  ];
  for (const f of files) {
    const attrs =
      `path="${escapeAttr(f.path)}" scope="${f.scope}"` +
      (f.truncated ? ` truncated="true" total-bytes="${f.bytes}"` : "");
    parts.push(`<file ${attrs}>`);
    parts.push(f.content.trimEnd());
    if (f.truncated) {
      parts.push(`… [truncated — file is ${f.bytes} bytes]`);
    }
    parts.push(`</file>`);
  }
  parts.push("</project-instructions>");
  return parts.join("\n");
}

/**
 * One-call convenience for composeSystemPrompt: returns the rendered block or
 * "" — and never throws (fail-open by design).
 */
export function loadProjectInstructionsBlock(opts = {}) {
  try {
    const loaded = loadProjectInstructions(opts);
    return renderProjectInstructionsBlock(loaded);
  } catch {
    return "";
  }
}

export const _deps = { fs: fsDefault, path: pathDefault, os: osDefault };

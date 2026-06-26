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
import { credentialFileReason } from "./credential-guard.js";

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
 * @returns {Array<{path:string, scope:"user"|"project"|"local"|"rules"}>}
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
    // NOTE: `.chainlesschain/rules.md` is intentionally NOT loaded here — it is
    // already injected by buildSystemPrompt() (as "## Project Rules"), which is
    // the base of every composeSystemPrompt() call. Loading it here too sent it
    // TWICE in the system prompt on every turn. Path-scoped `.claude/rules/*.md`
    // below are NOT covered by buildSystemPrompt, so they stay.
    // Path-scoped rule files (`.claude/rules/*.md`, YAML frontmatter `paths:`
    // globs). Glob filtering happens at LOAD time where content is available.
    try {
      const rulesDir = path.join(d, ".claude", "rules");
      for (const f of fs
        .readdirSync(rulesDir)
        .filter((n) => n.endsWith(".md"))
        .sort()) {
        push(path.join(rulesDir, f), "rule");
      }
    } catch {
      /* no rules dir */
    }
  }
  return out;
}

/**
 * Parse a rule file's YAML-ish frontmatter (zero-dep): `paths:`/`globs:` as a
 * dash-list or inline value. Returns { globs, body } with frontmatter
 * stripped from body; files without frontmatter pass through unchanged.
 */
export function parseRuleFrontmatter(text) {
  const str = String(text);
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(str);
  if (!m) return { globs: [], body: str };
  const globs = [];
  let inPaths = false;
  const take = (raw) => {
    const v = raw.trim().replace(/^["']|["']$/g, "");
    if (v) globs.push(v);
  };
  for (const rawLine of m[1].split(/\r?\n/)) {
    const line = rawLine.trim();
    const key = /^(paths|globs)\s*:\s*(.*)$/.exec(line);
    if (key) {
      inPaths = true;
      const inline = key[2].trim();
      if (inline) {
        for (const g of inline.startsWith("[")
          ? inline.replace(/^\[|\]$/g, "").split(",")
          : [inline]) {
          take(g);
        }
      }
      continue;
    }
    if (inPaths) {
      const item = /^-\s*(.+)$/.exec(line);
      if (item) take(item[1]);
      else if (line) inPaths = false;
    }
  }
  return { globs, body: str.slice(m[0].length) };
}

/**
 * Does a path-scoped rule apply when the agent runs at `relCwd` (cwd relative
 * to the dir holding `.claude/`)? v1 prefix-overlap semantics: the glob's
 * literal prefix and the cwd must sit on the same path line — running at the
 * project root loads every rule; running inside packages/cli loads rules
 * whose glob prefix is packages/cli plus prefixless globs (star-star
 * patterns). Finer tool-time injection is a later phase (module 99 §5.3).
 */
export function ruleApplies(globs, relCwd) {
  if (!globs || globs.length === 0) return true;
  const cwd = String(relCwd || "")
    .replace(/\\/g, "/")
    .replace(/^\.\/?/, "");
  if (!cwd) return true; // at the project root every rule is in play
  for (const glob of globs) {
    const g = String(glob).replace(/\\/g, "/");
    const star = g.search(/[*?[]/);
    const prefix = (star === -1 ? g : g.slice(0, star)).replace(/\/+$/, "");
    if (!prefix) return true; // "**/*.js" — applies everywhere
    if (
      cwd === prefix ||
      cwd.startsWith(`${prefix}/`) ||
      prefix.startsWith(`${cwd}/`)
    ) {
      return true;
    }
  }
  return false;
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
    if (scope === "rule") {
      // <base>/.claude/rules/<file>.md → base is three dirs up.
      const base = path.dirname(path.dirname(path.dirname(abs)));
      const relCwd = path.relative(
        base,
        path.resolve(opts.cwd || process.cwd()),
      );
      const { globs, body } = parseRuleFrontmatter(entry.content);
      if (!ruleApplies(globs, relCwd)) continue; // out of scope for this cwd
      entry = { ...entry, content: body };
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
      // Refuse to import a credential / secret file. `cc agent` auto-loads
      // project memory, so a cloned/untrusted repo's cc.md must NOT be able to
      // pull `@~/.ssh/id_rsa` / `@../.env` into the LLM-bound system prompt
      // (mirrors the read_file/run_shell credential guard).
      const credReason = credentialFileReason(resolved);
      if (credReason) {
        visited.add(resolved); // don't re-warn on a second reference
        warnings.push(
          `refused @import of ${resolved} — ${credReason}; project memory must not pull secrets into the prompt`,
        );
        continue;
      }
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

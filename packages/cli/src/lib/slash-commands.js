/**
 * slash-commands — user-defined command templates (Claude-Code parity).
 *
 * Markdown files under `.claude/commands/` (project) or `~/.claude/commands/`
 * (personal) become reusable command macros. Distinct from skills (skills are
 * AI-invoked capability bundles; these are user-authored prompt macros you run
 * explicitly). A file `git/commit.md` is the command `git:commit`.
 *
 * Frontmatter (all optional): `description`, `argument-hint`, `allowed-tools`,
 * `model`. Body is the prompt template, with substitutions applied at run time:
 *   $ARGUMENTS   → all args joined by space
 *   $1 $2 … $9   → positional args (missing → empty string)
 *   !`<cmd>`     → run <cmd> in a shell, splice in its stdout (bang exec)
 *   @path        → splice in file/dir contents (via file-ref-expander)
 *
 * Project scope shadows personal scope on a name clash. Discovery + parse +
 * expand are pure (inject fs/exec/cwd) so the whole thing is unit-testable.
 */

import fsDefault from "node:fs";
import pathDefault from "node:path";
import { homedir } from "node:os";
import { execSync as execSyncDefault } from "node:child_process";
import { expandFileRefs } from "../runtime/file-ref-expander.js";

const _deps = { fs: fsDefault, path: pathDefault, execSync: execSyncDefault };

/**
 * Split `--- ... ---` frontmatter from the body and camelCase the keys (so
 * `argument-hint` → `argumentHint`). A minimal `key: value` scalar parser —
 * command frontmatter only carries simple scalars (description, argument-hint,
 * allowed-tools, model). Deliberately NOT js-yaml (an undeclared CLI dep that
 * only resolves via workspace hoisting) and NOT skill-loader's parseSkillMd
 * (its import chain drags native deps that crash vitest). Returns `{ data, body }`.
 */
function parseFrontmatter(content) {
  const text = String(content || "");
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: text.trim() };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colon = trimmed.indexOf(":");
    if (colon <= 0) continue;
    const key = trimmed.slice(0, colon).trim();
    let value = trimmed.slice(colon + 1).trim();
    // Strip one layer of surrounding quotes.
    value = value.replace(/^(['"])([\s\S]*)\1$/, "$2");
    const camel = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    data[camel] = value;
  }
  return { data, body: (m[2] || "").trim() };
}

/** Default shell timeout for `!`cmd`` bang execution. */
export const BANG_TIMEOUT_MS = 10_000;

/**
 * The directories scanned for command files, project first (it shadows personal
 * on a name clash). `opts.home` overrides the personal root for tests.
 */
export function commandDirs(cwd = process.cwd(), opts = {}) {
  const path = opts.deps?.path || _deps.path;
  const home = opts.home || homedir();
  return [
    { dir: path.join(cwd, ".claude", "commands"), scope: "project" },
    { dir: path.join(home, ".claude", "commands"), scope: "personal" },
  ];
}

/** Recursively collect `*.md` files under `dir` as `{file, rel}` (rel uses /). */
function walkMd(dir, { fs, path }, base = dir, acc = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      walkMd(full, { fs, path }, base, acc);
    } else if (e.isFile() && e.name.endsWith(".md")) {
      const rel = path.relative(base, full).replace(/\\/g, "/");
      acc.push({ file: full, rel });
    }
  }
  return acc;
}

/** Command name from a relative path: `git/commit.md` → `git:commit`. */
function nameFromRel(rel) {
  return rel.replace(/\.md$/, "").replace(/\//g, ":");
}

/** Parse one command file into its metadata + body (no expansion yet). */
export function parseCommandFile(file, scope, opts = {}) {
  const fs = opts.deps?.fs || _deps.fs;
  let content;
  try {
    content = fs.readFileSync(file, "utf-8");
  } catch {
    return null;
  }
  const { data, body } = parseFrontmatter(content);
  return {
    file,
    scope,
    description: data.description || "",
    argumentHint: data.argumentHint || "",
    allowedTools: data.allowedTools || null,
    model: data.model || null,
    body: body || "",
  };
}

/**
 * Discover all commands across both scopes. Project shadows personal by name.
 * @returns {Array<{name, scope, file, description, argumentHint, allowedTools, model}>}
 */
export function discoverCommands(cwd = process.cwd(), opts = {}) {
  const fs = opts.deps?.fs || _deps.fs;
  const path = opts.deps?.path || _deps.path;
  const byName = new Map();
  // Personal first, then project — so project overwrites on clash.
  const dirs = commandDirs(cwd, opts).reverse();
  for (const { dir, scope } of dirs) {
    for (const { file, rel } of walkMd(dir, { fs, path })) {
      const meta = parseCommandFile(file, scope, opts);
      if (!meta) continue;
      const name = nameFromRel(rel);
      byName.set(name, { name, ...meta });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Look up one command by name (accepts `git:commit` or `git/commit`). */
export function getCommand(name, cwd = process.cwd(), opts = {}) {
  const wanted = String(name || "")
    .replace(/^\//, "")
    .replace(/\//g, ":");
  return discoverCommands(cwd, opts).find((c) => c.name === wanted) || null;
}

/** Substitute $ARGUMENTS and $1..$9 in `text`. */
export function substituteArgs(text, args = []) {
  const list = Array.isArray(args) ? args : [];
  let out = text.replace(/\$ARGUMENTS/g, list.join(" "));
  out = out.replace(/\$([1-9])/g, (_, d) => list[Number(d) - 1] ?? "");
  return out;
}

/** Run every `!`cmd`` and replace it with the command's stdout (best-effort). */
function runBangs(text, { cwd, execSync }) {
  return text.replace(/!`([^`]+)`/g, (_, cmd) => {
    try {
      const out = execSync(cmd, {
        cwd,
        encoding: "utf-8",
        timeout: BANG_TIMEOUT_MS,
        stdio: ["ignore", "pipe", "pipe"],
      });
      return String(out).trim();
    } catch (err) {
      return `[command failed: ${cmd} — ${err.message?.split("\n")[0] || err}]`;
    }
  });
}

/**
 * Expand a command into a final prompt string.
 *   1. $ARGUMENTS / $1..$9 substitution
 *   2. !`cmd` bang execution (skipped when opts.allowBang === false)
 *   3. @path file references (via file-ref-expander)
 *
 * @param {object} command  output of getCommand/parseCommandFile (needs .body)
 * @param {string[]} args
 * @param {object} [opts] { cwd, allowBang, deps:{ execSync } }
 * @returns {{ prompt:string, warnings:string[] }}
 */
export function expandCommand(command, args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const execSync = opts.deps?.execSync || _deps.execSync;
  const warnings = [];

  let text = substituteArgs(command.body || "", args);

  if (opts.allowBang !== false) {
    text = runBangs(text, { cwd, execSync });
  }

  // @file expansion appends a <referenced-files> block when anything resolves.
  const expanded = expandFileRefs(text, { cwd });
  for (const w of expanded.warnings) warnings.push(w);

  return { prompt: expanded.prompt, warnings };
}

export { _deps };

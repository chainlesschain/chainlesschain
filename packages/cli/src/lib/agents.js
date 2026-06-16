/**
 * agents — user-defined subagent definitions (Claude-Code parity).
 *
 * Markdown files under `.claude/agents/` (project) or `~/.claude/agents/`
 * (personal) define named subagents. Each file's body IS the subagent's system
 * prompt; frontmatter declares its metadata. Mirrors `.claude/commands/` (see
 * slash-commands.js) but for *agents* rather than prompt macros — a file
 * `review/security.md` is the agent `review:security`.
 *
 * Frontmatter (all optional):
 *   name          override the filename-derived name
 *   description   one-line summary (when to use this agent)
 *   tools         allow-list — comma string or YAML array; omit = inherit all
 *   model         model override for runs of this agent
 *
 * Project scope shadows personal on a name clash. Discovery + parse are pure
 * (inject fs/path/home) so the whole thing is unit-testable.
 */

import fsDefault from "node:fs";
import pathDefault from "node:path";
import { homedir } from "node:os";
import yaml from "js-yaml";
import { projectRootBase } from "./project-root.cjs";

const _deps = { fs: fsDefault, path: pathDefault };

/** Split `--- ... ---` YAML frontmatter from the body, camelCasing keys. */
function parseFrontmatter(content) {
  const text = String(content || "");
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: text.trim() };
  let raw = {};
  try {
    raw = yaml.load(m[1]) || {};
  } catch {
    raw = {};
  }
  const data = {};
  for (const [k, v] of Object.entries(raw)) {
    const camel = k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    data[camel] = v;
  }
  return { data, body: (m[2] || "").trim() };
}

/** Normalize `tools` (comma string | array | null) into a string[] or null. */
export function normalizeTools(tools) {
  if (tools == null) return null;
  const list = Array.isArray(tools) ? tools : String(tools).split(/[,\s]+/);
  const out = list.map((t) => String(t).trim()).filter(Boolean);
  return out.length > 0 ? out : null;
}

/** Directories scanned for agent files — project first (shadows personal). */
export function agentDirs(cwd = process.cwd(), opts = {}) {
  const fs = opts.deps?.fs || _deps.fs;
  const path = opts.deps?.path || _deps.path;
  const home = opts.home || homedir();
  // Project-native first (highest precedence), then the Claude-Code-portable
  // location (so existing `.claude/agents/*.md` work unchanged), then personal.
  // discoverAgents reverses + last-write-wins, so `.chainlesschain/agents/`
  // shadows `.claude/agents/` shadows `~/.claude/agents/` on a name clash.
  const dirs = [
    { dir: path.join(cwd, ".chainlesschain", "agents"), scope: "project" },
    { dir: path.join(cwd, ".claude", "agents"), scope: "project" },
  ];
  // Subdirectory run: also scan the project-root `.claude` (cwd stays closest
  // and wins on a name clash through the reverse + last-write-wins below).
  const root = projectRootBase(cwd, { fs, path });
  if (root) {
    dirs.push({
      dir: path.join(root, ".chainlesschain", "agents"),
      scope: "project",
    });
    dirs.push({ dir: path.join(root, ".claude", "agents"), scope: "project" });
  }
  dirs.push({ dir: path.join(home, ".claude", "agents"), scope: "personal" });
  return dirs;
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

/** Agent name from a relative path: `review/security.md` → `review:security`. */
function nameFromRel(rel) {
  return rel.replace(/\.md$/, "").replace(/\//g, ":");
}

/** Parse one agent file into its metadata + system prompt (the body). */
export function parseAgentFile(file, scope, opts = {}) {
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
    name: data.name || null, // resolved against the path in discoverAgents
    description: data.description || "",
    tools: normalizeTools(data.tools),
    model: data.model || null,
    systemPrompt: body || "",
  };
}

/**
 * Discover all agents across both scopes. Project shadows personal by name.
 * @returns {Array<{name, scope, file, description, tools, model, systemPrompt}>}
 */
export function discoverAgents(cwd = process.cwd(), opts = {}) {
  const fs = opts.deps?.fs || _deps.fs;
  const path = opts.deps?.path || _deps.path;
  const byName = new Map();
  // Personal first, then project — so project overwrites on clash.
  const dirs = agentDirs(cwd, opts).reverse();
  for (const { dir, scope } of dirs) {
    for (const { file, rel } of walkMd(dir, { fs, path })) {
      const meta = parseAgentFile(file, scope, opts);
      if (!meta) continue;
      // Explicit frontmatter `name` wins; else derive from the path.
      const name = meta.name || nameFromRel(rel);
      byName.set(name, { ...meta, name });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Look up one agent by name (accepts `review:security` or `review/security`). */
export function getAgent(name, cwd = process.cwd(), opts = {}) {
  const wanted = String(name || "")
    .replace(/^\//, "")
    .replace(/\//g, ":");
  return discoverAgents(cwd, opts).find((a) => a.name === wanted) || null;
}

export { _deps };

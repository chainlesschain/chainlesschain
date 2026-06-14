"use strict";

/**
 * permission-rules — Claude-Code `permissions.{allow,ask,deny}` rule engine.
 *
 * A rule is a string `Tool(pattern)` (or a bare `Tool` matching every call of
 * that tool). `Tool` may be written with the Claude-Code umbrella name (Bash,
 * Read, Write, Edit, WebFetch, Task, …) or this CLI's own tool name (run_shell,
 * read_file, write_file, …) — both resolve to the same family.
 *
 *   Bash(git push:*)      → run_shell whose command starts with "git push"
 *   Bash(npm run test:*)  → run_shell starting with "npm run test"
 *   Read(./src/**)        → read_file/list_dir on a path under <cwd>/src
 *   Edit(//etc/**)        → edit_file on an absolute path under /etc
 *   WebFetch(domain:example.com) → web_fetch of https://example.com/…
 *   Bash                  → every run_shell call
 *   *                     → every tool call (Claude-Code deny-all idiom)
 *   Bash(*)               → every run_shell call (lone-`*` pattern = match-all)
 *
 * Pure + self-contained (no glob dependency — `globToRegExp` is built in, the
 * repo avoids pulling minimatch/picomatch). Decision precedence is
 * deny > ask > allow; no match returns `{ decision: null }` so callers fall
 * back to the existing risk-tier / shell-policy logic unchanged.
 *
 * This module only *decides*; wiring it into the agent tool loop is a separate
 * step (so it can ship + be unit-tested in isolation).
 */

const path = require("node:path");
const os = require("node:os");

const DECISIONS = Object.freeze({
  DENY: "deny",
  ASK: "ask",
  ALLOW: "allow",
});

/**
 * Umbrella (Claude-Code) tool name → the concrete CLI tool names it covers.
 * A rule written with either side resolves to the same family.
 */
const TOOL_GROUPS = Object.freeze({
  bash: ["run_shell"],
  read: ["read_file", "list_dir"],
  grep: ["search_files"],
  glob: ["search_files"],
  write: ["write_file"],
  edit: ["edit_file", "edit_file_hashed"],
  webfetch: ["web_fetch"],
  websearch: ["web_search"],
  task: ["spawn_sub_agent"],
  skill: ["run_skill", "list_skills"],
  runcode: ["run_code"],
  git: ["git"],
  todowrite: ["todo_write"],
});

/** Tools whose match target is a shell/command string (prefix-style matching). */
const COMMAND_TOOLS = new Set(["run_shell", "run_code", "git"]);
/** Tools whose match target is a filesystem path. */
const PATH_TOOLS = new Set([
  "read_file",
  "list_dir",
  "search_files",
  "write_file",
  "edit_file",
  "edit_file_hashed",
]);
/** Tools whose match target is a URL. */
const URL_TOOLS = new Set(["web_fetch"]);

/**
 * Does a rule's tool token apply to the concrete tool being evaluated?
 * `Bash` → run_shell; `read_file` → read_file only; unknown tokens (e.g.
 * `mcp__srv__do`) fall back to a case-insensitive exact match.
 */
function toolMatches(ruleTool, actualTool) {
  const r = String(ruleTool || "").toLowerCase();
  const a = String(actualTool || "");
  // Claude-Code `*` deny-all: a bare-`*` tool token matches every tool.
  if (r === "*") return true;
  if (Object.prototype.hasOwnProperty.call(TOOL_GROUPS, r)) {
    return TOOL_GROUPS[r].includes(a);
  }
  return r === a.toLowerCase();
}

/**
 * Parse a rule string into `{ raw, tool, pattern }` (pattern null = bare tool
 * rule). Returns null for a malformed/empty rule so callers can skip it.
 */
function parseRule(rule) {
  const raw = String(rule || "").trim();
  if (!raw) return null;
  // Tool token is an umbrella/CLI name OR a bare `*` (Claude-Code deny-all).
  const m = raw.match(/^(\*|[A-Za-z_][\w-]*)\s*(?:\(([\s\S]*)\))?$/);
  if (!m) return null;
  const tool = m[1];
  const pattern = m[2] === undefined ? null : m[2].trim();
  return { raw, tool, pattern };
}

/** Convert a glob (`*`, `**`, `?`) into an anchored RegExp. Slash-normalized. */
function globToRegExp(glob) {
  const s = String(glob || "");
  let re = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "*") {
      if (s[i + 1] === "*") {
        re += ".*";
        i++;
        if (s[i + 1] === "/") i++; // `**/` also matches zero segments
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp("^" + re + "$");
}

/** Normalize a filesystem path to forward slashes for glob comparison. */
function toSlash(p) {
  return String(p || "").replace(/\\/g, "/");
}

/**
 * Resolve the concrete value a path-pattern should be matched against, and the
 * pattern itself, both as absolute slash-normalized strings.
 *   ./x or x   → relative to cwd
 *   //abs/x    → absolute (leading `//` is Claude-Code's absolute marker)
 *   ~/x        → home
 */
function resolvePathPattern(pattern, cwd) {
  let pat = String(pattern || "");
  if (pat.startsWith("//")) {
    pat = pat.slice(1); // `//etc/**` → `/etc/**`
  } else if (pat.startsWith("~/") || pat === "~") {
    pat = path.join(os.homedir(), pat.slice(1));
  } else {
    pat = path.resolve(cwd || process.cwd(), pat);
  }
  return toSlash(pat);
}

/** Extract the match target (command / path / url) for a tool's args. */
function extractTarget(actualTool, args, cwd) {
  const a = args || {};
  if (COMMAND_TOOLS.has(actualTool)) {
    return { kind: "command", value: String(a.command || "").trim() };
  }
  if (PATH_TOOLS.has(actualTool)) {
    const raw = a.path || a.file_path || a.dir || a.directory || "";
    if (!raw) return { kind: "path", value: null };
    return {
      kind: "path",
      value: toSlash(path.resolve(cwd || process.cwd(), String(raw))),
    };
  }
  if (URL_TOOLS.has(actualTool)) {
    return { kind: "url", value: String(a.url || "").trim() };
  }
  return { kind: "none", value: null };
}

/** Match a shell command against a Claude-Code Bash-style pattern. */
function matchCommand(pattern, command) {
  const cmd = String(command || "").trim();
  // `prefix:*` → starts-with prefix (CC idiom: Bash(git push:*))
  if (pattern.endsWith(":*")) {
    const prefix = pattern.slice(0, -2).trim();
    return cmd === prefix || cmd.startsWith(prefix);
  }
  if (pattern.includes("*")) {
    return globToRegExp(pattern).test(cmd);
  }
  return cmd === pattern;
}

/** Match a URL against a `domain:host` or plain glob pattern. */
function matchUrl(pattern, url) {
  const u = String(url || "");
  if (pattern.startsWith("domain:")) {
    const host = pattern.slice("domain:".length).trim();
    let actualHost = "";
    try {
      actualHost = new URL(u).host;
    } catch {
      return false;
    }
    return globToRegExp(host).test(actualHost);
  }
  return globToRegExp(pattern).test(u);
}

/**
 * Does `pattern` (the inside of `Tool(...)`, or null for a bare rule) match the
 * given tool call? `null` pattern always matches.
 */
function matchPattern(pattern, actualTool, args, cwd) {
  if (pattern === null) return true;
  // A lone `*` / `**` pattern matches any target regardless of slashes — covers
  // `Bash(*)`, `Read(**)`, `WebFetch(*)`, etc. Done before the glob path so a
  // command/url/path containing `/` can't slip past a deny-all (globToRegExp's
  // `*` → `[^/]*` otherwise excludes slashes).
  if (pattern === "*" || pattern === "**") return true;
  const target = extractTarget(actualTool, args, cwd);
  if (target.kind === "command") {
    return target.value ? matchCommand(pattern, target.value) : false;
  }
  if (target.kind === "url") {
    return target.value ? matchUrl(pattern, target.value) : false;
  }
  if (target.kind === "path") {
    if (!target.value) return false;
    return globToRegExp(resolvePathPattern(pattern, cwd)).test(target.value);
  }
  // Tool has no match target but the rule specified a pattern → no match.
  return false;
}

/**
 * Evaluate a tool call against a ruleset.
 *
 * @param {object} input
 * @param {string} input.tool            concrete tool name (run_shell, …)
 * @param {object} [input.args]          tool arguments
 * @param {string} [input.cwd]           base dir for relative path patterns
 * @param {object} input.rules           { allow:[], ask:[], deny:[] } of strings
 * @returns {{ decision: 'deny'|'ask'|'allow'|null, rule: string|null }}
 */
function evaluatePermissionRules({ tool, args = {}, cwd, rules } = {}) {
  const set = rules || {};
  const order = [
    [DECISIONS.DENY, set.deny],
    [DECISIONS.ASK, set.ask],
    [DECISIONS.ALLOW, set.allow],
  ];
  for (const [decision, list] of order) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      const parsed = parseRule(entry);
      if (!parsed) continue;
      if (!toolMatches(parsed.tool, tool)) continue;
      if (matchPattern(parsed.pattern, tool, args, cwd)) {
        return { decision, rule: parsed.raw };
      }
    }
  }
  return { decision: null, rule: null };
}

/** Concrete tool name → the umbrella token a suggested rule should be written
 *  with (Claude-Code style; what users expect to see in settings.json). */
const SUGGEST_UMBRELLA = Object.freeze({
  run_shell: "Bash",
  run_code: "Bash",
  git: "git",
  read_file: "Read",
  list_dir: "Read",
  search_files: "Grep",
  write_file: "Write",
  edit_file: "Edit",
  edit_file_hashed: "Edit",
  web_fetch: "WebFetch",
  web_search: "WebSearch",
  spawn_sub_agent: "Task",
  run_skill: "Skill",
  list_skills: "Skill",
  todo_write: "TodoWrite",
});

/** Commands whose first token is a dispatcher — keep 2 tokens in the prefix. */
const MULTI_VERB = new Set([
  "git", "npm", "npx", "yarn", "pnpm", "docker", "kubectl", "cargo",
  "go", "pip", "pip3", "python", "python3", "node", "dotnet", "gh", "brew",
]);

/**
 * Suggest a sensible `allow` rule string for a tool call, for the interactive
 * "always allow" / don't-ask-again flow. Commands → `Bash(<1-2 token prefix>:*)`;
 * paths → `<Umbrella>(<dir>/**)`; urls → `WebFetch(domain:<host>)`; otherwise a
 * bare tool umbrella. Returns null if nothing meaningful can be derived.
 */
function suggestAllowRule(tool, args = {}) {
  const umbrella = SUGGEST_UMBRELLA[tool] || tool;
  if (COMMAND_TOOLS.has(tool)) {
    const cmd = String(args.command || "").trim();
    if (!cmd) return umbrella;
    const tokens = cmd.split(/\s+/);
    const keep = MULTI_VERB.has(tokens[0]) && tokens.length > 1 ? 2 : 1;
    const prefix = tokens.slice(0, keep).join(" ");
    return `${umbrella}(${prefix}:*)`;
  }
  if (PATH_TOOLS.has(tool)) {
    const raw = args.path || args.file_path || args.dir || args.directory || "";
    if (!raw) return umbrella;
    const slash = String(raw).replace(/\\/g, "/");
    const dir = slash.includes("/") ? slash.slice(0, slash.lastIndexOf("/")) : ".";
    const base = dir === "" ? "/" : dir;
    const norm = /^(\.|\/|~)/.test(base) ? base : `./${base}`;
    return `${umbrella}(${norm}/**)`;
  }
  if (URL_TOOLS.has(tool)) {
    try {
      return `${umbrella}(domain:${new URL(String(args.url || "")).host})`;
    } catch {
      return umbrella;
    }
  }
  return umbrella;
}

module.exports = {
  DECISIONS,
  TOOL_GROUPS,
  COMMAND_TOOLS,
  PATH_TOOLS,
  URL_TOOLS,
  toolMatches,
  parseRule,
  globToRegExp,
  resolvePathPattern,
  extractTarget,
  matchCommand,
  matchUrl,
  matchPattern,
  evaluatePermissionRules,
  suggestAllowRule,
  SUGGEST_UMBRELLA,
};

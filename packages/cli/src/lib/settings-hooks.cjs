"use strict";

/**
 * settings-hooks — load Claude-Code `hooks` blocks from `.claude/settings.json`
 * and resolve which command hooks fire for a given event + tool.
 *
 * Schema (Claude-Code parity):
 *   {
 *     "hooks": {
 *       "PreToolUse":  [ { "matcher": "Bash", "hooks": [ { "type": "command",
 *                          "command": "./guard.sh", "timeout": 60 } ] } ],
 *       "PostToolUse": [ ... ]
 *     }
 *   }
 *
 * Hook arrays are **concatenated** across the settings hierarchy (user <
 * project < .local < --settings) — order is significant and there is no dedup
 * (unlike permission rules, which union). Distinct from the DB-backed
 * `cc hook add` registry: those stay observe-only; only these settings hooks
 * get the stdin-JSON decision protocol (see hook-runner.cjs) + blocking power.
 *
 * Pure + self-contained (`compileMatcher` is inlined rather than imported from
 * the ESM hook-manager, which a .cjs cannot `require`). `_deps.fs/homedir`
 * injection follows the CLI testing convention.
 */

const path = require("node:path");
const os = require("node:os");
const fsDefault = require("node:fs");
const { SUGGEST_UMBRELLA } = require("./permission-rules.cjs");
const { projectRootBase } = require("./project-root.cjs");

const _deps = { fs: fsDefault, homedir: () => os.homedir() };

/** Events this loader understands (PreToolUse/PostToolUse are wired first). */
const HOOK_EVENTS = Object.freeze([
  "PreToolUse",
  "PostToolUse",
  "UserPromptSubmit",
  "Stop",
  "SubagentStop",
  "SessionStart",
  "SessionEnd",
  "PreCompact",
  "Notification",
]);

/**
 * Same hierarchy as settings-loader (user < project-root < cwd < --settings).
 * When run from a SUBDIRECTORY, the project-root `.claude` hooks apply (below
 * cwd's, above the user layer) — same walk-up as settings-loader's settingsPaths
 * (shared `projectRootBase`, threaded through this loader's own `_deps.fs` to
 * keep test injection intact). Hooks RUN SHELL COMMANDS, so a guard hook in the
 * project-root settings must NOT silently vanish when `cc` is invoked from a
 * subdirectory. `projectRootBase` returns null when cwd IS the root.
 */
function settingsFiles(cwd, explicitFile) {
  const home = _deps.homedir();
  const list = [path.join(home, ".claude", "settings.json")];
  const root = projectRootBase(cwd, { fs: _deps.fs, path });
  if (root) {
    list.push(path.join(root, ".claude", "settings.json"));
    list.push(path.join(root, ".claude", "settings.local.json"));
  }
  list.push(path.join(cwd, ".claude", "settings.json"));
  list.push(path.join(cwd, ".claude", "settings.local.json"));
  if (explicitFile) list.push(path.resolve(cwd, explicitFile));
  return list;
}

function readJson(file, onWarn) {
  try {
    if (!_deps.fs.existsSync(file)) return null;
    const parsed = JSON.parse(_deps.fs.readFileSync(file, "utf-8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (err) {
    const msg = `hooks: ignoring malformed ${file} (${err.message})`;
    if (typeof onWarn === "function") onWarn(msg);
    else process.stderr.write(msg + "\n");
    return null; // fail-open
  }
}

/**
 * Load + concatenate the `hooks` blocks across the hierarchy.
 * @returns {{ hooks: Record<string, Array<{matcher:string|null, hooks:Array<{type,command,timeout}>}>>, files:string[] }}
 */
function loadHooks({ cwd = process.cwd(), settingsFile, onWarn } = {}) {
  const merged = {};
  const files = [];
  // Safe-mode kill switch (`cc agent --safe-mode` sets CC_SETTINGS_HOOKS=0):
  // run with NO settings hooks so a broken hook can be diagnosed.
  if (process.env.CC_SETTINGS_HOOKS === "0") {
    return { hooks: merged, files };
  }
  for (const file of settingsFiles(cwd, settingsFile)) {
    const data = readJson(file, onWarn);
    const block =
      data && data.hooks && typeof data.hooks === "object" ? data.hooks : null;
    if (!block) continue;
    let contributed = false;
    for (const [event, groups] of Object.entries(block)) {
      if (!Array.isArray(groups)) continue;
      for (const g of groups) {
        if (!g || typeof g !== "object" || !Array.isArray(g.hooks)) continue;
        const cmds = g.hooks.filter(
          (h) => h && h.type === "command" && h.command,
        );
        if (cmds.length === 0) continue;
        if (!merged[event]) merged[event] = [];
        merged[event].push({ matcher: g.matcher ?? null, hooks: cmds });
        contributed = true;
      }
    }
    if (contributed) files.push(file);
  }
  return { hooks: merged, files };
}

/**
 * Compile a matcher into a test fn (pipe / wildcard / regex). Inlined twin of
 * hook-manager.compileMatcher so this .cjs has no ESM dependency.
 */
function compileMatcher(pattern) {
  if (!pattern || pattern === "*") return () => true;
  if (pattern.startsWith("/") && pattern.lastIndexOf("/") > 0) {
    const i = pattern.lastIndexOf("/");
    try {
      const re = new RegExp(pattern.slice(1, i), pattern.slice(i + 1));
      return (v) => re.test(v);
    } catch {
      /* fall through to wildcard */
    }
  }
  // OR-separated alternatives: pipe `Edit|Write` AND comma `Bash,PowerShell`
  // (Claude-Code 2.1.191: comma-separated matchers silently never fired). Empty
  // segments (trailing `Bash,` / `Edit|`) are dropped so they can't collapse to
  // a match-everything matcher. Regex `/…/` matchers are handled above, so a
  // comma inside `{1,3}` is never split here.
  if (pattern.includes("|") || pattern.includes(",")) {
    const ms = pattern
      .split(/[|,]/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => compileMatcher(p));
    return ms.length ? (v) => ms.some((m) => m(v)) : () => false;
  }
  const esc = pattern
    .replace(/[.+^${}()[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  const re = new RegExp(`^${esc}$`);
  return (v) => re.test(v);
}

/** Concrete tool name → Claude-Code umbrella token (Bash, Read, …). */
function umbrellaFor(tool) {
  return SUGGEST_UMBRELLA[tool] || tool;
}

/**
 * Ordered command hooks for an event whose matcher matches the tool. The
 * matcher is tested against BOTH the CC umbrella (`Bash`) and the raw tool
 * name (`run_shell`), so settings written either way fire.
 *
 * @returns {Array<{command:string, timeout?:number}>}
 */
function collectHooks(hooksBlock, event, toolName) {
  const groups = (hooksBlock && hooksBlock[event]) || [];
  const umbrella = umbrellaFor(toolName);
  const raw = String(toolName || "");
  const out = [];
  for (const g of groups) {
    const fn = compileMatcher(g.matcher);
    if (fn(umbrella) || (raw && fn(raw))) {
      for (const h of g.hooks) out.push({ command: h.command, timeout: h.timeout });
    }
  }
  return out;
}

module.exports = {
  loadHooks,
  collectHooks,
  compileMatcher,
  umbrellaFor,
  settingsFiles,
  HOOK_EVENTS,
  _deps,
};

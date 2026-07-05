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
const crypto = require("node:crypto");
const { SUGGEST_UMBRELLA } = require("./permission-rules.cjs");
const { projectRootBase } = require("./project-root.cjs");

const _deps = { fs: fsDefault, homedir: () => os.homedir() };

/** Events this loader understands (PreToolUse/PostToolUse are wired first). */
const HOOK_EVENTS = Object.freeze([
  "PreToolUse",
  "PostToolUse",
  "UserPromptSubmit",
  "Stop",
  "SubagentStart",
  "SubagentStop",
  "SessionStart",
  "SessionResume",
  "SessionPause",
  "SessionEnd",
  "ConfigChange",
  "PreCompact",
  "Notification",
  "PermissionRequest",
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

function managedSettingsFile(env = process.env) {
  if (env.CC_MANAGED_SETTINGS) return path.resolve(env.CC_MANAGED_SETTINGS);
  if (process.platform === "win32") {
    const base = env.ProgramData || env.PROGRAMDATA || "C:\\ProgramData";
    return path.join(base, "ChainlessChain", "managed-settings.json");
  }
  return "/etc/chainlesschain/managed-settings.json";
}

function appendHookBlock(merged, data) {
  const block =
    data && data.hooks && typeof data.hooks === "object" ? data.hooks : null;
  if (!block) return false;
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
  return contributed;
}

/**
 * Load + concatenate the `hooks` blocks across the hierarchy.
 * @returns {{ hooks: Record<string, Array<{matcher:string|null, hooks:Array<{type,command,timeout}>}>>, files:string[] }}
 */
function loadHooks({
  cwd = process.cwd(),
  settingsFile,
  onWarn,
  env = process.env,
} = {}) {
  const merged = {};
  const files = [];
  const managedFile = managedSettingsFile(env);
  let managed = null;
  if (_deps.fs.existsSync(managedFile)) {
    managed = readJson(managedFile, onWarn);
    if (!managed) {
      const error = new Error(
        `managed settings are unreadable or malformed: ${managedFile}`,
      );
      error.code = "CC_MANAGED_SETTINGS_INVALID";
      throw error;
    }
  }
  // Safe-mode kill switch (`cc agent --safe-mode` sets CC_SETTINGS_HOOKS=0):
  // user/project hooks are disabled, but administrator hooks remain active.
  const managedOnly = managed?.allowManagedHooksOnly === true;
  const skipUnmanaged = env.CC_SETTINGS_HOOKS === "0" || managedOnly;
  const seenPaths = new Set();
  for (const file of skipUnmanaged ? [] : settingsFiles(cwd, settingsFile)) {
    // Dedup by RESOLVED path so the SAME physical file is never read twice — e.g.
    // `--settings .claude/settings.json` from the project root aliases the
    // auto-loaded cwd file, which would otherwise CONCATENATE its hook groups a
    // second time and double-fire every hook in it. (Cross-FILE concatenation
    // across the user/project/local hierarchy is intentional and untouched —
    // identical commands from DIFFERENT layers still both run.)
    const resolved = path.resolve(file);
    if (seenPaths.has(resolved)) continue;
    seenPaths.add(resolved);
    const data = readJson(file, onWarn);
    const contributed = appendHookBlock(merged, data);
    if (contributed) files.push(file);
  }
  if (managed && appendHookBlock(merged, managed)) files.push(managedFile);
  const result = { hooks: merged, files };
  if (managed) {
    result.managed = managed;
    result.managedFile = managedFile;
  }
  return result;
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
 * `async`/`asyncRewake` are carried through (default false) so the caller can
 * split fire-and-forget hooks off the blocking path (see async-hook-supervisor).
 * `event` is stamped on each hook so a supervisor can key runs by (event+cmd).
 *
 * @returns {Array<{command:string, timeout?:number, event:string,
 *                  async:boolean, asyncRewake:boolean}>}
 */
function collectHooks(hooksBlock, event, toolName) {
  const groups = (hooksBlock && hooksBlock[event]) || [];
  const umbrella = umbrellaFor(toolName);
  const raw = String(toolName || "");
  // Claude-Code MCP parity: a bare server-prefix matcher (`mcp__github`) fires
  // for EVERY tool from that server (`mcp__github__create_issue`, …). Our
  // matcher is anchored (`^…$`), so the server prefix alone would never match a
  // full `mcp__server__tool` name without also testing the prefix explicitly.
  // (Users can still target one tool with the full name, or all of a server's
  // tools with a `mcp__server*` wildcard / `/mcp__server__/` regex.)
  let mcpServer = null;
  if (raw.startsWith("mcp__")) {
    const parts = raw.split("__");
    if (parts.length >= 3) mcpServer = `${parts[0]}__${parts[1]}`;
  }
  const out = [];
  for (const g of groups) {
    const fn = compileMatcher(g.matcher);
    if (fn(umbrella) || (raw && fn(raw)) || (mcpServer && fn(mcpServer))) {
      for (const h of g.hooks)
        out.push({
          command: h.command,
          timeout: h.timeout,
          event,
          async: h.async === true,
          asyncRewake: h.asyncRewake === true,
        });
    }
  }
  return out;
}

/**
 * Every command-hook in a parsed settings object, tagged with the event +
 * matcher it fires under (so a fingerprint reflects WHEN it runs, not just the
 * command string). Mirrors loadHooks' command-hook filter.
 */
function extractCommandHooks(data) {
  const out = [];
  const block =
    data && data.hooks && typeof data.hooks === "object" ? data.hooks : null;
  if (!block) return out;
  for (const [event, groups] of Object.entries(block)) {
    if (!Array.isArray(groups)) continue;
    for (const g of groups) {
      if (!g || typeof g !== "object" || !Array.isArray(g.hooks)) continue;
      for (const h of g.hooks) {
        if (h && h.type === "command" && h.command) {
          out.push({
            event,
            matcher: g.matcher ?? null,
            command: String(h.command),
          });
        }
      }
    }
  }
  return out;
}

/** `~/.chainlesschain/hook-trust.json` — remembered first-run acknowledgments. */
function hookTrustStorePath() {
  return path.join(_deps.homedir(), ".chainlesschain", "hook-trust.json");
}

function readHookTrustStore() {
  try {
    const f = hookTrustStorePath();
    if (!_deps.fs.existsSync(f)) return {};
    const parsed = JSON.parse(_deps.fs.readFileSync(f, "utf-8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {}; // unreadable store → treat as nothing acknowledged
  }
}

function writeHookTrustStore(store) {
  try {
    const f = hookTrustStorePath();
    _deps.fs.mkdirSync(path.dirname(f), { recursive: true });
    _deps.fs.writeFileSync(f, JSON.stringify(store, null, 2), "utf-8");
    return true;
  } catch {
    return false; // best-effort — a failed write just re-shows the notice
  }
}

/**
 * First-run trust notice for project-sourced settings.json hooks (which run
 * shell). The user's own `~/.claude/settings.json` and an explicit `--settings`
 * file are trusted; only the project's `.claude/settings{,.local}.json` (project
 * root + cwd) carry the cloned-repo auto-execution risk that Claude-Code 2.1.195
 * gated ("untrusted project config must require explicit consent").
 *
 * Returns a one-line notice (and records an acknowledgment hash) the FIRST time
 * a project's shell-running hooks are seen — and again only if those hooks
 * change. Returns null when there are no project hooks, the hooks are unchanged
 * since last acknowledged, or the notice is disabled (`CC_HOOK_TRUST_NOTICE=0`,
 * or hooks themselves are off via `CC_SETTINGS_HOOKS=0`). Best-effort: a failed
 * store write still returns the notice (shown again next run) rather than
 * throwing — it must never abort agent startup.
 *
 * @returns {string|null}
 */
function projectHookTrustNotice({ cwd = process.cwd(), settingsFile } = {}) {
  if (process.env.CC_HOOK_TRUST_NOTICE === "0") return null;
  if (process.env.CC_SETTINGS_HOOKS === "0") return null; // hooks won't run anyway
  const managedFile = managedSettingsFile(process.env);
  if (_deps.fs.existsSync(managedFile)) {
    const managed = readJson(managedFile);
    if (managed?.allowManagedHooksOnly === true) return null;
  }
  const home = path.join(_deps.homedir(), ".claude", "settings.json");
  const explicit = settingsFile ? path.resolve(cwd, settingsFile) : null;
  const trusted = new Set([home, explicit].filter(Boolean));
  const seen = new Set();
  const projectFiles = settingsFiles(cwd, settingsFile).filter((f) => {
    if (trusted.has(f) || seen.has(f)) return false;
    seen.add(f);
    return true;
  });

  const entries = [];
  const contributing = [];
  for (const f of projectFiles) {
    let data;
    try {
      if (!_deps.fs.existsSync(f)) continue;
      data = JSON.parse(_deps.fs.readFileSync(f, "utf-8"));
    } catch {
      continue; // malformed JSON is surfaced by loadHooks' own warn path
    }
    const cmds = extractCommandHooks(data);
    if (cmds.length) {
      entries.push(...cmds);
      contributing.push(f);
    }
  }
  if (entries.length === 0) return null;

  const fingerprint = entries
    .map((e) => `${e.event} ${e.matcher ?? ""} ${e.command}`)
    .sort();
  const hash = crypto
    .createHash("sha256")
    .update(JSON.stringify(fingerprint))
    .digest("hex");
  const key = projectRootBase(cwd, { fs: _deps.fs, path }) || cwd;

  const store = readHookTrustStore();
  if (store[key] && store[key].hash === hash) return null; // already acknowledged
  store[key] = {
    hash,
    files: contributing,
    count: entries.length,
    at: new Date().toISOString(),
  };
  writeHookTrustStore(store); // best-effort acknowledgment

  const fileList = contributing.map((f) => `    ${f}`).join("\n");
  return (
    `⚠ This project's .claude/settings.json defines ${entries.length} ` +
    `shell-running hook(s) that auto-run on agent activity:\n${fileList}\n` +
    `  Review them before trusting this repo. Shown once per change; ` +
    `disable all hooks with CC_SETTINGS_HOOKS=0.`
  );
}

module.exports = {
  loadHooks,
  projectHookTrustNotice,
  collectHooks,
  compileMatcher,
  umbrellaFor,
  settingsFiles,
  managedSettingsFile,
  HOOK_EVENTS,
  _deps,
};

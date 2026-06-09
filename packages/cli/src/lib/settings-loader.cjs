"use strict";

/**
 * settings-loader — discover + merge `.claude/settings.json` files into a
 * single permission ruleset, Claude-Code style.
 *
 * Precedence (lowest → highest):
 *   1. ~/.claude/settings.json                 (user, all projects)
 *   2. <project>/.claude/settings.json         (project, checked in)
 *   3. <project>/.claude/settings.local.json   (personal override, gitignored)
 *   4. --settings <file>                       (explicit, CC `--settings` parity)
 *   5. CC_PERMISSIONS_ALLOW / _ASK / _DENY env (comma-separated, kill-switch)
 *
 * Permission arrays are **unioned** across sources — a higher layer can add
 * rules but never *remove* a lower layer's `deny` (deny can only accrete). The
 * engine's deny > ask > allow precedence then resolves any overlap, so an
 * inherited deny always beats a locally added allow.
 *
 * Robustness: a missing file is silently skipped; a malformed file warns to
 * stderr and is skipped (fail-open to the existing risk-tier logic — a broken
 * settings file must never wedge the agent). All reads are explicit UTF-8.
 *
 * `_deps` injection (fs / homedir) follows the CLI testing convention since
 * `vi.mock` cannot intercept CJS `require`.
 */

const fsDefault = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const _deps = { fs: fsDefault, homedir: () => os.homedir() };

const KINDS = Object.freeze(["allow", "ask", "deny"]);

/** Read + JSON.parse one settings file. Returns null on missing/bad. */
function readSettingsFile(file, { onWarn } = {}) {
  let text;
  try {
    if (!_deps.fs.existsSync(file)) return null;
    text = _deps.fs.readFileSync(file, "utf-8");
  } catch {
    return null; // unreadable → treat as absent
  }
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (err) {
    if (typeof onWarn === "function") {
      onWarn(`settings: ignoring malformed ${file} (${err.message})`);
    } else {
      process.stderr.write(
        `settings: ignoring malformed ${file} (${err.message})\n`,
      );
    }
    return null;
  }
}

/** Push every string of `arr` into `target` + `sources`, de-duped. */
function accrete(target, sources, arr, file, kind) {
  if (!Array.isArray(arr)) return;
  for (const entry of arr) {
    const rule = String(entry || "").trim();
    if (!rule) continue;
    if (!target.includes(rule)) target.push(rule);
    // First source to introduce a rule wins as its provenance label.
    const key = `${kind}:${rule}`;
    if (!sources[key]) sources[key] = file;
  }
}

/** The ordered list of candidate settings files for a cwd. */
function settingsPaths(cwd, explicitFile) {
  const home = _deps.homedir();
  const list = [
    path.join(home, ".claude", "settings.json"),
    path.join(cwd, ".claude", "settings.json"),
    path.join(cwd, ".claude", "settings.local.json"),
  ];
  if (explicitFile) list.push(path.resolve(cwd, explicitFile));
  return list;
}

/** Parse a comma/space separated env override into a string[]. */
function parseEnvList(value) {
  if (!value) return [];
  return String(value)
    .split(/[,\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Load + merge the effective permission ruleset for a project.
 *
 * @param {object} [opts]
 * @param {string} [opts.cwd=process.cwd()]
 * @param {string} [opts.settingsFile]   value of --settings (CC parity)
 * @param {object} [opts.env=process.env]
 * @param {(msg:string)=>void} [opts.onWarn]
 * @returns {{
 *   rules: { allow:string[], ask:string[], deny:string[] },
 *   sources: Record<string,string>,    // "kind:rule" → originating file
 *   files: string[]                     // settings files that contributed
 * }}
 */
function loadSettings(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const env = opts.env || process.env;
  const onWarn = opts.onWarn;

  const rules = { allow: [], ask: [], deny: [] };
  const sources = {};
  const files = [];

  for (const file of settingsPaths(cwd, opts.settingsFile)) {
    const data = readSettingsFile(file, { onWarn });
    if (!data) continue;
    const perms =
      data.permissions && typeof data.permissions === "object"
        ? data.permissions
        : {};
    let contributed = false;
    for (const kind of KINDS) {
      const before = rules[kind].length;
      accrete(rules[kind], sources, perms[kind], file, kind);
      if (rules[kind].length !== before) contributed = true;
    }
    if (contributed) files.push(file);
  }

  // env kill-switch layer (highest precedence source label)
  const envMap = {
    allow: parseEnvList(env.CC_PERMISSIONS_ALLOW),
    ask: parseEnvList(env.CC_PERMISSIONS_ASK),
    deny: parseEnvList(env.CC_PERMISSIONS_DENY),
  };
  let envContributed = false;
  for (const kind of KINDS) {
    const before = rules[kind].length;
    accrete(rules[kind], sources, envMap[kind], "<env>", kind);
    if (rules[kind].length !== before) envContributed = true;
  }
  if (envContributed) files.push("<env>");

  return { rules, sources, files };
}

/** Look up the source file a matched `{ kind, rule }` came from. */
function ruleSource(sources, kind, rule) {
  return (sources && sources[`${kind}:${rule}`]) || null;
}

module.exports = {
  loadSettings,
  readSettingsFile,
  settingsPaths,
  parseEnvList,
  ruleSource,
  KINDS,
  _deps,
};

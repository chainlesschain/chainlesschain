/**
 * Plugin OPTIONS resolution (Phase 3 gap: typed optionsSchema + sensitive
 * project-scope gate).
 *
 * A plugin declares `optionsSchema` (typed config with `scope` and `sensitive`
 * in [[capabilities.js]]). Users supply option VALUES at two scopes:
 *   - USER scope   → user data dir `plugin-options.json` (may hold secrets)
 *   - PROJECT scope → repo-local `.chainlesschain/plugin-options.json`
 *     (checked-in-able → MUST NOT hold secrets)
 *
 * The security-critical rule (already enforced by `validateOptions`): a
 * SENSITIVE option can never come from project config. `resolvePluginOptions`
 * layers defaults < project (non-sensitive only) < user, DROPS + WARNS on any
 * sensitive/user-only option that appears in project config, and returns the
 * merged values with a redacted view for logging.
 *
 * Store IO is injected (`_deps`) so unit tests never touch the real dirs; the
 * resolver itself is pure.
 */

import fs from "fs";
import path from "path";
import { getElectronUserDataDir } from "../paths.js";
import {
  optionDefaults,
  validateOptions,
  redactSensitiveOptions,
} from "./capabilities.js";

export const _deps = {
  existsSync: fs.existsSync,
  readFileSync: fs.readFileSync,
  writeFileSync: fs.writeFileSync,
  mkdirSync: fs.mkdirSync,
  userStorePath: () =>
    path.join(getElectronUserDataDir(), "plugin-options.json"),
  projectStorePath: (cwd) =>
    path.join(cwd || process.cwd(), ".chainlesschain", "plugin-options.json"),
};

function readJsonObject(p) {
  try {
    if (!_deps.existsSync(p)) return {};
    const data = JSON.parse(_deps.readFileSync(p, "utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function writeJsonObject(p, obj) {
  _deps.mkdirSync(path.dirname(p), { recursive: true });
  _deps.writeFileSync(p, JSON.stringify(obj, null, 2), "utf8");
}

/** Load a plugin's option VALUES at the given scope (`user` | `project`). */
export function loadPluginOptionValues(name, scope, { cwd } = {}) {
  const p =
    scope === "project" ? _deps.projectStorePath(cwd) : _deps.userStorePath();
  const store = readJsonObject(p);
  const v = store[name];
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

/** Persist a plugin's option VALUES at a scope (replaces the plugin's entry). */
export function setPluginOptionValues(name, values, scope, { cwd } = {}) {
  const p =
    scope === "project" ? _deps.projectStorePath(cwd) : _deps.userStorePath();
  const store = readJsonObject(p);
  store[name] = values && typeof values === "object" ? values : {};
  writeJsonObject(p, store);
  return { name, scope, path: p };
}

/** Provided keys of `values` (that exist in schema) accepted at `scope`. */
function acceptedKeys(schema, values, scope) {
  const res = validateOptions(schema, values, { scope });
  const keys = new Set();
  for (const key of Object.keys(values || {})) {
    if (!Object.prototype.hasOwnProperty.call(schema, key)) continue; // unknown → ignored
    // A provided key was accepted iff no error names it. validateOptions always
    // quotes the offending key as `"<key>"`, so this is an exact match.
    if (!res.errors.some((e) => e.includes(`"${key}"`))) keys.add(key);
  }
  return { res, keys };
}

/**
 * PURE: resolve effective option values from defaults + project + user config.
 *
 * Precedence: defaults < project (non-sensitive, non-user-only) < user.
 * A sensitive or user-only option present in project config is DROPPED and a
 * warning is recorded — a checked-in project file can never inject a secret.
 *
 * @returns {{ options:object, redacted:object, warnings:string[],
 *             sources:Record<string,'default'|'project'|'user'>,
 *             droppedFromProject:string[] }}
 */
export function resolvePluginOptions(
  schema,
  { userValues, projectValues } = {},
) {
  const s = schema || {};
  const options = optionDefaults(s);
  const sources = {};
  for (const key of Object.keys(options)) sources[key] = "default";

  const warnings = [];
  const droppedFromProject = [];

  // Project layer first (lower precedence). validateOptions errors on sensitive/
  // user-only keys at project scope — those are the drops we surface + refuse.
  const proj = acceptedKeys(s, projectValues, "project");
  for (const err of proj.res.errors) {
    if (/sensitive|user-scoped/.test(err)) {
      const m = err.match(/"([^"]+)"/);
      if (m) droppedFromProject.push(m[1]);
    }
    warnings.push(`project: ${err}`);
  }
  for (const w of proj.res.warnings) warnings.push(`project: ${w}`);
  for (const key of proj.keys) {
    options[key] = proj.res.normalized[key];
    sources[key] = "project";
  }

  // User layer on top (highest precedence; may carry secrets).
  const user = acceptedKeys(s, userValues, "user");
  for (const err of user.res.errors) warnings.push(`user: ${err}`);
  for (const w of user.res.warnings) warnings.push(`user: ${w}`);
  for (const key of user.keys) {
    options[key] = user.res.normalized[key];
    sources[key] = "user";
  }

  return {
    options,
    redacted: redactSensitiveOptions(s, options),
    warnings,
    sources,
    droppedFromProject: [...new Set(droppedFromProject)],
  };
}

/** Load both scopes' values from disk and resolve against a schema. */
export function getResolvedPluginOptions(name, schema, { cwd } = {}) {
  return resolvePluginOptions(schema, {
    userValues: loadPluginOptionValues(name, "user", { cwd }),
    projectValues: loadPluginOptionValues(name, "project", { cwd }),
  });
}

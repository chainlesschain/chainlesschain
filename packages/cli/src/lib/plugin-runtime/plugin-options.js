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
import {
  createSecretStore,
  isSecretRef,
  secretRef,
} from "../secret-store.js";

export const _deps = {
  existsSync: fs.existsSync,
  readFileSync: fs.readFileSync,
  writeFileSync: fs.writeFileSync,
  mkdirSync: fs.mkdirSync,
  secretStore: () => createSecretStore(),
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
export function loadPluginOptionValues(name, scope, { cwd, schema, secretStore } = {}) {
  const p =
    scope === "project" ? _deps.projectStorePath(cwd) : _deps.userStorePath();
  const store = readJsonObject(p);
  const v = store[name];
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out = { ...v };
  const normalized = schema || {};
  for (const [key, desc] of Object.entries(normalized)) {
    if (!desc?.sensitive || !isSecretRef(out[key])) continue;
    try {
      const value = (secretStore || _deps.secretStore)().get(out[key].__cc_secret_ref);
      if (value != null) out[key] = value;
      else delete out[key];
    } catch {
      // Missing/unavailable secret backends fail closed: do not expose a
      // plaintext fallback and let validation keep the option at its default.
      delete out[key];
    }
  }
  return out;
}

/** Persist a plugin's option VALUES at a scope (replaces the plugin's entry). */
export function setPluginOptionValues(
  name,
  values,
  scope,
  { cwd, schema, secretStore } = {},
) {
  const p =
    scope === "project" ? _deps.projectStorePath(cwd) : _deps.userStorePath();
  const store = readJsonObject(p);
  const input = values && typeof values === "object" ? values : {};
  const persisted = { ...input };
  const normalized = schema || {};
  let secrets = null;
  const getSecrets = () => {
    if (!secrets) secrets = (secretStore || _deps.secretStore)();
    return secrets;
  };
  const rejectedSensitive = [];
  for (const [key, desc] of Object.entries(normalized)) {
    if (!desc?.sensitive || !Object.prototype.hasOwnProperty.call(input, key)) continue;
    // Project files are shareable and must never receive a sensitive value.
    if (scope === "project") {
      delete persisted[key];
      rejectedSensitive.push(key);
      continue;
    }
    if (input[key] == null || input[key] === "") {
      delete persisted[key];
      try { getSecrets().delete(`${name}/${key}`); } catch {}
      continue;
    }
    getSecrets().set(`${name}/${key}`, input[key]);
    persisted[key] = secretRef(`${name}/${key}`);
  }
  if (rejectedSensitive.length > 0) {
    persisted.__cc_rejected_sensitive = [...new Set(rejectedSensitive)].sort();
  } else if (Object.prototype.hasOwnProperty.call(persisted, "__cc_rejected_sensitive")) {
    delete persisted.__cc_rejected_sensitive;
  }
  store[name] = persisted;
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
  const projectInput = { ...(projectValues || {}) };
  const rejectedSensitive = Array.isArray(projectInput.__cc_rejected_sensitive)
    ? projectInput.__cc_rejected_sensitive
    : [];
  delete projectInput.__cc_rejected_sensitive;
  for (const key of rejectedSensitive) {
    droppedFromProject.push(key);
    warnings.push(
      `project: option "${key}" is sensitive and cannot be set from project config — use user scope / OS keychain`,
    );
  }

  // Project layer first (lower precedence). validateOptions errors on sensitive/
  // user-only keys at project scope — those are the drops we surface + refuse.
  const proj = acceptedKeys(s, projectInput, "project");
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
    userValues: loadPluginOptionValues(name, "user", { cwd, schema }),
    projectValues: loadPluginOptionValues(name, "project", { cwd, schema }),
  });
}

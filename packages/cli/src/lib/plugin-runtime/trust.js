/**
 * Plugin trust gating (Phase 3.3f) — decide whether a plugin's CODE-BEARING
 * components (hooks that run shell, LSP servers that spawn binaries) are allowed
 * to execute.
 *
 * Threat model: `cc plugin add owner/repo` and, worse, a cloned repo that ships
 * a project-scope plugin under `.chainlesschain/plugins/`, could run arbitrary
 * commands the moment the agent starts. So:
 *
 *   - user / local scope  → TRUSTED. The developer installed it on their own
 *     machine (same consent model as an npm dependency's lifecycle scripts).
 *   - project scope       → UNTRUSTED until the user explicitly trusts it, since
 *     it can arrive with a git clone. Trust is pinned to the exact version, so a
 *     later version bump re-requires consent.
 *
 * Trust is recorded in the USER data dir (never in the repo), keyed by
 * `<scope>:<name>` → { version, trustedAt }.
 *
 * Only code execution is gated here. Declarative components (skills are prompts,
 * mcp/settings are config) load regardless; this is specifically about not
 * running untrusted SHELL/binaries behind the user's back.
 */

import fs from "fs";
import path from "path";
import { getElectronUserDataDir } from "../paths.js";

export const _deps = {
  existsSync: fs.existsSync,
  readFileSync: fs.readFileSync,
  writeFileSync: fs.writeFileSync,
  mkdirSync: fs.mkdirSync,
  now: () => new Date().toISOString(),
  // Path of the trust store; injectable so unit tests never touch the real
  // user-data dir.
  storePath: () => path.join(getElectronUserDataDir(), "plugin-trust.json"),
};

const AUTO_TRUSTED_SCOPES = new Set(["user", "local"]);

export function loadTrustStore() {
  try {
    const p = _deps.storePath();
    if (!_deps.existsSync(p)) return {};
    const data = JSON.parse(_deps.readFileSync(p, "utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function saveTrustStore(store) {
  const p = _deps.storePath();
  _deps.mkdirSync(path.dirname(p), { recursive: true });
  _deps.writeFileSync(p, JSON.stringify(store, null, 2), "utf8");
}

function trustKey(scope, name) {
  return `${scope}:${name}`;
}

/**
 * May this plugin's code-bearing components run?
 * @param {{ scope, name, version }} plugin
 */
export function isPluginTrusted(plugin) {
  if (!plugin || !plugin.name) return false;
  if (AUTO_TRUSTED_SCOPES.has(plugin.scope)) return true;
  const entry = loadTrustStore()[trustKey(plugin.scope, plugin.name)];
  return Boolean(entry && entry.version === plugin.version);
}

/** Trust a plugin (records the exact version). */
export function trustPlugin(name, { scope = "project", version } = {}) {
  if (!version) throw new Error("trustPlugin requires a version");
  const store = loadTrustStore();
  store[trustKey(scope, name)] = { version, trustedAt: _deps.now() };
  saveTrustStore(store);
  return { name, scope, version };
}

/** Revoke trust for a plugin at a scope. */
export function untrustPlugin(name, { scope = "project" } = {}) {
  const store = loadTrustStore();
  const key = trustKey(scope, name);
  const existed = Object.prototype.hasOwnProperty.call(store, key);
  delete store[key];
  saveTrustStore(store);
  return { name, scope, removed: existed };
}

/** All trust entries (for `cc plugin trust --list`). */
export function listTrust() {
  return Object.entries(loadTrustStore()).map(([key, v]) => {
    const idx = key.indexOf(":");
    return {
      scope: key.slice(0, idx),
      name: key.slice(idx + 1),
      version: v?.version || null,
      trustedAt: v?.trustedAt || null,
    };
  });
}

/**
 * Split discovered plugins into those whose code may run and those gated out.
 * @returns {{ trusted: any[], skipped: any[] }}
 */
export function partitionByTrust(plugins) {
  const trusted = [];
  const skipped = [];
  for (const p of plugins || []) {
    (isPluginTrusted(p) ? trusted : skipped).push(p);
  }
  return { trusted, skipped };
}

// One-time stderr notice so a user isn't mystified when a project plugin's
// hooks/servers silently don't run. Guarded so it prints at most once per
// (component-kind) per process.
const _warned = new Set();
export function warnUntrustedOnce(names, kind) {
  if (!names || names.length === 0) return;
  if (_warned.has(kind)) return;
  _warned.add(kind);
  const list = [...new Set(names)].join(", ");
  try {
    process.stderr.write(
      `[plugins] skipped ${kind} from untrusted project plugin(s): ${list}\n` +
        `          run \`cc plugin trust <name>\` to enable them.\n`,
    );
  } catch {
    /* stderr notice is best-effort */
  }
}

/** Test hook: reset the one-time warning guard. */
export function _resetTrustWarnings() {
  _warned.clear();
}

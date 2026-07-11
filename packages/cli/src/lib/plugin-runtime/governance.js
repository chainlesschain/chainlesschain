/**
 * Plugin governance (gap-2026-07-11 P2#13): dependency version constraints and
 * "is this plugin actually in use" classification.
 *
 * Two failure modes this addresses:
 *   1. A plugin that needs another plugin (or a minimum host version) installs
 *      fine and then misbehaves at runtime because the dependency is absent or
 *      too old. `checkPluginDependencies` validates a manifest `dependencies`
 *      map (name → semver range) against what's installed, before load.
 *   2. An "unused plugin" reaper that only counts tool invocations wrongly
 *      flags a plugin whose entire value is passive — an LSP server, an MCP
 *      server, hooks, or monitors — because those never show up as an explicit
 *      tool call. `isPluginInUse` treats passive contributions as usage.
 *
 * Pure functions only; semver is the sole dependency.
 */

import semver from "semver";

/**
 * Passive component kinds — a plugin contributing any of these is "in use"
 * even with zero explicit tool/skill invocations, because they work in the
 * background (a language server, MCP tools surfaced on demand, lifecycle hooks,
 * background monitors).
 */
export const PASSIVE_COMPONENT_KINDS = Object.freeze([
  "lsp",
  "mcp",
  "hooks",
  "monitors",
]);

/**
 * Parse a manifest's `dependencies` field into a normalized map. Accepts:
 *   { "other-plugin": "^1.2.0", "host": ">=0.162.0" }
 * A reserved key `host` (or `cc`) constrains the CLI version itself. Returns
 * `{ deps, hostRange, errors }`; bad ranges are collected, not thrown. Pure.
 */
export function parsePluginDependencies(manifest) {
  const errors = [];
  const deps = {};
  let hostRange = null;
  const raw = manifest && manifest.dependencies;
  if (raw == null) return { deps, hostRange, errors };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    errors.push("dependencies must be an object of name → semver range");
    return { deps, hostRange, errors };
  }
  for (const [name, range] of Object.entries(raw)) {
    if (typeof range !== "string" || range.trim() === "") {
      errors.push(`dependency "${name}": range must be a non-empty string`);
      continue;
    }
    if (!semver.validRange(range)) {
      errors.push(`dependency "${name}": invalid semver range "${range}"`);
      continue;
    }
    if (name === "host" || name === "cc") {
      hostRange = range;
    } else {
      deps[name] = range;
    }
  }
  return { deps, hostRange, errors };
}

/**
 * Check a plugin's declared dependencies against installed plugins + the host
 * version. `installed` is a map of pluginName → version string. Returns
 * `{ ok, missing, mismatched, hostMismatch }`. Pure.
 *
 * @param {object} manifest         the depending plugin's manifest
 * @param {object} opts             { installed, hostVersion }
 */
export function checkPluginDependencies(
  manifest,
  { installed = {}, hostVersion = null } = {},
) {
  const { deps, hostRange } = parsePluginDependencies(manifest);
  const missing = [];
  const mismatched = [];
  for (const [name, range] of Object.entries(deps)) {
    const have = installed[name];
    if (have == null) {
      missing.push({ name, range });
      continue;
    }
    const coerced = semver.valid(have) || semver.coerce(have)?.version;
    if (
      !coerced ||
      !semver.satisfies(coerced, range, { includePrerelease: true })
    ) {
      mismatched.push({ name, range, have });
    }
  }
  let hostMismatch = null;
  if (hostRange && hostVersion) {
    const hv = semver.valid(hostVersion) || semver.coerce(hostVersion)?.version;
    if (!hv || !semver.satisfies(hv, hostRange, { includePrerelease: true })) {
      hostMismatch = { range: hostRange, have: hostVersion };
    }
  }
  return {
    ok: missing.length === 0 && mismatched.length === 0 && !hostMismatch,
    missing,
    mismatched,
    hostMismatch,
  };
}

/** Human-readable one-liners for a dependency check result. Pure. */
export function formatDependencyIssues(name, result) {
  const lines = [];
  for (const m of result.missing) {
    lines.push(`${name}: missing dependency ${m.name}@${m.range}`);
  }
  for (const m of result.mismatched) {
    lines.push(
      `${name}: dependency ${m.name}@${m.range} not satisfied by installed ${m.have}`,
    );
  }
  if (result.hostMismatch) {
    lines.push(
      `${name}: requires cc ${result.hostMismatch.range}, running ${result.hostMismatch.have}`,
    );
  }
  return lines;
}

/**
 * Whether a plugin should be considered "in use". A plugin is in use when it
 * contributes any passive component (LSP/MCP/hooks/monitors) OR when one of its
 * named skills/agents/tools appears in `invokedNames`. Pure.
 *
 * @param {object} plugin           parsed manifest with `.components` + `.name`
 * @param {object} opts             { invokedNames?: Set|Array }
 * @returns {{ inUse, reason }}
 */
export function isPluginInUse(plugin, { invokedNames = [] } = {}) {
  const components = (plugin && plugin.components) || {};
  for (const kind of PASSIVE_COMPONENT_KINDS) {
    if (hasComponent(components[kind])) {
      return { inUse: true, reason: `passive ${kind}` };
    }
  }
  const invoked =
    invokedNames instanceof Set ? invokedNames : new Set(invokedNames || []);
  const contributed = [
    ...componentNames(components.skills),
    ...componentNames(components.agents),
  ];
  for (const n of contributed) {
    if (invoked.has(n)) return { inUse: true, reason: `invoked ${n}` };
  }
  return { inUse: false, reason: "no passive component and never invoked" };
}

function hasComponent(c) {
  if (!c) return false;
  if (Array.isArray(c)) return c.length > 0;
  if (typeof c === "object") {
    if (typeof c.count === "number") return c.count > 0;
    if (c.file) return true;
    if (c.inline) return true;
  }
  return false;
}

function componentNames(c) {
  if (!Array.isArray(c)) return [];
  return c
    .map((e) => (typeof e === "string" ? e : e && (e.name || e.id)))
    .filter(Boolean);
}

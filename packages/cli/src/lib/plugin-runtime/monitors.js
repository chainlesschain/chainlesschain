/**
 * Collect installed plugins' background-monitor declarations (Phase 3.3i /
 * Phase 6 down payment — plugin Monitor component reaches a real supervisor).
 *
 * A plugin ships monitors in `monitors/monitors.json`:
 *   { "monitors": [
 *       { "name": "tests", "command": "npm", "args": ["test"],
 *         "mode": "interval", "intervalMs": 60000 },
 *       { "name": "logtail", "command": "tail", "args": ["-f","app.log"],
 *         "mode": "longRunning" }
 *   ] }
 * Each monitor is a background process the supervisor spawns to watch logs /
 * files / external state; its output can be injected into the next agent turn.
 *
 * SECURITY: a monitor spawns a command, so — exactly like hooks/LSP/MCP — only
 * TRUSTED plugins contribute (user/local scope auto-trusted; project scope must
 * be `cc plugin trust`-ed at its exact version). An untrusted cloned-repo plugin
 * can NOT get a background process launched.
 */

import fs from "fs";
import { discoverPlugins } from "./scopes.js";
import { partitionByTrust, warnUntrustedOnce } from "./trust.js";
import { componentCapabilityDenial } from "./capabilities.js";

export const _deps = { readFileSync: fs.readFileSync };

const VALID_MODES = new Set(["interval", "longRunning"]);

// One-time stderr notice when a plugin's monitors are refused at the COMPONENT
// level because the plugin opted into the capability model but did not declare
// the `monitor` capability. Distinct from the trust gate: these plugins ARE
// trusted, but their monitor component is denied.
const _capabilityDenied = new Set();
function warnMonitorCapabilityDeniedOnce(entries) {
  if (!entries || entries.length === 0) return;
  if (_capabilityDenied.has("monitor-capability")) return;
  _capabilityDenied.add("monitor-capability");
  const list = entries.map((e) => `${e.name} (${e.reason})`).join("; ");
  try {
    process.stderr.write(
      `[plugins] refused monitor(s) from plugin(s) that declared a permissions ` +
        `block but did not declare the 'monitor' capability: ${list}\n` +
        `          add 'monitor' to the plugin's permissions block to enable them.\n`,
    );
  } catch {
    /* stderr notice is best-effort */
  }
}

/** Test hook: reset the one-time capability-denied warning guard. */
export function _resetMonitorWarnings() {
  _capabilityDenied.clear();
}

/** Normalize one raw monitor entry into a validated descriptor, or null. */
function normalizeMonitor(plugin, raw) {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.name !== "string" || raw.name === "") return null;
  if (typeof raw.command !== "string" || raw.command === "") return null;
  const mode = VALID_MODES.has(raw.mode) ? raw.mode : "interval";
  const args = Array.isArray(raw.args) ? raw.args.map((a) => String(a)) : [];
  const intervalMs =
    Number.isFinite(raw.intervalMs) && raw.intervalMs > 0
      ? Math.floor(raw.intervalMs)
      : null;
  const env =
    raw.env && typeof raw.env === "object" && !Array.isArray(raw.env)
      ? raw.env
      : null;
  return {
    plugin: plugin.name,
    scope: plugin.scope,
    version: plugin.version,
    // Namespaced so two plugins' "tests" monitors never collide.
    id: `${plugin.name}:${raw.name}`,
    name: raw.name,
    command: raw.command,
    args,
    mode,
    intervalMs,
    env,
    cwd: plugin.root,
  };
}

/**
 * Flatten every trusted, installed plugin's monitor declarations.
 * @param {object} [opts] { cwd, scopes }
 * @returns {Array<object>} validated monitor descriptors
 */
export function collectPluginMonitors(opts = {}) {
  let plugins = [];
  try {
    plugins = discoverPlugins({ cwd: opts.cwd, scopes: opts.scopes });
  } catch {
    return [];
  }
  // A monitor spawns a command — gate it behind trust.
  const { trusted, skipped } = partitionByTrust(plugins);
  warnUntrustedOnce(
    skipped.filter((p) => p.manifest?.components?.monitors).map((p) => p.name),
    "monitors",
  );
  const out = [];
  const denied = [];
  for (const p of trusted) {
    if (!p.manifest || p.manifest.ok !== true) continue;
    const m = p.manifest.components?.monitors;
    if (!m) continue;
    // Component-level capability gate: a plugin that declared a permissions
    // block but did not declare the `monitor` capability gets its monitors
    // refused here (mirrors the MCP collector's denial).
    const denial = componentCapabilityDenial(p.manifest, ["monitor"]);
    if (denial) {
      denied.push({ name: p.name, reason: denial.reason });
      continue;
    }
    let parsed;
    if (m.absPath) {
      try {
        parsed = JSON.parse(_deps.readFileSync(m.absPath, "utf8"));
      } catch {
        continue;
      }
    } else if (m.inline) {
      // Monitors declared inline in plugin.json — the normalized component keeps
      // only counts, so re-read the raw manifest for the actual entries (same
      // approach as the MCP collector). Without this, inline monitors never spawn.
      try {
        const raw = JSON.parse(
          _deps.readFileSync(p.manifest.manifestPath, "utf8"),
        );
        parsed = raw && typeof raw === "object" ? raw.monitors : null;
      } catch {
        continue;
      }
    } else {
      continue;
    }
    const list = Array.isArray(parsed?.monitors)
      ? parsed.monitors
      : Array.isArray(parsed)
        ? parsed
        : [];
    for (const raw of list) {
      const desc = normalizeMonitor(p, raw);
      if (desc) out.push(desc);
    }
  }
  warnMonitorCapabilityDeniedOnce(denied);
  return out;
}

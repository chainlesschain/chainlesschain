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

export const _deps = { readFileSync: fs.readFileSync };

const VALID_MODES = new Set(["interval", "longRunning"]);

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
  for (const p of trusted) {
    if (!p.manifest || p.manifest.ok !== true) continue;
    const m = p.manifest.components?.monitors;
    if (!m || !m.absPath) continue;
    let parsed;
    try {
      parsed = JSON.parse(_deps.readFileSync(m.absPath, "utf8"));
    } catch {
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
  return out;
}

/**
 * Plugin `bin` component — put a trusted plugin's executables on PATH for the
 * session (Phase 3.3n). A plugin ships helper executables under `bin/`; making
 * them resolvable means the agent's `run_shell` (and monitors/hooks, which
 * inherit the process env) can invoke `some-plugin-tool` by name.
 *
 * Wiring: prepend the trusted plugins' bin dirs to `process.env.PATH` at session
 * start and RESTORE the original PATH at session end — session-scoped, so no
 * plugin executable stays resolvable after the session. Every child process
 * inherits process.env, so this one mutation covers run_shell (foreground +
 * background), the monitor supervisor, and hook commands uniformly.
 *
 * SECURITY: an executable on PATH runs code, so — like hooks/LSP/MCP/monitors —
 * only TRUSTED plugins contribute (user/local auto-trusted; project needs
 * `cc plugin trust`). An untrusted cloned-repo plugin can NOT shadow a system
 * command or get its binary invoked.
 */

import path from "path";
import fs from "fs";
import { discoverPlugins } from "./scopes.js";
import { partitionByTrust, warnUntrustedOnce } from "./trust.js";
import { componentCapabilityDenial } from "./capabilities.js";

// One-time stderr notice when a plugin's bin dir is refused at the COMPONENT
// level because the plugin opted into the capability model but did not declare
// the `process` capability its executables need. Distinct from the trust gate:
// these plugins ARE trusted, but their bin component is denied.
const _capabilityDenied = new Set();
function warnBinCapabilityDeniedOnce(entries) {
  if (!entries || entries.length === 0) return;
  if (_capabilityDenied.has("bin-capability")) return;
  _capabilityDenied.add("bin-capability");
  const list = entries.map((e) => `${e.name} (${e.reason})`).join("; ");
  try {
    process.stderr.write(
      `[plugins] refused bin dir(s) from plugin(s) that declared a permissions ` +
        `block but did not declare the 'process' capability: ${list}\n` +
        `          add 'process' to the plugin's permissions block to enable them.\n`,
    );
  } catch {
    /* stderr notice is best-effort */
  }
}

/** Test hook: reset the one-time capability-denied warning guard. */
export function _resetBinWarnings() {
  _capabilityDenied.clear();
}

/**
 * Collect trusted, installed plugins' `bin/` directories.
 * @param {object} [opts] { cwd, scopes }
 * @returns {Array<{plugin, scope, version, dir}>}
 */
export function collectPluginBinDirs(opts = {}) {
  let plugins = [];
  try {
    plugins = discoverPlugins({ cwd: opts.cwd, scopes: opts.scopes });
  } catch {
    return [];
  }
  const { trusted, skipped } = partitionByTrust(plugins);
  warnUntrustedOnce(
    skipped
      .filter((p) => p.manifest?.components?.bin?.length)
      .map((p) => p.name),
    "bin",
  );
  const out = [];
  const denied = [];
  for (const p of trusted) {
    if (!p.manifest || p.manifest.ok !== true) continue;
    const bins = p.manifest.components?.bin;
    if (!Array.isArray(bins) || bins.length === 0) continue;
    // Component-level capability gate: a plugin that declared a permissions
    // block but did not declare the `process` capability its executables need
    // gets its bin dir refused here (mirrors the MCP collector's denial).
    const denial = componentCapabilityDenial(p.manifest, ["process"]);
    if (denial) {
      denied.push({ name: p.name, reason: denial.reason });
      continue;
    }
    // Every bin entry's absPath is a file inside the plugin's bin dir; collect
    // the unique parent directories (usually just `<root>/bin`).
    const dirs = new Set(bins.map((b) => path.dirname(b.absPath)));
    for (const dir of dirs) {
      out.push({
        plugin: p.name,
        scope: p.scope,
        version: p.version,
        dir,
      });
    }
  }
  warnBinCapabilityDeniedOnce(denied);
  return out;
}

/**
 * Prepend trusted plugins' bin dirs to `env.PATH` (defaults to process.env).
 * Returns a `restore()` that puts PATH back, plus the dirs added. Idempotent per
 * call — a dir already on PATH is not added twice.
 *
 * @param {object} [opts] { cwd, scopes, env }
 * @returns {{ added: string[], restore: () => void }}
 */
export function applyPluginBinPath(opts = {}) {
  const env = opts.env || process.env;
  const dirs = collectPluginBinDirs({ cwd: opts.cwd, scopes: opts.scopes }).map(
    (b) => b.dir,
  );
  const prevPath = env.PATH;
  if (dirs.length === 0) {
    return { added: [], restore: () => {} };
  }
  const existing = new Set(
    String(prevPath || "")
      .split(path.delimiter)
      .filter(Boolean),
  );
  const added = dirs.filter((d) => !existing.has(d));
  if (added.length === 0) {
    return { added: [], restore: () => {} };
  }
  env.PATH = [...added, prevPath].filter(Boolean).join(path.delimiter);
  let restored = false;
  return {
    added,
    restore: () => {
      if (restored) return;
      restored = true;
      // Restore only if nothing else re-touched PATH out from under us; either
      // way, put the recorded previous value back (session-scoped semantics).
      env.PATH = prevPath;
    },
  };
}

/**
 * Resolve the first executable token of a shell command to a trusted plugin
 * bin. This is intentionally conservative: only an existing file directly
 * under a collected plugin bin directory is attributed.
 *
 * @param {string} command
 * @param {object} [opts] { cwd, scopes }
 * @returns {{pluginId:string,pluginVersion:string,pluginSource:string,scope:string,binPath:string}|null}
 */
export function resolvePluginBinCommand(command, opts = {}) {
  if (typeof command !== "string") return null;
  const match = command.match(/^\s*(?:"([^"]+)"|'([^']+)'|([^\s]+))/);
  const token = match?.[1] || match?.[2] || match?.[3] || "";
  if (!token) return null;
  const tokenBase = path.basename(token).toLowerCase();
  const candidates = new Set([tokenBase]);
  if (process.platform === "win32" && !path.extname(tokenBase)) {
    candidates.add(`${tokenBase}.exe`);
    candidates.add(`${tokenBase}.cmd`);
    candidates.add(`${tokenBase}.bat`);
  }
  for (const entry of collectPluginBinDirs(opts)) {
    for (const candidateName of candidates) {
      const binPath = path.join(entry.dir, candidateName);
      if (!fs.existsSync(binPath)) continue;
      if (path.isAbsolute(token)) {
        try {
          if (path.resolve(token) !== path.resolve(binPath)) continue;
        } catch {
          continue;
        }
      }
      return {
        pluginId: entry.plugin,
        pluginVersion: entry.version || null,
        pluginSource: entry.dir,
        scope: entry.scope || null,
        binPath,
      };
    }
  }
  return null;
}

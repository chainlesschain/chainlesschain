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
import { discoverPlugins } from "./scopes.js";
import { partitionByTrust, warnUntrustedOnce } from "./trust.js";

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
  for (const p of trusted) {
    if (!p.manifest || p.manifest.ok !== true) continue;
    const bins = p.manifest.components?.bin;
    if (!Array.isArray(bins) || bins.length === 0) continue;
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

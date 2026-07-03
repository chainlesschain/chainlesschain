/**
 * Apply installed plugins' `.lsp.json` language-server contributions to the LSP
 * registry (Phase 3.2 — first plugin component actually wired to the agent).
 *
 * A plugin declares extra language servers via `.lsp.json`; this bridges those
 * declarations into `lsp-server-registry.registerLanguageServer`, so the Phase 2
 * `code_intelligence` agent tool and `cc code-intel` command transparently gain
 * definition/references/diagnostics for the plugin's language — no core change
 * per new language.
 *
 * Idempotent + memoized per project root: the first LSP query (agent or CLI)
 * triggers a one-time scan of the user/project/local plugin scopes.
 */

import path from "path";
import { discoverPlugins } from "./scopes.js";
import { registerLanguageServer } from "../lsp/lsp-server-registry.js";
import { partitionByTrust, warnUntrustedOnce } from "./trust.js";

const _loadedRoots = new Set();

/**
 * Register every installed plugin's LSP servers for `cwd` (once per root).
 * Never throws — a broken plugin manifest must not break code navigation.
 *
 * @param {object} [opts] { cwd, scopes, force }
 * @returns {{ registered: Array<{plugin, languageId, id}> }}
 */
export function ensurePluginLspServers(opts = {}) {
  const cwd = path.resolve(opts.cwd || process.cwd());
  if (_loadedRoots.has(cwd) && !opts.force) return { registered: [] };
  _loadedRoots.add(cwd);

  const registered = [];
  let plugins = [];
  try {
    plugins = discoverPlugins({ cwd, scopes: opts.scopes });
  } catch {
    return { registered };
  }

  // An LSP server spawns a binary — gate it behind trust. Untrusted project
  // plugins (e.g. from a cloned repo) don't get to launch processes silently.
  const { trusted, skipped } = partitionByTrust(plugins);
  warnUntrustedOnce(
    skipped
      .filter((p) => (p.manifest?.components?.lsp || []).length > 0)
      .map((p) => p.name),
    "language servers",
  );

  for (const p of trusted) {
    const servers = p.manifest?.components?.lsp || [];
    for (const s of servers) {
      try {
        registerLanguageServer({
          languageId: s.languageId,
          command: s.command,
          args: s.args,
          extensions: s.extensions,
          id: s.id,
        });
        registered.push({ plugin: p.name, languageId: s.languageId, id: s.id });
      } catch {
        // skip a malformed server entry; other plugins still load
      }
    }
  }
  return { registered };
}

/** Test hook: forget which roots have been scanned so a re-scan can run. */
export function _resetPluginLspLoadState() {
  _loadedRoots.clear();
}

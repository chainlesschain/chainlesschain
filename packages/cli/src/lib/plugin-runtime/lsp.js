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
import { componentCapabilityDenial } from "./capabilities.js";

const _loadedRoots = new Set();

// One-time stderr notice when a plugin's LSP servers are refused at the
// COMPONENT level because the plugin opted into the capability model but did not
// declare the `process` capability the servers need. Distinct from the trust
// gate: these plugins ARE trusted, but their LSP component is denied.
const _capabilityDenied = new Set();
function warnLspCapabilityDeniedOnce(entries) {
  if (!entries || entries.length === 0) return;
  if (_capabilityDenied.has("lsp-capability")) return;
  _capabilityDenied.add("lsp-capability");
  const list = entries.map((e) => `${e.name} (${e.reason})`).join("; ");
  try {
    process.stderr.write(
      `[plugins] refused language server(s) from plugin(s) that declared a ` +
        `permissions block but did not declare the 'process' capability: ${list}\n` +
        `          add 'process' to the plugin's permissions block to enable them.\n`,
    );
  } catch {
    /* stderr notice is best-effort */
  }
}

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

  const denied = [];
  for (const p of trusted) {
    const servers = p.manifest?.components?.lsp || [];
    if (servers.length === 0) continue;
    // Component-level capability gate: a plugin that declared a permissions
    // block but did not declare the `process` capability its language servers
    // need gets them refused here (mirrors the MCP collector's denial).
    const denial = componentCapabilityDenial(p.manifest, ["process"]);
    if (denial) {
      denied.push({ name: p.name, reason: denial.reason });
      continue;
    }
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
  warnLspCapabilityDeniedOnce(denied);
  return { registered };
}

/** Test hook: forget which roots have been scanned so a re-scan can run. */
export function _resetPluginLspLoadState() {
  _loadedRoots.clear();
}

/** Test hook: reset the one-time capability-denied warning guard. */
export function _resetLspWarnings() {
  _capabilityDenied.clear();
}

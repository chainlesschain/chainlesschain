/**
 * Hot-reload the plugin runtime (Phase 3.3m — `/reload-plugins`).
 *
 * Installing / trusting / upgrading a plugin mid-session normally needs a
 * restart because several collectors memoize their work (LSP registration is
 * registered once per root; the managed-policy load + trust/untrusted warnings
 * are cached). This resets that memoized state and re-runs the declarative
 * collectors so a freshly-installed/trusted plugin's components appear without
 * restarting.
 *
 * Returns a summary of what is now discovered (per-component counts) so the REPL
 * can report it. The caller (agent-repl) additionally re-merges hooks and
 * restarts the monitor supervisor with the fresh set — those hold live session
 * state (the effective hook map, running child processes) the pure collectors
 * can't touch. Already-connected MCP servers stay connected for this session
 * (reconnecting mid-turn is out of scope); newly-added MCP servers are picked up
 * on the next session.
 */

import { discoverPlugins } from "./scopes.js";
import { ensurePluginLspServers, _resetPluginLspLoadState } from "./lsp.js";
import { _resetPluginServers } from "../lsp/lsp-server-registry.js";
import { _resetPolicyCache, _resetPolicyWarnings } from "./policy.js";
import { _resetTrustWarnings } from "./trust.js";
import { discoverPluginSkillLayers } from "./skills.js";
import { discoverPluginAgentLayers } from "./agents.js";
import { collectPluginHooks } from "./hooks.js";
import { collectPluginMcpServers } from "./mcp.js";
import { collectPluginMonitors } from "./monitors.js";

/**
 * Reset memoized plugin-runtime state and re-scan. Pure w.r.t. session state —
 * the REPL layer applies the hooks/monitors side of the reload.
 *
 * @param {object} [opts] { cwd, scopes }
 * @returns {{ plugins, lspRegistered, skills, agents, hooks, mcp, monitors }}
 */
export function reloadPluginRuntime(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const scopes = opts.scopes;

  // 1) Clear caches so the next discovery re-reads managed policy + re-evaluates
  //    trust, and LSP servers can be cleanly re-registered.
  _resetPolicyCache();
  _resetPolicyWarnings();
  _resetTrustWarnings();
  _resetPluginServers();
  _resetPluginLspLoadState();

  // 2) Re-register plugin LSP servers from scratch (force past the per-root memo).
  let lspRegistered = 0;
  try {
    const res = ensurePluginLspServers({ cwd, scopes, force: true });
    lspRegistered = res?.registered?.length || 0;
  } catch {
    lspRegistered = 0;
  }

  // 3) Re-scan the declarative collectors for a fresh summary.
  const count = (fn, pick) => {
    try {
      const r = fn({ cwd, scopes });
      return pick(r);
    } catch {
      return 0;
    }
  };
  const plugins = count(discoverPlugins, (r) => r.length);
  const skills = count(discoverPluginSkillLayers, (r) => r.length);
  const agents = count(discoverPluginAgentLayers, (r) => r.length);
  const hooks = count(collectPluginHooks, (r) => Object.keys(r).length);
  const mcp = count(
    collectPluginMcpServers,
    (r) => Object.keys(r.servers).length,
  );
  const monitors = count(collectPluginMonitors, (r) => r.length);

  return { plugins, lspRegistered, skills, agents, hooks, mcp, monitors };
}

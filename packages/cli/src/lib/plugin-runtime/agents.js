/**
 * Discover installed plugins' agent-definition directories so `discoverAgents`
 * can expose them as named subagents (Phase 3.3h — plugin Agent component
 * reaches the agent chain).
 *
 * A plugin ships subagents under `<pluginRoot>/agents/<name>.md` (the same
 * markdown-with-frontmatter shape as `.claude/agents/*.md`), so each installed
 * plugin's `agents/` directory becomes an extra agent-scan layer. Only plugins
 * whose manifest fully validated (`manifest.ok`) contribute.
 *
 * NOT trust-gated: an agent definition is declarative (a system prompt + an
 * optional tool ALLOW-list + model — it can only narrow, never expand,
 * capability) and runs only when the user invokes it BY NAME (`cc agents run …`),
 * exactly like a skill. It is never auto-executed at startup (unlike a hook), so
 * it carries the same trust as a skill's SKILL.md, which is also not gated. The
 * code-bearing components (hooks/LSP/MCP) remain trust-gated.
 */

import fs from "fs";
import path from "path";
import { discoverPlugins } from "./scopes.js";

export const _deps = { existsSync: fs.existsSync };

/**
 * @param {object} [opts] { cwd, scopes }
 * @returns {Array<{ name, scope, version, dir }>} one entry per plugin that has
 *   an `agents/` directory; `dir` is that directory (a scan root for
 *   discoverAgents' walkMd).
 */
export function discoverPluginAgentLayers(opts = {}) {
  let plugins = [];
  try {
    plugins = discoverPlugins({ cwd: opts.cwd, scopes: opts.scopes });
  } catch {
    return [];
  }
  const out = [];
  for (const p of plugins) {
    if (!p.manifest || p.manifest.ok !== true) continue;
    const agentsDir = path.join(p.root, "agents");
    if (!_deps.existsSync(agentsDir)) continue;
    out.push({
      name: p.name,
      scope: p.scope,
      version: p.version,
      dir: agentsDir,
    });
  }
  return out;
}

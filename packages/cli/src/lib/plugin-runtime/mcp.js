/**
 * Collect installed plugins' `.mcp.json` servers so a plugin's MCP component
 * reaches the agent's tool surface (Phase 3.3g — plugin MCP → agent chain).
 *
 * A plugin ships MCP servers in the same shape as a project `.mcp.json`: a
 * top-level `mcpServers` (or `servers`) map of name → `{command,args,env,url,…}`.
 * Those are folded into the agent's combined MCP client alongside the user's
 * registered + project servers.
 *
 * SECURITY: an MCP stdio server spawns a command, so a plugin's `.mcp.json`
 * carries the same RCE weight as its hooks/LSP components. Only TRUSTED plugins
 * contribute (user/local scope auto-trusted; project scope must be
 * `cc plugin trust`-ed at its exact version) — an untrusted project plugin from
 * a cloned repo can NOT get a server spawned the moment the agent starts.
 */

import fs from "fs";
import { discoverPlugins } from "./scopes.js";
import { partitionByTrust, warnUntrustedOnce } from "./trust.js";
import { componentCapabilityDenial } from "./capabilities.js";

export const _deps = { readFileSync: fs.readFileSync };

// One-time stderr notice when a plugin's MCP server is refused at the COMPONENT
// level because the plugin opted into the capability model but did not declare
// the `mcp` capability its server needs. Distinct from the trust gate: these
// plugins ARE trusted, but their MCP component is denied. (Network is enforced
// separately at connection time by the egress/network policy, so a local stdio
// server is not denied for lacking a `network` declaration.)
const _capabilityDenied = new Set();
function warnMcpCapabilityDeniedOnce(entries) {
  if (!entries || entries.length === 0) return;
  if (_capabilityDenied.has("mcp-capability")) return;
  _capabilityDenied.add("mcp-capability");
  const list = entries.map((e) => `${e.name} (${e.reason})`).join("; ");
  try {
    process.stderr.write(
      `[plugins] refused MCP server(s) from plugin(s) that declared a permissions ` +
        `block but did not declare the 'mcp' capability their server needs: ${list}\n` +
        `          add 'mcp' to the plugin's permissions block to enable them.\n`,
    );
  } catch {
    /* stderr notice is best-effort */
  }
}

/** Test hook: reset the one-time capability-denied warning guard. */
export function _resetMcpWarnings() {
  _capabilityDenied.clear();
}

/** Accept `{ mcpServers: {...} }`, `{ servers: {...} }`, or a bare map. */
function normalizeServerMap(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const block = parsed.mcpServers || parsed.servers || parsed;
  if (!block || typeof block !== "object" || Array.isArray(block)) return {};
  return block;
}

/**
 * Merge every trusted, installed plugin's `.mcp.json` servers into one map,
 * keyed by server name. A later plugin (in discovery precedence) wins on a name
 * clash; callers merging this into their own servers keep their own on a clash.
 *
 * @param {object} [opts] { cwd, scopes }
 * @returns {{ servers: Record<string,object>, sources: string[] }}
 */
export function collectPluginMcpServers(opts = {}) {
  let plugins = [];
  try {
    plugins = discoverPlugins({ cwd: opts.cwd, scopes: opts.scopes });
  } catch {
    return { servers: {}, sources: [] };
  }
  // An MCP stdio server spawns a command — gate it behind trust so a cloned
  // repo's project plugin can't get a server launched the moment cc starts.
  const { trusted, skipped } = partitionByTrust(plugins);
  warnUntrustedOnce(
    skipped.filter((p) => p.manifest?.components?.mcp).map((p) => p.name),
    "mcp",
  );
  const servers = {};
  const sources = [];
  const denied = [];
  for (const p of trusted) {
    if (!p.manifest || p.manifest.ok !== true) continue;
    const m = p.manifest.components?.mcp;
    if (!m) continue;
    // Component-level capability gate: a plugin that declared a permissions
    // block but under-declared the `mcp` capability its server needs gets its
    // MCP component refused here (mirrors the hooks/monitors/bin/lsp denial).
    // Legacy plugins (no permissions block) are unrestricted and never denied.
    const denial = componentCapabilityDenial(p.manifest, ["mcp"]);
    if (denial) {
      denied.push({ name: p.name, reason: denial.reason });
      continue;
    }
    let parsed = null;
    if (m.absPath) {
      try {
        parsed = JSON.parse(_deps.readFileSync(m.absPath, "utf8"));
      } catch {
        continue;
      }
    } else if (m.inline) {
      // Inline MCP declared directly in the manifest — re-read the raw manifest
      // so we get the server bodies (the normalized component keeps only counts).
      try {
        parsed = JSON.parse(
          _deps.readFileSync(p.manifest.manifestPath, "utf8"),
        );
        parsed = parsed && typeof parsed === "object" ? parsed.mcp : null;
      } catch {
        continue;
      }
    }
    const map = normalizeServerMap(parsed);
    let added = 0;
    for (const [name, cfg] of Object.entries(map)) {
      if (!cfg || typeof cfg !== "object") continue;
      if (name in servers) continue; // first plugin wins on a clash
      servers[name] = {
        ...cfg,
        origin: "plugin:mcp",
        policy: "allow",
        pluginId: p.name,
        pluginVersion: p.version,
        pluginSource: m.absPath || p.manifest.manifestPath,
      };
      added++;
    }
    if (added > 0 && m.absPath) sources.push(m.absPath);
  }
  warnMcpCapabilityDeniedOnce(denied);
  return { servers, sources };
}

/**
 * Plugin / MCP manager (P1 #7 图形管理器) — pure logic for the manager
 * webview. Argv builders + tolerant parsers over the CLI's --json surface:
 *
 *   plugins:  cc plugin installed --json      (unified runtime, scope dirs)
 *             cc plugin trust|untrust <name>
 *             cc plugin uninstall <name> --scope <s>
 *             cc plugin add <source> [--registry <url>] --json
 *   mcp:      cc mcp servers --json           (policy-annotated)
 *             cc mcp remove <name> · cc mcp connect <name> --json
 *   skills:   cc skill list --json            (read-only listing)
 *
 * Deliberately scoped to the UNIFIED plugin runtime (`plugin installed/add/
 * trust/uninstall`) — the DB-backed `plugin list/install/enable/disable`
 * command family is the legacy bookkeeping store and is not surfaced here.
 */

function buildPluginInstalledArgs() {
  return ["plugin", "installed", "--json"];
}

function buildPluginTrustArgs(name, trusted) {
  return ["plugin", trusted ? "trust" : "untrust", String(name)];
}

function buildPluginUninstallArgs(name, scope = "user") {
  return ["plugin", "uninstall", String(name), "--scope", String(scope)];
}

function buildPluginAddArgs(source, { registry } = {}) {
  const args = ["plugin", "add", String(source)];
  if (registry) args.push("--registry", String(registry));
  args.push("--json");
  return args;
}

function buildMcpServersArgs() {
  return ["mcp", "servers", "--json"];
}

function buildMcpRemoveArgs(name) {
  return ["mcp", "remove", String(name)];
}

function buildMcpConnectArgs(name) {
  return ["mcp", "connect", String(name), "--json"];
}

function buildSkillListArgs() {
  return ["skill", "list", "--json"];
}

function parseArray(text) {
  try {
    const parsed = JSON.parse(String(text || "").trim());
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** `plugin installed --json` → [{name, version, scope, dir, ok}]; null = unreadable. */
function parsePluginInstalled(text) {
  const rows = parseArray(text);
  if (!rows) return null;
  return rows
    .filter((r) => r && typeof r.name === "string" && r.name)
    .map((r) => ({
      name: r.name,
      version: String(r.version || ""),
      scope: String(r.scope || "user"),
      dir: String(r.dir || ""),
      ok: r.ok === true,
    }));
}

/** `mcp servers --json` → policy-annotated rows; null = unreadable. */
function parseMcpServers(text) {
  const rows = parseArray(text);
  if (!rows) return null;
  return rows
    .filter((r) => r && typeof r.name === "string" && r.name)
    .map((r) => ({
      name: r.name,
      url: String(r.url || ""),
      command: String(r.command || ""),
      transport: String(r._transport || r.transport || ""),
      autoConnect: r.autoConnect === true || r.autoConnect === 1,
      allowed: r._allowed !== false,
      reason: String(r._reason || ""),
    }));
}

/** `skill list --json` → [{id, name, category, source, description}]; null = unreadable. */
function parseSkillList(text) {
  const rows = parseArray(text);
  if (!rows) return null;
  return rows
    .filter((r) => r && (r.id || r.name))
    .map((r) => ({
      id: String(r.id || r.name),
      name: String(r.name || r.id),
      category: String(r.category || ""),
      source: String(r.source || ""),
      description: String(r.description || ""),
    }));
}

module.exports = {
  buildMcpConnectArgs,
  buildMcpRemoveArgs,
  buildMcpServersArgs,
  buildPluginAddArgs,
  buildPluginInstalledArgs,
  buildPluginTrustArgs,
  buildPluginUninstallArgs,
  buildSkillListArgs,
  parseMcpServers,
  parsePluginInstalled,
  parseSkillList,
};

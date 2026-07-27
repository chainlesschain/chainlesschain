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

function buildPluginTrustArgs(name, trusted, scope) {
  const args = ["plugin", trusted ? "trust" : "untrust", String(name)];
  // The CLI defaults trust/untrust to --scope project, but the panel's Add
  // installs at user scope — without the row's scope, Trust errors ("not
  // installed at project scope") and Untrust silently no-ops (exit 0, trust
  // kept), i.e. the security control appears to succeed without revoking.
  if (scope) args.push("--scope", String(scope));
  return args;
}

function buildPluginUninstallArgs(name, scope = "user") {
  return ["plugin", "uninstall", String(name), "--scope", String(scope)];
}

function buildPluginUseArgs(name, version, scope = "user") {
  return [
    "plugin",
    "use",
    String(name),
    String(version),
    "--scope",
    String(scope),
  ];
}

function buildPluginLifecycleArgs(name, enabled, scope = "user") {
  return [
    "plugin",
    enabled ? "enable" : "disable",
    String(name),
    "--scope",
    String(scope),
    "--json",
  ];
}

function buildPluginUpgradeArgs(
  source,
  { scope = "user", registry, packageName } = {},
) {
  const target = registry ? packageName : source;
  const args = [
    "plugin",
    "upgrade",
    String(target || ""),
    "--scope",
    String(scope),
  ];
  if (registry) args.push("--registry", String(registry));
  args.push("--json");
  return args;
}

function buildPluginConsentArgs(name, action, scope = "user") {
  const args = ["plugin", "consent", String(name), "--scope", String(scope)];
  if (action === "grant") args.push("--grant");
  else if (action === "revoke") args.push("--revoke");
  if (action !== "revoke") args.push("--json");
  return args;
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
      versions: Array.isArray(r.versions)
        ? r.versions
            .filter(
              (version) =>
                typeof version === "string" &&
                version.length > 0 &&
                version.length <= 128,
            )
            .slice(0, 64)
        : r.version
          ? [String(r.version)]
          : [],
      scope: String(r.scope || "user"),
      dir: String(r.dir || ""),
      ok: r.ok === true,
      enabled: r.enabled !== false,
      source: parsePluginSource(r.source),
      integrity: parsePluginIntegrity(r.integrity),
      policy: parsePluginPolicy(r.policy),
    }));
}

function bounded(value, max = 4096) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function parsePluginSource(source) {
  if (!source || typeof source !== "object") return null;
  const type = ["local", "git", "registry"].includes(source.type)
    ? source.type
    : "";
  const value = bounded(source.source);
  if (!type || !value) return null;
  return {
    type,
    source: value,
    ref: bounded(source.ref, 256),
    registry: bounded(source.registry),
    resolvedSource: bounded(source.resolvedSource),
    package: bounded(source.package, 256),
    offline: source.offline === true,
  };
}

function parsePluginIntegrity(integrity) {
  const signature =
    integrity?.signature && typeof integrity.signature === "object"
      ? integrity.signature
      : {};
  const sbom =
    integrity?.sbom && typeof integrity.sbom === "object" ? integrity.sbom : {};
  return {
    signature: {
      present: signature.present === true,
      verified: signature.verified === true,
      reason: bounded(signature.reason, 512),
      manifestSha256: bounded(signature.manifestSha256, 128),
      publicKeySha256: bounded(signature.publicKeySha256, 128),
    },
    sbom: {
      present: sbom.present === true,
      digest: bounded(sbom.digest, 128),
      fileCount: Math.max(0, Math.min(100000, Number(sbom.fileCount) || 0)),
      totalBytes: Math.max(
        0,
        Math.min(Number.MAX_SAFE_INTEGER, Number(sbom.totalBytes) || 0),
      ),
    },
  };
}

function parsePluginPolicy(policy) {
  if (!policy || typeof policy !== "object") {
    return {
      managed: false,
      source: "",
      allowed: true,
      reason: "",
      requireSigned: false,
    };
  }
  return {
    managed: policy.managed === true,
    source: bounded(policy.source),
    allowed: policy.allowed !== false,
    reason: bounded(policy.reason, 1024),
    requireSigned: policy.requireSigned === true,
  };
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
  buildPluginConsentArgs,
  buildPluginInstalledArgs,
  buildPluginLifecycleArgs,
  buildPluginTrustArgs,
  buildPluginUninstallArgs,
  buildPluginUpgradeArgs,
  buildPluginUseArgs,
  buildSkillListArgs,
  parseMcpServers,
  parsePluginInstalled,
  parseSkillList,
};

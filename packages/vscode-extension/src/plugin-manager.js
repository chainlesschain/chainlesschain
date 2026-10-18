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

function connectionArgs(connection) {
  if (connection === undefined) return [];
  if (
    typeof connection !== "string" ||
    !connection ||
    connection.length > 4096 ||
    /[\u0000-\u001f]/u.test(connection)
  )
    throw new Error("Invalid goal connection file");
  return [`--connection=${connection}`];
}
function buildCliGoalCatalogArgs(after, connection) {
  if (
    after !== undefined &&
    (typeof after !== "string" || !/^[A-Za-z0-9_-]{1,1024}$/.test(after))
  )
    throw new Error("Invalid goal catalog cursor");
  return [
    "goal",
    "catalog",
    "--json",
    ...(after ? [`--after=${after}`] : []),
    ...connectionArgs(connection),
  ];
}

function parseCliGoalCatalog(text, expectedStore, connection) {
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > 32 * 1024)
    return null;
  try {
    const raw = JSON.parse(text);
    if (
      raw?.schema !== "chainlesschain.goal-catalog.v1" ||
      raw.snapshot !== true ||
      typeof raw.storeId !== "string" ||
      !(connection
        ? raw.source === "desktop-project" &&
          /^project-goals-[a-f0-9-]{36}$/.test(raw.storeId)
        : raw.source === undefined &&
          /^cli-goals-[a-f0-9]{64}$/.test(raw.storeId)) ||
      (expectedStore !== undefined && raw.storeId !== expectedStore) ||
      typeof raw.observedAt !== "string" ||
      raw.observedAt.length > 64 ||
      !Number.isFinite(Date.parse(raw.observedAt)) ||
      !Array.isArray(raw.entries) ||
      raw.entries.length > 20 ||
      !Number.isSafeInteger(raw.scannedCount) ||
      raw.scannedCount < 0 ||
      raw.scannedCount > 20 ||
      !Number.isSafeInteger(raw.skippedCount) ||
      raw.skippedCount < 0 ||
      raw.scannedCount !== raw.entries.length + raw.skippedCount ||
      !Number.isSafeInteger(raw.invalidNameCount) ||
      raw.invalidNameCount < 0 ||
      raw.invalidNameCount > 2048 ||
      (raw.nextCursor !== null &&
        (typeof raw.nextCursor !== "string" ||
          !/^[A-Za-z0-9_-]{1,1024}$/.test(raw.nextCursor) ||
          raw.scannedCount === 0))
    )
      return null;
    let prior = "";
    const entries = [];
    for (const entry of raw.entries) {
      if (
        !entry ||
        typeof entry.id !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(entry.id) ||
        entry.id.includes("..") ||
        entry.id <= prior ||
        typeof entry.title !== "string" ||
        entry.title.length > 160 ||
        /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(
          entry.title,
        ) ||
        !["active", "paused", "done", "abandoned"].includes(entry.status) ||
        !Number.isSafeInteger(entry.revision) ||
        entry.revision < 1 ||
        !Number.isSafeInteger(entry.controlGeneration) ||
        entry.controlGeneration < 0
      )
        return null;
      prior = entry.id;
      entries.push({
        id: entry.id,
        title: entry.title,
        status: entry.status,
        revision: entry.revision,
        controlGeneration: entry.controlGeneration,
      });
    }
    return {
      storeId: raw.storeId,
      entries,
      observedAt: raw.observedAt,
      scannedCount: raw.scannedCount,
      skippedCount: raw.skippedCount,
      invalidNameCount: raw.invalidNameCount,
      nextCursor: raw.nextCursor,
    };
  } catch {
    return null;
  }
}

function buildCliGoalPanelsArgs(
  id,
  name,
  scope = "user",
  expectedStore,
  connection,
) {
  if (
    typeof id !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(id) ||
    id.includes("..")
  )
    throw new Error("Enter a standalone CLI goal ID");
  if (
    typeof name !== "string" ||
    !name ||
    name.length > 256 ||
    !["user", "project", "local"].includes(scope)
  )
    throw new Error("Invalid plugin selection");
  if (
    expectedStore !== undefined &&
    !(connection
      ? /^project-goals-[a-f0-9-]{36}$/.test(expectedStore)
      : /^cli-goals-[a-f0-9]{64}$/.test(expectedStore))
  )
    throw new Error("Invalid selected goal store");
  return [
    "goal",
    "panels",
    id,
    `--plugin=${name}`,
    "--scope",
    scope,
    "--json",
    ...(expectedStore ? [`--expected-store=${expectedStore}`] : []),
    ...connectionArgs(connection),
  ];
}

/** A user-requested snapshot, never a live subscription or an action receipt. */
function parseCliGoalPanels(
  text,
  { id, name, scope, expectedStore, connection } = {},
) {
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > 128 * 1024)
    return null;
  try {
    const raw = JSON.parse(text);
    const ref = raw?.goalRef;
    if (
      raw?.schema !== "chainlesschain.goal-extension-panels.v1" ||
      raw.snapshot !== true ||
      (connection
        ? raw.source !== "desktop-project"
        : raw.source !== undefined) ||
      !ref ||
      ![ref.id, ref.storeId].every(
        (v) => typeof v === "string" && v.length > 0 && v.length <= 256,
      ) ||
      !Number.isSafeInteger(ref.revision) ||
      ref.revision < 1 ||
      !Number.isSafeInteger(ref.controlGeneration) ||
      ref.controlGeneration < 0 ||
      (id !== undefined && ref.id !== id) ||
      (expectedStore !== undefined && ref.storeId !== expectedStore) ||
      typeof raw.observedAt !== "string" ||
      raw.observedAt.length > 64 ||
      !Number.isFinite(Date.parse(raw.observedAt)) ||
      !Array.isArray(raw.panels) ||
      raw.panels.length > 16 ||
      !Array.isArray(raw.dropped) ||
      raw.dropped.length > 256
    )
      return null;
    const panels = [];
    for (const panel of raw.panels) {
      const plugin = panel?.plugin;
      if (
        !plugin ||
        ![plugin.name, plugin.version].every(
          (v) => typeof v === "string" && v.length > 0 && v.length <= 256,
        ) ||
        !["user", "project", "local"].includes(plugin.scope) ||
        (name !== undefined && plugin.name !== name) ||
        (scope !== undefined && plugin.scope !== scope) ||
        typeof panel.id !== "string" ||
        !/^[a-z][a-z0-9-]{0,63}$/.test(panel.id) ||
        !(
          panel.slot === "goal.summary" ||
          (connection && panel.slot === "goal.evidence")
        ) ||
        panel.format !== "text" ||
        typeof panel.text !== "string" ||
        panel.text.length > 32768
      )
        return null;
      panels.push({
        plugin: {
          name: plugin.name,
          version: plugin.version,
          scope: plugin.scope,
        },
        id: panel.id,
        text: panel.text,
      });
    }
    return {
      goalRef: {
        id: ref.id,
        storeId: ref.storeId,
        revision: ref.revision,
        controlGeneration: ref.controlGeneration,
      },
      observedAt: raw.observedAt,
      panels,
      dropped: raw.dropped.map((entry) => ({
        name: bounded(entry?.name, 256),
        reason: bounded(entry?.reason, 128),
      })),
    };
  } catch {
    return null;
  }
}

function buildCliGoalDraftRequestArgs(input) {
  const {
    id,
    name,
    scope = "user",
    expectedStore,
    connection,
    source,
    requestId,
    title,
    descriptionFile,
    out,
  } = input;
  buildCliGoalPanelsArgs(id, name, scope, expectedStore, connection);
  if (
    !connection ||
    !/^goal-proposal-[a-f0-9]{64}$/u.test(source || "") ||
    ![
      [requestId, 128],
      [title, 256],
      [descriptionFile, 4096],
      [out, 4096],
    ].every(
      ([value, max]) =>
        typeof value === "string" &&
        value.trim() &&
        value.length <= max &&
        !/[\u0000-\u001f]/u.test(value),
    )
  )
    throw new Error("Invalid draft request selection");
  return [
    "goal",
    "draft-request",
    id,
    `--plugin=${name}`,
    "--scope",
    scope,
    `--connection=${connection}`,
    `--source=${source}`,
    `--request-id=${requestId}`,
    `--title=${title}`,
    `--description-file=${descriptionFile}`,
    `--out=${out}`,
    "--json",
    ...(expectedStore ? [`--expected-store=${expectedStore}`] : []),
  ];
}
function parseCliGoalDraftExport(text, expected) {
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > 16384)
    return null;
  try {
    const result = JSON.parse(text);
    if (
      result.schema !== "chainlesschain.goal-draft-export/v1" ||
      result.state !== "request-exported" ||
      result.goalRef?.id !== expected.id ||
      result.goalRef?.storeId !== expected.expectedStore ||
      result.declaredPlugin?.name !== expected.name ||
      result.declaredPlugin?.scope !== expected.scope ||
      result.file !== expected.out ||
      result.requestId !== expected.requestId ||
      !/^sha256:[a-f0-9]{64}$/u.test(result.contentDigest)
    )
      return null;
    return {
      file: result.file,
      requestId: result.requestId,
      contentDigest: result.contentDigest,
    };
  } catch {
    return null;
  }
}
function formatCliGoalPanels(result) {
  return [
    `CLI goal snapshot: ${result.goalRef.id} (revision ${result.goalRef.revision})`,
    `Observed: ${result.observedAt}`,
    ...result.panels.map(
      (panel) =>
        `\n${panel.plugin.name} [${panel.plugin.scope}]\n${panel.text}`,
    ),
    ...(result.panels.length
      ? []
      : ["\nNo authorized goal panels are available."]),
    ...result.dropped.map(
      (entry) => `${entry.name || "plugins"}: ${entry.reason}`,
    ),
  ].join("\n");
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
  { scope = "user", registry, packageName, grantCapabilities = false } = {},
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
  if (grantCapabilities) args.push("--grant-capabilities");
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

/**
 * Parse the transactional `plugin upgrade --json` result. Older CLIs without
 * activationStatus remain compatible, while unreadable or unknown states fail
 * closed so the IDE does not reload sessions against an ambiguous install.
 */
function parsePluginUpgradeResult(text) {
  let parsed;
  try {
    parsed = JSON.parse(String(text || "").trim());
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return null;
  const inferredStatus =
    parsed.updated === true || parsed.reinstalled === true
      ? "activated"
      : "unchanged";
  const activationStatus =
    typeof parsed.activationStatus === "string"
      ? parsed.activationStatus
      : inferredStatus;
  if (!["activated", "rolled_back", "unchanged"].includes(activationStatus)) {
    return null;
  }
  const capabilities =
    parsed.capabilities && typeof parsed.capabilities === "object"
      ? parsed.capabilities
      : null;
  return {
    name: bounded(parsed.name, 256),
    version: bounded(parsed.version, 128),
    previousVersion: bounded(parsed.previousVersion, 128),
    activationStatus,
    rollbackVersion: bounded(parsed.rollbackVersion, 128),
    rollbackReason: [
      "capability_consent_required",
      "capability_consent_failed",
    ].includes(parsed.rollbackReason)
      ? parsed.rollbackReason
      : "",
    capabilitiesGranted: parsed.capabilitiesGranted === true,
    capabilities: capabilities
      ? {
          consented: capabilities.consented === true,
          reason: bounded(capabilities.reason, 512),
          declared: boundedStringArray(capabilities.declared, 32, 256),
          added: boundedStringArray(capabilities.added, 32, 256),
        }
      : null,
  };
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
      ...(r.goalExtension !== undefined
        ? { goalExtension: parseGoalExtension(r.goalExtension) }
        : {}),
    }));
}

// Management output is descriptive. Never infer admission from compatibility.
function parseGoalExtension(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return { status: "unknown", runtimeAvailable: false, hosts: {} };
  const hosts = {};
  for (const host of ["cli", "vscode", "jetbrains", "desktop"]) {
    if (typeof raw.hosts?.[host] === "string")
      hosts[host] = bounded(raw.hosts[host], 128);
  }
  return {
    status: ["legacy", "invalid", "declaration-only"].includes(raw.status)
      ? raw.status
      : "unknown",
    apiVersion: bounded(raw.apiVersion, 128),
    apiCompatible: raw.apiCompatible === true,
    runtimeAvailable: false,
    hosts,
  };
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

function boundedStringArray(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === "string" && item)
    .slice(0, maxItems)
    .map((item) => bounded(item, maxLength));
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
  buildCliGoalCatalogArgs,
  parseCliGoalCatalog,
  buildCliGoalPanelsArgs,
  buildCliGoalDraftRequestArgs,
  parseCliGoalDraftExport,
  parseCliGoalPanels,
  formatCliGoalPanels,
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
  parsePluginUpgradeResult,
  parseSkillList,
};

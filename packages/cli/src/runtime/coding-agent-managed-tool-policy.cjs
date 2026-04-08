"use strict";

const DEFAULT_ALLOWED_MANAGED_TOOL_NAMES = Object.freeze([
  "info_searcher",
  "format_output",
  "json_parser",
  "yaml_parser",
  "base64_handler",
]);

const DEFAULT_ALLOWED_MCP_SERVER_NAMES = Object.freeze(["weather"]);

const MCP_SERVER_READY_STATES = Object.freeze(["connected", "ready"]);

const RISK_LEVEL_ORDER = Object.freeze({
  low: 0,
  medium: 1,
  high: 2,
});

function normalizeCollection(values, fallback = []) {
  if (values instanceof Set) {
    return values;
  }

  if (Array.isArray(values)) {
    return new Set(values);
  }

  return new Set(fallback);
}

function normalizeRiskLevel(value, fallback = "medium") {
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }

  if (typeof value === "number") {
    if (value <= 1) {
      return "low";
    }
    if (value === 2) {
      return "medium";
    }
    return "high";
  }

  if (typeof value === "string" && /^\d+$/.test(value)) {
    return normalizeRiskLevel(Number(value), fallback);
  }

  return fallback;
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") {
      return true;
    }
    if (normalized === "false" || normalized === "0") {
      return false;
    }
  }

  return fallback;
}

function selectHigherRiskLevel(...values) {
  const normalized = values
    .map((value) => normalizeRiskLevel(value, null))
    .filter(Boolean);

  if (normalized.length === 0) {
    return "medium";
  }

  return normalized.reduce((current, candidate) =>
    RISK_LEVEL_ORDER[candidate] > RISK_LEVEL_ORDER[current] ? candidate : current,
  );
}

function createTrustedMcpServerMap(registry = null) {
  const trustedServers = Array.isArray(registry?.trustedServers)
    ? registry.trustedServers
    : Array.isArray(registry)
      ? registry
      : [];

  return new Map(
    trustedServers
      .filter((server) => server?.id)
      .map((server) => [
        server.id,
        {
          ...server,
          securityLevel: selectHigherRiskLevel(server.securityLevel),
          requiredPermissions: Array.isArray(server.requiredPermissions)
            ? [...server.requiredPermissions]
            : [],
          capabilities: Array.isArray(server.capabilities)
            ? [...server.capabilities]
            : [],
        },
      ]),
  );
}

function resolveManagedToolPolicy(managedTool, options = {}) {
  const name = String(managedTool?.name || "").trim();
  const allowedManagedToolNames = normalizeCollection(
    options.allowedManagedToolNames,
    DEFAULT_ALLOWED_MANAGED_TOOL_NAMES,
  );
  const coreToolNames = normalizeCollection(options.coreToolNames);
  const enabled = normalizeBoolean(managedTool?.enabled, true);
  const deprecated = normalizeBoolean(managedTool?.deprecated, false);
  const riskLevel = normalizeRiskLevel(managedTool?.risk_level, "medium");
  const isReadOnly =
    normalizeBoolean(managedTool?.is_read_only, false) || riskLevel === "low";

  if (!name) {
    return {
      allowed: false,
      decision: "deny",
      reason: "Managed tool is missing a stable name.",
      riskLevel,
      isReadOnly,
    };
  }

  if (coreToolNames.has(name)) {
    return {
      allowed: false,
      decision: "deny",
      reason: `Managed tool "${name}" collides with a core coding-agent tool.`,
      riskLevel,
      isReadOnly,
    };
  }

  if (allowedManagedToolNames.size > 0 && !allowedManagedToolNames.has(name)) {
    return {
      allowed: false,
      decision: "deny",
      reason: `Managed tool "${name}" is not on the desktop allowlist.`,
      riskLevel,
      isReadOnly,
    };
  }

  if (!enabled) {
    return {
      allowed: false,
      decision: "deny",
      reason: `Managed tool "${name}" is disabled.`,
      riskLevel,
      isReadOnly,
    };
  }

  if (deprecated) {
    return {
      allowed: false,
      decision: "deny",
      reason: `Managed tool "${name}" is deprecated.`,
      riskLevel,
      isReadOnly,
    };
  }

  return {
    allowed: true,
    decision: "allow",
    reason: `Managed tool "${name}" is allowlisted for coding-agent sessions.`,
    riskLevel,
    isReadOnly,
  };
}

function resolveMcpServerPolicy(serverName, serverState, options = {}) {
  const normalizedServerName = String(serverName || "").trim();
  const allowedMcpServerNames = normalizeCollection(
    options.allowedMcpServerNames,
    DEFAULT_ALLOWED_MCP_SERVER_NAMES,
  );
  const trustedMcpServers =
    options.trustedMcpServers instanceof Map
      ? options.trustedMcpServers
      : createTrustedMcpServerMap(options.trustedMcpServers);
  const allowHighRiskMcpServers = options.allowHighRiskMcpServers === true;
  const trustedServer = trustedMcpServers.get(normalizedServerName) || null;
  const securityLevel = trustedServer
    ? selectHigherRiskLevel(
        trustedServer.securityLevel,
        serverState?.securityLevel,
      )
    : normalizeRiskLevel(serverState?.securityLevel, "high");

  if (!normalizedServerName) {
    return {
      allowed: false,
      decision: "deny",
      trusted: false,
      securityLevel,
      reason: "MCP server is missing a stable name.",
      requiredPermissions: [],
      capabilities: [],
    };
  }

  if (
    allowedMcpServerNames.size > 0 &&
    !allowedMcpServerNames.has(normalizedServerName)
  ) {
    return {
      allowed: false,
      decision: "deny",
      trusted: !!trustedServer,
      securityLevel,
      reason: `MCP server "${normalizedServerName}" is not on the desktop allowlist.`,
      requiredPermissions: trustedServer?.requiredPermissions || [],
      capabilities: trustedServer?.capabilities || [],
    };
  }

  if (!trustedServer) {
    return {
      allowed: false,
      decision: "deny",
      trusted: false,
      securityLevel,
      reason: `MCP server "${normalizedServerName}" is not in the trusted registry.`,
      requiredPermissions: [],
      capabilities: [],
    };
  }

  const state = String(serverState?.state || "connected").toLowerCase();
  if (!MCP_SERVER_READY_STATES.includes(state)) {
    return {
      allowed: false,
      decision: "deny",
      trusted: true,
      securityLevel,
      reason: `MCP server "${normalizedServerName}" is not ready.`,
      requiredPermissions: trustedServer.requiredPermissions,
      capabilities: trustedServer.capabilities,
    };
  }

  if (securityLevel === "high" && !allowHighRiskMcpServers) {
    return {
      allowed: false,
      decision: "deny",
      trusted: true,
      securityLevel,
      reason: `MCP server "${normalizedServerName}" is high risk and requires explicit opt-in.`,
      requiredPermissions: trustedServer.requiredPermissions,
      capabilities: trustedServer.capabilities,
    };
  }

  return {
    allowed: true,
    decision: "allow",
    trusted: true,
    securityLevel,
    reason: `Trusted MCP server "${normalizedServerName}" is allowed for coding-agent sessions.`,
    requiredPermissions: trustedServer.requiredPermissions,
    capabilities: trustedServer.capabilities,
    server: trustedServer,
  };
}

module.exports = {
  DEFAULT_ALLOWED_MANAGED_TOOL_NAMES,
  DEFAULT_ALLOWED_MCP_SERVER_NAMES,
  MCP_SERVER_READY_STATES,
  normalizeRiskLevel,
  normalizeBoolean,
  selectHigherRiskLevel,
  createTrustedMcpServerMap,
  resolveManagedToolPolicy,
  resolveMcpServerPolicy,
};

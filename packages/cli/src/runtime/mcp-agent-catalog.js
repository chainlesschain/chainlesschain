import { createHash } from "node:crypto";
import { inferTransport } from "../harness/mcp-client.js";
import {
  admitMcpToolList,
  isMcpToolMetadataError,
} from "../lib/mcp-tool-metadata.js";
import { mcpEffectDescriptorFields } from "../lib/mcp-effect-contract.js";
import {
  publishMcpToolCatalog,
  setMcpToolCatalogRefresh,
} from "../lib/mcp-tool-catalog-authority.js";
import { refreshMcpToolSearch } from "./mcp-tool-search.js";

const catalogs = new WeakMap();
const configAuthorities = new WeakMap();
let nextConfigAuthority = 0;

// Bind the logical name to its approved source. The lifecycle digest is an
// audit identifier (it deliberately omits URL queries and environment), not
// a sufficiently precise authorization boundary for catalog inheritance.
function configIdentity(config, authorizationRefresh = false) {
  if (!config || typeof config !== "object") return null;
  const normalize = (value, key = "") => {
    if (value == null || typeof value !== "object") return value;
    if (/authority/i.test(key)) {
      if (!configAuthorities.has(value))
        configAuthorities.set(value, ++nextConfigAuthority);
      return { authority: configAuthorities.get(value) };
    }
    if (Array.isArray(value)) return value.map((item) => normalize(item));
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((name) => [name, normalize(value[name], name)]),
    );
  };
  const { mcpStdioExecutionAuthority: _consumed, headers, ...source } = config;
  void _consumed;
  source.transport = inferTransport(config);
  source.headers = Object.fromEntries(
    Object.entries(headers || {})
      .filter(
        ([key]) =>
          !authorizationRefresh || key.toLowerCase() !== "authorization",
      )
      .map(([key, value]) => [key.toLowerCase(), value]),
  );
  return createHash("sha256")
    .update(JSON.stringify(normalize(source)))
    .digest("hex");
}

function observedEntry(client, name, record) {
  const entry =
    client.servers instanceof Map ? client.servers.get(name) : undefined;
  return {
    entry,
    tools: entry?.tools,
    state: entry?.state,
    dirty: entry?._toolInventoryDirty,
    instructions: entry?.instructions,
    error: entry?.toolsError,
    configIdentity: configIdentity(entry?.config, record.authorizationRefresh),
  };
}

function sameObservation(a, b) {
  return a && Object.keys(b).every((key) => a[key] === b[key]);
}

function replaceTools(result, name, record, inventory) {
  const previousBytes = record.metadataBytes || 0;
  const otherBytes = Math.max(
    0,
    (result._mcpToolMetadataBytes || 0) - previousBytes,
  );
  let admitted;
  let error = null;
  try {
    admitted = admitMcpToolList(name, inventory, record.config, {
      clientBytesUsed: otherBytes,
    });
  } catch (cause) {
    if (!isMcpToolMetadataError(cause)) throw cause;
    admitted = { tools: [], metadataBytes: 0 };
    error = cause;
  }
  const retiredNames = new Set(
    Object.entries(result.externalToolExecutors)
      .filter(
        ([, executor]) =>
          executor.kind === "mcp" && executor.serverName === name,
      )
      .map(([tool]) => tool),
  );
  const retained = result.extraToolDefinitions.filter(
    (definition) => !retiredNames.has(definition.function.name),
  );
  result.extraToolDefinitions.splice(
    0,
    result.extraToolDefinitions.length,
    ...retained,
  );
  for (const retired of retiredNames) {
    delete result.externalToolExecutors[retired];
    delete result.externalToolDescriptors[retired];
  }
  const cfg = record.config;
  const resultLimits = Object.freeze(
    Object.fromEntries(
      ["maxToolResultBytes", "maxToolResultDepth", "maxToolResultNodes"]
        .filter((key) => Number.isFinite(cfg[key]))
        .map((key) => [key, cfg[key]]),
    ),
  );
  for (const tool of admitted.tools) {
    const wireName = `mcp__${name}__${tool.name}`;
    result.extraToolDefinitions.push(
      Object.freeze({
        type: "function",
        function: Object.freeze({
          name: wireName,
          description:
            tool.description || `MCP tool "${tool.name}" on server "${name}"`,
          parameters:
            tool.inputSchema ||
            Object.freeze({ type: "object", properties: Object.freeze({}) }),
        }),
      }),
    );
    const route = {
      kind: "mcp",
      serverName: name,
      toolName: tool.name,
      ...(Object.keys(resultLimits).length
        ? { toolResultConfig: resultLimits }
        : {}),
    };
    const executor = {};
    for (const [key, value] of Object.entries(route))
      Object.defineProperty(executor, key, { value, enumerable: true });
    result.externalToolExecutors[wireName] = executor;
    result.externalToolDescriptors[wireName] = Object.freeze({
      name: wireName,
      kind: "mcp",
      category: "mcp",
      source: cfg.pluginId ? `plugin:${cfg.pluginId}` : name,
      ...(cfg.pluginVersion ? { version: cfg.pluginVersion } : {}),
      ...mcpEffectDescriptorFields(tool, {
        sourceTrusted: cfg.sourceTrusted,
        provenance:
          cfg.configSource ||
          cfg.pluginSource ||
          (cfg.configScope ? `${cfg.configScope}:${name}` : `mcp:${name}`),
      }),
    });
  }
  record.metadataBytes = admitted.metadataBytes;
  result._mcpToolMetadataBytes = otherBytes + admitted.metadataBytes;
  const connected = result.connected?.find((server) => server.server === name);
  if (connected) connected.tools = admitted.tools.length;
  return { tools: admitted.tools, error };
}

function refresh(result, records) {
  // MCPClient owns validated transport entries. Inspect only known, configured
  // servers; a connection added through some other client path grants nothing.
  // This read has no I/O and also observes disconnect() before its async teardown.
  if (!(result.mcpClient.servers instanceof Map)) return;
  let changed = false;
  for (const [name, record] of records) {
    if (record.initializing) continue;
    const current = observedEntry(result.mcpClient, name, record);
    if (sameObservation(record.observation, current)) continue;
    const available =
      current.state === "connected" &&
      current.dirty !== true &&
      !current.error &&
      current.configIdentity !== null &&
      current.configIdentity === record.configIdentity;
    const replacement = replaceTools(
      result,
      name,
      record,
      available ? current.tools || [] : [],
    );
    if (replacement.error)
      record.writeErr?.(
        `  mcp: "${name}" refreshed tool metadata was rejected: ${replacement.error.message}\n`,
      );
    if (
      available &&
      typeof current.instructions === "string" &&
      current.instructions.trim()
    )
      result.instructionsByServer[name] = current.instructions.trim();
    else delete result.instructionsByServer[name];
    record.observation = current;
    changed = true;
  }
  if (changed) {
    refreshMcpToolSearch(result);
    publishMcpToolCatalog(result);
  }
}

export function registerMcpCatalogServer(
  result,
  name,
  config,
  writeErr,
  { connectConfig = config, authorizationRefresh = false } = {},
) {
  let records = catalogs.get(result);
  if (!records) {
    records = new Map();
    catalogs.set(result, records);
    setMcpToolCatalogRefresh(result, () => refresh(result, records));
  }
  const captured = {};
  for (const [key, value] of Object.entries(config)) {
    if (
      (key.startsWith("max") && Number.isFinite(value)) ||
      [
        "pluginId",
        "pluginVersion",
        "configSource",
        "pluginSource",
        "configScope",
      ].includes(key)
    )
      captured[key] = value;
  }
  captured.sourceTrusted =
    config.configScope === "managed" ||
    Boolean(config.pluginId && config.pluginWorkspaceAuthority);
  records.set(name, {
    config: Object.freeze(captured),
    configIdentity: configIdentity(connectConfig, authorizationRefresh),
    authorizationRefresh,
    initializing: true,
    metadataBytes: 0,
    writeErr,
  });
}

export function settleMcpCatalogServer(result, name, response = {}) {
  const record = catalogs.get(result).get(name);
  const outcome = replaceTools(result, name, record, response?.tools ?? []);
  record.initializing = false;
  record.observation = observedEntry(result.mcpClient, name, record);
  // Successful connect has already validated and normalized stdio invocation
  // and sandbox configuration. Capture that effective source for reconnects.
  if (record.observation.state === "connected" && response?.tools)
    record.configIdentity = record.observation.configIdentity;
  return outcome;
}

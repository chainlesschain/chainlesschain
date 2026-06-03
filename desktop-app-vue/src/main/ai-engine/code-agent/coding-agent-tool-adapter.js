const mcpServerRegistry = require("../../mcp/servers/server-registry.json");
const {
  getCodingAgentToolContracts,
} = require("../../../../../packages/cli/src/runtime/coding-agent-contract-shared.cjs");
const {
  resolveToolPolicy,
  TOOL_CATEGORIES,
  RISK_LEVELS,
} = require("../../../../../packages/cli/src/runtime/coding-agent-policy.cjs");
const {
  DEFAULT_ALLOWED_MANAGED_TOOL_NAMES,
  DEFAULT_ALLOWED_MCP_SERVER_NAMES,
  normalizeRiskLevel,
  normalizeBoolean,
  selectHigherRiskLevel,
  createTrustedMcpServerMap,
  resolveManagedToolPolicy,
  resolveMcpServerPolicy,
} = require("../../../../../packages/cli/src/runtime/coding-agent-managed-tool-policy.cjs");

function cloneToolDescriptor(descriptor) {
  return {
    ...descriptor,
    inputSchema: JSON.parse(JSON.stringify(descriptor.inputSchema || {})),
    permissions: JSON.parse(JSON.stringify(descriptor.permissions || {})),
    telemetry: JSON.parse(JSON.stringify(descriptor.telemetry || {})),
    managedMetadata: descriptor.managedMetadata || null,
    mcpMetadata: descriptor.mcpMetadata
      ? JSON.parse(JSON.stringify(descriptor.mcpMetadata))
      : null,
    readOnlySubcommands: Array.isArray(descriptor.readOnlySubcommands)
      ? [...descriptor.readOnlySubcommands]
      : undefined,
  };
}

function humanizeToolName(name) {
  return String(name || "")
    .trim()
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildPermissions({
  sourceKind,
  isReadOnly,
  riskLevel,
  requiredPermissions = [],
}) {
  const scopes = [];
  if (sourceKind === "mcp") {
    scopes.push("mcp:invoke");
  } else if (sourceKind === "managed") {
    scopes.push("tool:invoke");
  } else {
    scopes.push("tool:execute");
  }

  for (const permission of requiredPermissions) {
    if (!scopes.includes(permission)) {
      scopes.push(permission);
    }
  }

  return {
    level: isReadOnly
      ? "readonly"
      : riskLevel === RISK_LEVELS.HIGH
        ? "elevated"
        : "standard",
    scopes,
  };
}

function buildTelemetry({ name, category, sourceKind }) {
  return {
    category: category || "execute",
    tags: [`tool:${name}`, `source:${sourceKind}`],
  };
}

function createCanonicalToolDescriptor(base = {}, overrides = {}) {
  const merged = {
    ...base,
    ...overrides,
  };
  const normalizedRiskLevel = normalizeRiskLevel(
    merged.riskLevel,
    base.riskLevel || "medium",
  );
  const isReadOnly =
    normalizeBoolean(merged.isReadOnly, false) || normalizedRiskLevel === "low";
  const policy = resolveToolPolicy(merged.name, {
    riskLevel: normalizedRiskLevel,
    isReadOnly,
  });
  const sourceKind = merged.sourceKind || "managed";
  const category =
    merged.category ||
    (isReadOnly ? TOOL_CATEGORIES.READ : null) ||
    policy.category ||
    TOOL_CATEGORIES.EXECUTE;

  return {
    ...merged,
    title: merged.title || humanizeToolName(merged.name),
    kind: merged.kind || sourceKind,
    category,
    inputSchema: JSON.parse(
      JSON.stringify(merged.inputSchema || { type: "object", properties: {} }),
    ),
    isReadOnly,
    riskLevel: normalizedRiskLevel,
    availableInPlanMode:
      typeof merged.availableInPlanMode === "boolean"
        ? merged.availableInPlanMode
        : policy.availableInPlanMode,
    planModeBehavior: merged.planModeBehavior || policy.planModeBehavior,
    requiresPlanApproval:
      typeof merged.requiresPlanApproval === "boolean"
        ? merged.requiresPlanApproval
        : policy.requiresPlanApproval,
    requiresConfirmation:
      typeof merged.requiresConfirmation === "boolean"
        ? merged.requiresConfirmation
        : normalizedRiskLevel === RISK_LEVELS.HIGH
          ? true
          : policy.requiresConfirmation,
    approvalFlow: merged.approvalFlow || policy.approvalFlow,
    permissions:
      merged.permissions ||
      buildPermissions({
        sourceKind,
        isReadOnly,
        riskLevel: normalizedRiskLevel,
        requiredPermissions: merged.requiredPermissions,
      }),
    telemetry:
      merged.telemetry ||
      buildTelemetry({
        name: merged.name,
        category,
        sourceKind,
      }),
  };
}

function mapContractToCoreTool(contract) {
  const descriptor = createCanonicalToolDescriptor(
    {
      title: contract.title,
      kind: contract.kind,
      category: contract.category,
      permissions: JSON.parse(JSON.stringify(contract.permissions || {})),
      telemetry: JSON.parse(JSON.stringify(contract.telemetry || {})),
      availableInPlanMode: contract.availableInPlanMode,
      requiresPlanApproval: contract.requiresPlanApproval,
      requiresConfirmation: contract.requiresConfirmation,
      approvalFlow: contract.approvalFlow,
    },
    {
      sourceKind: "core",
      name: contract.name,
      description: contract.description || "",
      inputSchema: JSON.parse(
        JSON.stringify(contract.inputSchema || { type: "object", properties: {} }),
      ),
      isReadOnly: contract.isReadOnly === true,
      riskLevel: contract.riskLevel || "medium",
      planModeBehavior: contract.planModeBehavior || "blocked",
      source: "desktop-core",
    },
  );

  if (Array.isArray(contract.readOnlySubcommands)) {
    descriptor.readOnlySubcommands = [...contract.readOnlySubcommands];
  }

  return descriptor;
}

const CORE_CODING_AGENT_TOOLS = getCodingAgentToolContracts({
  tier: "mvp",
}).map(mapContractToCoreTool);

function parseSchema(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "object") {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

function createManagedToolDescriptor(baseTool, managedTool) {
  const parsedSchema = parseSchema(managedTool?.input_schema) ||
    parseSchema(managedTool?.schema) ||
    parseSchema(managedTool?.parameters_schema) ||
    baseTool?.inputSchema || { type: "object", properties: {} };
  const normalizedRiskLevel = normalizeRiskLevel(
    managedTool?.risk_level,
    baseTool?.riskLevel || "medium",
  );
  const inferredReadOnly =
    normalizeBoolean(managedTool?.is_read_only, false) ||
    normalizedRiskLevel === "low";

  return createCanonicalToolDescriptor(baseTool ? cloneToolDescriptor(baseTool) : {}, {
    sourceKind: "managed",
    name: managedTool?.name || baseTool?.name || null,
    title:
      managedTool?.title ||
      managedTool?.display_name ||
      baseTool?.title ||
      humanizeToolName(managedTool?.name || baseTool?.name),
    kind: baseTool?.kind || "managed",
    description: managedTool?.description || baseTool?.description || "",
    inputSchema: JSON.parse(JSON.stringify(parsedSchema)),
    isReadOnly: baseTool?.isReadOnly ?? inferredReadOnly,
    riskLevel: normalizedRiskLevel,
    source: managedTool?.id
      ? `desktop-tool-manager:${managedTool.id}`
      : baseTool?.source || "desktop-core",
    managedMetadata: managedTool || null,
  });
}

function createMcpToolDescriptor(serverName, mcpTool, serverPolicy) {
  const normalizedRiskLevel = selectHigherRiskLevel(
    serverPolicy.securityLevel,
    mcpTool?.risk_level,
  );

  return createCanonicalToolDescriptor({
    sourceKind: "mcp",
    name: `mcp_${serverName}_${mcpTool?.name || "tool"}`,
    title:
      mcpTool?.title ||
      humanizeToolName(`${serverName}_${mcpTool?.name || "tool"}`),
    kind: "mcp",
    description: mcpTool?.description || `MCP tool from ${serverName}.`,
    inputSchema: parseSchema(mcpTool?.inputSchema) ||
      parseSchema(mcpTool?.input_schema) ||
      parseSchema(mcpTool?.parameters_schema) || {
        type: "object",
        properties: {},
      },
    isReadOnly:
      normalizeBoolean(mcpTool?.isReadOnly, false) ||
      normalizeBoolean(mcpTool?.is_read_only, false) ||
      normalizedRiskLevel === "low",
    riskLevel: normalizedRiskLevel,
    source: `mcp:${serverName}`,
    requiredPermissions: serverPolicy.requiredPermissions || [],
    requiresConfirmation: normalizedRiskLevel === RISK_LEVELS.HIGH,
    mcpMetadata: {
      serverName,
      trusted: serverPolicy.trusted === true,
      securityLevel: serverPolicy.securityLevel,
      requiredPermissions: serverPolicy.requiredPermissions || [],
      capabilities: serverPolicy.capabilities || [],
      originalToolName: mcpTool?.name || null,
      tool: mcpTool || null,
    },
  });
}

class CodingAgentToolAdapter {
  constructor(options = {}) {
    this.toolManager = options.toolManager || null;
    this.mcpManager = options.mcpManager || null;
    this.allowedManagedToolNames = new Set(
      Array.isArray(options.allowedManagedToolNames)
        ? options.allowedManagedToolNames
        : DEFAULT_ALLOWED_MANAGED_TOOL_NAMES,
    );
    this.allowedMcpServerNames = new Set(
      Array.isArray(options.allowedMcpServerNames)
        ? options.allowedMcpServerNames
        : DEFAULT_ALLOWED_MCP_SERVER_NAMES,
    );
    this.allowHighRiskMcpServers = options.allowHighRiskMcpServers === true;
    this.trustedMcpServers = createTrustedMcpServerMap(
      options.mcpServerRegistry || mcpServerRegistry,
    );
    this.coreTools = CORE_CODING_AGENT_TOOLS.map(cloneToolDescriptor);
    this.coreToolMap = new Map(this.coreTools.map((tool) => [tool.name, tool]));
    this.toolDescriptorCache = new Map(
      this.coreTools.map((tool) => [tool.name, cloneToolDescriptor(tool)]),
    );
  }

  listCoreTools() {
    return this.coreTools.map(cloneToolDescriptor);
  }

  getCoreTool(name) {
    const tool = this.coreToolMap.get(name);
    return tool ? cloneToolDescriptor(tool) : null;
  }

  hasTool(name) {
    return this.coreToolMap.has(name);
  }

  getToolDescriptorSync(name) {
    const tool = this.toolDescriptorCache.get(name);
    return tool ? cloneToolDescriptor(tool) : null;
  }

  getToolDefinitions() {
    return this.buildFunctionToolDefinitions(this.listCoreTools());
  }

  getSummary() {
    return this.summarizeTools(this.coreTools);
  }

  summarizeTools(tools = []) {
    const toolsByRisk = {
      low: [],
      medium: [],
      high: [],
    };
    const toolsBySource = {};

    for (const tool of tools) {
      const bucket = toolsByRisk[tool.riskLevel];
      if (bucket) {
        bucket.push(tool.name);
      } else {
        // Tools with an unknown/missing riskLevel are surfaced as medium so
        // the summary stays internally consistent.
        toolsByRisk.medium.push(tool.name);
      }
      const source = tool.source || "unknown";
      if (!toolsBySource[source]) {
        toolsBySource[source] = [];
      }
      toolsBySource[source].push(tool.name);
    }

    return {
      totalTools: tools.length,
      toolsByRisk,
      toolsBySource,
      managedToolSupport:
        !!this.toolManager &&
        typeof this.toolManager.getAllTools === "function" &&
        typeof this.toolManager.getToolByName === "function",
      mcpToolSupport:
        !!this.mcpManager &&
        typeof this.mcpManager.listTools === "function" &&
        this.mcpManager.servers instanceof Map,
    };
  }

  buildFunctionToolDefinition(tool) {
    if (!tool?.name) {
      return null;
    }

    return {
      type: "function",
      function: {
        name: tool.name,
        description: tool.description || "",
        parameters: JSON.parse(
          JSON.stringify(
            tool.inputSchema || { type: "object", properties: {} },
          ),
        ),
      },
    };
  }

  buildFunctionToolDefinitions(tools = []) {
    return tools
      .map((tool) => this.buildFunctionToolDefinition(tool))
      .filter(Boolean);
  }

  async getTool(name, options = {}) {
    const baseTool = this.getCoreTool(name);
    const includeManagedMetadata = options.includeManagedMetadata !== false;

    if (!includeManagedMetadata || !this.toolManager) {
      return baseTool;
    }

    const managedTool = await this._getManagedTool(name);
    if (!managedTool) {
      return baseTool;
    }

    return this._mergeToolMetadata(baseTool, managedTool);
  }

  async listAgentTools(options = {}) {
    const includeManagedMetadata = options.includeManagedMetadata === true;
    const includeManagedTools = options.includeManagedTools === true;
    const includeMcpTools = options.includeMcpTools === true;
    const tools = this.listCoreTools();
    const managedTools = this.toolManager ? await this._listManagedTools() : [];
    const mergedCoreTools =
      includeManagedMetadata && managedTools.length > 0
        ? tools.map((tool) => {
            const managedTool = managedTools.find(
              (item) => item.name === tool.name,
            );
            return managedTool
              ? this._mergeToolMetadata(tool, managedTool)
              : tool;
          })
        : tools;

    const additionalManagedTools = includeManagedTools
      ? managedTools
          .filter((tool) => this._shouldIncludeManagedTool(tool))
          .map((tool) => this._mergeToolMetadata(null, tool))
      : [];
    const additionalMcpTools = includeMcpTools
      ? await this._listMcpTools()
      : [];
    const allTools = [
      ...mergedCoreTools,
      ...additionalManagedTools,
      ...additionalMcpTools,
    ];

    this._refreshToolDescriptorCache(allTools);
    return allTools;
  }

  async listAvailableTools() {
    return this.listAgentTools({
      includeManagedMetadata: true,
      includeManagedTools: true,
      includeMcpTools: true,
    });
  }

  async _listManagedTools() {
    if (
      !this.toolManager ||
      typeof this.toolManager.getAllTools !== "function"
    ) {
      return [];
    }

    const tools = await this.toolManager.getAllTools({ enabled: 1 });
    return Array.isArray(tools) ? tools : [];
  }

  async _getManagedTool(name) {
    if (
      !this.toolManager ||
      typeof this.toolManager.getToolByName !== "function"
    ) {
      return null;
    }

    return this.toolManager.getToolByName(name);
  }

  async _listMcpTools() {
    if (
      !this.mcpManager ||
      typeof this.mcpManager.listTools !== "function" ||
      !(this.mcpManager.servers instanceof Map)
    ) {
      return [];
    }

    const tools = [];
    // Track normalized MCP tool names so duplicates across (or within) servers
    // get a deterministic suffix instead of silently overwriting each other
    // in the descriptor cache.
    const seenNames = new Set();
    for (const [serverName, serverState] of this.mcpManager.servers.entries()) {
      if (!this._shouldIncludeMcpServer(serverName, serverState)) {
        continue;
      }

      let serverTools = Array.isArray(serverState?.tools)
        ? serverState.tools
        : [];
      if (serverTools.length === 0) {
        serverTools = await this.mcpManager.listTools(serverName);
      }

      for (const mcpTool of Array.isArray(serverTools) ? serverTools : []) {
        const descriptor = this._normalizeMcpToolDescriptor(
          serverName,
          mcpTool,
        );
        if (seenNames.has(descriptor.name)) {
          let index = 2;
          let candidate = `${descriptor.name}_${index}`;
          while (seenNames.has(candidate)) {
            index += 1;
            candidate = `${descriptor.name}_${index}`;
          }
          descriptor.name = candidate;
        }
        seenNames.add(descriptor.name);
        tools.push(descriptor);
      }
    }

    return tools;
  }

  _shouldIncludeManagedTool(managedTool) {
    return resolveManagedToolPolicy(managedTool, {
      allowedManagedToolNames: this.allowedManagedToolNames,
      coreToolNames: [...this.coreToolMap.keys()],
    }).allowed;
  }

  _shouldIncludeMcpServer(serverName, serverState) {
    return resolveMcpServerPolicy(serverName, serverState, {
      allowedMcpServerNames: this.allowedMcpServerNames,
      trustedMcpServers: this.trustedMcpServers,
      allowHighRiskMcpServers: this.allowHighRiskMcpServers,
    }).allowed;
  }

  _mergeToolMetadata(baseTool, managedTool) {
    return createManagedToolDescriptor(baseTool, managedTool);
  }

  _normalizeMcpToolDescriptor(serverName, mcpTool) {
    const serverPolicy = resolveMcpServerPolicy(
      serverName,
      { state: "ready" },
      {
        allowedMcpServerNames: this.allowedMcpServerNames,
        trustedMcpServers: this.trustedMcpServers,
        allowHighRiskMcpServers: true,
      },
    );
    return createMcpToolDescriptor(serverName, mcpTool, serverPolicy);
  }

  _refreshToolDescriptorCache(tools = []) {
    this.toolDescriptorCache = new Map(
      this.coreTools.map((tool) => [tool.name, cloneToolDescriptor(tool)]),
    );

    for (const tool of tools) {
      if (tool?.name) {
        this.toolDescriptorCache.set(tool.name, cloneToolDescriptor(tool));
      }
    }
  }
}

module.exports = {
  CORE_CODING_AGENT_TOOLS,
  DEFAULT_ALLOWED_MANAGED_TOOL_NAMES,
  DEFAULT_ALLOWED_MCP_SERVER_NAMES,
  CodingAgentToolAdapter,
};

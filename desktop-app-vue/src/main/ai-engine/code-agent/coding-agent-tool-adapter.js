const mcpServerRegistry = require("../../mcp/servers/server-registry.json");
const {
  TOOL_POLICY_METADATA,
  READ_ONLY_GIT_SUBCOMMANDS,
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

function getSharedPolicy(toolName) {
  return TOOL_POLICY_METADATA[toolName] || null;
}

const CORE_CODING_AGENT_TOOLS = [
  {
    name: "read_file",
    description: "Read a file from the current workspace.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Workspace-relative or absolute file path to read.",
        },
      },
      required: ["path"],
    },
    isReadOnly: getSharedPolicy("read_file")?.isReadOnly === true,
    riskLevel: getSharedPolicy("read_file")?.riskLevel || "low",
    planModeBehavior: getSharedPolicy("read_file")?.planModeBehavior || "allow",
    source: "desktop-core",
  },
  {
    name: "search_files",
    description: "Search file names or file contents inside the workspace.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Glob pattern or text query to search for.",
        },
        directory: {
          type: "string",
          description: "Optional directory root for the search.",
        },
        content_search: {
          type: "boolean",
          description: "When true, search file contents instead of names.",
        },
      },
      required: ["pattern"],
    },
    isReadOnly: getSharedPolicy("search_files")?.isReadOnly === true,
    riskLevel: getSharedPolicy("search_files")?.riskLevel || "low",
    planModeBehavior:
      getSharedPolicy("search_files")?.planModeBehavior || "allow",
    source: "desktop-core",
  },
  {
    name: "list_dir",
    description: "List the contents of a workspace directory.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Directory path to inspect. Defaults to the workspace root.",
        },
      },
    },
    isReadOnly: getSharedPolicy("list_dir")?.isReadOnly === true,
    riskLevel: getSharedPolicy("list_dir")?.riskLevel || "low",
    planModeBehavior: getSharedPolicy("list_dir")?.planModeBehavior || "allow",
    source: "desktop-core",
  },
  {
    name: "edit_file",
    description: "Edit an existing file by replacing exact text.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Target file path.",
        },
        old_string: {
          type: "string",
          description: "Exact text to replace.",
        },
        new_string: {
          type: "string",
          description: "Replacement text.",
        },
      },
      required: ["path", "old_string", "new_string"],
    },
    isReadOnly: getSharedPolicy("edit_file")?.isReadOnly === true,
    riskLevel: getSharedPolicy("edit_file")?.riskLevel || "medium",
    planModeBehavior:
      getSharedPolicy("edit_file")?.planModeBehavior || "blocked",
    source: "desktop-core",
  },
  {
    name: "write_file",
    description: "Create or overwrite a workspace file.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Target file path.",
        },
        content: {
          type: "string",
          description: "Full file content to write.",
        },
      },
      required: ["path", "content"],
    },
    isReadOnly: getSharedPolicy("write_file")?.isReadOnly === true,
    riskLevel: getSharedPolicy("write_file")?.riskLevel || "medium",
    planModeBehavior:
      getSharedPolicy("write_file")?.planModeBehavior || "blocked",
    source: "desktop-core",
  },
  {
    name: "run_shell",
    description: "Execute a shell command in the controlled workspace runtime.",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Shell command to execute.",
        },
        cwd: {
          type: "string",
          description: "Optional working directory override.",
        },
      },
      required: ["command"],
    },
    isReadOnly: getSharedPolicy("run_shell")?.isReadOnly === true,
    riskLevel: getSharedPolicy("run_shell")?.riskLevel || "high",
    planModeBehavior:
      getSharedPolicy("run_shell")?.planModeBehavior || "blocked",
    source: "desktop-core",
  },
  {
    name: "git",
    description: "Run a git command in the controlled workspace runtime.",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Git subcommand to execute, for example status or diff.",
        },
        cwd: {
          type: "string",
          description: "Optional working directory override.",
        },
      },
      required: ["command"],
    },
    isReadOnly: getSharedPolicy("git")?.isReadOnly === true,
    riskLevel: getSharedPolicy("git")?.riskLevel || "high",
    planModeBehavior: getSharedPolicy("git")?.planModeBehavior || "blocked",
    readOnlySubcommands: [...READ_ONLY_GIT_SUBCOMMANDS],
    source: "desktop-core",
  },
];

function cloneToolDescriptor(descriptor) {
  return {
    ...descriptor,
    inputSchema: JSON.parse(JSON.stringify(descriptor.inputSchema || {})),
  };
}

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

    return {
      ...(baseTool ? cloneToolDescriptor(baseTool) : {}),
      name: managedTool?.name || baseTool?.name || null,
      description: managedTool?.description || baseTool?.description || "",
      inputSchema: JSON.parse(JSON.stringify(parsedSchema)),
      isReadOnly: baseTool?.isReadOnly ?? inferredReadOnly,
      riskLevel: normalizedRiskLevel,
      source: managedTool?.id
        ? `desktop-tool-manager:${managedTool.id}`
        : baseTool?.source || "desktop-core",
      managedMetadata: managedTool || null,
    };
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
    const normalizedRiskLevel = selectHigherRiskLevel(
      serverPolicy.securityLevel,
      mcpTool?.risk_level,
    );

    return {
      name: `mcp_${serverName}_${mcpTool?.name || "tool"}`,
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
      mcpMetadata: {
        serverName,
        trusted: serverPolicy.trusted === true,
        securityLevel: serverPolicy.securityLevel,
        requiredPermissions: serverPolicy.requiredPermissions || [],
        capabilities: serverPolicy.capabilities || [],
        originalToolName: mcpTool?.name || null,
        tool: mcpTool || null,
      },
    };
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

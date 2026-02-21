/**
 * UnifiedToolRegistry — 统一工具注册表
 *
 * Aggregates three tool systems (FunctionCaller, MCP, Skills) into a single
 * registry with Agent Skills metadata for every tool.
 *
 * @module UnifiedToolRegistry
 */

const { logger } = require("../utils/logger.js");
const { EventEmitter } = require("events");

class UnifiedToolRegistry extends EventEmitter {
  constructor() {
    super();

    /** @type {Map<string, UnifiedTool>} All tools keyed by normalized name */
    this.tools = new Map();

    /** @type {Map<string, SkillManifestEntry>} Skill manifests keyed by skill name */
    this.skills = new Map();

    /** @type {Object|null} FunctionCaller reference */
    this.functionCaller = null;

    /** @type {Object|null} MCPToolAdapter reference */
    this.mcpAdapter = null;

    /** @type {Object|null} SkillRegistry reference */
    this.skillRegistry = null;

    /** @type {Object|null} MCPSkillGenerator */
    this.mcpSkillGenerator = null;

    /** @type {Object|null} ToolSkillMapper */
    this.toolSkillMapper = null;

    this._initialized = false;

    /** @type {Promise|null} Guards against concurrent initialize() calls */
    this._initPromise = null;
  }

  // ===== Binding =====

  /**
   * Bind FunctionCaller to import built-in tools
   * @param {Object} fc - FunctionCaller instance
   */
  bindFunctionCaller(fc) {
    this.functionCaller = fc;
  }

  /**
   * Bind MCPToolAdapter to monitor MCP server connections
   * @param {Object} adapter - MCPToolAdapter instance
   */
  bindMCPAdapter(adapter) {
    this.mcpAdapter = adapter;
    if (adapter) {
      adapter.on?.("server-registered", ({ serverName, toolIds }) => {
        this._onMCPServerRegistered(serverName, toolIds);
      });
      adapter.on?.("server-unregistered", ({ serverName }) => {
        this._onMCPServerUnregistered(serverName);
      });
    }
  }

  /**
   * Bind SkillRegistry to read skill metadata
   * @param {Object} sr - SkillRegistry instance
   */
  bindSkillRegistry(sr) {
    this.skillRegistry = sr;

    // v1.1.0: Listen for skill registry changes to auto-refresh
    if (sr) {
      sr.on?.("skill-registered", () => this._onSkillRegistryUpdate());
      sr.on?.("skill-unregistered", () => this._onSkillRegistryUpdate());
      sr.on?.("skill-hot-loaded", () => this._onSkillRegistryUpdate());
      sr.on?.("skill-hot-unloaded", () => this._onSkillRegistryUpdate());
    }
  }

  // ===== v1.1.0: Execution API =====

  /**
   * Execute a tool by name, routing to the correct subsystem
   * @param {string} toolName - Tool name (normalized or raw)
   * @param {Object} params - Tool parameters
   * @param {Object} [context] - Execution context
   * @returns {Promise<any>} Execution result
   */
  async executeToolByName(toolName, params = {}, context = {}) {
    const normalized = this._normalizeToolName(toolName);
    const tool = this.tools.get(normalized);
    if (!tool) {
      throw new Error(`Tool not found: ${toolName}`);
    }

    // Route based on source
    if (tool.source === "builtin" && this.functionCaller) {
      if (typeof this.functionCaller.executeTool === "function") {
        return await this.functionCaller.executeTool(toolName, params, context);
      }
      if (typeof this.functionCaller.callFunction === "function") {
        return await this.functionCaller.callFunction(toolName, params);
      }
    }

    if (tool.source === "mcp" && this.mcpAdapter) {
      if (typeof this.mcpAdapter.callTool === "function") {
        return await this.mcpAdapter.callTool(toolName, params);
      }
    }

    if (tool.source === "skill-handler" && this.skillRegistry) {
      const skillName = tool.skillName || toolName;
      return await this.skillRegistry.executeSkill(skillName, params, context);
    }

    throw new Error(
      `No executor available for tool: ${toolName} (source: ${tool.source})`,
    );
  }

  /**
   * Get a bound executor function for a tool
   * @param {string} toolName
   * @returns {Function|null}
   */
  getToolExecutor(toolName) {
    const normalized = this._normalizeToolName(toolName);
    const tool = this.tools.get(normalized);
    if (!tool) {
      return null;
    }

    return (params, context) =>
      this.executeToolByName(toolName, params, context);
  }

  // ===== Initialization =====

  /**
   * Initialize the unified registry — aggregate all tools and build skill mappings.
   * Concurrent calls are coalesced: only one initialization runs at a time.
   */
  async initialize() {
    if (this._initPromise) {
      return this._initPromise;
    }
    this._initPromise = this._doInitialize();
    try {
      await this._initPromise;
    } finally {
      this._initPromise = null;
    }
  }

  /** @private */
  async _doInitialize() {
    if (this._initialized) {
      logger.warn("[UnifiedToolRegistry] Already initialized, refreshing...");
    }

    const startTime = Date.now();
    this.tools.clear();
    this.skills.clear();

    // Lazy-load dependencies
    try {
      const { MCPSkillGenerator } = require("../mcp/mcp-skill-generator");
      this.mcpSkillGenerator = new MCPSkillGenerator();
    } catch (e) {
      logger.warn(
        "[UnifiedToolRegistry] MCPSkillGenerator not available:",
        e.message,
      );
    }

    try {
      const { ToolSkillMapper } = require("./tool-skill-mapper");
      this.toolSkillMapper = new ToolSkillMapper();
    } catch (e) {
      logger.warn(
        "[UnifiedToolRegistry] ToolSkillMapper not available:",
        e.message,
      );
    }

    // Step 1: Import FunctionCaller built-in tools
    this._importFunctionCallerTools();

    // Step 2: Import MCP tools (already connected servers)
    this._importMCPTools();

    // Step 3: Import Skills metadata and build tool→skill mappings
    this._importSkills();

    // Step 4: Auto-group remaining tools via ToolSkillMapper
    this._autoGroupRemainingTools();

    this._initialized = true;

    const duration = Date.now() - startTime;
    logger.info(
      "[UnifiedToolRegistry] Initialized in %dms — %d tools, %d skills",
      duration,
      this.tools.size,
      this.skills.size,
    );

    this.emit("initialized", {
      toolCount: this.tools.size,
      skillCount: this.skills.size,
    });
  }

  // ===== Public API =====

  /**
   * Get all skill manifests
   * @returns {SkillManifestEntry[]}
   */
  getSkillManifest() {
    return Array.from(this.skills.values());
  }

  /**
   * Get tools formatted for LLM function-calling
   * @returns {Array} OpenAI-compatible tool definitions
   */
  getToolsForLLM() {
    const result = [];
    for (const tool of this.tools.values()) {
      if (!tool.available) {
        continue;
      }
      result.push({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters || {},
      });
    }
    return result;
  }

  /**
   * Get tool context (skill instructions/examples) for a specific tool
   * @param {string} toolName
   * @returns {Object|null} { tool, skill }
   */
  getToolContext(toolName) {
    const normalized = this._normalizeToolName(toolName);
    const tool = this.tools.get(normalized);
    if (!tool) {
      return null;
    }

    const skill = tool.skillName ? this.skills.get(tool.skillName) : null;
    return { tool, skill: skill || null };
  }

  /**
   * Get all tools belonging to a specific skill
   * @param {string} skillName
   * @returns {UnifiedTool[]}
   */
  getToolsBySkill(skillName) {
    const skill = this.skills.get(skillName);
    if (!skill) {
      return [];
    }
    return skill.toolNames.map((name) => this.tools.get(name)).filter(Boolean);
  }

  /**
   * Get all tools with their skill metadata
   * @returns {UnifiedTool[]}
   */
  getAllTools() {
    return Array.from(this.tools.values());
  }

  /**
   * Search tools by keyword across name, description, tags, and skill name
   * @param {string} keyword
   * @returns {UnifiedTool[]}
   */
  searchTools(keyword) {
    if (!keyword) {
      return this.getAllTools();
    }
    const kw = keyword.toLowerCase();
    const results = [];
    for (const tool of this.tools.values()) {
      let score = 0;
      if (tool.name.toLowerCase().includes(kw)) {
        score += 50;
      }
      if (tool.description?.toLowerCase().includes(kw)) {
        score += 20;
      }
      if (tool.skillName?.toLowerCase().includes(kw)) {
        score += 30;
      }
      if (tool.skillCategory?.toLowerCase().includes(kw)) {
        score += 25;
      }
      if (tool.tags?.some((t) => t.toLowerCase().includes(kw))) {
        score += 15;
      }
      if (score > 0) {
        results.push({ ...tool, _score: score });
      }
    }
    results.sort((a, b) => b._score - a._score);
    return results;
  }

  /**
   * Get summary statistics
   * @returns {Object}
   */
  getStats() {
    const bySource = { builtin: 0, mcp: 0, "skill-handler": 0 };
    const byCategory = {};
    for (const tool of this.tools.values()) {
      bySource[tool.source] = (bySource[tool.source] || 0) + 1;
      const cat = tool.skillCategory || "uncategorized";
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    }
    return {
      totalTools: this.tools.size,
      totalSkills: this.skills.size,
      bySource,
      byCategory,
    };
  }

  // ===== Private: Import Functions =====

  /**
   * Import tools from FunctionCaller
   * @private
   */
  _importFunctionCallerTools() {
    if (!this.functionCaller) {
      return;
    }

    let toolDefs = [];
    try {
      toolDefs =
        this.functionCaller.getAllToolDefinitions?.() ||
        this.functionCaller.getAvailableTools?.() ||
        [];
    } catch (e) {
      logger.warn(
        "[UnifiedToolRegistry] Failed to get FunctionCaller tools:",
        e.message,
      );
      return;
    }

    for (const def of toolDefs) {
      const name = this._normalizeToolName(def.name || def.function?.name);
      if (!name) {
        continue;
      }

      this.tools.set(name, {
        name,
        description: def.description || def.function?.description || "",
        parameters:
          def.parameters || def.function?.parameters || def.input_schema || {},
        source: "builtin",
        skillName: null,
        skillCategory: null,
        instructions: "",
        examples: [],
        tags: [],
        available: this.functionCaller.isToolAvailable?.(def.name) !== false,
      });
    }

    logger.info(
      "[UnifiedToolRegistry] Imported %d FunctionCaller tools",
      toolDefs.length,
    );
  }

  /**
   * Import tools from connected MCP servers
   * @private
   */
  _importMCPTools() {
    if (!this.mcpAdapter) {
      return;
    }

    let mcpTools = [];
    try {
      mcpTools = this.mcpAdapter.getMCPTools?.() || [];
    } catch (e) {
      logger.warn("[UnifiedToolRegistry] Failed to get MCP tools:", e.message);
      return;
    }

    // getMCPTools() returns {toolId, serverName, originalToolName} only.
    // Try to get richer metadata from FunctionCaller (which also has the tool registered).
    for (const mt of mcpTools) {
      const name = this._normalizeToolName(mt.toolId || mt.name);
      if (!name) {
        continue;
      }

      // Try to find the tool in FunctionCaller for description/parameters
      let description = "";
      let parameters = {};
      if (this.functionCaller) {
        const fcTools =
          this.functionCaller.getAllToolDefinitions?.() ||
          this.functionCaller.getAvailableTools?.() ||
          [];
        const fcTool = fcTools.find((t) => {
          const tName = t.name || t.function?.name;
          return tName === mt.toolId || tName === name;
        });
        if (fcTool) {
          description =
            fcTool.description || fcTool.function?.description || "";
          parameters =
            fcTool.parameters ||
            fcTool.function?.parameters ||
            fcTool.input_schema ||
            {};
        }
      }

      this.tools.set(name, {
        name,
        description: description || `MCP tool from ${mt.serverName}`,
        parameters,
        source: "mcp",
        skillName: null,
        skillCategory: "mcp",
        instructions: "",
        examples: [],
        tags: ["mcp", mt.serverName].filter(Boolean),
        available: true,
      });
    }

    // Auto-generate skills for each MCP server
    if (this.mcpSkillGenerator && mcpTools.length > 0) {
      const byServer = {};
      for (const mt of mcpTools) {
        const sn = mt.serverName;
        if (!byServer[sn]) {
          byServer[sn] = [];
        }
        byServer[sn].push(mt);
      }

      const catalogMap = {};
      try {
        const { BUILTIN_CATALOG } = require("../mcp/community-registry");
        for (const entry of BUILTIN_CATALOG) {
          catalogMap[entry.name] = entry;
        }
      } catch (e) {
        logger.warn(
          "[UnifiedToolRegistry] community-registry not available:",
          e.message,
        );
      }

      for (const [serverName, tools] of Object.entries(byServer)) {
        const catalogEntry = catalogMap[serverName] || null;
        // Enrich tool objects with description from the registry for skill generation
        const enrichedTools = tools.map((mt) => {
          const toolEntry = this.tools.get(this._normalizeToolName(mt.toolId));
          return {
            ...mt,
            description: toolEntry?.description || "",
            inputSchema: toolEntry?.parameters || {},
          };
        });
        const skillManifest = this.mcpSkillGenerator.generateSkillFromMCPServer(
          serverName,
          catalogEntry,
          enrichedTools,
        );
        this._registerSkillManifest(skillManifest);
      }
    }

    logger.info("[UnifiedToolRegistry] Imported %d MCP tools", mcpTools.length);
  }

  /**
   * Import skills from SkillRegistry and map tools
   * @private
   */
  _importSkills() {
    if (!this.skillRegistry) {
      return;
    }

    let allSkills = [];
    try {
      allSkills = this.skillRegistry.getAllSkills?.() || [];
    } catch (e) {
      logger.warn("[UnifiedToolRegistry] Failed to get skills:", e.message);
      return;
    }

    for (const skill of allSkills) {
      // MarkdownSkill properties: skillId (real name), name (displayName),
      // tools, instructions, examples, tags, source, version, category, description
      // BaseSkill properties: skillId, name, description, version, category

      // Normalize tool references from skill (MarkdownSkill has .tools array)
      const toolRefs = skill.tools || [];
      const toolNames = toolRefs.map((ref) => this._normalizeToolName(ref));

      const manifest = {
        name: skill.skillId || skill.name,
        displayName: skill.name || skill.skillId,
        description: skill.description || "",
        category: skill.category || "general",
        instructions: skill.instructions || "",
        examples: skill.examples || [],
        toolNames,
        source: "builtin-skill",
        version: skill.version || "1.0.0",
        tags: skill.tags || [],
      };

      this._registerSkillManifest(manifest);

      // Link existing tools to this skill
      for (const tn of toolNames) {
        const tool = this.tools.get(tn);
        if (tool) {
          tool.skillName = manifest.name;
          tool.skillCategory = manifest.category;
          tool.instructions = manifest.instructions;
          tool.examples = manifest.examples;
        }
      }
    }

    logger.info(
      "[UnifiedToolRegistry] Imported %d skills from SkillRegistry",
      allSkills.length,
    );
  }

  /**
   * Auto-group remaining tools (without a skill) via ToolSkillMapper
   * @private
   */
  _autoGroupRemainingTools() {
    if (!this.toolSkillMapper) {
      return;
    }

    const ungrouped = [];
    for (const tool of this.tools.values()) {
      if (!tool.skillName) {
        ungrouped.push(tool);
      }
    }

    if (ungrouped.length === 0) {
      return;
    }

    const mappings = this.toolSkillMapper.mapTools(ungrouped);

    for (const mapping of mappings) {
      // Register the auto-generated skill
      this._registerSkillManifest(mapping.skill);

      // Link tools to skill
      for (const toolName of mapping.skill.toolNames) {
        const tool = this.tools.get(toolName);
        if (tool) {
          tool.skillName = mapping.skill.name;
          tool.skillCategory = mapping.skill.category;
          tool.instructions = mapping.skill.instructions;
          tool.examples = mapping.skill.examples;
        }
      }
    }

    logger.info(
      "[UnifiedToolRegistry] Auto-grouped %d tools into %d skills",
      ungrouped.length,
      mappings.length,
    );
  }

  // ===== Private: MCP Events =====

  /**
   * Handle MCP server registration
   * @private
   */
  _onMCPServerRegistered(serverName, toolIds) {
    if (!this._initialized) {
      return;
    }

    logger.info(
      "[UnifiedToolRegistry] MCP server registered: %s (%d tools)",
      serverName,
      toolIds?.length,
    );

    // Re-import MCP tools to pick up the new server
    this._importMCPTools();

    this.emit("tools-updated", { reason: "mcp-server-registered", serverName });
  }

  /**
   * Handle MCP server unregistration
   * @private
   */
  _onMCPServerUnregistered(serverName) {
    if (!this._initialized) {
      return;
    }

    // Remove tools belonging to this server
    // Normalize the prefix to handle server names with hyphens (e.g., "brave-search" → "brave_search")
    const prefix = `mcp_${this._normalizeToolName(serverName)}_`;
    const toDelete = [];
    for (const [name] of this.tools) {
      if (name.startsWith(prefix)) {
        toDelete.push(name);
      }
    }
    for (const name of toDelete) {
      this.tools.delete(name);
    }

    // Remove the auto-generated skill
    const skillName = `mcp-${serverName}`;
    this.skills.delete(skillName);

    logger.info(
      "[UnifiedToolRegistry] MCP server unregistered: %s",
      serverName,
    );
    this.emit("tools-updated", {
      reason: "mcp-server-unregistered",
      serverName,
    });
  }

  // ===== Private: Helpers =====

  /**
   * Handle SkillRegistry updates — re-import skills (v1.1.0)
   * @private
   */
  _onSkillRegistryUpdate() {
    if (!this._initialized) {
      return;
    }

    // Debounce: skip if called within 500ms
    if (this._lastSkillUpdate && Date.now() - this._lastSkillUpdate < 500) {
      return;
    }
    this._lastSkillUpdate = Date.now();

    logger.info(
      "[UnifiedToolRegistry] SkillRegistry updated, refreshing skills...",
    );
    this._importSkills();
    this.emit("tools-updated", { reason: "skill-registry-update" });
  }

  /**
   * Normalize tool name: replace hyphens with underscores
   * @param {string} ref - Tool reference (e.g., "browser-click")
   * @returns {string} Normalized name (e.g., "browser_click")
   */
  _normalizeToolName(ref) {
    if (!ref) {
      return "";
    }
    return ref.replace(/-/g, "_");
  }

  /**
   * Register a SkillManifestEntry
   * @param {SkillManifestEntry} manifest
   * @private
   */
  _registerSkillManifest(manifest) {
    if (!manifest || !manifest.name) {
      return;
    }
    this.skills.set(manifest.name, manifest);
  }
}

module.exports = { UnifiedToolRegistry };

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
const {
  getCodingAgentToolContract,
} = require("../../../../packages/cli/src/runtime/coding-agent-contract-shared.cjs");

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function humanizeToolName(name) {
  return String(name || "")
    .trim()
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function inferCategory({
  contract,
  explicitCategory,
  skillCategory,
  source,
  isReadOnly,
}) {
  if (contract?.category) {
    return contract.category;
  }
  // Explicit category on the raw descriptor wins over inference rules so that
  // canonical tools can self-report their category without relying on
  // read-only / source heuristics.
  if (explicitCategory) {
    return explicitCategory;
  }
  if (skillCategory && skillCategory !== "mcp") {
    return skillCategory;
  }
  if (isReadOnly) {
    return "read";
  }
  if (source === "mcp") {
    return "execute";
  }
  if (source === "skill-handler") {
    return "skill";
  }
  return "execute";
}

function buildPermissions({ source, isReadOnly, contract }) {
  if (contract?.permissions) {
    return cloneValue(contract.permissions);
  }

  const scopes = [];
  if (source === "mcp") {
    scopes.push("mcp:invoke");
  } else if (source === "skill-handler") {
    scopes.push("skill:execute");
  } else {
    scopes.push("tool:execute");
  }

  return {
    level: isReadOnly ? "readonly" : "standard",
    scopes,
  };
}

function buildTelemetry({
  name,
  source,
  category,
  contract,
  tags = [],
  rawTelemetry,
}) {
  // Merge precedence: contract.telemetry (trusted) > raw.telemetry (caller)
  // > synthesized defaults. Tags from all sources are unioned so authors
  // can add labels without clobbering category / source telemetry.
  const base = contract?.telemetry
    ? cloneValue(contract.telemetry)
    : rawTelemetry
      ? cloneValue(rawTelemetry)
      : { category };

  const mergedTags = new Set([
    ...(base.tags || []),
    `tool:${name}`,
    `source:${source}`,
    ...tags,
  ]);
  base.tags = Array.from(mergedTags);
  if (!base.category) {
    base.category = category;
  }
  return base;
}

function createUnifiedToolDescriptor(raw = {}) {
  const contract = getCodingAgentToolContract(raw.name);
  const inputSchema = raw.inputSchema ||
    raw.parameters || { type: "object", properties: {} };
  const isReadOnly =
    raw.isReadOnly === true || contract?.isReadOnly === true || false;
  const riskLevel =
    raw.riskLevel || contract?.riskLevel || (isReadOnly ? "low" : "medium");
  const category = inferCategory({
    contract,
    explicitCategory: raw.category,
    skillCategory: raw.skillCategory,
    source: raw.source,
    isReadOnly,
  });

  return {
    name: raw.name,
    title: raw.title || contract?.title || humanizeToolName(raw.name),
    kind: raw.kind || contract?.kind || raw.source || "custom",
    description: raw.description || contract?.description || "",
    inputSchema: cloneValue(inputSchema),
    parameters: cloneValue(inputSchema),
    source: raw.source || "builtin",
    available: raw.available !== false,
    isReadOnly,
    riskLevel,
    category,
    availableInPlanMode:
      typeof raw.availableInPlanMode === "boolean"
        ? raw.availableInPlanMode
        : contract?.availableInPlanMode || isReadOnly,
    planModeBehavior:
      raw.planModeBehavior ||
      contract?.planModeBehavior ||
      (isReadOnly ? "allow" : "blocked"),
    requiresPlanApproval:
      typeof raw.requiresPlanApproval === "boolean"
        ? raw.requiresPlanApproval
        : contract?.requiresPlanApproval ||
          (!isReadOnly && riskLevel !== "low"),
    requiresConfirmation:
      typeof raw.requiresConfirmation === "boolean"
        ? raw.requiresConfirmation
        : contract?.requiresConfirmation || false,
    approvalFlow: raw.approvalFlow || contract?.approvalFlow || "policy",
    permissions: buildPermissions({
      source: raw.source,
      isReadOnly,
      contract,
    }),
    telemetry: buildTelemetry({
      name: raw.name,
      source: raw.source || "builtin",
      category,
      contract,
      tags: raw.tags || [],
      rawTelemetry: raw.telemetry,
    }),
    skillName: raw.skillName || null,
    skillCategory: raw.skillCategory || null,
    instructions: raw.instructions || "",
    examples: Array.isArray(raw.examples) ? [...raw.examples] : [],
    tags: Array.isArray(raw.tags) ? [...raw.tags] : [],
    executorKey: raw.executorKey || raw.name,
    skillHandlerId: raw.skillHandlerId || null,
  };
}

function cloneToolDescriptor(tool) {
  return tool ? cloneValue(tool) : null;
}

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
      // v5.0.2.10: per-skill granular invalidation when event payload
      // includes the skill name; falls back to full invalidation when
      // the upstream emitter doesn't supply one.
      sr.on?.("skill-registered", (e) =>
        this._onSkillRegistryUpdate(e?.skillName || e?.name),
      );
      sr.on?.("skill-unregistered", (e) =>
        this._onSkillRegistryUpdate(e?.skillName || e?.name),
      );
      sr.on?.("skill-hot-loaded", (e) =>
        this._onSkillRegistryUpdate(e?.skillName || e?.name),
      );
      sr.on?.("skill-hot-unloaded", (e) =>
        this._onSkillRegistryUpdate(e?.skillName || e?.name),
      );
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
  async initialize(options = {}) {
    if (this._initPromise) {
      return this._initPromise;
    }
    this._initPromise = this._doInitialize(options);
    try {
      await this._initPromise;
    } finally {
      this._initPromise = null;
    }
  }

  /** @private */
  async _doInitialize(options = {}) {
    // `deferSkills: true` skips the synchronous skill import so callers
    // (e.g., production startup) get a fast path; tests and direct-Map
    // consumers omit it to keep the original eager contract.
    const deferSkills = options.deferSkills === true;
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

    // Step 1: Import FunctionCaller built-in tools (cheap, synchronous)
    this._importFunctionCallerTools();

    // Step 2: Import MCP tools (already connected servers)
    this._importMCPTools();

    this._initialized = true;
    this._skillsImported = false;

    if (deferSkills) {
      const fastDuration = Date.now() - startTime;
      logger.info(
        "[UnifiedToolRegistry] Fast init in %dms — %d tools (skills deferred)",
        fastDuration,
        this.tools.size,
      );
      // Background-import on next tick; first reader still pays cost only
      // if it arrives before the timer fires.
      this._skillsImportPromise = new Promise((resolve) => {
        setImmediate(() => {
          try {
            this._ensureSkillsImported();
          } finally {
            resolve();
          }
        });
      });
    } else {
      // Eager path: preserve the original blocking contract. Direct Map
      // access (`registry.skills.has(...)`, `registry.tools.get(...)`) and
      // tests that don't go through the public read API rely on this.
      this._ensureSkillsImported();
      const duration = Date.now() - startTime;
      logger.info(
        "[UnifiedToolRegistry] Initialized in %dms — %d tools, %d skills",
        duration,
        this.tools.size,
        this.skills.size,
      );
    }

    this.emit("initialized", {
      toolCount: this.tools.size,
      skillCount: this.skills.size,
    });
  }

  /**
   * Synchronously import skills + auto-group on first read. Idempotent.
   * @private
   */
  _ensureSkillsImported() {
    if (this._skillsImported) {
      return;
    }
    this._skillsImported = true;
    const t0 = Date.now();
    this._importSkills();
    this._autoGroupRemainingTools();
    logger.info(
      "[UnifiedToolRegistry] Skills imported in %dms — %d skills total",
      Date.now() - t0,
      this.skills.size,
    );
    this.emit("skills-ready", { skillCount: this.skills.size });
  }

  // ===== Public API =====

  /**
   * Get all skill manifests
   * @returns {SkillManifestEntry[]}
   */
  getSkillManifest() {
    this._ensureSkillsImported();
    return Array.from(this.skills.values()).map((skill) => cloneValue(skill));
  }

  /**
   * Get tools formatted for LLM function-calling
   * @param {Object} [options]
   * @param {string|string[]} [options.activeSkillNames] — if provided, only tools
   *   belonging to these skills (plus tools in `alwaysAvailable`) are returned.
   *   Omit or pass null for the legacy full-list behavior.
   * @param {string[]} [options.alwaysAvailable] — tool names that must pass through
   *   the filter regardless of skill (e.g., core file ops). Normalized.
   * @returns {Array} OpenAI-compatible tool definitions
   */
  getToolsForLLM(options = {}) {
    this._ensureSkillsImported();
    const { activeSkillNames = null, alwaysAvailable = [] } = options;

    let allowedToolNames = null;
    if (activeSkillNames) {
      const skillList = Array.isArray(activeSkillNames)
        ? activeSkillNames
        : [activeSkillNames];
      allowedToolNames = new Set();
      for (const skillName of skillList) {
        const skill = this.skills.get(skillName);
        if (skill?.toolNames) {
          for (const n of skill.toolNames) {
            allowedToolNames.add(n);
          }
        }
      }
      for (const n of alwaysAvailable) {
        allowedToolNames.add(this._normalizeToolName(n));
      }
    }

    const result = [];
    for (const tool of this.tools.values()) {
      if (!tool.available) {
        continue;
      }
      if (allowedToolNames && !allowedToolNames.has(tool.name)) {
        continue;
      }
      result.push({
        name: tool.name,
        description: tool.description,
        parameters: cloneValue(tool.inputSchema || tool.parameters || {}),
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
    this._ensureSkillsImported();
    const normalized = this._normalizeToolName(toolName);
    const tool = this.tools.get(normalized);
    if (!tool) {
      return null;
    }

    const skill = tool.skillName ? this.skills.get(tool.skillName) : null;
    return {
      tool: cloneToolDescriptor(tool),
      skill: skill ? cloneValue(skill) : null,
    };
  }

  /**
   * Get all tools belonging to a specific skill
   * @param {string} skillName
   * @returns {UnifiedTool[]}
   */
  getToolsBySkill(skillName) {
    this._ensureSkillsImported();
    const skill = this.skills.get(skillName);
    if (!skill) {
      return [];
    }
    return skill.toolNames
      .map((name) => this.tools.get(name))
      .filter(Boolean)
      .map((tool) => cloneToolDescriptor(tool));
  }

  /**
   * Get all tools with their skill metadata
   * @returns {UnifiedTool[]}
   */
  getAllTools() {
    this._ensureSkillsImported();
    return Array.from(this.tools.values()).map((tool) =>
      cloneToolDescriptor(tool),
    );
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
        results.push({ ...cloneToolDescriptor(tool), _score: score });
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
      const cat = tool.category || tool.skillCategory || "uncategorized";
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

      this.tools.set(
        name,
        createUnifiedToolDescriptor({
          // Forward ALL canonical fields from FunctionCaller — `getAllToolDefinitions()`
          // already emits canonical-shaped descriptors via `buildMaskingPayload()`.
          ...def,
          name,
          description: def.description || def.function?.description || "",
          // Canonical read order: prefer `inputSchema`, then fall back to
          // legacy `parameters` / OpenAI-wrapped `function.parameters` /
          // Claude-style `input_schema`.
          inputSchema:
            def.inputSchema ||
            def.parameters ||
            def.function?.parameters ||
            def.input_schema ||
            {},
          source: "builtin",
          skillName: def.skillName || null,
          skillCategory: def.skillCategory || null,
          instructions: def.instructions || "",
          examples: Array.isArray(def.examples) ? def.examples : [],
          tags: Array.isArray(def.tags)
            ? Array.from(new Set([...def.tags, "source:builtin"]))
            : ["source:builtin"],
          available: this.functionCaller.isToolAvailable?.(def.name) !== false,
        }),
      );
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
          // Canonical read order: inputSchema → legacy parameters → input_schema
          parameters =
            fcTool.inputSchema ||
            fcTool.parameters ||
            fcTool.function?.parameters ||
            fcTool.input_schema ||
            {};
        }
      }

      this.tools.set(
        name,
        createUnifiedToolDescriptor({
          name,
          description: description || `MCP tool from ${mt.serverName}`,
          inputSchema: parameters,
          source: "mcp",
          kind: "mcp",
          skillName: null,
          skillCategory: "mcp",
          instructions: "",
          examples: [],
          tags: ["mcp", mt.serverName, `server:${mt.serverName}`].filter(
            Boolean,
          ),
          available: true,
        }),
      );
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
            inputSchema: cloneValue(
              toolEntry?.inputSchema || toolEntry?.parameters || {},
            ),
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
          // Drop the previously-inferred `category` so that skill-driven
          // re-classification re-runs `inferCategory` with the new
          // `skillCategory`. Without this, the old inferred value (e.g.
          // "execute") would be treated as an explicit override.
          const { category: _priorCategory, ...toolWithoutCategory } = tool;
          void _priorCategory;
          this.tools.set(
            tn,
            createUnifiedToolDescriptor({
              ...toolWithoutCategory,
              skillName: manifest.name,
              skillCategory: manifest.category,
              instructions: manifest.instructions,
              examples: manifest.examples,
              tags: Array.from(
                new Set([
                  ...(tool.tags || []),
                  `skill:${manifest.name}`,
                  `category:${manifest.category}`,
                ]),
              ),
            }),
          );
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
          // Drop prior inferred `category` so skill-driven re-classification
          // re-runs through `inferCategory`.
          const { category: _priorCategory, ...toolWithoutCategory } = tool;
          void _priorCategory;
          this.tools.set(
            toolName,
            createUnifiedToolDescriptor({
              ...toolWithoutCategory,
              skillName: mapping.skill.name,
              skillCategory: mapping.skill.category,
              instructions: mapping.skill.instructions,
              examples: mapping.skill.examples,
              tags: Array.from(
                new Set([
                  ...(tool.tags || []),
                  `skill:${mapping.skill.name}`,
                  `category:${mapping.skill.category}`,
                ]),
              ),
            }),
          );
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
  _onSkillRegistryUpdate(skillName) {
    if (!this._initialized) {
      return;
    }

    // Debounce: skip if called within 500ms
    if (this._lastSkillUpdate && Date.now() - this._lastSkillUpdate < 500) {
      return;
    }
    this._lastSkillUpdate = Date.now();

    if (
      skillName &&
      typeof skillName === "string" &&
      this.skills.has(skillName)
    ) {
      // Granular invalidation: drop just this skill + its bound tools.
      // Next read API call will re-import only this skill via the
      // existing _ensureSkillsImported path (which is idempotent and
      // re-reads the registry).
      const skill = this.skills.get(skillName);
      if (skill && Array.isArray(skill.toolNames)) {
        for (const tn of skill.toolNames) {
          const norm = this._normalizeToolName(tn);
          const t = this.tools.get(norm);
          if (t && t.skillName === skillName) {
            // Strip skill metadata; keep the underlying tool entry
            delete t.skillName;
            delete t.instructions;
            delete t.examples;
          }
        }
      }
      this.skills.delete(skillName);
      this._skillsImported = false; // re-import to pick up the new state
      logger.info(
        `[UnifiedToolRegistry] Granular invalidation for skill "${skillName}"`,
      );
      this.emit("tools-updated", {
        reason: "skill-update",
        skillName,
      });
      return;
    }

    logger.info(
      "[UnifiedToolRegistry] SkillRegistry updated, refreshing skills...",
    );
    // Force a re-import on next read; cheaper than running it eagerly.
    this._skillsImported = false;
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

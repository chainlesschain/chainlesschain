/**
 * AgentDefinition — Agent 定义(不可变)与运行时分离
 *
 * 对标 Managed Agents 的 agents.create() 设计:
 * - 一次定义,多次 session 复用
 * - 预编译 tool schema,避免每次 session 重新 parse
 * - 定义不可变,变更需要新建 AgentDefinition
 *
 * 与 Skill 的关系:
 * - Skill(SKILL.md)仍然是技能定义的源
 * - AgentDefinition 是从 Skill 预编译出的"运行时就绪"产物
 * - 一个 Skill 可以派生多个 AgentDefinition(不同 approvalPolicy / model)
 */

const crypto = require("crypto");

function generateAgentId() {
  return `agent_${crypto.randomBytes(8).toString("hex")}`;
}

/**
 * 规范化 tool schema(fallback 链: inputSchema → parameters → empty)
 */
function normalizeToolSchema(tool) {
  const schema =
    tool.inputSchema ||
    tool.parameters ||
    { type: "object", properties: {} };
  return {
    name: tool.name,
    description: tool.description || "",
    inputSchema: schema,
    parameters: schema, // legacy mirror
    riskLevel: tool.riskLevel || "low",
    isReadOnly: !!tool.isReadOnly,
    availableInPlanMode: tool.availableInPlanMode !== false,
    requiresPlanApproval: !!tool.requiresPlanApproval,
  };
}

class AgentDefinition {
  constructor({
    agentId,
    name,
    description = "",
    systemPrompt = "",
    model = null,
    category = null,
    tools = [],
    skillName = null,
    approvalPolicy = "strict",
    metadata = {},
  } = {}) {
    if (!name || typeof name !== "string") {
      throw new Error("AgentDefinition: name is required");
    }

    this.agentId = agentId || generateAgentId();
    this.name = name;
    this.description = description;
    this.systemPrompt = systemPrompt;
    this.model = model;
    this.category = category;
    this.skillName = skillName;
    this.approvalPolicy = approvalPolicy;
    this.metadata = { ...metadata };

    // 预编译 tools — 规范化后存入 Map
    this._toolsMap = new Map();
    for (const t of tools) {
      if (!t || !t.name) continue;
      this._toolsMap.set(t.name, Object.freeze(normalizeToolSchema(t)));
    }

    // 冻结顶层属性(metadata 内容保留可变,结构不可变)
    Object.freeze(this._toolsMap);
    this.createdAt = Date.now();
    this._hash = this._computeHash();
    Object.freeze(this);
  }

  /**
   * 返回所有工具的 schema(用于传给 LLM function-calling)
   */
  getToolSchemas() {
    return Array.from(this._toolsMap.values());
  }

  /**
   * 查单个工具
   */
  getTool(name) {
    return this._toolsMap.get(name) || null;
  }

  hasTool(name) {
    return this._toolsMap.has(name);
  }

  listToolNames() {
    return Array.from(this._toolsMap.keys());
  }

  /**
   * 定义指纹(用于缓存失效判断)
   */
  getHash() {
    return this._hash;
  }

  _computeHash() {
    const material = JSON.stringify({
      name: this.name,
      systemPrompt: this.systemPrompt,
      model: this.model,
      category: this.category,
      tools: this.listToolNames().sort(),
    });
    return crypto.createHash("sha256").update(material).digest("hex").slice(0, 16);
  }

  /**
   * 从 Skill 对象派生(预编译入口)
   */
  static fromSkill(skill, overrides = {}) {
    if (!skill || !skill.name) {
      throw new Error("AgentDefinition.fromSkill: skill with name required");
    }

    // Skill 的 tools 字段可能是工具名数组,需要 overrides.toolResolver 解析
    const resolvedTools = overrides.tools || [];

    return new AgentDefinition({
      name: skill.name,
      description: skill.description || "",
      systemPrompt:
        overrides.systemPrompt ||
        skill.instructions ||
        skill.prompt ||
        "",
      model: overrides.model || skill.model || null,
      category: overrides.category || skill.category || null,
      tools: resolvedTools,
      skillName: skill.name,
      approvalPolicy: overrides.approvalPolicy || "strict",
      metadata: {
        skillVersion: skill.version || "1.0.0",
        ...(skill.metadata || {}),
        ...(overrides.metadata || {}),
      },
    });
  }
}

/**
 * AgentDefinitionCache — hash-based 缓存,避免重复预编译
 */
class AgentDefinitionCache {
  constructor({ maxEntries = 200 } = {}) {
    this.maxEntries = maxEntries;
    this._byId = new Map();
    this._byHash = new Map();
    this._byName = new Map(); // name → latest agentId
  }

  /**
   * 注册/去重:相同 hash 直接返回缓存
   */
  register(definition) {
    if (!(definition instanceof AgentDefinition)) {
      throw new Error("register: AgentDefinition instance required");
    }
    const hash = definition.getHash();
    if (this._byHash.has(hash)) {
      return this._byHash.get(hash);
    }

    if (this._byId.size >= this.maxEntries) {
      const oldestId = this._byId.keys().next().value;
      this._evict(oldestId);
    }

    this._byId.set(definition.agentId, definition);
    this._byHash.set(hash, definition);
    this._byName.set(definition.name, definition.agentId);
    return definition;
  }

  get(agentId) {
    return this._byId.get(agentId) || null;
  }

  getByName(name) {
    const id = this._byName.get(name);
    return id ? this._byId.get(id) : null;
  }

  has(agentId) {
    return this._byId.has(agentId);
  }

  _evict(agentId) {
    const def = this._byId.get(agentId);
    if (!def) return;
    this._byId.delete(agentId);
    this._byHash.delete(def.getHash());
    if (this._byName.get(def.name) === agentId) {
      this._byName.delete(def.name);
    }
  }

  remove(agentId) {
    this._evict(agentId);
  }

  clear() {
    this._byId.clear();
    this._byHash.clear();
    this._byName.clear();
  }

  size() {
    return this._byId.size;
  }

  list() {
    return Array.from(this._byId.values());
  }
}

module.exports = {
  AgentDefinition,
  AgentDefinitionCache,
  normalizeToolSchema,
  generateAgentId,
};

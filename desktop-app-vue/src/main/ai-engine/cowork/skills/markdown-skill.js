/**
 * MarkdownSkill - 基于 SKILL.md 的技能实现
 *
 * 继承 BaseSkill，支持从 SKILL.md 定义创建技能实例。
 *
 * @module ai-engine/cowork/skills/markdown-skill
 */

const path = require("path");
const { BaseSkill } = require("./base-skill");
const { logger } = require("../../../utils/logger.js");

/**
 * MarkdownSkill 类
 */
class MarkdownSkill extends BaseSkill {
  /**
   * 从 SkillDefinition 创建技能实例
   * @param {object} definition - SkillDefinition（由 SkillMdParser 解析）
   */
  constructor(definition) {
    super({
      skillId: definition.name,
      name: definition.displayName || definition.name,
      description: definition.description,
      version: definition.version,
      category: definition.category,
      capabilities: definition.capabilities || [],
      supportedFileTypes: definition.supportedFileTypes || [],
      config: {
        enabled: definition.enabled !== false,
      },
    });

    // 存储原始定义
    this.definition = definition;

    // 来源信息
    this.source = definition.source;
    this.sourcePath = definition.sourcePath;

    // 用户可调用标志
    this.userInvocable = definition.userInvocable;
    this.hidden = definition.hidden;

    // 标签
    this.tags = definition.tags || [];

    // handler 模块（延迟加载）
    this._handler = null;
    this._handlerLoaded = false;
  }

  /**
   * 检查是否可以处理任务
   * @override
   * @param {object} task - 任务对象
   * @returns {number} 匹配分数 (0-100)
   */
  canHandle(task) {
    if (!this.config.enabled) {
      return 0;
    }

    let score = super.canHandle(task);

    // 如果有 handler，增加分数
    if (this.definition.handler) {
      score += 10;
    }

    // 基于标签匹配
    if (task.tags && this.tags.length > 0) {
      const matchedTags = task.tags.filter((t) => this.tags.includes(t));
      score += matchedTags.length * 5;
    }

    return Math.min(100, score);
  }

  /**
   * 执行技能
   * @override
   * @param {object} task - 任务对象
   * @param {object} context - 执行上下文
   * @returns {Promise<object>}
   */
  async execute(task, context = {}) {
    // 如果有 handler，加载并执行
    if (this.definition.handler) {
      const handler = await this._loadHandler();

      if (handler && typeof handler.execute === "function") {
        return await handler.execute(task, context, this);
      }

      if (typeof handler === "function") {
        return await handler(task, context, this);
      }

      throw new Error(
        `Handler at ${this.definition.handler} does not export execute function`,
      );
    }

    // 没有 handler 的纯文档型技能，返回说明信息
    return {
      success: true,
      type: "documentation",
      skillId: this.skillId,
      name: this.name,
      description: this.description,
      body: this.definition.body,
      message: `Skill '${this.name}' is a documentation-only skill. See body for instructions.`,
    };
  }

  /**
   * 延迟加载 handler 模块
   * @private
   * @returns {Promise<object|function>}
   */
  async _loadHandler() {
    if (this._handlerLoaded) {
      return this._handler;
    }

    if (!this.definition.handler) {
      this._handlerLoaded = true;
      return null;
    }

    try {
      // handler 路径相对于 SKILL.md 所在目录
      const skillDir = path.dirname(this.sourcePath);
      const handlerPath = path.resolve(skillDir, this.definition.handler);

      this._log(`Loading handler from: ${handlerPath}`);

      // 清除 require 缓存以支持热重载
      delete require.cache[require.resolve(handlerPath)];

      this._handler = require(handlerPath);
      this._handlerLoaded = true;

      // 如果 handler 有 init 方法，调用它
      if (this._handler && typeof this._handler.init === "function") {
        await this._handler.init(this);
      }

      return this._handler;
    } catch (error) {
      this._log(`Failed to load handler: ${error.message}`, "error");
      this._handlerLoaded = true;
      throw error;
    }
  }

  /**
   * 重新加载 handler（支持热重载）
   * @returns {Promise<void>}
   */
  async reloadHandler() {
    this._handler = null;
    this._handlerLoaded = false;
    await this._loadHandler();
    this._log("Handler reloaded");
  }

  /**
   * 获取技能信息
   * @override
   * @returns {object}
   */
  getInfo() {
    return {
      ...super.getInfo(),
      source: this.source,
      sourcePath: this.sourcePath,
      userInvocable: this.userInvocable,
      hidden: this.hidden,
      tags: this.tags,
      hasHandler: !!this.definition.handler,
      hasBody: !!this.definition.body,
      requires: this.definition.requires,
      os: this.definition.os,
    };
  }

  /**
   * 获取 Markdown 正文
   * @returns {string}
   */
  getBody() {
    return this.definition.body || "";
  }

  /**
   * 获取原始定义
   * @returns {object}
   */
  getDefinition() {
    return this.definition;
  }
}

module.exports = { MarkdownSkill };

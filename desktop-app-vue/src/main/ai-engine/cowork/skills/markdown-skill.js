/**
 * MarkdownSkill - 基于 SKILL.md 的技能实现
 *
 * 继承 BaseSkill，支持从 SKILL.md 定义创建技能实例。
 *
 * @module ai-engine/cowork/skills/markdown-skill
 */

const { BaseSkill } = require("./base-skill");
const {
  assertSkillHandlerExecution,
  captureExternalHandlerSource,
} = require("./skill-execution-security");
const {
  isGovernedSkillExecutionAuthority,
  captureGovernedSkillHandlerSource,
} = require("./governed-skill-execution");

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

    // Agent Skills Open Standard fields
    this.tools = definition.tools || [];
    this.instructions = definition.instructions || "";
    this.examples = definition.examples || [];
    this.dependencies = definition.dependencies || [];
    this.inputSchema = definition.inputSchema || null;
    this.outputSchema = definition.outputSchema || null;
    this.author = definition.author || "";
    this.executionCapabilities = definition.executionCapabilities || [];

    // Host-assigned execution authority. The loader attaches these values
    // after parsing, so untrusted frontmatter cannot replace them.
    this._executionSecurity = definition._executionSecurity || null;
    this._skillSecurityPolicy = definition._skillSecurityPolicy || {};
    this._externalHandlerExecutor =
      typeof definition._externalHandlerExecutor === "function"
        ? definition._externalHandlerExecutor
        : null;
    this._governedExecutionAuthority =
      definition._governedExecutionAuthority || null;

    // handler 模块（延迟加载）
    this._handler = null;
    this._handlerLoaded = false;

    // Lazy loading support (v1.1.0)
    this._bodyLoaded = !definition._isStub;
  }

  /**
   * 确保技能已完整加载（懒加载支持）
   * 首次访问 body/handler 时触发完整解析
   * @returns {Promise<void>}
   */
  async ensureFullyLoaded() {
    if (this._bodyLoaded) {
      return;
    }

    if (!this.sourcePath || this.sourcePath === "unknown") {
      this._bodyLoaded = true;
      return;
    }

    try {
      const { SkillMdParser } = require("./skill-md-parser");
      const parser = new SkillMdParser({ strictValidation: false });
      const fullDefinition = await parser.parseFile(this.sourcePath);

      // Merge full definition into this instance
      this.definition = {
        ...this.definition,
        ...fullDefinition,
        _isStub: false,
      };
      this.tools = fullDefinition.tools || this.tools;
      this.instructions = fullDefinition.instructions || this.instructions;
      this.examples = fullDefinition.examples || this.examples;
      this.dependencies = fullDefinition.dependencies || this.dependencies;
      this.inputSchema = fullDefinition.inputSchema || this.inputSchema;
      this.outputSchema = fullDefinition.outputSchema || this.outputSchema;
      this.executionCapabilities =
        fullDefinition.executionCapabilities || this.executionCapabilities;

      this._bodyLoaded = true;
      this._log("Fully loaded (lazy)");
    } catch (error) {
      this._bodyLoaded = true; // Prevent infinite retries
      this._log(
        `Failed to lazy-load full definition: ${error.message}`,
        "error",
      );
    }
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
    // Ensure full definition is loaded (lazy loading support)
    await this.ensureFullyLoaded();

    // 如果有 handler，加载并执行
    if (this.definition.handler) {
      if (isGovernedSkillExecutionAuthority(this._governedExecutionAuthority)) {
        if (!this._externalHandlerExecutor) {
          const error = new Error(
            `Governed skill "${this.skillId}" requires the isolated executor`,
          );
          error.name = "SkillExecutionSecurityError";
          error.code = "CC_SKILL_GOVERNED_HANDLER_ISOLATION_REQUIRED";
          throw error;
        }
        const authority = this._governedExecutionAuthority;
        return await this._externalHandlerExecutor({
          skillId: this.skillId,
          source: "governed",
          handlerFileName: authority.handlerRelativePath,
          handlerSource: captureGovernedSkillHandlerSource(authority),
          contentDigest: authority.executorContentDigest,
          publicKeySha256: authority.publicKeySha256,
          executionCapabilities: [...authority.executionCapabilities],
          task,
          context,
        });
      }
      const authority = assertSkillHandlerExecution(
        this.definition,
        this._executionSecurity,
        this._skillSecurityPolicy,
      );
      this._executionSecurity = authority;
      this.definition._executionSecurity = authority;

      if (!authority.packageOwned) {
        if (!this._externalHandlerExecutor) {
          const error = new Error(
            `External skill "${this.skillId}" cannot load its handler into Electron main; an isolated executor is required`,
          );
          error.name = "SkillExecutionSecurityError";
          error.code = "CC_SKILL_EXTERNAL_HANDLER_ISOLATION_REQUIRED";
          throw error;
        }
        const handlerSource = captureExternalHandlerSource(authority);
        return await this._externalHandlerExecutor({
          skillId: this.skillId,
          source: this.source,
          handlerFileName: authority.handlerRelativePath,
          handlerSource,
          contentDigest: authority.contentDigest,
          publicKeySha256: authority.publicKeySha256,
          executionCapabilities: [...authority.executionCapabilities],
          task,
          context,
        });
      }

      const handler = await this._loadHandler(authority);

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
  async _loadHandler(authority = null) {
    if (this._handlerLoaded) {
      return this._handler;
    }

    if (!this.definition.handler) {
      this._handlerLoaded = true;
      return null;
    }

    try {
      const executionAuthority =
        authority ||
        assertSkillHandlerExecution(
          this.definition,
          this._executionSecurity,
          this._skillSecurityPolicy,
        );
      if (!executionAuthority.packageOwned) {
        const error = new Error(
          "External skill handlers must use the isolated executor",
        );
        error.name = "SkillExecutionSecurityError";
        error.code = "CC_SKILL_EXTERNAL_HANDLER_ISOLATION_REQUIRED";
        throw error;
      }
      const handlerPath = executionAuthority.handlerRealPath;

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
    const authority = assertSkillHandlerExecution(
      this.definition,
      this._executionSecurity,
      this._skillSecurityPolicy,
    );
    await this._loadHandler(authority);
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
      // Agent Skills Open Standard
      tools: this.tools,
      instructions: this.instructions,
      examples: this.examples,
      dependencies: this.dependencies,
      inputSchema: this.inputSchema,
      outputSchema: this.outputSchema,
      author: this.author,
      executionCapabilities: this.executionCapabilities,
      executionSecurity: this._executionSecurity
        ? {
            mode: this._executionSecurity.mode,
            executable: this._executionSecurity.executable === true,
            packageOwned: this._executionSecurity.packageOwned === true,
            signed: this._executionSecurity.signed === true,
            trusted: this._executionSecurity.trusted === true,
            publicKeySha256: this._executionSecurity.publicKeySha256 || null,
            capabilityManifestValid:
              this._executionSecurity.capabilityManifestValid === true,
            signatureReason: this._executionSecurity.signatureReason || null,
            contentDigest: this._executionSecurity.contentDigest || null,
          }
        : null,
    };
  }

  /**
   * 获取 Markdown 正文
   * @returns {string}
   */
  getBody() {
    // Note: synchronous - returns whatever is available
    // Call ensureFullyLoaded() before this if full body needed
    return this.definition.body || "";
  }

  /**
   * 获取原始定义
   * @returns {object}
   */
  getDefinition() {
    return this.definition;
  }

  /** Return a structured-clone-safe definition without host security ports. */
  getPublicDefinition() {
    const definition = { ...this.definition };
    delete definition._executionSecurity;
    delete definition._skillSecurityPolicy;
    delete definition._externalHandlerExecutor;
    delete definition._governedExecutionAuthority;
    delete definition._sourceContentSha256;
    return definition;
  }
}

module.exports = { MarkdownSkill };

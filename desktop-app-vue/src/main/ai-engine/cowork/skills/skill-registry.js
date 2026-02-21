/**
 * SkillRegistry - 技能注册表
 *
 * 管理所有可用的技能，提供技能注册、查找和执行功能。
 *
 * @module ai-engine/cowork/skills/skill-registry
 */

const { logger } = require("../../../utils/logger.js");
const EventEmitter = require("events");

/**
 * SkillRegistry 类
 */
class SkillRegistry extends EventEmitter {
  constructor(options = {}) {
    super();

    this.options = {
      // 是否启用自动加载
      autoLoad: options.autoLoad !== false,
      // 最大技能数
      maxSkills: options.maxSkills || 100,
      ...options,
    };

    // 技能映射: skillId -> Skill
    this.skills = new Map();

    // 分类索引: category -> Set<skillId>
    this.categoryIndex = new Map();

    // 文件类型索引: fileType -> Set<skillId>
    this.fileTypeIndex = new Map();

    this._log("SkillRegistry 已初始化");
  }

  // ==========================================
  // 技能注册
  // ==========================================

  /**
   * 注册技能
   * @param {BaseSkill} skill - 技能实例
   */
  register(skill) {
    if (!skill || !skill.skillId) {
      throw new Error("Invalid skill: missing skillId");
    }

    if (this.skills.size >= this.options.maxSkills) {
      throw new Error(`已达到最大技能数限制: ${this.options.maxSkills}`);
    }

    if (this.skills.has(skill.skillId)) {
      this._log(`技能已存在，将被覆盖: ${skill.skillId}`, "warn");
    }

    // 注册技能
    this.skills.set(skill.skillId, skill);

    // 更新分类索引
    if (skill.category) {
      if (!this.categoryIndex.has(skill.category)) {
        this.categoryIndex.set(skill.category, new Set());
      }
      this.categoryIndex.get(skill.category).add(skill.skillId);
    }

    // 更新文件类型索引
    if (skill.supportedFileTypes && Array.isArray(skill.supportedFileTypes)) {
      for (const fileType of skill.supportedFileTypes) {
        if (!this.fileTypeIndex.has(fileType)) {
          this.fileTypeIndex.set(fileType, new Set());
        }
        this.fileTypeIndex.get(fileType).add(skill.skillId);
      }
    }

    // 监听技能事件
    this._attachSkillEventListeners(skill);

    this._log(`技能已注册: ${skill.name} (${skill.skillId})`);
    this.emit("skill-registered", { skill });
  }

  /**
   * 批量注册技能
   * @param {Array<BaseSkill>} skills - 技能数组
   */
  registerMultiple(skills) {
    for (const skill of skills) {
      this.register(skill);
    }
  }

  /**
   * 注销技能
   * @param {string} skillId - 技能 ID
   */
  unregister(skillId) {
    const skill = this.skills.get(skillId);

    if (!skill) {
      this._log(`技能不存在: ${skillId}`, "warn");
      return;
    }

    // 移除技能
    this.skills.delete(skillId);

    // 更新分类索引
    if (skill.category && this.categoryIndex.has(skill.category)) {
      this.categoryIndex.get(skill.category).delete(skillId);
      if (this.categoryIndex.get(skill.category).size === 0) {
        this.categoryIndex.delete(skill.category);
      }
    }

    // 更新文件类型索引
    if (skill.supportedFileTypes) {
      for (const fileType of skill.supportedFileTypes) {
        if (this.fileTypeIndex.has(fileType)) {
          this.fileTypeIndex.get(fileType).delete(skillId);
          if (this.fileTypeIndex.get(fileType).size === 0) {
            this.fileTypeIndex.delete(fileType);
          }
        }
      }
    }

    this._log(`技能已注销: ${skill.name} (${skillId})`);
    this.emit("skill-unregistered", { skillId, skill });
  }

  /**
   * 热加载单个技能
   * @param {string} skillId - 技能 ID
   * @param {object} definition - 技能定义
   * @returns {boolean} 是否成功
   */
  hotLoadSkill(skillId, definition) {
    try {
      const { MarkdownSkill } = require("./markdown-skill");
      const skill = new MarkdownSkill(definition);
      this.register(skill);
      this._log(`技能热加载成功: ${skillId}`);
      this.emit("skill-hot-loaded", { skillId, skill });
      return true;
    } catch (error) {
      this._log(`技能热加载失败 ${skillId}: ${error.message}`, "error");
      return false;
    }
  }

  /**
   * 热卸载单个技能
   * @param {string} skillId - 技能 ID
   * @returns {boolean} 是否成功
   */
  hotUnloadSkill(skillId) {
    if (!this.skills.has(skillId)) {
      this._log(`技能不存在，无法热卸载: ${skillId}`, "warn");
      return false;
    }
    this.unregister(skillId);
    this._log(`技能热卸载成功: ${skillId}`);
    this.emit("skill-hot-unloaded", { skillId });
    return true;
  }

  // ==========================================
  // 技能查找
  // ==========================================

  /**
   * 获取技能
   * @param {string} skillId - 技能 ID
   * @returns {BaseSkill|undefined}
   */
  getSkill(skillId) {
    const skill = this.skills.get(skillId);
    if (skill && typeof skill.ensureFullyLoaded === "function") {
      // Trigger lazy loading (non-blocking, best effort)
      skill.ensureFullyLoaded().catch(() => {});
    }
    return skill;
  }

  /**
   * 查找能处理任务的技能
   * @param {Object} task - 任务对象
   * @param {Object} options - 选项
   * @returns {Array<{skill: BaseSkill, score: number}>}
   */
  findSkillsForTask(task, options = {}) {
    const results = [];

    for (const [skillId, skill] of this.skills) {
      if (!skill.config.enabled) {
        continue;
      }

      const score = skill.canHandle(task);
      if (score > 0) {
        results.push({ skill, score });
      }
    }

    // 按分数排序
    results.sort((a, b) => b.score - a.score);

    // 限制返回数量
    const limit = options.limit || results.length;
    return results.slice(0, limit);
  }

  /**
   * 选择最佳技能
   * @param {Object} task - 任务对象
   * @returns {BaseSkill|null}
   */
  selectBestSkill(task) {
    const skills = this.findSkillsForTask(task, { limit: 1 });
    return skills.length > 0 ? skills[0].skill : null;
  }

  /**
   * 按分类获取技能
   * @param {string} category - 分类
   * @returns {Array<BaseSkill>}
   */
  getSkillsByCategory(category) {
    const skillIds = this.categoryIndex.get(category);
    if (!skillIds) {
      return [];
    }

    return Array.from(skillIds)
      .map((id) => this.skills.get(id))
      .filter((skill) => skill !== undefined);
  }

  /**
   * 按文件类型获取技能
   * @param {string} fileType - 文件类型
   * @returns {Array<BaseSkill>}
   */
  getSkillsByFileType(fileType) {
    const skillIds = this.fileTypeIndex.get(fileType);
    if (!skillIds) {
      return [];
    }

    return Array.from(skillIds)
      .map((id) => this.skills.get(id))
      .filter((skill) => skill !== undefined);
  }

  /**
   * 获取所有技能
   * @returns {Array<BaseSkill>}
   */
  getAllSkills() {
    return Array.from(this.skills.values());
  }

  /**
   * 获取已启用的技能
   * @returns {Array<BaseSkill>}
   */
  getEnabledSkills() {
    return this.getAllSkills().filter((skill) => skill.config.enabled);
  }

  // ==========================================
  // 技能执行
  // ==========================================

  /**
   * 执行技能
   * @param {string} skillId - 技能 ID
   * @param {Object} task - 任务对象
   * @param {Object} context - 执行上下文
   * @returns {Promise<any>} 执行结果
   */
  async executeSkill(skillId, task, context = {}) {
    const skill = this.skills.get(skillId);

    if (!skill) {
      throw new Error(`技能不存在: ${skillId}`);
    }

    if (!skill.config.enabled) {
      throw new Error(`技能已禁用: ${skillId}`);
    }

    return await skill.executeWithMetrics(task, context);
  }

  /**
   * 自动执行任务（选择最佳技能）
   * @param {Object} task - 任务对象
   * @param {Object} context - 执行上下文
   * @returns {Promise<any>} 执行结果
   */
  async autoExecute(task, context = {}) {
    try {
      // 兼容性：如果task没有type但有operation，推断type为office
      let taskObj = task;
      if (!task.type && task.operation) {
        taskObj = {
          ...task,
          type: "office",
        };
      }

      const bestSkill = this.selectBestSkill(taskObj);

      if (!bestSkill) {
        throw new Error(
          `没有可用的技能来处理任务: ${taskObj.type || "unknown"}`,
        );
      }

      this._log(`自动选择技能: ${bestSkill.name} (${bestSkill.skillId})`);

      return await bestSkill.executeWithMetrics(taskObj, context);
    } catch (error) {
      // 兼容性：捕获错误并返回失败结果而不是抛出异常
      this._log(`任务执行失败: ${error.message}`, "error");
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // ==========================================
  // 自动加载
  // ==========================================

  /**
   * 自动加载内置技能
   */
  autoLoadBuiltinSkills() {
    if (!this.options.autoLoad) {
      return;
    }

    try {
      // 加载 Office Skill
      const { OfficeSkill } = require("./office-skill");
      this.register(new OfficeSkill());

      // 加载其他内置技能...
      // const { DataAnalysisSkill } = require('./data-analysis-skill');
      // this.register(new DataAnalysisSkill());

      this._log("内置技能已自动加载");
    } catch (error) {
      this._log(`自动加载内置技能失败: ${error.message}`, "error");
    }
  }

  // ==========================================
  // 事件监听
  // ==========================================

  /**
   * 附加技能事件监听器
   * @private
   */
  _attachSkillEventListeners(skill) {
    skill.on("skill-started", (data) => {
      this.emit("skill-started", data);
    });

    skill.on("skill-completed", (data) => {
      this.emit("skill-completed", data);
    });

    skill.on("skill-failed", (data) => {
      this.emit("skill-failed", data);
    });
  }

  // ==========================================
  // 统计和管理
  // ==========================================

  /**
   * 获取统计信息
   * @returns {Object}
   */
  getStats() {
    const skills = this.getAllSkills();
    const enabledSkills = this.getEnabledSkills();

    const totalMetrics = {
      invocations: 0,
      successes: 0,
      failures: 0,
      totalExecutionTime: 0,
    };

    for (const skill of skills) {
      totalMetrics.invocations += skill.metrics.invocations;
      totalMetrics.successes += skill.metrics.successes;
      totalMetrics.failures += skill.metrics.failures;
      totalMetrics.totalExecutionTime += skill.metrics.totalExecutionTime;
    }

    return {
      totalSkills: skills.length,
      enabledSkills: enabledSkills.length,
      disabledSkills: skills.length - enabledSkills.length,
      categories: this.categoryIndex.size,
      supportedFileTypes: this.fileTypeIndex.size,
      metrics: totalMetrics,
      successRate:
        totalMetrics.invocations > 0
          ? ((totalMetrics.successes / totalMetrics.invocations) * 100).toFixed(
              2,
            ) + "%"
          : "N/A",
    };
  }

  /**
   * 获取技能列表信息
   * @returns {Array}
   */
  getSkillList() {
    return this.getAllSkills().map((skill) => skill.getInfo());
  }

  /**
   * 重置所有技能指标
   */
  resetAllMetrics() {
    for (const skill of this.skills.values()) {
      skill.resetMetrics();
    }
    this._log("所有技能指标已重置");
  }

  /**
   * 日志输出
   * @private
   */
  _log(message, level = "info") {
    if (level === "error") {
      logger.error(`[SkillRegistry] ${message}`);
    } else if (level === "warn") {
      logger.warn(`[SkillRegistry] ${message}`);
    } else {
      logger.info(`[SkillRegistry] ${message}`);
    }
  }

  // ==========================================
  // API 兼容层（用于测试）
  // ==========================================

  /**
   * 查找最佳技能（别名：selectBestSkill）
   * @param {object} task - 任务对象
   * @returns {Promise<object>} 匹配结果
   */
  async findBestSkill(task) {
    const skill = await this.selectBestSkill(task);
    if (skill) {
      return {
        skill,
        score: skill.getScore ? skill.getScore(task) : 100,
      };
    }
    return null;
  }

  // ==========================================
  // 三层加载支持
  // ==========================================

  /**
   * 设置技能加载器
   * @param {SkillLoader} loader - 技能加载器实例
   */
  setLoader(loader) {
    this._loader = loader;

    // 监听加载器事件
    loader.on("skill-loaded", ({ layer, definition }) => {
      this.emit("skill-loaded", { layer, definition });
    });

    loader.on("skill-overridden", ({ skillName, oldSource, newSource }) => {
      this.emit("skill-overridden", { skillName, oldSource, newSource });
    });

    loader.on("load-error", ({ definition, error }) => {
      this.emit("load-error", { definition, error });
    });

    this._log("SkillLoader 已设置");
  }

  /**
   * 从加载器加载所有技能（三层加载）
   * @returns {Promise<{loaded: number, registered: number, errors: Array}>}
   */
  async loadAllSkills() {
    if (!this._loader) {
      throw new Error("SkillLoader not set. Call setLoader() first.");
    }

    // 加载所有层级
    const loadResult = await this._loader.loadAll();

    // 创建技能实例并注册
    const instances = this._loader.createSkillInstances();
    let registered = 0;

    for (const skill of instances) {
      try {
        this.register(skill);
        registered++;
      } catch (error) {
        this._log(`注册技能失败 ${skill.skillId}: ${error.message}`, "error");
        loadResult.errors.push({
          skillId: skill.skillId,
          error: error.message,
        });
      }
    }

    this._log(`三层加载完成: ${loadResult.loaded} 加载, ${registered} 注册`);

    return {
      loaded: loadResult.loaded,
      registered,
      errors: loadResult.errors,
    };
  }

  /**
   * 按来源获取技能
   * @param {'bundled'|'managed'|'workspace'} source - 来源
   * @returns {Array<BaseSkill>}
   */
  getSkillsBySource(source) {
    return this.getAllSkills().filter((skill) => {
      // MarkdownSkill 有 source 属性
      return skill.source === source;
    });
  }

  /**
   * 获取用户可调用的技能
   * @returns {Array<BaseSkill>}
   */
  getUserInvocableSkills() {
    return this.getAllSkills().filter((skill) => {
      // MarkdownSkill 有 userInvocable 和 hidden 属性
      const isInvocable = skill.userInvocable !== false;
      const isHidden = skill.hidden === true;
      const isEnabled = skill.config?.enabled !== false;
      return isInvocable && !isHidden && isEnabled;
    });
  }

  /**
   * 获取技能定义（原始 SKILL.md 数据）
   * @param {string} skillId - 技能 ID
   * @returns {object|null}
   */
  getSkillDefinition(skillId) {
    const skill = this.skills.get(skillId);
    if (skill && typeof skill.getDefinition === "function") {
      return skill.getDefinition();
    }
    return null;
  }

  /**
   * 重新加载所有技能
   * @returns {Promise<object>}
   */
  async reloadAllSkills() {
    if (!this._loader) {
      throw new Error("SkillLoader not set. Call setLoader() first.");
    }

    // 注销所有现有技能
    for (const skillId of Array.from(this.skills.keys())) {
      this.unregister(skillId);
    }

    // 重新加载
    return await this.loadAllSkills();
  }

  /**
   * 获取三层目录信息
   * @returns {object|null}
   */
  getSkillSources() {
    if (!this._loader) {
      return null;
    }
    return this._loader.getLayerPaths();
  }
}

// 单例
let registryInstance = null;

/**
 * 获取技能注册表单例
 * @param {Object} options - 配置选项
 * @returns {SkillRegistry}
 */
function getSkillRegistry(options = {}) {
  if (!registryInstance) {
    registryInstance = new SkillRegistry(options);
  }
  return registryInstance;
}

module.exports = { SkillRegistry, getSkillRegistry };

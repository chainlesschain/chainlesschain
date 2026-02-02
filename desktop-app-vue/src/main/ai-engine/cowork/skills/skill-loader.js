/**
 * SkillLoader - 三层技能加载器
 *
 * 实现 bundled/managed/workspace 三层加载机制，支持技能的优先级覆盖。
 *
 * @module ai-engine/cowork/skills/skill-loader
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const EventEmitter = require("events");
const { app } = require("electron");
const { logger } = require("../../../utils/logger.js");
const { SkillMdParser } = require("./skill-md-parser");
const { SkillGating } = require("./skill-gating");
const { MarkdownSkill } = require("./markdown-skill");

/**
 * 技能层级优先级
 */
const LAYER_PRIORITY = {
  bundled: 0, // 最低优先级：应用内置
  managed: 1, // 中等优先级：用户全局
  workspace: 2, // 最高优先级：项目级
};

/**
 * SkillLoader 类
 */
class SkillLoader extends EventEmitter {
  constructor(options = {}) {
    super();

    this.options = {
      // 工作区路径
      workspacePath: options.workspacePath || process.cwd(),
      // 是否自动检查门控条件
      autoGating: options.autoGating !== false,
      // 是否严格模式（门控失败则不加载）
      strictGating: options.strictGating || false,
      ...options,
    };

    this.parser = new SkillMdParser({ strictValidation: false });
    this.gating = new SkillGating();

    // 存储各层级的技能定义
    this.layerDefinitions = {
      bundled: new Map(),
      managed: new Map(),
      workspace: new Map(),
    };

    // 合并后的技能（按优先级）
    this.resolvedSkills = new Map();
  }

  /**
   * 获取三层目录路径
   * @returns {object}
   */
  getLayerPaths() {
    const userDataPath = app?.getPath
      ? app.getPath("userData")
      : path.join(os.homedir(), ".chainlesschain");

    return {
      // 内置技能目录（应用内）
      bundled: path.join(__dirname, "builtin"),
      // 用户全局技能目录
      managed: path.join(userDataPath, "skills"),
      // 工作区技能目录
      workspace: path.join(
        this.options.workspacePath,
        ".chainlesschain",
        "skills",
      ),
    };
  }

  /**
   * 加载所有层级的技能
   * @returns {Promise<{loaded: number, skipped: number, errors: Array}>}
   */
  async loadAll() {
    const result = {
      loaded: 0,
      skipped: 0,
      errors: [],
    };

    // 按优先级从低到高加载
    const layers = ["bundled", "managed", "workspace"];

    for (const layer of layers) {
      try {
        const layerResult = await this.loadLayer(layer);
        result.loaded += layerResult.loaded;
        result.skipped += layerResult.skipped;
        result.errors.push(...layerResult.errors);
      } catch (error) {
        logger.error(
          `[SkillLoader] Failed to load layer ${layer}: ${error.message}`,
        );
        result.errors.push({ layer, error: error.message });
      }
    }

    // 解决冲突
    this.resolveConflicts();

    logger.info(
      `[SkillLoader] Load complete: ${result.loaded} loaded, ${result.skipped} skipped, ${result.errors.length} errors`,
    );

    return result;
  }

  /**
   * 加载指定层级的技能
   * @param {'bundled'|'managed'|'workspace'} layer - 层级名称
   * @returns {Promise<{loaded: number, skipped: number, errors: Array}>}
   */
  async loadLayer(layer) {
    const result = {
      loaded: 0,
      skipped: 0,
      errors: [],
    };

    const paths = this.getLayerPaths();
    const layerPath = paths[layer];

    if (!fs.existsSync(layerPath)) {
      logger.debug(`[SkillLoader] Layer path does not exist: ${layerPath}`);
      return result;
    }

    // 扫描目录
    const entries = await fs.promises.readdir(layerPath, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const skillDir = path.join(layerPath, entry.name);
      const skillMdPath = path.join(skillDir, "SKILL.md");

      // 检查 SKILL.md 是否存在
      if (!fs.existsSync(skillMdPath)) {
        continue;
      }

      try {
        // 解析 SKILL.md
        const definition = await this.parser.parseFile(skillMdPath);
        definition.source = layer;

        // 门控检查
        if (this.options.autoGating) {
          const gatingResult = await this.gating.checkRequirements(definition);

          if (!gatingResult.passed) {
            const summary = this.gating.getSummary(gatingResult);

            if (this.options.strictGating) {
              logger.warn(
                `[SkillLoader] Skill ${definition.name} failed gating: ${summary}`,
              );
              result.skipped++;
              continue;
            }

            // 非严格模式下标记但仍加载
            definition._gatingFailed = true;
            definition._gatingReason = summary;
            logger.debug(
              `[SkillLoader] Skill ${definition.name} gating warning: ${summary}`,
            );
          }
        }

        // 存储到对应层级
        this.layerDefinitions[layer].set(definition.name, definition);
        result.loaded++;

        this.emit("skill-loaded", { layer, definition });
      } catch (error) {
        logger.error(
          `[SkillLoader] Failed to load skill from ${skillDir}: ${error.message}`,
        );
        result.errors.push({ path: skillDir, error: error.message });
      }
    }

    logger.info(
      `[SkillLoader] Layer '${layer}' loaded: ${result.loaded} skills`,
    );

    return result;
  }

  /**
   * 解决技能冲突（高优先级覆盖低优先级）
   */
  resolveConflicts() {
    this.resolvedSkills.clear();

    // 按优先级从低到高合并
    const layers = ["bundled", "managed", "workspace"];

    for (const layer of layers) {
      for (const [name, definition] of this.layerDefinitions[layer]) {
        if (this.resolvedSkills.has(name)) {
          // 发出覆盖事件
          const oldDefinition = this.resolvedSkills.get(name);
          this.emit("skill-overridden", {
            skillName: name,
            oldSource: oldDefinition.source,
            newSource: layer,
          });

          logger.debug(
            `[SkillLoader] Skill '${name}' overridden: ${oldDefinition.source} -> ${layer}`,
          );
        }

        this.resolvedSkills.set(name, definition);
      }
    }

    logger.info(
      `[SkillLoader] Resolved ${this.resolvedSkills.size} unique skills`,
    );
  }

  /**
   * 创建 MarkdownSkill 实例
   * @returns {MarkdownSkill[]}
   */
  createSkillInstances() {
    const instances = [];

    for (const definition of this.resolvedSkills.values()) {
      try {
        const skill = new MarkdownSkill(definition);
        instances.push(skill);
      } catch (error) {
        logger.error(
          `[SkillLoader] Failed to create skill instance for ${definition.name}: ${error.message}`,
        );
        this.emit("load-error", { definition, error });
      }
    }

    return instances;
  }

  /**
   * 获取所有已解析的技能定义
   * @returns {Map<string, object>}
   */
  getResolvedDefinitions() {
    return this.resolvedSkills;
  }

  /**
   * 按来源获取技能定义
   * @param {'bundled'|'managed'|'workspace'} source - 来源
   * @returns {object[]}
   */
  getDefinitionsBySource(source) {
    return Array.from(this.layerDefinitions[source]?.values() || []);
  }

  /**
   * 获取用户可调用的技能定义
   * @returns {object[]}
   */
  getUserInvocableDefinitions() {
    return Array.from(this.resolvedSkills.values()).filter(
      (d) => d.userInvocable && !d.hidden && d.enabled,
    );
  }

  /**
   * 设置工作区路径
   * @param {string} workspacePath - 工作区路径
   */
  setWorkspacePath(workspacePath) {
    this.options.workspacePath = workspacePath;
  }

  /**
   * 重新加载所有技能
   * @returns {Promise<object>}
   */
  async reload() {
    // 清空现有数据
    this.layerDefinitions.bundled.clear();
    this.layerDefinitions.managed.clear();
    this.layerDefinitions.workspace.clear();
    this.resolvedSkills.clear();

    // 清除门控缓存
    this.gating.clearCache();

    return await this.loadAll();
  }
}

module.exports = { SkillLoader, LAYER_PRIORITY };

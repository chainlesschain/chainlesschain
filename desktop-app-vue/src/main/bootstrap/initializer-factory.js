/**
 * 初始化器工厂
 * 统一管理所有模块的初始化逻辑，提供并行初始化和错误恢复能力
 *
 * @module bootstrap/initializer-factory
 */

const { logger } = require("../utils/logger.js");

/**
 * 初始化结果
 * @typedef {Object} InitResult
 * @property {boolean} success - 是否成功
 * @property {string} name - 模块名称
 * @property {number} duration - 耗时(ms)
 * @property {Error} [error] - 错误信息
 * @property {*} [instance] - 初始化的实例
 */

/**
 * 初始化器配置
 * @typedef {Object} InitializerConfig
 * @property {string} name - 模块名称
 * @property {Function} init - 初始化函数
 * @property {boolean} [required] - 是否必需（失败时是否阻止启动）
 * @property {string[]} [dependsOn] - 依赖的模块名称
 * @property {boolean} [lazy] - 是否懒加载
 */

class InitializerFactory {
  constructor() {
    /** @type {Map<string, InitializerConfig>} */
    this.initializers = new Map();
    /** @type {Map<string, InitResult>} */
    this.results = new Map();
    /** @type {Object} */
    this.instances = {};
    /** @type {Map<string, Promise<InitResult>>} */
    this.runningPromises = new Map();
    /** @type {Function} */
    this.progressCallback = null;
    this.currentProgress = 0;
  }

  /**
   * 设置进度回调
   * @param {Function} callback - (message: string, progress: number) => void
   */
  setProgressCallback(callback) {
    this.progressCallback = callback;
  }

  /**
   * 更新进度
   * @param {string} message - 进度消息
   * @param {number} progress - 进度百分比
   */
  updateProgress(message, progress) {
    this.currentProgress = progress;
    if (this.progressCallback) {
      this.progressCallback(message, progress);
    }
  }

  /**
   * 注册初始化器
   * @param {InitializerConfig} config - 初始化器配置
   */
  register(config) {
    if (!config.name || typeof config.init !== "function") {
      throw new Error("初始化器配置必须包含 name 和 init 函数");
    }
    this.initializers.set(config.name, {
      required: false,
      lazy: false,
      dependsOn: [],
      ...config,
    });
  }

  /**
   * 批量注册初始化器
   * @param {InitializerConfig[]} configs - 初始化器配置数组
   */
  registerAll(configs) {
    for (const config of configs) {
      this.register(config);
    }
  }

  /**
   * 执行单个初始化器
   * @param {string} name - 模块名称
   * @param {Object} context - 上下文对象，包含依赖实例
   * @returns {Promise<InitResult>}
   */
  async runOne(name, context = {}) {
    if (this.runningPromises.has(name)) {
      return this.runningPromises.get(name);
    }

    const config = this.initializers.get(name);
    if (!config) {
      return {
        success: false,
        name,
        duration: 0,
        error: new Error(`初始化器 ${name} 未注册`),
      };
    }

    const runPromise = (async () => {
      // 检查依赖（若依赖正在初始化，等待其完成）
      for (const dep of config.dependsOn || []) {
        const depResult = this.results.get(dep);
        if (!depResult) {
          const depPromise = this.runningPromises.get(dep);
          if (depPromise) {
            await depPromise;
          }
        }
        const finalDepResult = this.results.get(dep);
        if (!finalDepResult || !finalDepResult.success) {
          logger.warn(
            `[InitializerFactory] ${name} 依赖的 ${dep} 未初始化成功，跳过`,
          );
          return {
            success: false,
            name,
            duration: 0,
            error: new Error(`依赖 ${dep} 未初始化成功`),
          };
        }
      }

      const startTime = Date.now();
      try {
        logger.info(`[InitializerFactory] 初始化 ${name}...`);

        // 合并已初始化的实例到上下文
        const fullContext = { ...this.instances, ...context };
        const instance = await config.init(fullContext);

        const duration = Date.now() - startTime;
        const result = {
          success: true,
          name,
          duration,
          instance,
        };

        this.results.set(name, result);
        if (instance !== undefined) {
          this.instances[name] = instance;
        }

        logger.info(
          `[InitializerFactory] ✓ ${name} 初始化成功 (${duration}ms)`,
        );
        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        const result = {
          success: false,
          name,
          duration,
          error,
        };

        this.results.set(name, result);

        if (config.required) {
          logger.error(
            `[InitializerFactory] ✗ ${name} 初始化失败 (必需模块):`,
            error,
          );
          throw error;
        } else {
          logger.warn(
            `[InitializerFactory] ⚠ ${name} 初始化失败 (非必需，继续启动):`,
            error.message,
          );
        }

        return result;
      }
    })();

    this.runningPromises.set(name, runPromise);
    try {
      return await runPromise;
    } finally {
      this.runningPromises.delete(name);
    }
  }

  /**
   * 并行执行一组初始化器
   * @param {string[]} names - 模块名称数组
   * @param {Object} context - 上下文对象
   * @returns {Promise<InitResult[]>}
   */
  async runParallel(names, context = {}) {
    const promises = names.map((name) => this.runOne(name, context));
    return Promise.all(promises);
  }

  /**
   * 按依赖顺序执行所有初始化器
   * @param {Object} context - 上下文对象
   * @returns {Promise<Map<string, InitResult>>}
   */
  async runAll(context = {}) {
    const executed = new Set();
    const pending = new Set(this.initializers.keys());

    // 过滤掉懒加载的初始化器
    for (const [name, config] of this.initializers) {
      if (config.lazy) {
        pending.delete(name);
        logger.info(`[InitializerFactory] ${name} 配置为懒加载，跳过`);
      }
    }

    const totalModules = pending.size;
    let completedModules = 0;

    while (pending.size > 0) {
      // 找出可以执行的初始化器（依赖已满足）
      const canRun = [];
      for (const name of pending) {
        const config = this.initializers.get(name);
        const deps = config.dependsOn || [];
        if (
          deps.every((dep) => executed.has(dep) || !this.initializers.has(dep))
        ) {
          canRun.push(name);
        }
      }

      if (canRun.length === 0 && pending.size > 0) {
        // 存在循环依赖
        logger.error(
          "[InitializerFactory] 检测到循环依赖:",
          Array.from(pending),
        );
        throw new Error("初始化器存在循环依赖");
      }

      // 并行执行可以执行的初始化器
      await this.runParallel(canRun, context);

      // 更新状态
      for (const name of canRun) {
        executed.add(name);
        pending.delete(name);
        completedModules++;

        // 更新进度
        const progress = Math.round((completedModules / totalModules) * 100);
        this.updateProgress(
          `已初始化 ${completedModules}/${totalModules} 个模块`,
          progress,
        );
      }
    }

    return this.results;
  }

  /**
   * 执行分阶段初始化
   * @param {Array<{name: string, modules: string[], progress: number}>} phases - 阶段配置
   * @param {Object} context - 上下文对象
   * @returns {Promise<Map<string, InitResult>>}
   */
  async runPhased(phases, context = {}) {
    for (const phase of phases) {
      this.updateProgress(phase.name, phase.progress);
      logger.info(`[InitializerFactory] === ${phase.name} ===`);

      // 过滤出已注册且非懒加载的模块
      const modulesToRun = phase.modules.filter((name) => {
        const config = this.initializers.get(name);
        if (!config) {
          logger.warn(`[InitializerFactory] 模块 ${name} 未注册，跳过`);
          return false;
        }
        if (config.lazy) {
          logger.info(`[InitializerFactory] 模块 ${name} 配置为懒加载，跳过`);
          return false;
        }
        return true;
      });

      await this.runParallel(modulesToRun, context);
    }

    return this.results;
  }

  /**
   * 获取初始化结果
   * @param {string} name - 模块名称
   * @returns {InitResult|undefined}
   */
  getResult(name) {
    return this.results.get(name);
  }

  /**
   * 获取已初始化的实例
   * @param {string} name - 模块名称
   * @returns {*}
   */
  getInstance(name) {
    return this.instances[name];
  }

  /**
   * 获取所有已初始化的实例
   * @returns {Object}
   */
  getAllInstances() {
    return { ...this.instances };
  }

  /**
   * 打印初始化统计
   */
  printStats() {
    let successful = 0;
    let failed = 0;
    let totalDuration = 0;

    for (const result of this.results.values()) {
      if (result.success) {
        successful++;
      } else {
        failed++;
      }
      totalDuration += result.duration;
    }

    logger.info("=".repeat(60));
    logger.info("[InitializerFactory] 初始化统计:");
    logger.info(
      `  成功: ${successful}, 失败: ${failed}, 总计: ${this.results.size}`,
    );
    logger.info(`  总耗时: ${totalDuration}ms`);
    logger.info("=".repeat(60));

    // 打印失败的模块
    for (const [name, result] of this.results) {
      if (!result.success) {
        logger.warn(`  ⚠ ${name}: ${result.error?.message || "未知错误"}`);
      }
    }
  }

  /**
   * 重置所有状态
   */
  reset() {
    this.results.clear();
    this.instances = {};
    this.currentProgress = 0;
  }
}

// 导出单例
const initializerFactory = new InitializerFactory();

module.exports = {
  InitializerFactory,
  initializerFactory,
};

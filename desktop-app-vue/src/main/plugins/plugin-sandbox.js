/**
 * PluginSandbox - 插件沙箱
 *
 * 职责：
 * - 在隔离环境中执行插件代码
 * - 提供安全的global对象
 * - 超时控制和资源限制
 * - 生命周期钩子调用
 */

const { logger } = require("../utils/logger.js");
const vm = require("vm");
const EventEmitter = require("events");

class PluginSandbox extends EventEmitter {
  constructor(pluginId, pluginPath, manifest, pluginAPI) {
    super();

    this.pluginId = pluginId;
    this.pluginPath = pluginPath;
    this.manifest = manifest;
    this.pluginAPI = pluginAPI;

    // 插件实例
    this.instance = null;

    // 执行上下文
    this.context = null;

    // 超时设置（毫秒）
    this.timeouts = {
      load: 10000, // 加载超时
      hook: 5000, // 钩子执行超时
      method: 30000, // 方法执行超时
    };

    // 状态
    this.state = "created"; // created, loaded, enabled, disabled, error
  }

  /**
   * 加载插件代码
   * @returns {Promise<Object>} 插件实例
   */
  async load() {
    logger.info(`[PluginSandbox] 加载插件: ${this.pluginId}`);

    try {
      this.state = "loading";

      // 1. 读取插件代码
      const fs = require("fs");
      const path = require("path");
      const entryFile = this.manifest.main || "index.js";
      const entryPath = path.join(this.pluginPath, entryFile);

      if (!fs.existsSync(entryPath)) {
        throw new Error(`插件入口文件不存在: ${entryPath}`);
      }

      const code = fs.readFileSync(entryPath, "utf-8");

      // 2. 创建沙箱环境
      this.context = this.createSandboxContext();

      // 3. 在沙箱中执行代码
      const script = new vm.Script(
        `
        (function(module, exports, require, __dirname, __filename) {
          ${code}
        })
      `,
        {
          filename: entryPath,
          timeout: this.timeouts.load,
        },
      );

      // 模拟module系统
      const module = { exports: {} };
      const exports = module.exports;

      // 创建require函数（限制只能require白名单模块）
      const customRequire = this.createRequireFunction();

      // 在VM上下文中执行
      const vmContext = vm.createContext(this.context);

      try {
        const fn = script.runInContext(vmContext, {
          timeout: this.timeouts.load,
          displayErrors: true,
        });

        // 调用包装函数
        fn.call(
          exports,
          module,
          exports,
          customRequire,
          this.pluginPath,
          entryPath,
        );
      } catch (error) {
        if (error.message.includes("timed out")) {
          throw new Error(`插件加载超时（${this.timeouts.load}ms）`);
        }
        throw error;
      }

      // 4. 获取导出的插件类
      const PluginClass = module.exports;

      if (typeof PluginClass !== "function") {
        throw new Error("插件必须导出一个构造函数或类");
      }

      // 5. 实例化插件
      this.instance = new PluginClass();

      // 6. 验证插件接口
      this.validatePluginInterface();

      this.state = "loaded";
      this.emit("loaded", { pluginId: this.pluginId });

      logger.info(`[PluginSandbox] 插件加载成功: ${this.pluginId}`);

      return this.instance;
    } catch (error) {
      this.state = "error";
      this.emit("error", { pluginId: this.pluginId, error });
      logger.error(`[PluginSandbox] 插件加载失败: ${this.pluginId}`, error);
      throw error;
    }
  }

  /**
   * 创建沙箱上下文
   * @returns {Object} 沙箱上下文
   */
  createSandboxContext() {
    // 提供安全的全局对象
    const context = {
      // 标准JavaScript全局对象
      console: {
        log: (...args) => this.pluginAPI.api.utils.log(...args),
        warn: (...args) => this.pluginAPI.api.utils.warn(...args),
        error: (...args) => this.pluginAPI.api.utils.error(...args),
      },

      // 定时器（带限制）
      setTimeout: (fn, delay) => {
        return setTimeout(
          () => {
            try {
              fn();
            } catch (error) {
              logger.error(`[PluginSandbox] setTimeout错误:`, error);
            }
          },
          Math.min(delay, 60000),
        ); // 最大60秒
      },

      setInterval: (fn, delay) => {
        return setInterval(
          () => {
            try {
              fn();
            } catch (error) {
              logger.error(`[PluginSandbox] setInterval错误:`, error);
            }
          },
          Math.max(delay, 100),
        ); // 最小100ms
      },

      clearTimeout: (id) => clearTimeout(id),
      clearInterval: (id) => clearInterval(id),

      // Promise支持
      Promise: Promise,

      // 基本类型
      Object: Object,
      Array: Array,
      String: String,
      Number: Number,
      Boolean: Boolean,
      Date: Date,
      Math: Math,
      JSON: JSON,
      RegExp: RegExp,
      Error: Error,
      TypeError: TypeError,
      RangeError: RangeError,

      // Buffer（限制使用）
      Buffer: Buffer,

      // 插件API
      chainlesschain: this.pluginAPI.getAPI(),

      // 全局变量
      global: undefined, // 禁止访问global
      process: {
        env: {}, // 空的env对象
        version: process.version,
        platform: process.platform,
      },
    };

    return context;
  }

  /**
   * 创建受限的require函数
   * @returns {Function} require函数
   */
  createRequireFunction() {
    // 允许的内置模块白名单
    const allowedModules = [
      "crypto",
      "path",
      "url",
      "querystring",
      "util",
      "events",
    ];

    return (moduleName) => {
      // 检查是否为允许的内置模块
      if (allowedModules.includes(moduleName)) {
        return require(moduleName);
      }

      // 检查是否为相对路径（插件自己的模块）
      if (moduleName.startsWith(".") || moduleName.startsWith("/")) {
        const path = require("path");
        const resolvedPath = path.resolve(this.pluginPath, moduleName);

        // 确保在插件目录内
        if (!resolvedPath.startsWith(this.pluginPath)) {
          throw new Error(`不允许加载插件目录外的模块: ${moduleName}`);
        }

        return require(resolvedPath);
      }

      // 检查是否为插件的NPM依赖
      const path = require("path");
      const modulePath = path.join(this.pluginPath, "node_modules", moduleName);

      if (require("fs").existsSync(modulePath)) {
        return require(modulePath);
      }

      throw new Error(
        `不允许加载模块: ${moduleName}。只能使用白名单模块或插件自己的依赖。`,
      );
    };
  }

  /**
   * 验证插件接口
   */
  validatePluginInterface() {
    if (!this.instance) {
      throw new Error("插件实例不存在");
    }

    // 检查必需的方法（可选）
    const optionalMethods = ["onEnable", "onDisable", "onLoad", "onUnload"];

    optionalMethods.forEach((method) => {
      if (
        this.instance[method] &&
        typeof this.instance[method] !== "function"
      ) {
        logger.warn(`[PluginSandbox] ${method} 应该是一个函数`);
      }
    });
  }

  /**
   * 调用插件钩子
   * @param {string} hookName - 钩子名称
   * @param {...any} args - 参数
   * @returns {Promise<any>} 钩子返回值
   */
  async callHook(hookName, ...args) {
    if (!this.instance) {
      throw new Error("插件未加载");
    }

    const hook = this.instance[hookName];

    if (!hook || typeof hook !== "function") {
      logger.info(`[PluginSandbox] 插件没有 ${hookName} 钩子，跳过`);
      return null;
    }

    logger.info(`[PluginSandbox] 调用钩子: ${this.pluginId}.${hookName}`);

    try {
      // 使用Promise.race实现超时控制
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(
            new Error(`钩子 ${hookName} 执行超时（${this.timeouts.hook}ms）`),
          );
        }, this.timeouts.hook);
      });

      const hookPromise = Promise.resolve(hook.call(this.instance, ...args));

      const result = await Promise.race([hookPromise, timeoutPromise]);

      logger.info(`[PluginSandbox] 钩子执行成功: ${this.pluginId}.${hookName}`);

      return result;
    } catch (error) {
      logger.error(
        `[PluginSandbox] 钩子执行失败: ${this.pluginId}.${hookName}`,
        error,
      );
      this.emit("hook-error", { pluginId: this.pluginId, hookName, error });
      throw error;
    }
  }

  /**
   * 启用插件
   * @returns {Promise<void>}
   */
  async enable() {
    if (this.state === "enabled") {
      logger.info(`[PluginSandbox] 插件已启用: ${this.pluginId}`);
      return;
    }

    try {
      await this.callHook("onEnable");
      this.state = "enabled";
      this.emit("enabled", { pluginId: this.pluginId });
      logger.info(`[PluginSandbox] 插件已启用: ${this.pluginId}`);
    } catch (error) {
      this.state = "error";
      throw error;
    }
  }

  /**
   * 禁用插件
   * @returns {Promise<void>}
   */
  async disable() {
    if (this.state === "disabled") {
      logger.info(`[PluginSandbox] 插件已禁用: ${this.pluginId}`);
      return;
    }

    try {
      await this.callHook("onDisable");
      this.state = "disabled";
      this.emit("disabled", { pluginId: this.pluginId });
      logger.info(`[PluginSandbox] 插件已禁用: ${this.pluginId}`);
    } catch (error) {
      this.state = "error";
      throw error;
    }
  }

  /**
   * 卸载插件
   * @returns {Promise<void>}
   */
  async unload() {
    try {
      await this.callHook("onUnload");
      this.instance = null;
      this.context = null;
      this.state = "unloaded";
      this.emit("unloaded", { pluginId: this.pluginId });
      logger.info(`[PluginSandbox] 插件已卸载: ${this.pluginId}`);
    } catch (error) {
      this.state = "error";
      throw error;
    }
  }

  /**
   * 调用插件方法
   * @param {string} methodName - 方法名
   * @param {...any} args - 参数
   * @returns {Promise<any>} 方法返回值
   */
  async callMethod(methodName, ...args) {
    if (!this.instance) {
      throw new Error("插件未加载");
    }

    const method = this.instance[methodName];

    if (!method || typeof method !== "function") {
      throw new Error(`插件方法不存在: ${methodName}`);
    }

    logger.info(`[PluginSandbox] 调用方法: ${this.pluginId}.${methodName}`);

    try {
      // 超时控制
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(
            new Error(
              `方法 ${methodName} 执行超时（${this.timeouts.method}ms）`,
            ),
          );
        }, this.timeouts.method);
      });

      const methodPromise = Promise.resolve(
        method.call(this.instance, ...args),
      );

      const result = await Promise.race([methodPromise, timeoutPromise]);

      logger.info(
        `[PluginSandbox] 方法执行成功: ${this.pluginId}.${methodName}`,
      );

      return result;
    } catch (error) {
      logger.error(
        `[PluginSandbox] 方法执行失败: ${this.pluginId}.${methodName}`,
        error,
      );
      this.emit("method-error", { pluginId: this.pluginId, methodName, error });
      throw error;
    }
  }

  /**
   * 获取插件状态
   * @returns {string} 状态
   */
  getState() {
    return this.state;
  }

  /**
   * 获取插件实例
   * @returns {Object|null} 插件实例
   */
  getInstance() {
    return this.instance;
  }

  /**
   * 销毁沙箱
   */
  destroy() {
    this.removeAllListeners();
    this.instance = null;
    this.context = null;
    this.state = "destroyed";
  }
}

module.exports = PluginSandbox;

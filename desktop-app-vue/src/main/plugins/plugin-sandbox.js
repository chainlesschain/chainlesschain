/**
 * PluginSandbox - 插件沙箱
 *
 * 职责：
 * - 在隔离环境中执行插件代码
 * - 提供安全的global对象
 * - 超时控制和资源限制
 * - 生命周期钩子调用
 */

const { logger: pluginLogSink } = require("../utils/logger.js");
const { createPluginLogRedactor } = require("./plugin-log-redaction");
const {
  createPluginFailureDescriptor,
  createPluginMethodUnavailableError,
  createPluginOperationError,
} = require("./plugin-ipc-error-boundary");
const { isWithinDir } = require("../utils/path-boundary.js");
const vm = require("vm");
const fs = require("fs");
const EventEmitter = require("events");

const logger = createPluginLogRedactor(pluginLogSink, "PluginSandbox");
const MAX_SANDBOX_MODULES = 512;
const MAX_SANDBOX_MODULE_BYTES = 4 * 1024 * 1024;

function createSandboxModuleUnavailableError() {
  const error = new Error("Plugin sandbox module unavailable");
  error.code = "PLUGIN_SANDBOX_MODULE_UNAVAILABLE";
  return error;
}

// M2: _deps injection so tests can mock fs.promises (vi.mock cannot
// intercept fs.promises for inlined CJS modules)
const _deps = { fsp: fs.promises };

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

    // 插件通过沙箱 setTimeout/setInterval 创建的定时器句柄。destroy() 必须全部
    // 清除，否则插件的定时器回调会在沙箱销毁后继续运行（泄漏内存 + 销毁后仍执行
    // 插件代码）。
    this._activeTimers = new Set();
    this._moduleCache = new Map();
  }

  /**
   * 加载插件代码
   * @returns {Promise<Object>} 插件实例
   */
  async load() {
    logger.info(`[PluginSandbox] 加载插件: ${this.pluginId}`);

    try {
      this.state = "loading";

      // 1. 读取插件代码 (M2: 异步读取，避免启动期阻塞事件循环)
      const path = require("path");
      const entryFile = this.manifest.main || "index.js";
      const entryPath = path.join(this.pluginPath, entryFile);

      let code;
      try {
        code = await _deps.fsp.readFile(entryPath, "utf-8");
      } catch (err) {
        if (err.code === "ENOENT") {
          throw new Error(`插件入口文件不存在: ${entryPath}`);
        }
        logger.error("[PluginSandbox] 插件入口读取失败", err);
        throw createPluginOperationError("plugin");
      }

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

      // 在VM上下文中执行
      const vmContext = vm.createContext(this.context);

      // 创建require函数。插件自有模块和依赖继续在同一VM上下文中执行，
      // 禁止退回宿主CommonJS loader。
      const customRequire = this.createRequireFunction(
        vmContext,
        path.dirname(entryPath),
      );

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
          path.dirname(entryPath),
          entryPath,
        );
      } catch (error) {
        if (error.message.includes("timed out")) {
          throw new Error(`插件加载超时（${this.timeouts.load}ms）`);
        }
        logger.error("[PluginSandbox] 插件代码执行失败", error);
        throw createPluginOperationError("plugin");
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
      this.emit("error", {
        pluginId: this.pluginId,
        ...createPluginFailureDescriptor("plugin"),
      });
      logger.error(`[PluginSandbox] 插件加载失败: ${this.pluginId}`, error);
      throw createPluginOperationError("plugin");
    }
  }

  /**
   * 创建沙箱上下文
   * @returns {Object} 沙箱上下文
   */
  createSandboxContext() {
    const forwardConsoleCall = (level, args) => {
      const sink = this.pluginAPI?.api?.utils?.[level];
      if (typeof sink !== "function") {
        return;
      }
      sink({
        event: "plugin-console",
        level,
        argumentCount: Math.min(args.length, 32),
        redacted: true,
      });
    };

    // 提供安全的全局对象
    const context = {
      // 标准JavaScript全局对象
      console: {
        log: (...args) => forwardConsoleCall("log", args),
        warn: (...args) => forwardConsoleCall("warn", args),
        error: (...args) => forwardConsoleCall("error", args),
      },

      // 定时器（带限制 + 句柄追踪，destroy() 时统一清理）
      setTimeout: (fn, delay) => {
        const id = setTimeout(
          () => {
            this._activeTimers.delete(id); // one-shot：触发后自动取消追踪
            try {
              fn();
            } catch (error) {
              logger.error(`[PluginSandbox] setTimeout错误:`, error);
            }
          },
          Math.min(delay, 60000),
        ); // 最大60秒
        this._activeTimers.add(id);
        return id;
      },

      setInterval: (fn, delay) => {
        const id = setInterval(
          () => {
            try {
              fn();
            } catch (error) {
              logger.error(`[PluginSandbox] setInterval错误:`, error);
            }
          },
          Math.max(delay, 100),
        ); // 最小100ms
        this._activeTimers.add(id);
        return id;
      },

      clearTimeout: (id) => {
        this._activeTimers.delete(id);
        clearTimeout(id);
      },
      clearInterval: (id) => {
        this._activeTimers.delete(id);
        clearInterval(id);
      },

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
  createRequireFunction(
    vmContext,
    parentDirectory = this.pluginPath,
    moduleCache = this._moduleCache,
  ) {
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

      if (
        typeof moduleName !== "string" ||
        !vmContext ||
        typeof vmContext !== "object"
      ) {
        throw createSandboxModuleUnavailableError();
      }

      const path = require("path");
      let resolvedPath;
      try {
        if (moduleName.startsWith(".") || path.isAbsolute(moduleName)) {
          resolvedPath = require.resolve(
            path.resolve(parentDirectory, moduleName),
          );
        } else {
          resolvedPath = require.resolve(moduleName, {
            paths: [parentDirectory, this.pluginPath],
          });
        }
      } catch (_error) {
        throw createSandboxModuleUnavailableError();
      }

      let pluginRoot;
      let moduleRealPath;
      try {
        pluginRoot = fs.realpathSync(this.pluginPath);
        moduleRealPath = fs.realpathSync(resolvedPath);
      } catch (_error) {
        throw createSandboxModuleUnavailableError();
      }

      if (!isWithinDir(pluginRoot, moduleRealPath)) {
        throw createSandboxModuleUnavailableError();
      }

      if (moduleCache.has(moduleRealPath)) {
        return moduleCache.get(moduleRealPath).exports;
      }
      if (moduleCache.size >= MAX_SANDBOX_MODULES) {
        throw createSandboxModuleUnavailableError();
      }

      let source;
      try {
        const stats = fs.statSync(moduleRealPath);
        if (
          !stats.isFile() ||
          stats.size < 0 ||
          stats.size > MAX_SANDBOX_MODULE_BYTES
        ) {
          throw createSandboxModuleUnavailableError();
        }
        source = fs.readFileSync(moduleRealPath, "utf8");
      } catch (_error) {
        throw createSandboxModuleUnavailableError();
      }

      const extension = path.extname(moduleRealPath).toLowerCase();
      if (extension === ".json") {
        try {
          const record = { exports: JSON.parse(source) };
          moduleCache.set(moduleRealPath, record);
          return record.exports;
        } catch (_error) {
          throw createSandboxModuleUnavailableError();
        }
      }
      if (extension !== ".js" && extension !== ".cjs") {
        throw createSandboxModuleUnavailableError();
      }

      const record = { exports: {} };
      moduleCache.set(moduleRealPath, record);
      try {
        const factory = new vm.Script(
          `(function(module, exports, require, __dirname, __filename) {\n${source}\n})`,
          {
            filename: moduleRealPath,
            displayErrors: false,
          },
        ).runInContext(vmContext, {
          timeout: this.timeouts.load,
          displayErrors: false,
        });
        const localRequire = this.createRequireFunction(
          vmContext,
          path.dirname(moduleRealPath),
          moduleCache,
        );
        factory.call(
          record.exports,
          record,
          record.exports,
          localRequire,
          path.dirname(moduleRealPath),
          moduleRealPath,
        );
        return record.exports;
      } catch (_error) {
        moduleCache.delete(moduleRealPath);
        throw createSandboxModuleUnavailableError();
      }
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
      this.emit("hook-error", {
        pluginId: this.pluginId,
        hookName,
        ...createPluginFailureDescriptor("plugin"),
      });
      throw createPluginOperationError("plugin");
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
    } catch (_error) {
      this.state = "error";
      throw createPluginOperationError("plugin");
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
    } catch (_error) {
      this.state = "error";
      throw createPluginOperationError("plugin");
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
    } catch (_error) {
      this.state = "error";
      throw createPluginOperationError("plugin");
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
      throw createPluginMethodUnavailableError();
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
      this.emit("method-error", {
        pluginId: this.pluginId,
        methodName,
        ...createPluginFailureDescriptor("plugin"),
      });
      throw createPluginOperationError("plugin");
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
    // 清除插件残留的定时器，避免销毁后插件回调继续运行 / 泄漏。
    for (const id of this._activeTimers) {
      clearTimeout(id);
      clearInterval(id); // Node 的 Timeout 句柄可被任一方法清除，双清安全
    }
    this._activeTimers.clear();
    this._moduleCache.clear();

    this.removeAllListeners();
    this.instance = null;
    this.context = null;
    this.state = "destroyed";
  }
}

module.exports = PluginSandbox;
module.exports._deps = _deps;

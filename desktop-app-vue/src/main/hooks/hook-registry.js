/**
 * Hook Registry - 钩子注册表
 *
 * 管理所有钩子的注册、查找和生命周期
 *
 * @module hooks/hook-registry
 */

const { EventEmitter } = require("events");
const path = require("path");
const fs = require("fs").promises;

/**
 * 钩子优先级
 */
const HookPriority = {
  SYSTEM: 0, // 系统级 (最先执行)
  HIGH: 100, // 高优先级
  NORMAL: 500, // 普通优先级
  LOW: 900, // 低优先级
  MONITOR: 1000, // 监控级 (最后执行, 不可阻止)
};

/**
 * 钩子类型
 */
const HookType = {
  SYNC: "sync", // 同步钩子
  ASYNC: "async", // 异步钩子
  COMMAND: "command", // Shell 命令钩子
  SCRIPT: "script", // 脚本文件钩子
};

/**
 * 钩子事件类型
 */
const HookEvents = [
  // IPC 相关
  "PreIPCCall",
  "PostIPCCall",
  "IPCError",
  // 工具调用相关
  "PreToolUse",
  "PostToolUse",
  "ToolError",
  // 会话相关
  "SessionStart",
  "SessionEnd",
  "PreCompact",
  "PostCompact",
  // 用户交互相关
  "UserPromptSubmit",
  "AssistantResponse",
  // Agent 相关
  "AgentStart",
  "AgentStop",
  "TaskAssigned",
  "TaskCompleted",
  // 文件操作相关
  "PreFileAccess",
  "PostFileAccess",
  "FileModified",
  // 内存系统相关
  "MemorySave",
  "MemoryLoad",
  // 审计和合规相关
  "AuditLog",
  "ComplianceCheck",
  "DataSubjectRequest",
  // Git 相关 (v1.1.0)
  "PreGitCommit",
  "PostGitCommit",
  "PreGitPush",
  "CIFailure",
];

/**
 * 钩子注册表
 */
class HookRegistry extends EventEmitter {
  /**
   * @param {Object} options 配置选项
   * @param {string} options.configPath 配置文件路径
   */
  constructor(options = {}) {
    super();

    /** @type {Map<string, Array>} 事件名 -> 钩子数组 */
    this.hooks = new Map();

    /** @type {Map<string, Object>} 钩子ID -> 钩子对象 */
    this.hookById = new Map();

    /** @type {boolean} 全局开关 */
    this.enabled = true;

    /** @type {string|null} 配置文件路径 */
    this.configPath = options.configPath || null;

    /** @type {Object} 统计信息 */
    this.stats = {
      totalRegistered: 0,
      totalExecutions: 0,
      totalErrors: 0,
      executionsByEvent: {},
    };

    // 初始化所有事件类型
    this._initializeEventTypes();
  }

  /**
   * 初始化事件类型
   * @private
   */
  _initializeEventTypes() {
    HookEvents.forEach((event) => {
      this.hooks.set(event, []);
      this.stats.executionsByEvent[event] = 0;
    });
  }

  /**
   * 注册钩子
   * @param {Object} hookConfig 钩子配置
   * @param {string} hookConfig.event 事件名称
   * @param {string} [hookConfig.id] 钩子ID
   * @param {string} [hookConfig.name] 钩子名称
   * @param {string} [hookConfig.type] 钩子类型
   * @param {number} [hookConfig.priority] 优先级
   * @param {Function} [hookConfig.handler] 处理函数
   * @param {string} [hookConfig.command] Shell 命令
   * @param {string} [hookConfig.script] 脚本路径
   * @param {RegExp|Function|string} [hookConfig.matcher] 匹配器
   * @param {number} [hookConfig.timeout] 超时时间
   * @param {boolean} [hookConfig.enabled] 是否启用
   * @param {string} [hookConfig.description] 描述
   * @param {Object} [hookConfig.metadata] 元数据
   * @returns {string} 钩子ID
   */
  register(hookConfig) {
    const {
      id = this._generateId(),
      event,
      name = "unnamed-hook",
      type = HookType.ASYNC,
      priority = HookPriority.NORMAL,
      handler,
      command,
      script,
      matcher = null,
      timeout = 30000,
      enabled = true,
      description = "",
      metadata = {},
    } = hookConfig;

    // 验证事件名称
    if (!event || !this.hooks.has(event)) {
      throw new Error(
        `Invalid hook event: ${event}. Valid events: ${HookEvents.join(", ")}`,
      );
    }

    // 验证钩子类型和必需字段
    if ((type === HookType.SYNC || type === HookType.ASYNC) && !handler) {
      throw new Error("Sync/Async hooks require a handler function");
    }

    if (type === HookType.COMMAND && !command) {
      throw new Error("Command hooks require a command string");
    }

    if (type === HookType.SCRIPT && !script) {
      throw new Error("Script hooks require a script path");
    }

    // 检查重复ID
    if (this.hookById.has(id)) {
      throw new Error(`Hook with id "${id}" already exists`);
    }

    const hook = {
      id,
      event,
      name,
      type,
      priority,
      handler,
      command,
      script,
      matcher: this._compileMatcher(matcher),
      matcherRaw: matcher,
      timeout,
      enabled,
      description,
      metadata,
      registeredAt: Date.now(),
      executionCount: 0,
      errorCount: 0,
      lastExecutedAt: null,
      avgExecutionTime: 0,
      totalExecutionTime: 0,
    };

    // 添加到注册表
    const eventHooks = this.hooks.get(event);
    eventHooks.push(hook);

    // 按优先级排序
    eventHooks.sort((a, b) => a.priority - b.priority);

    this.hookById.set(id, hook);
    this.stats.totalRegistered++;

    this.emit("hook-registered", { hook: this._sanitizeHook(hook) });

    return id;
  }

  /**
   * 批量注册钩子
   * @param {Array<Object>} hookConfigs 钩子配置数组
   * @returns {Array<string>} 钩子ID数组
   */
  registerMultiple(hookConfigs) {
    return hookConfigs.map((config) => this.register(config));
  }

  /**
   * 注销钩子
   * @param {string} hookId 钩子ID
   * @returns {boolean} 是否成功
   */
  unregister(hookId) {
    const hook = this.hookById.get(hookId);
    if (!hook) {
      return false;
    }

    const eventHooks = this.hooks.get(hook.event);
    const index = eventHooks.findIndex((h) => h.id === hookId);
    if (index !== -1) {
      eventHooks.splice(index, 1);
    }

    this.hookById.delete(hookId);
    this.emit("hook-unregistered", { hookId, hook: this._sanitizeHook(hook) });

    return true;
  }

  /**
   * 获取事件的所有钩子
   * @param {string} eventName 事件名称
   * @param {Object} options 选项
   * @param {boolean} [options.enabledOnly=true] 仅返回启用的钩子
   * @param {Object} [options.matchContext] 匹配上下文
   * @returns {Array} 钩子数组
   */
  getHooks(eventName, options = {}) {
    const { enabledOnly = true, matchContext = null } = options;

    let hooks = this.hooks.get(eventName) || [];

    if (enabledOnly) {
      hooks = hooks.filter((h) => h.enabled);
    }

    if (matchContext) {
      hooks = hooks.filter((h) => this._matchHook(h, matchContext));
    }

    return hooks;
  }

  /**
   * 编译匹配器
   * @private
   */
  _compileMatcher(matcher) {
    if (!matcher) {
      return null;
    }

    if (typeof matcher === "function") {
      return matcher;
    }

    if (matcher instanceof RegExp) {
      return (context) => {
        const target =
          context.toolName || context.channel || context.filePath || "";
        return matcher.test(target);
      };
    }

    if (typeof matcher === "string") {
      // 支持通配符和管道符
      // 例如: "file_*", "Edit|Write", "*.js"
      const patterns = matcher.split("|").map((p) => p.trim());
      const regexes = patterns.map((p) => {
        const pattern = p.replace(/\*/g, ".*").replace(/\?/g, ".");
        return new RegExp(`^${pattern}$`);
      });

      return (context) => {
        const target =
          context.toolName || context.channel || context.filePath || "";
        return regexes.some((regex) => regex.test(target));
      };
    }

    return null;
  }

  /**
   * 检查钩子是否匹配上下文
   * @private
   */
  _matchHook(hook, context) {
    if (!hook.matcher) {
      return true;
    }
    try {
      return hook.matcher(context);
    } catch (error) {
      console.warn(
        `[HookRegistry] Matcher error for hook ${hook.name}:`,
        error.message,
      );
      return false;
    }
  }

  /**
   * 启用/禁用钩子
   * @param {string} hookId 钩子ID
   * @param {boolean} enabled 是否启用
   * @returns {boolean} 是否成功
   */
  setEnabled(hookId, enabled) {
    const hook = this.hookById.get(hookId);
    if (hook) {
      hook.enabled = enabled;
      this.emit("hook-status-changed", { hookId, enabled });
      return true;
    }
    return false;
  }

  /**
   * 获取钩子信息
   * @param {string} hookId 钩子ID
   * @returns {Object|null} 钩子对象
   */
  getHook(hookId) {
    const hook = this.hookById.get(hookId);
    return hook ? this._sanitizeHook(hook) : null;
  }

  /**
   * 获取所有钩子列表
   * @param {Object} options 选项
   * @param {string} [options.event] 事件名称过滤
   * @param {boolean} [options.enabledOnly] 仅返回启用的
   * @returns {Array} 钩子信息数组
   */
  listHooks(options = {}) {
    const { event = null, enabledOnly = false } = options;

    let hooks = Array.from(this.hookById.values());

    if (event) {
      hooks = hooks.filter((h) => h.event === event);
    }

    if (enabledOnly) {
      hooks = hooks.filter((h) => h.enabled);
    }

    return hooks.map((h) => this._sanitizeHook(h));
  }

  /**
   * 更新钩子统计
   * @param {string} hookId 钩子ID
   * @param {Object} stats 统计数据
   * @param {number} stats.executionTime 执行时间
   * @param {boolean} stats.success 是否成功
   */
  updateStats(hookId, { executionTime, success }) {
    const hook = this.hookById.get(hookId);
    if (!hook) {
      return;
    }

    hook.executionCount++;
    hook.lastExecutedAt = Date.now();
    hook.totalExecutionTime += executionTime;

    if (!success) {
      hook.errorCount++;
    }

    // 更新平均执行时间
    hook.avgExecutionTime = hook.totalExecutionTime / hook.executionCount;

    // 更新全局统计
    this.stats.totalExecutions++;
    this.stats.executionsByEvent[hook.event]++;
    if (!success) {
      this.stats.totalErrors++;
    }
  }

  /**
   * 获取统计信息
   * @returns {Object} 统计信息
   */
  getStats() {
    return {
      ...this.stats,
      hookCount: this.hookById.size,
      enabledCount: Array.from(this.hookById.values()).filter((h) => h.enabled)
        .length,
      eventTypes: HookEvents,
    };
  }

  /**
   * 从配置文件加载钩子
   * @param {string} configPath 配置文件路径
   * @returns {Promise<boolean>} 是否成功
   */
  async loadFromConfig(configPath) {
    try {
      const content = await fs.readFile(configPath, "utf-8");
      const config = JSON.parse(content);

      let loadedCount = 0;

      if (config.hooks) {
        for (const [eventName, hookConfigs] of Object.entries(config.hooks)) {
          for (const hookConfig of hookConfigs) {
            try {
              this.register({
                event: eventName,
                ...hookConfig,
                metadata: {
                  ...hookConfig.metadata,
                  source: "config",
                  configPath,
                },
              });
              loadedCount++;
            } catch (error) {
              console.warn(
                `[HookRegistry] Failed to register hook from config:`,
                error.message,
              );
            }
          }
        }
      }

      this.emit("config-loaded", { configPath, hookCount: loadedCount });
      return true;
    } catch (error) {
      if (error.code !== "ENOENT") {
        this.emit("config-error", { configPath, error: error.message });
      }
      return false;
    }
  }

  /**
   * 清除所有钩子
   */
  clear() {
    this.hooks.forEach((_, key) => this.hooks.set(key, []));
    this.hookById.clear();
    this.stats.totalRegistered = 0;
    this.emit("hooks-cleared");
  }

  /**
   * 移除函数引用，返回可序列化的钩子对象
   * @private
   */
  _sanitizeHook(hook) {
    return {
      id: hook.id,
      name: hook.name,
      event: hook.event,
      type: hook.type,
      priority: hook.priority,
      enabled: hook.enabled,
      description: hook.description,
      matcher: hook.matcherRaw
        ? hook.matcherRaw instanceof RegExp
          ? hook.matcherRaw.toString()
          : String(hook.matcherRaw)
        : null,
      timeout: hook.timeout,
      command: hook.command,
      script: hook.script,
      metadata: hook.metadata,
      executionCount: hook.executionCount,
      errorCount: hook.errorCount,
      avgExecutionTime: Math.round(hook.avgExecutionTime * 100) / 100,
      lastExecutedAt: hook.lastExecutedAt,
      registeredAt: hook.registeredAt,
    };
  }

  /**
   * 生成唯一ID
   * @private
   */
  _generateId() {
    return `hook_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

module.exports = {
  HookRegistry,
  HookPriority,
  HookType,
  HookEvents,
};

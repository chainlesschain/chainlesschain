# Hooks 系统设计方案

> 参考 Claude Code Hooks 系统，结合 ChainlessChain 现有架构设计

## 1. 系统概述

### 1.1 设计目标

- **可扩展性**: 支持第三方插件和自定义钩子
- **非侵入性**: 不修改现有核心代码逻辑
- **类型安全**: 提供完整的钩子类型定义
- **性能优化**: 异步执行，支持超时和取消
- **调试友好**: 完整的日志和错误追踪

### 1.2 核心概念

```
┌─────────────────────────────────────────────────────────────┐
│                      Hooks System                           │
├─────────────────────────────────────────────────────────────┤
│  HookRegistry          │  管理所有钩子注册和查找            │
│  HookExecutor          │  执行钩子，处理异步和错误          │
│  HookContext           │  钩子执行上下文，支持数据传递      │
│  HookMiddleware        │  中间件包装器，集成到 IPC 系统     │
│  HookConfigLoader      │  从配置文件加载钩子定义            │
├─────────────────────────────────────────────────────────────┤
│  配置文件位置:                                              │
│  - .chainlesschain/hooks.json     (项目级)                  │
│  - ~/.chainlesschain/hooks.json   (用户级)                  │
│  - .chainlesschain/hooks/*.js     (脚本钩子)                │
└─────────────────────────────────────────────────────────────┘
```

## 2. 钩子事件定义

### 2.1 完整事件列表

| 事件名称 | 触发时机 | 用途 | 可阻止 |
|---------|---------|------|--------|
| **IPC 相关** |
| `PreIPCCall` | IPC 调用前 | 验证、权限检查、日志 | ✅ |
| `PostIPCCall` | IPC 调用后 | 结果处理、日志、统计 | ❌ |
| `IPCError` | IPC 调用出错 | 错误处理、通知、诊断 | ❌ |
| **工具调用相关** |
| `PreToolUse` | 工具执行前 | 参数验证、权限检查 | ✅ |
| `PostToolUse` | 工具执行后 | 结果格式化、日志 | ❌ |
| `ToolError` | 工具执行出错 | 错误处理、重试逻辑 | ❌ |
| **会话相关** |
| `SessionStart` | 会话创建时 | 初始化、环境设置 | ❌ |
| `SessionEnd` | 会话结束时 | 清理、保存状态 | ❌ |
| `PreCompact` | 上下文压缩前 | 保存重要数据 | ✅ |
| `PostCompact` | 上下文压缩后 | 压缩统计、通知 | ❌ |
| **用户交互相关** |
| `UserPromptSubmit` | 用户提交输入前 | 输入验证、上下文注入 | ✅ |
| `AssistantResponse` | AI 响应生成后 | 响应处理、格式化 | ❌ |
| **Agent 相关** |
| `AgentStart` | Agent 启动时 | 初始化、资源分配 | ❌ |
| `AgentStop` | Agent 停止时 | 清理、结果汇总 | ❌ |
| `TaskAssigned` | 任务分配时 | 任务验证、日志 | ✅ |
| `TaskCompleted` | 任务完成时 | 结果处理、通知 | ❌ |
| **文件操作相关** |
| `PreFileAccess` | 文件访问前 | 权限检查、路径验证 | ✅ |
| `PostFileAccess` | 文件访问后 | 审计日志、统计 | ❌ |
| `FileModified` | 文件被修改时 | 备份、通知、索引更新 | ❌ |
| **内存系统相关** |
| `MemorySave` | 保存到永久记忆前 | 数据处理、去重 | ✅ |
| `MemoryLoad` | 加载永久记忆后 | 数据处理、过滤 | ❌ |

### 2.2 事件数据结构

```javascript
/**
 * 钩子事件基础结构
 */
const HookEvent = {
  // 事件标识
  eventName: 'PreToolUse',      // 事件名称
  eventId: 'uuid-xxx',          // 唯一事件ID
  timestamp: Date.now(),        // 触发时间戳

  // 上下文信息
  context: {
    sessionId: 'session-123',   // 当前会话ID
    agentId: 'agent-456',       // 当前Agent ID (如果有)
    userId: 'user-789',         // 用户标识
    source: 'ipc',              // 触发来源
  },

  // 事件数据 (因事件类型而异)
  data: {
    toolName: 'file_reader',
    parameters: { filePath: '/path/to/file' },
    // ...
  },

  // 控制字段
  prevented: false,             // 是否被阻止
  preventReason: null,          // 阻止原因
  modifications: {},            // 钩子修改的数据
}
```

## 3. 核心类设计

### 3.1 HookRegistry (钩子注册表)

```javascript
// 文件: src/main/hooks/hook-registry.js

const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs').promises;

/**
 * 钩子优先级
 */
const HookPriority = {
  SYSTEM: 0,      // 系统级 (最先执行)
  HIGH: 100,      // 高优先级
  NORMAL: 500,    // 普通优先级
  LOW: 900,       // 低优先级
  MONITOR: 1000,  // 监控级 (最后执行, 不可阻止)
};

/**
 * 钩子类型
 */
const HookType = {
  SYNC: 'sync',           // 同步钩子
  ASYNC: 'async',         // 异步钩子
  COMMAND: 'command',     // Shell 命令钩子
  SCRIPT: 'script',       // 脚本文件钩子
};

/**
 * 钩子注册表
 */
class HookRegistry extends EventEmitter {
  constructor(options = {}) {
    super();

    this.hooks = new Map();           // eventName -> Hook[]
    this.hookById = new Map();        // hookId -> Hook
    this.enabled = true;              // 全局开关
    this.configPath = options.configPath || null;

    // 统计信息
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
   */
  _initializeEventTypes() {
    const eventTypes = [
      'PreIPCCall', 'PostIPCCall', 'IPCError',
      'PreToolUse', 'PostToolUse', 'ToolError',
      'SessionStart', 'SessionEnd', 'PreCompact', 'PostCompact',
      'UserPromptSubmit', 'AssistantResponse',
      'AgentStart', 'AgentStop', 'TaskAssigned', 'TaskCompleted',
      'PreFileAccess', 'PostFileAccess', 'FileModified',
      'MemorySave', 'MemoryLoad',
    ];

    eventTypes.forEach(event => {
      this.hooks.set(event, []);
      this.stats.executionsByEvent[event] = 0;
    });
  }

  /**
   * 注册钩子
   * @param {Object} hookConfig 钩子配置
   * @returns {string} 钩子ID
   */
  register(hookConfig) {
    const {
      id = this._generateId(),
      event,
      name = 'unnamed-hook',
      type = HookType.ASYNC,
      priority = HookPriority.NORMAL,
      handler,                    // 函数类型
      command,                    // 命令类型
      script,                     // 脚本类型
      matcher = null,             // 匹配器 (正则或函数)
      timeout = 30000,            // 超时时间 (ms)
      enabled = true,
      description = '',
      metadata = {},
    } = hookConfig;

    // 验证
    if (!event || !this.hooks.has(event)) {
      throw new Error(`Invalid hook event: ${event}`);
    }

    if (type === HookType.SYNC && !handler) {
      throw new Error('Sync hooks require a handler function');
    }

    if (type === HookType.COMMAND && !command) {
      throw new Error('Command hooks require a command string');
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
      matcher,
      timeout,
      enabled,
      description,
      metadata,
      registeredAt: Date.now(),
      executionCount: 0,
      errorCount: 0,
      lastExecutedAt: null,
      avgExecutionTime: 0,
    };

    // 添加到注册表
    const eventHooks = this.hooks.get(event);
    eventHooks.push(hook);

    // 按优先级排序
    eventHooks.sort((a, b) => a.priority - b.priority);

    this.hookById.set(id, hook);
    this.stats.totalRegistered++;

    this.emit('hook-registered', { hook });

    return id;
  }

  /**
   * 批量注册钩子
   */
  registerMultiple(hookConfigs) {
    return hookConfigs.map(config => this.register(config));
  }

  /**
   * 注销钩子
   */
  unregister(hookId) {
    const hook = this.hookById.get(hookId);
    if (!hook) return false;

    const eventHooks = this.hooks.get(hook.event);
    const index = eventHooks.findIndex(h => h.id === hookId);
    if (index !== -1) {
      eventHooks.splice(index, 1);
    }

    this.hookById.delete(hookId);
    this.emit('hook-unregistered', { hookId, hook });

    return true;
  }

  /**
   * 获取事件的所有钩子
   */
  getHooks(eventName, options = {}) {
    const { enabledOnly = true, matchContext = null } = options;

    let hooks = this.hooks.get(eventName) || [];

    if (enabledOnly) {
      hooks = hooks.filter(h => h.enabled);
    }

    if (matchContext) {
      hooks = hooks.filter(h => this._matchHook(h, matchContext));
    }

    return hooks;
  }

  /**
   * 检查钩子是否匹配上下文
   */
  _matchHook(hook, context) {
    if (!hook.matcher) return true;

    if (typeof hook.matcher === 'function') {
      return hook.matcher(context);
    }

    if (hook.matcher instanceof RegExp) {
      // 用于匹配工具名、通道名等
      const target = context.toolName || context.channel || '';
      return hook.matcher.test(target);
    }

    if (typeof hook.matcher === 'string') {
      // 支持通配符
      const pattern = hook.matcher
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
      const regex = new RegExp(`^${pattern}$`);
      const target = context.toolName || context.channel || '';
      return regex.test(target);
    }

    return true;
  }

  /**
   * 启用/禁用钩子
   */
  setEnabled(hookId, enabled) {
    const hook = this.hookById.get(hookId);
    if (hook) {
      hook.enabled = enabled;
      this.emit('hook-status-changed', { hookId, enabled });
      return true;
    }
    return false;
  }

  /**
   * 获取钩子信息
   */
  getHook(hookId) {
    return this.hookById.get(hookId);
  }

  /**
   * 获取所有钩子列表
   */
  listHooks(options = {}) {
    const { event = null, enabledOnly = false } = options;

    let hooks = Array.from(this.hookById.values());

    if (event) {
      hooks = hooks.filter(h => h.event === event);
    }

    if (enabledOnly) {
      hooks = hooks.filter(h => h.enabled);
    }

    return hooks.map(h => ({
      id: h.id,
      name: h.name,
      event: h.event,
      type: h.type,
      priority: h.priority,
      enabled: h.enabled,
      description: h.description,
      executionCount: h.executionCount,
      avgExecutionTime: h.avgExecutionTime,
    }));
  }

  /**
   * 更新钩子统计
   */
  updateStats(hookId, { executionTime, success }) {
    const hook = this.hookById.get(hookId);
    if (!hook) return;

    hook.executionCount++;
    hook.lastExecutedAt = Date.now();

    if (!success) {
      hook.errorCount++;
    }

    // 更新平均执行时间
    const totalTime = hook.avgExecutionTime * (hook.executionCount - 1) + executionTime;
    hook.avgExecutionTime = totalTime / hook.executionCount;

    // 更新全局统计
    this.stats.totalExecutions++;
    this.stats.executionsByEvent[hook.event]++;
    if (!success) {
      this.stats.totalErrors++;
    }
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      hookCount: this.hookById.size,
      enabledCount: Array.from(this.hookById.values()).filter(h => h.enabled).length,
    };
  }

  /**
   * 从配置文件加载钩子
   */
  async loadFromConfig(configPath) {
    try {
      const content = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(content);

      if (config.hooks) {
        for (const [eventName, hookConfigs] of Object.entries(config.hooks)) {
          for (const hookConfig of hookConfigs) {
            this.register({
              event: eventName,
              ...hookConfig,
              metadata: { ...hookConfig.metadata, source: 'config', configPath },
            });
          }
        }
      }

      this.emit('config-loaded', { configPath, hookCount: this.hookById.size });
      return true;
    } catch (error) {
      this.emit('config-error', { configPath, error });
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
    this.emit('hooks-cleared');
  }

  _generateId() {
    return `hook_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

module.exports = {
  HookRegistry,
  HookPriority,
  HookType,
};
```

### 3.2 HookExecutor (钩子执行器)

```javascript
// 文件: src/main/hooks/hook-executor.js

const { spawn } = require('child_process');
const path = require('path');
const { EventEmitter } = require('events');

/**
 * 钩子执行结果
 */
const HookResult = {
  CONTINUE: 'continue',       // 继续执行
  PREVENT: 'prevent',         // 阻止后续操作
  MODIFY: 'modify',           // 修改数据后继续
  ERROR: 'error',             // 执行出错
};

/**
 * 钩子执行器
 */
class HookExecutor extends EventEmitter {
  constructor(registry, options = {}) {
    super();

    this.registry = registry;
    this.options = {
      defaultTimeout: 30000,
      maxConcurrent: 10,
      continueOnError: true,    // 单个钩子出错是否继续
      ...options,
    };

    this.runningHooks = new Map();  // hookId -> AbortController
  }

  /**
   * 触发钩子事件
   * @param {string} eventName 事件名称
   * @param {Object} eventData 事件数据
   * @param {Object} context 执行上下文
   * @returns {Object} 执行结果
   */
  async trigger(eventName, eventData = {}, context = {}) {
    if (!this.registry.enabled) {
      return { result: HookResult.CONTINUE, data: eventData };
    }

    const hooks = this.registry.getHooks(eventName, {
      enabledOnly: true,
      matchContext: { ...context, ...eventData },
    });

    if (hooks.length === 0) {
      return { result: HookResult.CONTINUE, data: eventData };
    }

    const event = {
      eventName,
      eventId: this._generateEventId(),
      timestamp: Date.now(),
      context,
      data: { ...eventData },
      prevented: false,
      preventReason: null,
      modifications: {},
    };

    this.emit('execution-start', { event, hookCount: hooks.length });

    let currentData = { ...eventData };
    const results = [];

    for (const hook of hooks) {
      // 检查是否已被阻止
      if (event.prevented && hook.priority !== 1000) {
        // 监控级钩子仍然执行
        continue;
      }

      const startTime = Date.now();
      let hookResult;

      try {
        hookResult = await this._executeHook(hook, event, currentData);

        // 处理结果
        if (hookResult.result === HookResult.PREVENT) {
          event.prevented = true;
          event.preventReason = hookResult.reason || `Prevented by hook: ${hook.name}`;
        }

        if (hookResult.result === HookResult.MODIFY && hookResult.data) {
          currentData = { ...currentData, ...hookResult.data };
          event.modifications = { ...event.modifications, ...hookResult.data };
        }

        this.registry.updateStats(hook.id, {
          executionTime: Date.now() - startTime,
          success: true,
        });

      } catch (error) {
        hookResult = {
          result: HookResult.ERROR,
          error: error.message,
          hookId: hook.id,
          hookName: hook.name,
        };

        this.registry.updateStats(hook.id, {
          executionTime: Date.now() - startTime,
          success: false,
        });

        this.emit('hook-error', { hook, error, event });

        if (!this.options.continueOnError) {
          throw error;
        }
      }

      results.push({
        hookId: hook.id,
        hookName: hook.name,
        ...hookResult,
        executionTime: Date.now() - startTime,
      });
    }

    const finalResult = {
      result: event.prevented ? HookResult.PREVENT : HookResult.CONTINUE,
      prevented: event.prevented,
      preventReason: event.preventReason,
      data: currentData,
      modifications: event.modifications,
      hookResults: results,
      totalHooks: hooks.length,
      executedHooks: results.length,
    };

    this.emit('execution-complete', { event, finalResult });

    return finalResult;
  }

  /**
   * 执行单个钩子
   */
  async _executeHook(hook, event, data) {
    const controller = new AbortController();
    this.runningHooks.set(hook.id, controller);

    const timeout = hook.timeout || this.options.defaultTimeout;
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      let result;

      switch (hook.type) {
        case 'sync':
        case 'async':
          result = await this._executeFunctionHook(hook, event, data, controller.signal);
          break;

        case 'command':
          result = await this._executeCommandHook(hook, event, data, controller.signal);
          break;

        case 'script':
          result = await this._executeScriptHook(hook, event, data, controller.signal);
          break;

        default:
          throw new Error(`Unknown hook type: ${hook.type}`);
      }

      return result;

    } finally {
      clearTimeout(timeoutId);
      this.runningHooks.delete(hook.id);
    }
  }

  /**
   * 执行函数类型钩子
   */
  async _executeFunctionHook(hook, event, data, signal) {
    if (signal.aborted) {
      throw new Error('Hook execution aborted (timeout)');
    }

    const result = await hook.handler({
      event,
      data,
      context: event.context,
      signal,
    });

    return this._normalizeResult(result);
  }

  /**
   * 执行命令类型钩子
   */
  async _executeCommandHook(hook, event, data, signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        return reject(new Error('Hook execution aborted (timeout)'));
      }

      // 设置环境变量
      const env = {
        ...process.env,
        HOOK_EVENT: event.eventName,
        HOOK_EVENT_ID: event.eventId,
        HOOK_DATA: JSON.stringify(data),
        HOOK_CONTEXT: JSON.stringify(event.context),
      };

      // 为特定事件设置额外环境变量
      if (data.toolName) env.TOOL_NAME = data.toolName;
      if (data.filePath) env.FILE_PATH = data.filePath;
      if (data.channel) env.IPC_CHANNEL = data.channel;

      const [cmd, ...args] = hook.command.split(' ');
      const child = spawn(cmd, args, {
        env,
        shell: true,
        cwd: event.context.workingDirectory || process.cwd(),
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      const abortHandler = () => {
        child.kill('SIGTERM');
        reject(new Error('Hook execution aborted (timeout)'));
      };
      signal.addEventListener('abort', abortHandler);

      child.on('close', (code) => {
        signal.removeEventListener('abort', abortHandler);

        if (code === 0) {
          // 尝试解析 JSON 输出
          const result = this._parseCommandOutput(stdout);
          resolve(result);
        } else if (code === 2) {
          // 退出码 2 表示阻止操作
          resolve({
            result: HookResult.PREVENT,
            reason: stderr || stdout || 'Prevented by hook command',
          });
        } else {
          reject(new Error(`Hook command exited with code ${code}: ${stderr}`));
        }
      });

      child.on('error', (error) => {
        signal.removeEventListener('abort', abortHandler);
        reject(error);
      });
    });
  }

  /**
   * 执行脚本类型钩子
   */
  async _executeScriptHook(hook, event, data, signal) {
    const scriptPath = hook.script;
    const ext = path.extname(scriptPath);

    let command;
    switch (ext) {
      case '.js':
        command = `node "${scriptPath}"`;
        break;
      case '.py':
        command = `python "${scriptPath}"`;
        break;
      case '.sh':
        command = `bash "${scriptPath}"`;
        break;
      case '.ps1':
        command = `powershell -File "${scriptPath}"`;
        break;
      default:
        command = `"${scriptPath}"`;
    }

    return this._executeCommandHook(
      { ...hook, command },
      event,
      data,
      signal
    );
  }

  /**
   * 解析命令输出
   */
  _parseCommandOutput(stdout) {
    const trimmed = stdout.trim();

    if (!trimmed) {
      return { result: HookResult.CONTINUE };
    }

    try {
      const json = JSON.parse(trimmed);
      return this._normalizeResult(json);
    } catch {
      // 非 JSON 输出，作为消息处理
      return {
        result: HookResult.CONTINUE,
        message: trimmed,
      };
    }
  }

  /**
   * 标准化钩子结果
   */
  _normalizeResult(result) {
    if (!result) {
      return { result: HookResult.CONTINUE };
    }

    if (typeof result === 'boolean') {
      return {
        result: result ? HookResult.CONTINUE : HookResult.PREVENT,
      };
    }

    if (typeof result === 'object') {
      // 支持多种返回格式
      if (result.prevent === true || result.blocked === true) {
        return {
          result: HookResult.PREVENT,
          reason: result.reason || result.message,
        };
      }

      if (result.modify || result.data) {
        return {
          result: HookResult.MODIFY,
          data: result.modify || result.data,
        };
      }

      if (result.result && Object.values(HookResult).includes(result.result)) {
        return result;
      }

      return { result: HookResult.CONTINUE, ...result };
    }

    return { result: HookResult.CONTINUE };
  }

  /**
   * 取消正在运行的钩子
   */
  cancelHook(hookId) {
    const controller = this.runningHooks.get(hookId);
    if (controller) {
      controller.abort();
      return true;
    }
    return false;
  }

  /**
   * 取消所有正在运行的钩子
   */
  cancelAll() {
    this.runningHooks.forEach((controller, hookId) => {
      controller.abort();
    });
    this.runningHooks.clear();
  }

  _generateEventId() {
    return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

module.exports = {
  HookExecutor,
  HookResult,
};
```

### 3.3 HookMiddleware (IPC 中间件集成)

```javascript
// 文件: src/main/hooks/hook-middleware.js

const { HookResult } = require('./hook-executor');

/**
 * 创建 IPC 钩子中间件
 * 包装 IPC 处理器，自动触发 Pre/Post 钩子
 */
function createIPCHookMiddleware(hookSystem) {
  return {
    /**
     * 包装 IPC 处理器
     */
    wrap(channel, handler, options = {}) {
      const {
        skipPreHook = false,
        skipPostHook = false,
        contextExtractor = null,  // 自定义上下文提取器
      } = options;

      return async (event, ...args) => {
        const context = {
          channel,
          args,
          sender: event.sender?.id,
          timestamp: Date.now(),
          ...(contextExtractor ? contextExtractor(event, args) : {}),
        };

        // Pre 钩子
        if (!skipPreHook) {
          const preResult = await hookSystem.trigger('PreIPCCall', {
            channel,
            args,
          }, context);

          if (preResult.prevented) {
            throw new Error(`IPC call prevented: ${preResult.preventReason}`);
          }

          // 应用修改
          if (preResult.modifications && Object.keys(preResult.modifications).length > 0) {
            if (preResult.modifications.args) {
              args = preResult.modifications.args;
            }
          }
        }

        let result;
        let error;

        try {
          result = await handler(event, ...args);
        } catch (err) {
          error = err;

          // 错误钩子
          await hookSystem.trigger('IPCError', {
            channel,
            args,
            error: {
              message: err.message,
              stack: err.stack,
              code: err.code,
            },
          }, context);

          throw err;
        }

        // Post 钩子
        if (!skipPostHook && !error) {
          const postResult = await hookSystem.trigger('PostIPCCall', {
            channel,
            args,
            result,
            executionTime: Date.now() - context.timestamp,
          }, context);

          // Post 钩子可以修改返回值
          if (postResult.modifications && postResult.modifications.result !== undefined) {
            result = postResult.modifications.result;
          }
        }

        return result;
      };
    },

    /**
     * 批量包装 IPC 处理器
     */
    wrapAll(handlers) {
      const wrapped = {};
      for (const [channel, handler] of Object.entries(handlers)) {
        wrapped[channel] = this.wrap(channel, handler);
      }
      return wrapped;
    },
  };
}

/**
 * 创建工具调用钩子中间件
 */
function createToolHookMiddleware(hookSystem) {
  return {
    /**
     * 包装工具处理器
     */
    wrap(toolName, handler, options = {}) {
      return async (params, context = {}) => {
        const toolContext = {
          toolName,
          params,
          ...context,
        };

        // PreToolUse 钩子
        const preResult = await hookSystem.trigger('PreToolUse', {
          toolName,
          params,
        }, toolContext);

        if (preResult.prevented) {
          return {
            success: false,
            error: `Tool use prevented: ${preResult.preventReason}`,
            prevented: true,
          };
        }

        // 应用参数修改
        let finalParams = params;
        if (preResult.modifications && preResult.modifications.params) {
          finalParams = { ...params, ...preResult.modifications.params };
        }

        let result;
        let error;
        const startTime = Date.now();

        try {
          result = await handler(finalParams, context);
        } catch (err) {
          error = err;

          // ToolError 钩子
          await hookSystem.trigger('ToolError', {
            toolName,
            params: finalParams,
            error: {
              message: err.message,
              stack: err.stack,
            },
          }, toolContext);

          throw err;
        }

        // PostToolUse 钩子
        const postResult = await hookSystem.trigger('PostToolUse', {
          toolName,
          params: finalParams,
          result,
          executionTime: Date.now() - startTime,
        }, toolContext);

        // 允许修改结果
        if (postResult.modifications && postResult.modifications.result !== undefined) {
          result = postResult.modifications.result;
        }

        return result;
      };
    },
  };
}

/**
 * 创建会话钩子中间件
 */
function createSessionHookMiddleware(hookSystem) {
  return {
    /**
     * 绑定到 SessionManager
     */
    bindToSessionManager(sessionManager) {
      // 会话开始
      sessionManager.on('session-created', async ({ sessionId, metadata }) => {
        await hookSystem.trigger('SessionStart', {
          sessionId,
          metadata,
        }, { sessionId });
      });

      // 会话结束
      sessionManager.on('session-ended', async ({ sessionId, reason }) => {
        await hookSystem.trigger('SessionEnd', {
          sessionId,
          reason,
        }, { sessionId });
      });

      // 上下文压缩前
      const originalCompress = sessionManager.compressContext?.bind(sessionManager);
      if (originalCompress) {
        sessionManager.compressContext = async function(...args) {
          const preResult = await hookSystem.trigger('PreCompact', {
            sessionId: this.currentSessionId,
            messageCount: this.messages?.length,
          }, { sessionId: this.currentSessionId });

          if (preResult.prevented) {
            console.log(`Context compression prevented: ${preResult.preventReason}`);
            return null;
          }

          const result = await originalCompress(...args);

          await hookSystem.trigger('PostCompact', {
            sessionId: this.currentSessionId,
            compressionRatio: result?.compressionRatio,
          }, { sessionId: this.currentSessionId });

          return result;
        };
      }
    },
  };
}

module.exports = {
  createIPCHookMiddleware,
  createToolHookMiddleware,
  createSessionHookMiddleware,
};
```

### 3.4 HookSystem (统一入口)

```javascript
// 文件: src/main/hooks/index.js

const { HookRegistry, HookPriority, HookType } = require('./hook-registry');
const { HookExecutor, HookResult } = require('./hook-executor');
const {
  createIPCHookMiddleware,
  createToolHookMiddleware,
  createSessionHookMiddleware,
} = require('./hook-middleware');
const path = require('path');
const fs = require('fs').promises;

/**
 * Hooks 系统主类
 */
class HookSystem {
  constructor(options = {}) {
    this.options = {
      configPaths: options.configPaths || [],
      autoLoadConfig: options.autoLoadConfig !== false,
      ...options,
    };

    // 核心组件
    this.registry = new HookRegistry(options);
    this.executor = new HookExecutor(this.registry, options);

    // 中间件
    this.ipcMiddleware = createIPCHookMiddleware(this);
    this.toolMiddleware = createToolHookMiddleware(this);
    this.sessionMiddleware = createSessionHookMiddleware(this);

    // 事件转发
    this._setupEventForwarding();
  }

  /**
   * 初始化
   */
  async initialize() {
    if (this.options.autoLoadConfig) {
      await this.loadDefaultConfigs();
    }

    // 注册内置钩子
    this._registerBuiltinHooks();

    return this;
  }

  /**
   * 加载默认配置文件
   */
  async loadDefaultConfigs() {
    const configPaths = [
      // 项目级配置
      path.join(process.cwd(), '.chainlesschain', 'hooks.json'),
      // 用户级配置
      path.join(process.env.HOME || process.env.USERPROFILE, '.chainlesschain', 'hooks.json'),
      // 自定义配置路径
      ...this.options.configPaths,
    ];

    for (const configPath of configPaths) {
      try {
        await fs.access(configPath);
        await this.registry.loadFromConfig(configPath);
        console.log(`[HookSystem] Loaded hooks from: ${configPath}`);
      } catch {
        // 配置文件不存在，跳过
      }
    }

    // 加载脚本钩子目录
    const scriptDirs = [
      path.join(process.cwd(), '.chainlesschain', 'hooks'),
      path.join(process.env.HOME || process.env.USERPROFILE, '.chainlesschain', 'hooks'),
    ];

    for (const scriptDir of scriptDirs) {
      await this._loadScriptHooks(scriptDir);
    }
  }

  /**
   * 加载脚本钩子
   */
  async _loadScriptHooks(dirPath) {
    try {
      const files = await fs.readdir(dirPath);

      for (const file of files) {
        if (!file.endsWith('.js')) continue;

        const scriptPath = path.join(dirPath, file);
        try {
          const hookModule = require(scriptPath);

          if (hookModule.hooks && Array.isArray(hookModule.hooks)) {
            this.registry.registerMultiple(hookModule.hooks);
            console.log(`[HookSystem] Loaded script hooks from: ${scriptPath}`);
          }
        } catch (error) {
          console.error(`[HookSystem] Failed to load script: ${scriptPath}`, error.message);
        }
      }
    } catch {
      // 目录不存在，跳过
    }
  }

  /**
   * 注册内置钩子
   */
  _registerBuiltinHooks() {
    // 性能监控钩子
    this.registry.register({
      event: 'PostIPCCall',
      name: 'builtin-performance-logger',
      type: HookType.ASYNC,
      priority: HookPriority.MONITOR,
      handler: async ({ data }) => {
        if (data.executionTime > 1000) {
          console.warn(`[Slow IPC] ${data.channel} took ${data.executionTime}ms`);
        }
        return { result: HookResult.CONTINUE };
      },
    });

    // 错误统计钩子
    this.registry.register({
      event: 'IPCError',
      name: 'builtin-error-counter',
      type: HookType.ASYNC,
      priority: HookPriority.MONITOR,
      handler: async ({ data }) => {
        // 可以在这里添加错误统计逻辑
        return { result: HookResult.CONTINUE };
      },
    });
  }

  /**
   * 设置事件转发
   */
  _setupEventForwarding() {
    // 将 registry 和 executor 的事件转发到 HookSystem
    this.registry.on('hook-registered', (data) => this.emit('hook-registered', data));
    this.registry.on('hook-unregistered', (data) => this.emit('hook-unregistered', data));
    this.executor.on('execution-start', (data) => this.emit('execution-start', data));
    this.executor.on('execution-complete', (data) => this.emit('execution-complete', data));
    this.executor.on('hook-error', (data) => this.emit('hook-error', data));
  }

  // ==================== 公共 API ====================

  /**
   * 注册钩子
   */
  register(hookConfig) {
    return this.registry.register(hookConfig);
  }

  /**
   * 批量注册
   */
  registerMultiple(hookConfigs) {
    return this.registry.registerMultiple(hookConfigs);
  }

  /**
   * 注销钩子
   */
  unregister(hookId) {
    return this.registry.unregister(hookId);
  }

  /**
   * 触发事件
   */
  async trigger(eventName, data = {}, context = {}) {
    return this.executor.trigger(eventName, data, context);
  }

  /**
   * 获取钩子列表
   */
  listHooks(options) {
    return this.registry.listHooks(options);
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return this.registry.getStats();
  }

  /**
   * 启用/禁用全局钩子
   */
  setEnabled(enabled) {
    this.registry.enabled = enabled;
  }

  /**
   * 启用/禁用单个钩子
   */
  setHookEnabled(hookId, enabled) {
    return this.registry.setEnabled(hookId, enabled);
  }
}

// 使 HookSystem 继承 EventEmitter
const { EventEmitter } = require('events');
Object.setPrototypeOf(HookSystem.prototype, EventEmitter.prototype);

// 单例
let hookSystemInstance = null;

function getHookSystem(options) {
  if (!hookSystemInstance) {
    hookSystemInstance = new HookSystem(options);
  }
  return hookSystemInstance;
}

function initializeHookSystem(options) {
  hookSystemInstance = new HookSystem(options);
  return hookSystemInstance.initialize();
}

module.exports = {
  HookSystem,
  HookRegistry,
  HookExecutor,
  HookPriority,
  HookType,
  HookResult,
  getHookSystem,
  initializeHookSystem,
  createIPCHookMiddleware,
  createToolHookMiddleware,
  createSessionHookMiddleware,
};
```

## 4. 配置文件格式

### 4.1 hooks.json 配置示例

```json
{
  "$schema": "./hooks-schema.json",
  "version": "1.0.0",
  "enabled": true,

  "hooks": {
    "PreToolUse": [
      {
        "name": "validate-file-paths",
        "description": "验证文件路径安全性",
        "type": "async",
        "priority": 100,
        "matcher": "file_*",
        "timeout": 5000,
        "handler": "validateFilePath"
      },
      {
        "name": "log-tool-usage",
        "description": "记录工具使用日志",
        "type": "command",
        "priority": 900,
        "command": "echo \"Tool: $TOOL_NAME\" >> /tmp/tool.log"
      }
    ],

    "PostToolUse": [
      {
        "name": "format-lint-results",
        "description": "格式化 lint 工具输出",
        "type": "async",
        "matcher": "tool_eslint|tool_prettier",
        "handler": "formatLintResults"
      }
    ],

    "PreCompact": [
      {
        "name": "save-to-permanent-memory",
        "description": "压缩前保存重要信息到永久记忆",
        "type": "async",
        "priority": 100,
        "handler": "saveToMemory"
      }
    ],

    "UserPromptSubmit": [
      {
        "name": "inject-project-context",
        "description": "注入项目上下文信息",
        "type": "async",
        "handler": "injectContext"
      },
      {
        "name": "validate-prompt-safety",
        "description": "验证提示安全性",
        "type": "command",
        "command": "./scripts/validate-prompt.sh",
        "timeout": 10000
      }
    ],

    "FileModified": [
      {
        "name": "auto-lint-on-save",
        "description": "保存时自动 lint",
        "type": "command",
        "matcher": "\\.(js|ts|vue)$",
        "command": "npm run lint -- $FILE_PATH"
      }
    ]
  },

  "settings": {
    "continueOnError": true,
    "defaultTimeout": 30000,
    "maxConcurrent": 10
  }
}
```

### 4.2 脚本钩子示例

```javascript
// 文件: .chainlesschain/hooks/custom-hooks.js

module.exports = {
  hooks: [
    {
      event: 'PreToolUse',
      name: 'custom-tool-validator',
      type: 'async',
      priority: 200,
      matcher: /^tool_/,
      handler: async ({ data, context }) => {
        const { toolName, params } = data;

        // 自定义验证逻辑
        if (toolName === 'tool_file_delete' && !params.confirmed) {
          return {
            result: 'prevent',
            reason: 'File deletion requires confirmation',
          };
        }

        return { result: 'continue' };
      },
    },

    {
      event: 'PostIPCCall',
      name: 'custom-response-logger',
      type: 'async',
      priority: 900,
      handler: async ({ data }) => {
        console.log(`[Custom Logger] ${data.channel}: ${data.executionTime}ms`);
        return { result: 'continue' };
      },
    },
  ],
};
```

## 5. 集成到现有系统

### 5.1 Bootstrap 集成

```javascript
// 修改: src/main/bootstrap/index.js

const { initializeHookSystem } = require('../hooks');

async function bootstrapApplication(options = {}) {
  const { progressCallback } = options;

  // Phase 0: 初始化 Hooks 系统 (最先执行)
  progressCallback('Initializing hooks system...', 0);
  const hookSystem = await initializeHookSystem({
    configPaths: [
      options.hooksConfigPath,
    ],
  });

  // 将 hookSystem 添加到 dependencies
  const dependencies = {
    hookSystem,
    // ... 其他依赖
  };

  // ... 后续初始化阶段
}
```

### 5.2 IPC Registry 集成

```javascript
// 修改: src/main/ipc/ipc-registry.js

const { getHookSystem } = require('../hooks');

function registerAllIPC(dependencies) {
  const hookSystem = dependencies.hookSystem || getHookSystem();
  const ipcMiddleware = hookSystem.ipcMiddleware;

  // 包装所有 IPC 处理器
  const wrappedHandlers = {};

  // 示例: 包装 LLM IPC
  const llmHandlers = {
    'llm:send-message': async (event, params) => {
      // 原始处理逻辑
    },
  };

  // 使用中间件包装
  for (const [channel, handler] of Object.entries(llmHandlers)) {
    ipcMain.handle(channel, ipcMiddleware.wrap(channel, handler));
  }
}
```

### 5.3 FunctionCaller 集成

```javascript
// 修改: src/main/ai-engine/function-caller.js

const { getHookSystem } = require('../hooks');

class FunctionCaller {
  constructor(options = {}) {
    // ...
    this.hookSystem = options.hookSystem || getHookSystem();
    this.toolMiddleware = this.hookSystem.toolMiddleware;
  }

  registerTool(name, handler, schema) {
    // 使用中间件包装工具处理器
    const wrappedHandler = this.toolMiddleware.wrap(name, handler);
    this.tools.set(name, { handler: wrappedHandler, schema });
  }
}
```

### 5.4 SessionManager 集成

```javascript
// 修改: src/main/llm/session-manager.js

const { getHookSystem } = require('../hooks');

class SessionManager extends EventEmitter {
  constructor(options = {}) {
    super();
    // ...

    // 绑定钩子
    const hookSystem = options.hookSystem || getHookSystem();
    hookSystem.sessionMiddleware.bindToSessionManager(this);
  }
}
```

## 6. IPC 接口定义

```javascript
// 文件: src/main/hooks/hooks-ipc.js

const { ipcMain } = require('electron');
const { getHookSystem } = require('./index');

function registerHooksIPC() {
  const hookSystem = getHookSystem();

  // 获取钩子列表
  ipcMain.handle('hooks:list', async (event, options) => {
    return hookSystem.listHooks(options);
  });

  // 获取统计信息
  ipcMain.handle('hooks:stats', async () => {
    return hookSystem.getStats();
  });

  // 启用/禁用钩子
  ipcMain.handle('hooks:set-enabled', async (event, { hookId, enabled }) => {
    return hookSystem.setHookEnabled(hookId, enabled);
  });

  // 注册新钩子 (仅允许特定类型)
  ipcMain.handle('hooks:register', async (event, hookConfig) => {
    // 安全检查: 只允许注册命令类型钩子
    if (hookConfig.type === 'command' || hookConfig.type === 'script') {
      return hookSystem.register(hookConfig);
    }
    throw new Error('Only command and script hooks can be registered via IPC');
  });

  // 注销钩子
  ipcMain.handle('hooks:unregister', async (event, hookId) => {
    return hookSystem.unregister(hookId);
  });

  // 手动触发钩子 (调试用)
  ipcMain.handle('hooks:trigger', async (event, { eventName, data, context }) => {
    return hookSystem.trigger(eventName, data, context);
  });
}

module.exports = { registerHooksIPC };
```

## 7. 文件结构

```
desktop-app-vue/src/main/hooks/
├── index.js                    # 主入口和单例管理
├── hook-registry.js            # 钩子注册表
├── hook-executor.js            # 钩子执行器
├── hook-middleware.js          # 中间件工厂
├── hooks-ipc.js               # IPC 接口
├── builtin-hooks/             # 内置钩子
│   ├── performance-hooks.js   # 性能监控钩子
│   ├── security-hooks.js      # 安全检查钩子
│   └── logging-hooks.js       # 日志钩子
└── types.d.ts                 # TypeScript 类型定义

配置文件位置:
.chainlesschain/
├── hooks.json                 # 项目级钩子配置
└── hooks/                     # 项目级脚本钩子
    ├── custom-hooks.js
    └── my-validator.js

~/.chainlesschain/
├── hooks.json                 # 用户级钩子配置
└── hooks/                     # 用户级脚本钩子
```

## 8. 使用示例

### 8.1 注册函数钩子

```javascript
const { getHookSystem, HookPriority } = require('./hooks');

const hookSystem = getHookSystem();

// 注册验证钩子
hookSystem.register({
  event: 'PreToolUse',
  name: 'my-tool-validator',
  priority: HookPriority.HIGH,
  matcher: /^tool_file/,  // 匹配所有文件工具
  handler: async ({ data, context }) => {
    const { toolName, params } = data;

    // 检查危险操作
    if (toolName === 'tool_file_delete') {
      if (!params.path.startsWith('/tmp/')) {
        return {
          result: 'prevent',
          reason: 'Only /tmp files can be deleted',
        };
      }
    }

    return { result: 'continue' };
  },
});
```

### 8.2 注册命令钩子

```javascript
hookSystem.register({
  event: 'PostToolUse',
  name: 'lint-after-edit',
  type: 'command',
  matcher: 'Edit|Write',
  command: 'npm run lint:fix -- "$FILE_PATH"',
  timeout: 60000,
});
```

### 8.3 监听钩子事件

```javascript
hookSystem.on('execution-complete', ({ event, finalResult }) => {
  console.log(`[Hooks] ${event.eventName}: ${finalResult.executedHooks} hooks executed`);

  if (finalResult.prevented) {
    console.warn(`[Hooks] Operation prevented: ${finalResult.preventReason}`);
  }
});

hookSystem.on('hook-error', ({ hook, error }) => {
  console.error(`[Hooks] Error in hook ${hook.name}:`, error.message);
});
```

## 9. 安全考虑

1. **命令注入防护**: 命令钩子的环境变量经过转义
2. **超时保护**: 所有钩子有默认超时
3. **权限隔离**: IPC 只能注册命令/脚本类型钩子
4. **沙箱执行**: 脚本钩子在隔离环境执行
5. **审计日志**: 所有钩子执行都有日志记录

## 10. 性能优化

1. **匹配器缓存**: 正则表达式匹配器编译后缓存
2. **并行执行**: 同优先级钩子可并行执行
3. **懒加载**: 脚本钩子按需加载
4. **统计采样**: 高频事件使用采样统计

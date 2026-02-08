/**
 * Hook Executor - 钩子执行器
 *
 * 负责执行钩子，处理异步、超时和错误
 *
 * @module hooks/hook-executor
 */

const { spawn } = require("child_process");
const path = require("path");
const { EventEmitter } = require("events");

/**
 * 钩子执行结果
 */
const HookResult = {
  CONTINUE: "continue", // 继续执行
  PREVENT: "prevent", // 阻止后续操作
  MODIFY: "modify", // 修改数据后继续
  ERROR: "error", // 执行出错
};

/**
 * 钩子执行器
 */
class HookExecutor extends EventEmitter {
  /**
   * @param {HookRegistry} registry 钩子注册表
   * @param {Object} options 配置选项
   */
  constructor(registry, options = {}) {
    super();

    /** @type {HookRegistry} */
    this.registry = registry;

    /** @type {Object} */
    this.options = {
      defaultTimeout: 30000,
      maxConcurrent: 10,
      continueOnError: true, // 单个钩子出错是否继续
      parallelSamePriority: false, // 同优先级钩子是否并行执行
      ...options,
    };

    /** @type {Map<string, AbortController>} hookId -> AbortController */
    this.runningHooks = new Map();

    /** @type {number} 事件计数器 */
    this.eventCounter = 0;
  }

  /**
   * 触发钩子事件
   * @param {string} eventName 事件名称
   * @param {Object} eventData 事件数据
   * @param {Object} context 执行上下文
   * @returns {Promise<Object>} 执行结果
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
      return {
        result: HookResult.CONTINUE,
        data: eventData,
        prevented: false,
        preventReason: null,
        modifications: {},
        hookResults: [],
        totalHooks: 0,
        executedHooks: 0,
        totalTime: 0,
      };
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

    this.emit("execution-start", {
      eventName,
      eventId: event.eventId,
      hookCount: hooks.length,
    });

    let currentData = { ...eventData };
    const results = [];

    for (const hook of hooks) {
      // 检查是否已被阻止 (监控级钩子仍然执行)
      if (event.prevented && hook.priority !== 1000) {
        continue;
      }

      const startTime = Date.now();
      let hookResult;

      try {
        hookResult = await this._executeHook(hook, event, currentData);

        // 处理结果
        if (hookResult.result === HookResult.PREVENT) {
          event.prevented = true;
          event.preventReason =
            hookResult.reason || `Prevented by hook: ${hook.name}`;
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

        this.emit("hook-error", {
          hookId: hook.id,
          hookName: hook.name,
          eventName,
          error: error.message,
        });

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
      totalTime: Date.now() - event.timestamp,
    };

    this.emit("execution-complete", {
      eventName,
      eventId: event.eventId,
      ...finalResult,
    });

    return finalResult;
  }

  /**
   * 执行单个钩子
   * @private
   */
  async _executeHook(hook, event, data) {
    const controller = new AbortController();
    this.runningHooks.set(hook.id, controller);

    const timeout = hook.timeout || this.options.defaultTimeout;
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      let result;

      switch (hook.type) {
        case "sync":
        case "async":
          result = await this._executeFunctionHook(
            hook,
            event,
            data,
            controller.signal,
          );
          break;

        case "command":
          result = await this._executeCommandHook(
            hook,
            event,
            data,
            controller.signal,
          );
          break;

        case "script":
          result = await this._executeScriptHook(
            hook,
            event,
            data,
            controller.signal,
          );
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
   * @private
   */
  async _executeFunctionHook(hook, event, data, signal) {
    if (signal.aborted) {
      throw new Error("Hook execution aborted (timeout)");
    }

    const result = await hook.handler({
      event: {
        name: event.eventName,
        id: event.eventId,
        timestamp: event.timestamp,
      },
      data,
      context: event.context,
      signal,
    });

    return this._normalizeResult(result);
  }

  /**
   * 执行命令类型钩子
   * @private
   */
  async _executeCommandHook(hook, event, data, signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        return reject(new Error("Hook execution aborted (timeout)"));
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
      if (data.toolName) {
        env.TOOL_NAME = data.toolName;
      }
      if (data.filePath) {
        env.FILE_PATH = data.filePath;
      }
      if (data.channel) {
        env.IPC_CHANNEL = data.channel;
      }
      if (data.sessionId) {
        env.SESSION_ID = data.sessionId;
      }

      // 解析命令
      const isWindows = process.platform === "win32";
      const shellCmd = isWindows ? "cmd.exe" : "/bin/sh";
      const shellArgs = isWindows ? ["/c", hook.command] : ["-c", hook.command];

      const child = spawn(shellCmd, shellArgs, {
        env,
        cwd: event.context.workingDirectory || process.cwd(),
        windowsHide: true,
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      const abortHandler = () => {
        child.kill("SIGTERM");
        reject(new Error("Hook execution aborted (timeout)"));
      };
      signal.addEventListener("abort", abortHandler, { once: true });

      child.on("close", (code) => {
        signal.removeEventListener("abort", abortHandler);

        if (code === 0) {
          // 尝试解析 JSON 输出
          const result = this._parseCommandOutput(stdout);
          resolve(result);
        } else if (code === 2) {
          // 退出码 2 表示阻止操作
          resolve({
            result: HookResult.PREVENT,
            reason:
              stderr.trim() || stdout.trim() || "Prevented by hook command",
          });
        } else {
          reject(
            new Error(
              `Hook command exited with code ${code}: ${stderr.trim()}`,
            ),
          );
        }
      });

      child.on("error", (error) => {
        signal.removeEventListener("abort", abortHandler);
        reject(error);
      });
    });
  }

  /**
   * 执行脚本类型钩子
   * @private
   */
  async _executeScriptHook(hook, event, data, signal) {
    const scriptPath = hook.script;
    const ext = path.extname(scriptPath).toLowerCase();

    let command;
    const isWindows = process.platform === "win32";

    switch (ext) {
      case ".js":
        command = `node "${scriptPath}"`;
        break;
      case ".py":
        command = `python "${scriptPath}"`;
        break;
      case ".sh":
        command = isWindows ? `bash "${scriptPath}"` : `sh "${scriptPath}"`;
        break;
      case ".ps1":
        command = `powershell -ExecutionPolicy Bypass -File "${scriptPath}"`;
        break;
      case ".bat":
      case ".cmd":
        command = `"${scriptPath}"`;
        break;
      default:
        command = `"${scriptPath}"`;
    }

    return this._executeCommandHook({ ...hook, command }, event, data, signal);
  }

  /**
   * 解析命令输出
   * @private
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
   * @private
   */
  _normalizeResult(result) {
    if (!result) {
      return { result: HookResult.CONTINUE };
    }

    if (typeof result === "boolean") {
      return {
        result: result ? HookResult.CONTINUE : HookResult.PREVENT,
      };
    }

    if (typeof result === "object") {
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
   * @param {string} hookId 钩子ID
   * @returns {boolean} 是否成功
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
    this.runningHooks.forEach((controller) => {
      controller.abort();
    });
    this.runningHooks.clear();
  }

  /**
   * 获取正在运行的钩子数量
   * @returns {number}
   */
  getRunningCount() {
    return this.runningHooks.size;
  }

  /**
   * 生成事件ID
   * @private
   */
  _generateEventId() {
    return `evt_${Date.now()}_${++this.eventCounter}_${Math.random().toString(36).substr(2, 6)}`;
  }
}

module.exports = {
  HookExecutor,
  HookResult,
};

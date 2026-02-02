/**
 * Hook Middleware - 钩子中间件
 *
 * 提供与 IPC、工具调用、会话管理的集成中间件
 *
 * @module hooks/hook-middleware
 */

const { HookResult } = require('./hook-executor');

/**
 * 创建 IPC 钩子中间件
 * 包装 IPC 处理器，自动触发 Pre/Post 钩子
 *
 * @param {HookSystem} hookSystem 钩子系统实例
 * @returns {Object} 中间件对象
 */
function createIPCHookMiddleware(hookSystem) {
  return {
    /**
     * 包装 IPC 处理器
     * @param {string} channel IPC 通道名称
     * @param {Function} handler 原始处理器
     * @param {Object} options 选项
     * @returns {Function} 包装后的处理器
     */
    wrap(channel, handler, options = {}) {
      const { skipPreHook = false, skipPostHook = false, contextExtractor = null } = options;

      return async (event, ...args) => {
        const context = {
          channel,
          args,
          sender: event?.sender?.id,
          timestamp: Date.now(),
          ...(contextExtractor ? contextExtractor(event, args) : {}),
        };

        // Pre 钩子
        if (!skipPreHook) {
          const preResult = await hookSystem.trigger(
            'PreIPCCall',
            {
              channel,
              args,
            },
            context
          );

          if (preResult.prevented) {
            const error = new Error(`IPC call prevented: ${preResult.preventReason}`);
            error.code = 'HOOK_PREVENTED';
            error.preventReason = preResult.preventReason;
            throw error;
          }

          // 应用参数修改
          if (preResult.modifications && preResult.modifications.args) {
            args = preResult.modifications.args;
          }
        }

        let result;
        let error;
        const startTime = Date.now();

        try {
          result = await handler(event, ...args);
        } catch (err) {
          error = err;

          // 错误钩子
          await hookSystem.trigger(
            'IPCError',
            {
              channel,
              args,
              error: {
                message: err.message,
                stack: err.stack,
                code: err.code,
              },
            },
            context
          );

          throw err;
        }

        // Post 钩子
        if (!skipPostHook && !error) {
          const postResult = await hookSystem.trigger(
            'PostIPCCall',
            {
              channel,
              args,
              result,
              executionTime: Date.now() - startTime,
            },
            context
          );

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
     * @param {Object} handlers 处理器映射 { channel: handler }
     * @param {Object} options 选项
     * @returns {Object} 包装后的处理器映射
     */
    wrapAll(handlers, options = {}) {
      const wrapped = {};
      for (const [channel, handler] of Object.entries(handlers)) {
        wrapped[channel] = this.wrap(channel, handler, options);
      }
      return wrapped;
    },

    /**
     * 创建 ipcMain.handle 的包装版本
     * @param {Electron.IpcMain} ipcMain Electron ipcMain
     * @returns {Function} 包装后的 handle 方法
     */
    createWrappedHandle(ipcMain) {
      const middleware = this;
      return function wrappedHandle(channel, handler, options = {}) {
        const wrappedHandler = middleware.wrap(channel, handler, options);
        return ipcMain.handle(channel, wrappedHandler);
      };
    },
  };
}

/**
 * 创建工具调用钩子中间件
 *
 * @param {HookSystem} hookSystem 钩子系统实例
 * @returns {Object} 中间件对象
 */
function createToolHookMiddleware(hookSystem) {
  return {
    /**
     * 包装工具处理器
     * @param {string} toolName 工具名称
     * @param {Function} handler 原始处理器
     * @param {Object} options 选项
     * @returns {Function} 包装后的处理器
     */
    wrap(toolName, handler, options = {}) {
      const { skipPreHook = false, skipPostHook = false } = options;

      return async (params, context = {}) => {
        const toolContext = {
          toolName,
          params,
          ...context,
        };

        // PreToolUse 钩子
        if (!skipPreHook) {
          const preResult = await hookSystem.trigger(
            'PreToolUse',
            {
              toolName,
              params,
            },
            toolContext
          );

          if (preResult.prevented) {
            return {
              success: false,
              error: `Tool use prevented: ${preResult.preventReason}`,
              prevented: true,
              preventReason: preResult.preventReason,
            };
          }

          // 应用参数修改
          if (preResult.modifications && preResult.modifications.params) {
            params = { ...params, ...preResult.modifications.params };
          }
        }

        let result;
        let error;
        const startTime = Date.now();

        try {
          result = await handler(params, context);
        } catch (err) {
          error = err;

          // ToolError 钩子
          await hookSystem.trigger(
            'ToolError',
            {
              toolName,
              params,
              error: {
                message: err.message,
                stack: err.stack,
              },
            },
            toolContext
          );

          throw err;
        }

        // PostToolUse 钩子
        if (!skipPostHook) {
          const postResult = await hookSystem.trigger(
            'PostToolUse',
            {
              toolName,
              params,
              result,
              executionTime: Date.now() - startTime,
              success: !error,
            },
            toolContext
          );

          // 允许修改结果
          if (postResult.modifications && postResult.modifications.result !== undefined) {
            result = postResult.modifications.result;
          }
        }

        return result;
      };
    },

    /**
     * 批量包装工具
     * @param {Map|Object} tools 工具映射
     * @param {Object} options 选项
     * @returns {Map|Object} 包装后的工具映射
     */
    wrapAll(tools, options = {}) {
      if (tools instanceof Map) {
        const wrapped = new Map();
        for (const [name, tool] of tools) {
          if (typeof tool.handler === 'function') {
            wrapped.set(name, {
              ...tool,
              handler: this.wrap(name, tool.handler, options),
            });
          } else {
            wrapped.set(name, tool);
          }
        }
        return wrapped;
      }

      const wrapped = {};
      for (const [name, handler] of Object.entries(tools)) {
        wrapped[name] = this.wrap(name, handler, options);
      }
      return wrapped;
    },
  };
}

/**
 * 创建会话钩子中间件
 *
 * @param {HookSystem} hookSystem 钩子系统实例
 * @returns {Object} 中间件对象
 */
function createSessionHookMiddleware(hookSystem) {
  return {
    /**
     * 绑定到 SessionManager
     * @param {SessionManager} sessionManager 会话管理器
     */
    bindToSessionManager(sessionManager) {
      if (!sessionManager) {
        console.warn('[HookMiddleware] SessionManager is null, skipping binding');
        return;
      }

      // 会话创建
      sessionManager.on('session-created', async (data) => {
        await hookSystem.trigger(
          'SessionStart',
          {
            sessionId: data.sessionId || data.id,
            metadata: data.metadata || {},
          },
          { sessionId: data.sessionId || data.id }
        );
      });

      // 会话结束
      sessionManager.on('session-ended', async (data) => {
        await hookSystem.trigger(
          'SessionEnd',
          {
            sessionId: data.sessionId || data.id,
            reason: data.reason || 'ended',
          },
          { sessionId: data.sessionId || data.id }
        );
      });

      // 上下文压缩 - 包装 compressContext 方法
      if (typeof sessionManager.compressContext === 'function') {
        const originalCompress = sessionManager.compressContext.bind(sessionManager);

        sessionManager.compressContext = async function (...args) {
          const sessionId = this.currentSessionId || this.activeSessionId;

          // PreCompact 钩子
          const preResult = await hookSystem.trigger(
            'PreCompact',
            {
              sessionId,
              messageCount: this.messages?.length || 0,
              contextSize: this.getContextSize?.() || 0,
            },
            { sessionId }
          );

          if (preResult.prevented) {
            console.log(`[HookMiddleware] Context compression prevented: ${preResult.preventReason}`);
            return null;
          }

          // 执行原始压缩
          const result = await originalCompress(...args);

          // PostCompact 钩子
          await hookSystem.trigger(
            'PostCompact',
            {
              sessionId,
              compressionRatio: result?.compressionRatio || 0,
              savedTokens: result?.savedTokens || 0,
            },
            { sessionId }
          );

          return result;
        };
      }
    },
  };
}

/**
 * 创建文件访问钩子中间件
 *
 * @param {HookSystem} hookSystem 钩子系统实例
 * @returns {Object} 中间件对象
 */
function createFileHookMiddleware(hookSystem) {
  return {
    /**
     * 包装文件读取操作
     */
    wrapRead(readFn) {
      return async (filePath, options = {}) => {
        const context = { filePath, operation: 'read' };

        const preResult = await hookSystem.trigger('PreFileAccess', { filePath, operation: 'read' }, context);

        if (preResult.prevented) {
          throw new Error(`File access prevented: ${preResult.preventReason}`);
        }

        const result = await readFn(filePath, options);

        await hookSystem.trigger(
          'PostFileAccess',
          {
            filePath,
            operation: 'read',
            success: true,
            size: result?.length || 0,
          },
          context
        );

        return result;
      };
    },

    /**
     * 包装文件写入操作
     */
    wrapWrite(writeFn) {
      return async (filePath, content, options = {}) => {
        const context = { filePath, operation: 'write' };

        const preResult = await hookSystem.trigger(
          'PreFileAccess',
          {
            filePath,
            operation: 'write',
            contentSize: content?.length || 0,
          },
          context
        );

        if (preResult.prevented) {
          throw new Error(`File access prevented: ${preResult.preventReason}`);
        }

        const result = await writeFn(filePath, content, options);

        await hookSystem.trigger(
          'PostFileAccess',
          {
            filePath,
            operation: 'write',
            success: true,
          },
          context
        );

        // 触发文件修改事件
        await hookSystem.trigger(
          'FileModified',
          {
            filePath,
            operation: 'write',
            contentSize: content?.length || 0,
          },
          context
        );

        return result;
      };
    },
  };
}

/**
 * 创建 Agent 钩子中间件
 *
 * @param {HookSystem} hookSystem 钩子系统实例
 * @returns {Object} 中间件对象
 */
function createAgentHookMiddleware(hookSystem) {
  return {
    /**
     * 绑定到 AgentOrchestrator 或 TeammateTool
     */
    bindToOrchestrator(orchestrator) {
      if (!orchestrator) return;

      // Agent 启动
      orchestrator.on('agent-started', async (data) => {
        await hookSystem.trigger(
          'AgentStart',
          {
            agentId: data.agentId,
            agentType: data.type,
            capabilities: data.capabilities,
          },
          { agentId: data.agentId }
        );
      });

      // Agent 停止
      orchestrator.on('agent-stopped', async (data) => {
        await hookSystem.trigger(
          'AgentStop',
          {
            agentId: data.agentId,
            reason: data.reason,
            result: data.result,
          },
          { agentId: data.agentId }
        );
      });

      // 任务分配
      orchestrator.on('task-assigned', async (data) => {
        await hookSystem.trigger(
          'TaskAssigned',
          {
            taskId: data.taskId,
            agentId: data.agentId,
            taskType: data.type,
            description: data.description,
          },
          { taskId: data.taskId, agentId: data.agentId }
        );
      });

      // 任务完成
      orchestrator.on('task-completed', async (data) => {
        await hookSystem.trigger(
          'TaskCompleted',
          {
            taskId: data.taskId,
            agentId: data.agentId,
            success: data.success,
            result: data.result,
            executionTime: data.executionTime,
          },
          { taskId: data.taskId, agentId: data.agentId }
        );
      });
    },
  };
}

module.exports = {
  createIPCHookMiddleware,
  createToolHookMiddleware,
  createSessionHookMiddleware,
  createFileHookMiddleware,
  createAgentHookMiddleware,
};

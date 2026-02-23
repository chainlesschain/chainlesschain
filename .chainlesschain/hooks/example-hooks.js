/**
 * Example Script Hooks
 *
 * 这个文件展示了如何使用 JavaScript 创建自定义钩子
 * 将此文件放在 .chainlesschain/hooks/ 目录下，系统会自动加载
 *
 * @example
 * // 钩子系统会自动导入这个文件并注册 hooks 数组中的所有钩子
 */

module.exports = {
  hooks: [
    // ==================== 工具使用验证 ====================
    {
      event: 'PreToolUse',
      name: 'custom:validate-file-paths',
      type: 'async',
      priority: 100,
      description: 'Validate file paths for security',
      // 只匹配文件相关工具
      matcher: /^tool_file/,
      timeout: 5000,

      /**
       * 验证文件路径安全性
       */
      handler: async ({ data, context }) => {
        const { toolName, params } = data;
        const filePath = params.filePath || params.path || '';

        // 禁止访问敏感目录
        const sensitivePatterns = [
          /\.env/i,
          /credentials/i,
          /secrets/i,
          /\.ssh/i,
          /\.aws/i,
          /password/i,
        ];

        for (const pattern of sensitivePatterns) {
          if (pattern.test(filePath)) {
            return {
              prevent: true,
              reason: `Access to sensitive file blocked: ${filePath}`,
            };
          }
        }

        // 禁止删除非临时目录的文件
        if (toolName === 'tool_file_delete') {
          const allowedDeletePaths = ['/tmp/', '/temp/', '/.cache/'];
          const isAllowed = allowedDeletePaths.some((p) => filePath.includes(p));

          if (!isAllowed && !params.confirmed) {
            return {
              prevent: true,
              reason: 'File deletion requires explicit confirmation or must be in temp directory',
            };
          }
        }

        return { result: 'continue' };
      },
    },

    // ==================== 工具使用统计 ====================
    {
      event: 'PostToolUse',
      name: 'custom:tool-usage-stats',
      type: 'async',
      priority: 900,
      description: 'Collect tool usage statistics',

      handler: async ({ data }) => {
        const { toolName, executionTime, success } = data;

        // 记录到内存统计 (实际应用中可以写入数据库)
        if (!global.toolUsageStats) {
          global.toolUsageStats = {};
        }

        if (!global.toolUsageStats[toolName]) {
          global.toolUsageStats[toolName] = {
            totalCalls: 0,
            successCalls: 0,
            totalTime: 0,
          };
        }

        const stats = global.toolUsageStats[toolName];
        stats.totalCalls++;
        if (success) stats.successCalls++;
        stats.totalTime += executionTime;

        // 每 100 次调用打印一次统计
        if (stats.totalCalls % 100 === 0) {
          console.log(`[ToolStats] ${toolName}: ${stats.totalCalls} calls, ${stats.successCalls} success, avg ${Math.round(stats.totalTime / stats.totalCalls)}ms`);
        }

        return { result: 'continue' };
      },
    },

    // ==================== 用户输入处理 ====================
    {
      event: 'UserPromptSubmit',
      name: 'custom:prompt-preprocessor',
      type: 'async',
      priority: 200,
      description: 'Preprocess user prompts',

      handler: async ({ data, context }) => {
        const { prompt } = data;

        // 检测并替换敏感信息
        let processedPrompt = prompt;

        // 简单的邮箱脱敏示例
        processedPrompt = processedPrompt.replace(/[\w.-]+@[\w.-]+\.\w+/g, '[EMAIL_REDACTED]');

        // 简单的手机号脱敏示例 (中国手机号)
        processedPrompt = processedPrompt.replace(/1[3-9]\d{9}/g, '[PHONE_REDACTED]');

        if (processedPrompt !== prompt) {
          return {
            result: 'modify',
            data: { prompt: processedPrompt },
          };
        }

        return { result: 'continue' };
      },
    },

    // ==================== 会话生命周期 ====================
    {
      event: 'SessionStart',
      name: 'custom:session-initializer',
      type: 'async',
      priority: 100,
      description: 'Initialize session context',

      handler: async ({ data, context }) => {
        const { sessionId } = data;

        console.log(`[Session] New session started: ${sessionId}`);

        // 可以在这里加载用户偏好、历史上下文等
        // 例如: await loadUserPreferences(sessionId);

        return { result: 'continue' };
      },
    },

    {
      event: 'SessionEnd',
      name: 'custom:session-cleanup',
      type: 'async',
      priority: 900,
      description: 'Cleanup session resources',

      handler: async ({ data }) => {
        const { sessionId, reason } = data;

        console.log(`[Session] Session ended: ${sessionId}, reason: ${reason}`);

        // 可以在这里保存会话状态、清理临时文件等
        // 例如: await saveSessionState(sessionId);

        return { result: 'continue' };
      },
    },

    // ==================== 上下文压缩 ====================
    {
      event: 'PreCompact',
      name: 'custom:pre-compact-saver',
      type: 'async',
      priority: 100,
      description: 'Save important data before context compression',

      handler: async ({ data, context }) => {
        const { sessionId, messageCount } = data;

        console.log(`[Compact] About to compress session ${sessionId} with ${messageCount} messages`);

        // 这里可以提取重要信息保存到永久记忆
        // 例如: await extractAndSaveKeyInsights(sessionId);

        return { result: 'continue' };
      },
    },

    // ==================== 错误处理 ====================
    {
      event: 'IPCError',
      name: 'custom:error-reporter',
      type: 'async',
      priority: 100,
      description: 'Report IPC errors',

      handler: async ({ data }) => {
        const { channel, error } = data;

        // 记录错误
        console.error(`[IPCError] Channel: ${channel}, Error: ${error.message}`);

        // 可以在这里发送错误报告、触发告警等
        // 例如: await sendErrorAlert(channel, error);

        return { result: 'continue' };
      },
    },

    // ==================== Agent 任务监控 ====================
    {
      event: 'TaskAssigned',
      name: 'custom:task-logger',
      type: 'async',
      priority: 500,
      description: 'Log task assignments',

      handler: async ({ data }) => {
        const { taskId, agentId, taskType, description } = data;

        console.log(`[Task] Assigned: ${taskId} -> ${agentId} (${taskType}): ${description?.substring(0, 50)}...`);

        return { result: 'continue' };
      },
    },

    {
      event: 'TaskCompleted',
      name: 'custom:task-reporter',
      type: 'async',
      priority: 500,
      description: 'Report task completion',

      handler: async ({ data }) => {
        const { taskId, agentId, success, executionTime } = data;

        const status = success ? 'SUCCESS' : 'FAILED';
        console.log(`[Task] ${status}: ${taskId} by ${agentId} in ${executionTime}ms`);

        return { result: 'continue' };
      },
    },
  ],
};

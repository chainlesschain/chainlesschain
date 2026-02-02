/**
 * Prompt Compressor IPC 处理器
 *
 * 提供 Prompt 压缩功能的前端访问接口
 * 支持智能压缩策略控制、统计监控、手动压缩操作
 *
 * 功能：
 * - 压缩策略配置（去重、截断、总结）
 * - 手动压缩消息
 * - 压缩统计和建议
 * - 压缩预览
 *
 * @module prompt-compressor-ipc
 */

const { logger } = require('../utils/logger.js');
const defaultIpcGuard = require('../ipc/ipc-guard');
const { PromptCompressor, estimateTokens } = require('./prompt-compressor');

// 模块级别的实例
let compressorInstance = null;

// 压缩历史记录（用于统计）
let compressionHistory = [];
const MAX_HISTORY_SIZE = 100;

/**
 * 获取或创建 PromptCompressor 实例
 * @param {Object} options - 配置选项
 * @returns {PromptCompressor}
 */
function getOrCreateCompressor(options = {}) {
  if (!compressorInstance) {
    compressorInstance = new PromptCompressor(options);
  }
  return compressorInstance;
}

/**
 * 记录压缩历史
 * @param {Object} result - 压缩结果
 */
function recordCompressionHistory(result) {
  compressionHistory.push({
    timestamp: Date.now(),
    originalTokens: result.originalTokens,
    compressedTokens: result.compressedTokens,
    compressionRatio: result.compressionRatio,
    strategy: result.strategy,
    tokensSaved: result.tokensSaved,
    processingTime: result.processingTime,
  });

  // 保持历史记录在限制内
  if (compressionHistory.length > MAX_HISTORY_SIZE) {
    compressionHistory = compressionHistory.slice(-MAX_HISTORY_SIZE);
  }
}

/**
 * 计算压缩统计
 * @returns {Object} 统计数据
 */
function calculateCompressionStats() {
  if (compressionHistory.length === 0) {
    return {
      totalCompressions: 0,
      totalTokensSaved: 0,
      averageCompressionRatio: 1.0,
      averageProcessingTime: 0,
      strategyDistribution: {},
      recentCompressions: [],
    };
  }

  const totalTokensSaved = compressionHistory.reduce((sum, h) => sum + h.tokensSaved, 0);
  const totalOriginalTokens = compressionHistory.reduce((sum, h) => sum + h.originalTokens, 0);
  const avgRatio = totalOriginalTokens > 0
    ? compressionHistory.reduce((sum, h) => sum + h.compressedTokens, 0) / totalOriginalTokens
    : 1.0;
  const avgTime = compressionHistory.reduce((sum, h) => sum + h.processingTime, 0) / compressionHistory.length;

  // 策略分布
  const strategyDistribution = {};
  for (const h of compressionHistory) {
    const strategies = h.strategy.split('+');
    for (const s of strategies) {
      strategyDistribution[s] = (strategyDistribution[s] || 0) + 1;
    }
  }

  return {
    totalCompressions: compressionHistory.length,
    totalTokensSaved,
    averageCompressionRatio: avgRatio,
    averageProcessingTime: Math.round(avgTime),
    strategyDistribution,
    recentCompressions: compressionHistory.slice(-10).reverse(),
  };
}

/**
 * 注册 Prompt Compressor IPC 处理器
 * @param {Object} dependencies - 依赖
 * @param {Object} [dependencies.ipcMain] - IPC 主进程对象
 * @param {Object} [dependencies.ipcGuard] - IPC 防重复注册守卫
 * @param {Object} [dependencies.llmManager] - LLM 管理器（用于智能总结）
 * @param {Object} [dependencies.compressor] - Compressor 实例
 */
function registerPromptCompressorIPC({
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
  llmManager,
  compressor: injectedCompressor,
} = {}) {
  const ipcGuard = injectedIpcGuard || defaultIpcGuard;

  // 防止重复注册
  if (ipcGuard.isModuleRegistered('prompt-compressor-ipc')) {
    logger.info('[Prompt Compressor IPC] Handlers already registered, skipping...');
    return;
  }

  const electron = require('electron');
  const ipcMain = injectedIpcMain || electron.ipcMain;

  // 使用注入的实例或创建新实例
  const compressor = injectedCompressor || getOrCreateCompressor({ llmManager });

  // 如果提供了 llmManager，更新 compressor 的引用
  if (llmManager && !compressor.llmManager) {
    compressor.llmManager = llmManager;
  }

  logger.info('[Prompt Compressor IPC] Registering handlers...');

  // ============================================================
  // 配置管理 (Configuration) - 3 handlers
  // ============================================================

  /**
   * 获取压缩器配置
   * Channel: 'compressor:get-config'
   *
   * @returns {Object} 当前配置
   */
  ipcMain.handle('compressor:get-config', async () => {
    try {
      const stats = compressor.getStats();
      return {
        success: true,
        config: stats,
      };
    } catch (error) {
      logger.error('[Prompt Compressor IPC] 获取配置失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 更新压缩器配置
   * Channel: 'compressor:set-config'
   *
   * @param {Object} config - 新配置
   * @returns {Object} 更新后的配置
   */
  ipcMain.handle('compressor:set-config', async (_event, config) => {
    try {
      if (!config || typeof config !== 'object') {
        throw new Error('Invalid config: must be an object');
      }

      compressor.updateConfig(config);
      const stats = compressor.getStats();

      logger.info('[Prompt Compressor IPC] 配置已更新:', config);

      return {
        success: true,
        config: stats,
      };
    } catch (error) {
      logger.error('[Prompt Compressor IPC] 设置配置失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 重置压缩器配置为默认值
   * Channel: 'compressor:reset-config'
   *
   * @returns {Object} 重置后的配置
   */
  ipcMain.handle('compressor:reset-config', async () => {
    try {
      compressor.updateConfig({
        enableDeduplication: true,
        enableSummarization: false,
        enableTruncation: true,
        maxHistoryMessages: 10,
        maxTotalTokens: 4000,
        similarityThreshold: 0.9,
      });

      const stats = compressor.getStats();
      logger.info('[Prompt Compressor IPC] 配置已重置为默认值');

      return {
        success: true,
        config: stats,
      };
    } catch (error) {
      logger.error('[Prompt Compressor IPC] 重置配置失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // ============================================================
  // 压缩操作 (Compression Operations) - 4 handlers
  // ============================================================

  /**
   * 压缩消息数组
   * Channel: 'compressor:compress'
   *
   * @param {Object} options - 压缩选项
   * @param {Array} options.messages - 消息数组
   * @param {boolean} [options.preserveSystemMessage=true] - 保留系统消息
   * @param {boolean} [options.preserveLastUserMessage=true] - 保留最后用户消息
   * @returns {Object} 压缩结果
   */
  ipcMain.handle('compressor:compress', async (_event, options = {}) => {
    try {
      const { messages, preserveSystemMessage, preserveLastUserMessage } = options;

      if (!Array.isArray(messages)) {
        throw new Error('messages must be an array');
      }

      const result = await compressor.compress(messages, {
        preserveSystemMessage,
        preserveLastUserMessage,
      });

      // 记录到历史
      recordCompressionHistory(result);

      return {
        success: true,
        ...result,
      };
    } catch (error) {
      logger.error('[Prompt Compressor IPC] 压缩失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 预览压缩效果（不实际执行）
   * Channel: 'compressor:preview'
   *
   * @param {Object} options - 预览选项
   * @param {Array} options.messages - 消息数组
   * @returns {Object} 预览结果（包含估算的压缩效果）
   */
  ipcMain.handle('compressor:preview', async (_event, options = {}) => {
    try {
      const { messages } = options;

      if (!Array.isArray(messages)) {
        throw new Error('messages must be an array');
      }

      // 计算原始 Token 数
      const originalTokens = messages.reduce((sum, msg) => {
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        return sum + estimateTokens(content);
      }, 0);

      // 估算压缩后的 Token 数
      const stats = compressor.getStats();
      let estimatedTokens = originalTokens;
      const applicableStrategies = [];

      // 估算去重效果
      if (stats.strategies.deduplication && messages.length > 2) {
        // 假设去重可以减少 10-20% 的消息
        estimatedTokens *= 0.85;
        applicableStrategies.push('deduplication');
      }

      // 估算截断效果
      if (stats.strategies.truncation && messages.length > stats.config.maxHistoryMessages) {
        const ratio = stats.config.maxHistoryMessages / messages.length;
        estimatedTokens *= ratio;
        applicableStrategies.push('truncation');
      }

      // 估算总结效果
      if (stats.strategies.summarization && estimatedTokens > stats.config.maxTotalTokens) {
        estimatedTokens = stats.config.maxTotalTokens * 0.7;
        applicableStrategies.push('summarization');
      }

      const estimatedRatio = originalTokens > 0 ? estimatedTokens / originalTokens : 1.0;

      return {
        success: true,
        preview: {
          originalTokens,
          estimatedCompressedTokens: Math.round(estimatedTokens),
          estimatedCompressionRatio: estimatedRatio,
          estimatedTokensSaved: Math.round(originalTokens - estimatedTokens),
          applicableStrategies,
          recommendation: estimatedRatio < 0.8
            ? 'Compression recommended - significant token savings possible'
            : estimatedRatio < 0.95
              ? 'Moderate compression possible'
              : 'Compression may not be necessary',
        },
      };
    } catch (error) {
      logger.error('[Prompt Compressor IPC] 预览失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 估算消息的 Token 数量
   * Channel: 'compressor:estimate-tokens'
   *
   * @param {Object} options - 估算选项
   * @param {string|Array} options.content - 内容（字符串或消息数组）
   * @returns {Object} Token 估算结果
   */
  ipcMain.handle('compressor:estimate-tokens', async (_event, options = {}) => {
    try {
      const { content } = options;

      if (Array.isArray(content)) {
        // 消息数组
        const breakdown = content.map((msg, index) => {
          const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
          return {
            index,
            role: msg.role,
            tokens: estimateTokens(text),
            charCount: text.length,
          };
        });

        const total = breakdown.reduce((sum, b) => sum + b.tokens, 0);

        return {
          success: true,
          tokens: total,
          breakdown,
        };
      } else {
        // 单个字符串
        const text = typeof content === 'string' ? content : JSON.stringify(content);
        const tokens = estimateTokens(text);

        return {
          success: true,
          tokens,
          charCount: text.length,
        };
      }
    } catch (error) {
      logger.error('[Prompt Compressor IPC] 估算 Token 失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 获取压缩建议
   * Channel: 'compressor:get-recommendations'
   *
   * @param {Object} options - 选项
   * @param {Array} options.messages - 消息数组
   * @param {number} [options.targetTokens] - 目标 Token 数
   * @returns {Object} 压缩建议
   */
  ipcMain.handle('compressor:get-recommendations', async (_event, options = {}) => {
    try {
      const { messages, targetTokens } = options;

      if (!Array.isArray(messages)) {
        throw new Error('messages must be an array');
      }

      // 计算当前 Token 数
      const currentTokens = messages.reduce((sum, msg) => {
        const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        return sum + estimateTokens(text);
      }, 0);

      const target = targetTokens || compressor.maxTotalTokens;
      const recommendations = [];

      // 检查是否需要压缩
      if (currentTokens <= target) {
        return {
          success: true,
          recommendations: [{
            action: 'none',
            priority: 'low',
            description: 'No compression needed - current token count is within target',
            currentTokens,
            targetTokens: target,
          }],
        };
      }

      // 计算需要减少的 Token 数
      const tokensToReduce = currentTokens - target;
      const reductionRatio = tokensToReduce / currentTokens;

      // 建议 1: 截断历史
      if (messages.length > 5) {
        const avgTokensPerMessage = currentTokens / messages.length;
        const messagesToRemove = Math.ceil(tokensToReduce / avgTokensPerMessage);
        recommendations.push({
          action: 'truncate',
          priority: reductionRatio > 0.5 ? 'high' : 'medium',
          description: `Remove ${messagesToRemove} older messages to reduce ~${Math.round(messagesToRemove * avgTokensPerMessage)} tokens`,
          estimatedSavings: Math.round(messagesToRemove * avgTokensPerMessage),
        });
      }

      // 建议 2: 去重
      const uniqueContents = new Set();
      let duplicateCount = 0;
      for (const msg of messages) {
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        if (uniqueContents.has(content)) {
          duplicateCount++;
        } else {
          uniqueContents.add(content);
        }
      }
      if (duplicateCount > 0) {
        recommendations.push({
          action: 'deduplicate',
          priority: 'high',
          description: `Remove ${duplicateCount} duplicate messages`,
          estimatedSavings: Math.round((duplicateCount / messages.length) * currentTokens),
        });
      }

      // 建议 3: 总结
      if (currentTokens > target * 2) {
        recommendations.push({
          action: 'summarize',
          priority: 'medium',
          description: 'Use LLM to summarize conversation history into a condensed form',
          estimatedSavings: Math.round(currentTokens * 0.6),
          requiresLLM: true,
        });
      }

      // 建议 4: 移除系统消息（如果有多个）
      const systemMessages = messages.filter(m => m.role === 'system');
      if (systemMessages.length > 1) {
        const extraSystemTokens = systemMessages.slice(1).reduce((sum, msg) => {
          return sum + estimateTokens(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content));
        }, 0);
        recommendations.push({
          action: 'consolidate_system',
          priority: 'low',
          description: `Consolidate ${systemMessages.length} system messages into one`,
          estimatedSavings: Math.round(extraSystemTokens * 0.5),
        });
      }

      // 排序建议（按优先级）
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

      return {
        success: true,
        currentTokens,
        targetTokens: target,
        tokensToReduce,
        recommendations,
      };
    } catch (error) {
      logger.error('[Prompt Compressor IPC] 获取建议失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // ============================================================
  // 统计信息 (Statistics) - 3 handlers
  // ============================================================

  /**
   * 获取压缩统计信息
   * Channel: 'compressor:get-stats'
   *
   * @returns {Object} 统计数据
   */
  ipcMain.handle('compressor:get-stats', async () => {
    try {
      const stats = calculateCompressionStats();
      return {
        success: true,
        stats,
      };
    } catch (error) {
      logger.error('[Prompt Compressor IPC] 获取统计失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 获取压缩历史
   * Channel: 'compressor:get-history'
   *
   * @param {Object} [options] - 选项
   * @param {number} [options.limit=20] - 限制数量
   * @returns {Object} 压缩历史
   */
  ipcMain.handle('compressor:get-history', async (_event, options = {}) => {
    try {
      const limit = options.limit || 20;
      const history = compressionHistory.slice(-limit).reverse();

      return {
        success: true,
        history,
        totalCount: compressionHistory.length,
      };
    } catch (error) {
      logger.error('[Prompt Compressor IPC] 获取历史失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 清除压缩历史
   * Channel: 'compressor:clear-history'
   *
   * @returns {Object} 操作结果
   */
  ipcMain.handle('compressor:clear-history', async () => {
    try {
      const count = compressionHistory.length;
      compressionHistory = [];
      logger.info('[Prompt Compressor IPC] 压缩历史已清除，共', count, '条记录');

      return {
        success: true,
        clearedCount: count,
      };
    } catch (error) {
      logger.error('[Prompt Compressor IPC] 清除历史失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // 标记模块为已注册
  ipcGuard.markModuleRegistered('prompt-compressor-ipc');

  logger.info('[Prompt Compressor IPC] ✓ All handlers registered (10 handlers: 3 config + 4 compression + 3 stats)');
}

/**
 * 注销 Prompt Compressor IPC 处理器
 * @param {Object} [dependencies] - 依赖
 */
function unregisterPromptCompressorIPC({ ipcMain: injectedIpcMain, ipcGuard: injectedIpcGuard } = {}) {
  const ipcGuard = injectedIpcGuard || defaultIpcGuard;

  if (!ipcGuard.isModuleRegistered('prompt-compressor-ipc')) {
    return;
  }

  const electron = require('electron');
  const ipcMain = injectedIpcMain || electron.ipcMain;

  // 所有 channel 名称
  const channels = [
    'compressor:get-config',
    'compressor:set-config',
    'compressor:reset-config',
    'compressor:compress',
    'compressor:preview',
    'compressor:estimate-tokens',
    'compressor:get-recommendations',
    'compressor:get-stats',
    'compressor:get-history',
    'compressor:clear-history',
  ];

  for (const channel of channels) {
    ipcMain.removeHandler(channel);
  }

  ipcGuard.unmarkModuleRegistered('prompt-compressor-ipc');
  logger.info('[Prompt Compressor IPC] Handlers unregistered');
}

module.exports = {
  registerPromptCompressorIPC,
  unregisterPromptCompressorIPC,
  // 导出用于测试
  getOrCreateCompressor,
  calculateCompressionStats,
};

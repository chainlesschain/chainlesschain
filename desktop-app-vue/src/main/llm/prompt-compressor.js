/**
 * Prompt 压缩器模块
 * 实现智能 Prompt 压缩策略，减少 Token 使用量
 *
 * 策略：
 * 1. 消息去重：移除重复或相似的消息
 * 2. 历史截断：保留最近的 N 条消息，截断旧消息
 * 3. 智能总结：对长历史使用 LLM 生成摘要
 *
 * 目标：压缩率 0.6-0.7 (节省 30-40% tokens)
 *
 * @module prompt-compressor
 */

const crypto = require('crypto');

/**
 * 计算文本的 MD5 哈希
 * @param {string} text - 输入文本
 * @returns {string} MD5 哈希值
 */
function md5Hash(text) {
  return crypto.createHash('md5').update(text).digest('hex');
}

/**
 * 估算消息的 Token 数量（粗略估计）
 * 规则：英文 1 token ≈ 4 字符，中文 1 token ≈ 1-2 字符
 * @param {string} text - 文本内容
 * @returns {number} 估算的 Token 数
 */
function estimateTokens(text) {
  if (!text) return 0;

  // 分别计算中文和英文字符
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const otherChars = text.length - chineseChars;

  // 中文按 1.5 字符/token，英文按 4 字符/token
  return Math.ceil(chineseChars / 1.5 + otherChars / 4);
}

/**
 * 计算两个字符串的相似度（简化的 Jaccard 相似度）
 * @param {string} str1 - 字符串1
 * @param {string} str2 - 字符串2
 * @returns {number} 相似度 (0-1)
 */
function calculateSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;
  if (str1 === str2) return 1;

  // 分词（简单按字符分割）
  const tokens1 = new Set(str1.split(''));
  const tokens2 = new Set(str2.split(''));

  // 计算交集和并集
  const intersection = new Set([...tokens1].filter(x => tokens2.has(x)));
  const union = new Set([...tokens1, ...tokens2]);

  return intersection.size / union.size;
}

class PromptCompressor {
  /**
   * 创建 Prompt 压缩器
   * @param {Object} options - 配置选项
   * @param {boolean} [options.enableDeduplication=true] - 启用消息去重
   * @param {boolean} [options.enableSummarization=false] - 启用智能总结（需要 LLM）
   * @param {boolean} [options.enableTruncation=true] - 启用历史截断
   * @param {number} [options.maxHistoryMessages=10] - 最大历史消息数
   * @param {number} [options.maxTotalTokens=4000] - 最大总 Token 数
   * @param {number} [options.similarityThreshold=0.9] - 相似度阈值（>= 此值视为重复）
   * @param {Object} [options.llmManager=null] - LLM 管理器（用于总结）
   */
  constructor(options = {}) {
    this.enableDeduplication = options.enableDeduplication !== false;
    this.enableSummarization = options.enableSummarization || false;
    this.enableTruncation = options.enableTruncation !== false;
    this.maxHistoryMessages = options.maxHistoryMessages || 10;
    this.maxTotalTokens = options.maxTotalTokens || 4000;
    this.similarityThreshold = options.similarityThreshold || 0.9;
    this.llmManager = options.llmManager || null;

    console.log('[PromptCompressor] 初始化完成，配置:', {
      去重: this.enableDeduplication,
      总结: this.enableSummarization,
      截断: this.enableTruncation,
      最大消息数: this.maxHistoryMessages,
      最大Tokens: this.maxTotalTokens,
    });
  }

  /**
   * 压缩消息数组
   * @param {Array} messages - 消息数组 [{role, content}, ...]
   * @param {Object} options - 压缩选项
   * @param {boolean} [options.preserveSystemMessage=true] - 保留 system 消息
   * @param {boolean} [options.preserveLastUserMessage=true] - 保留最后一条用户消息
   * @returns {Promise<Object>} 压缩结果 {messages, originalTokens, compressedTokens, compressionRatio, strategy}
   */
  async compress(messages, options = {}) {
    const startTime = Date.now();

    if (!Array.isArray(messages) || messages.length === 0) {
      return {
        messages: [],
        originalTokens: 0,
        compressedTokens: 0,
        compressionRatio: 1.0,
        strategy: 'none',
        processingTime: 0,
      };
    }

    const preserveSystemMessage = options.preserveSystemMessage !== false;
    const preserveLastUserMessage = options.preserveLastUserMessage !== false;

    // 计算原始 Token 数
    const originalTokens = messages.reduce((sum, msg) => {
      return sum + estimateTokens(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content));
    }, 0);

    console.log(`[PromptCompressor] 开始压缩，原始消息数: ${messages.length}, 估算 Tokens: ${originalTokens}`);

    let compressedMessages = [...messages];
    let appliedStrategies = [];

    // 策略 1: 消息去重
    if (this.enableDeduplication && compressedMessages.length > 2) {
      compressedMessages = this._deduplicateMessages(compressedMessages, {
        preserveSystemMessage,
        preserveLastUserMessage,
      });
      appliedStrategies.push('deduplication');
    }

    // 策略 2: 历史截断（保留最近的消息）
    if (this.enableTruncation && compressedMessages.length > this.maxHistoryMessages) {
      compressedMessages = this._truncateHistory(compressedMessages, {
        preserveSystemMessage,
        preserveLastUserMessage,
      });
      appliedStrategies.push('truncation');
    }

    // 策略 3: 智能总结（如果启用且有 LLM Manager）
    if (this.enableSummarization && this.llmManager && compressedMessages.length > 5) {
      const currentTokens = compressedMessages.reduce((sum, msg) => {
        return sum + estimateTokens(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content));
      }, 0);

      // 如果 Token 数仍然超过阈值，进行总结
      if (currentTokens > this.maxTotalTokens) {
        try {
          compressedMessages = await this._summarizeHistory(compressedMessages, {
            preserveSystemMessage,
            preserveLastUserMessage,
          });
          appliedStrategies.push('summarization');
        } catch (summaryError) {
          console.error('[PromptCompressor] 总结失败，跳过总结策略:', summaryError.message);
        }
      }
    }

    // 计算压缩后的 Token 数
    const compressedTokens = compressedMessages.reduce((sum, msg) => {
      return sum + estimateTokens(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content));
    }, 0);

    const compressionRatio = originalTokens > 0 ? compressedTokens / originalTokens : 1.0;
    const processingTime = Date.now() - startTime;

    console.log(`[PromptCompressor] 压缩完成，压缩后消息数: ${compressedMessages.length}, 估算 Tokens: ${compressedTokens}, 压缩率: ${compressionRatio.toFixed(2)}, 耗时: ${processingTime}ms`);
    console.log(`[PromptCompressor] 应用策略: ${appliedStrategies.join(', ') || 'none'}`);

    return {
      messages: compressedMessages,
      originalTokens,
      compressedTokens,
      compressionRatio,
      strategy: appliedStrategies.join('+') || 'none',
      processingTime,
      tokensSaved: originalTokens - compressedTokens,
    };
  }

  /**
   * 消息去重（移除重复或高度相似的消息）
   * @private
   */
  _deduplicateMessages(messages, options) {
    const { preserveSystemMessage, preserveLastUserMessage } = options;

    // 分离出需要保留的消息
    const systemMessages = preserveSystemMessage
      ? messages.filter(msg => msg.role === 'system')
      : [];

    const lastUserMessage = preserveLastUserMessage
      ? [...messages].reverse().find(msg => msg.role === 'user')
      : null;

    // 待去重的消息（排除需要保留的）
    const messagesToProcess = messages.filter(msg => {
      if (preserveSystemMessage && msg.role === 'system') return false;
      if (preserveLastUserMessage && lastUserMessage && msg === lastUserMessage) return false;
      return true;
    });

    // 使用哈希去重
    const seen = new Map(); // hash -> message
    const deduplicated = [];

    for (const msg of messagesToProcess) {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      const hash = md5Hash(content);

      // 检查是否已存在相同消息
      if (seen.has(hash)) {
        console.log(`[PromptCompressor] 发现重复消息 (exact match): ${content.substring(0, 50)}...`);
        continue;
      }

      // 检查是否存在高度相似的消息
      let isDuplicate = false;
      for (const [existingHash, existingMsg] of seen.entries()) {
        const existingContent = typeof existingMsg.content === 'string'
          ? existingMsg.content
          : JSON.stringify(existingMsg.content);

        const similarity = calculateSimilarity(content, existingContent);
        if (similarity >= this.similarityThreshold) {
          console.log(`[PromptCompressor] 发现相似消息 (similarity: ${similarity.toFixed(2)}): ${content.substring(0, 50)}...`);
          isDuplicate = true;
          break;
        }
      }

      if (!isDuplicate) {
        seen.set(hash, msg);
        deduplicated.push(msg);
      }
    }

    // 重新组合消息（保留的消息放回原位）
    const result = [
      ...systemMessages,
      ...deduplicated,
    ];

    if (preserveLastUserMessage && lastUserMessage && !result.includes(lastUserMessage)) {
      result.push(lastUserMessage);
    }

    console.log(`[PromptCompressor] 去重: ${messages.length} -> ${result.length} 条消息`);
    return result;
  }

  /**
   * 历史截断（保留最近的消息）
   * @private
   */
  _truncateHistory(messages, options) {
    const { preserveSystemMessage, preserveLastUserMessage } = options;

    // 分离 system 消息
    const systemMessages = preserveSystemMessage
      ? messages.filter(msg => msg.role === 'system')
      : [];

    const nonSystemMessages = messages.filter(msg => msg.role !== 'system');

    // 保留最后一条用户消息
    const lastUserMessage = preserveLastUserMessage
      ? [...nonSystemMessages].reverse().find(msg => msg.role === 'user')
      : null;

    // 计算可以保留的消息数（扣除 system 和最后一条用户消息）
    let availableSlots = this.maxHistoryMessages - systemMessages.length;
    if (lastUserMessage) availableSlots -= 1;

    // 从最新的消息开始保留
    const otherMessages = nonSystemMessages.filter(msg => msg !== lastUserMessage);
    const recentMessages = otherMessages.slice(-availableSlots);

    // 重新组合
    const result = [
      ...systemMessages,
      ...recentMessages,
    ];

    if (lastUserMessage && !result.includes(lastUserMessage)) {
      result.push(lastUserMessage);
    }

    console.log(`[PromptCompressor] 截断: ${messages.length} -> ${result.length} 条消息（保留最近 ${this.maxHistoryMessages} 条）`);
    return result;
  }

  /**
   * 智能总结（使用 LLM 生成历史摘要）
   * @private
   */
  async _summarizeHistory(messages, options) {
    const { preserveSystemMessage, preserveLastUserMessage } = options;

    // 分离出需要总结的消息
    const systemMessages = preserveSystemMessage
      ? messages.filter(msg => msg.role === 'system')
      : [];

    const lastUserMessage = preserveLastUserMessage
      ? [...messages].reverse().find(msg => msg.role === 'user')
      : null;

    const messagesToSummarize = messages.filter(msg => {
      if (preserveSystemMessage && msg.role === 'system') return false;
      if (preserveLastUserMessage && lastUserMessage && msg === lastUserMessage) return false;
      return true;
    });

    if (messagesToSummarize.length < 3) {
      console.log('[PromptCompressor] 消息太少，跳过总结');
      return messages;
    }

    // 构建总结提示词
    const historyText = messagesToSummarize.map(msg => {
      const role = msg.role === 'user' ? '用户' : 'AI';
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      return `${role}: ${content}`;
    }).join('\n\n');

    const summaryPrompt = `请总结以下对话历史的关键信息，保留重要的上下文和事实，使用简洁的语言：

${historyText}

总结：`;

    try {
      console.log('[PromptCompressor] 调用 LLM 生成历史总结...');
      const summaryResult = await this.llmManager.query(summaryPrompt, {
        max_tokens: 500,
        temperature: 0.3,
      });

      const summary = summaryResult.text || summaryResult.content || '';

      if (!summary) {
        throw new Error('LLM 返回空总结');
      }

      console.log(`[PromptCompressor] 生成总结成功: ${summary.substring(0, 100)}...`);

      // 创建总结消息
      const summaryMessage = {
        role: 'system',
        content: `[历史对话总结]\n${summary}`,
      };

      // 重新组合消息
      const result = [
        ...systemMessages,
        summaryMessage,
      ];

      if (lastUserMessage && !result.includes(lastUserMessage)) {
        result.push(lastUserMessage);
      }

      console.log(`[PromptCompressor] 总结: ${messages.length} -> ${result.length} 条消息`);
      return result;

    } catch (error) {
      console.error('[PromptCompressor] 生成总结失败:', error.message);
      throw error;
    }
  }

  /**
   * 获取压缩统计信息
   * @returns {Object} 统计信息
   */
  getStats() {
    return {
      enabled: true,
      strategies: {
        deduplication: this.enableDeduplication,
        summarization: this.enableSummarization,
        truncation: this.enableTruncation,
      },
      config: {
        maxHistoryMessages: this.maxHistoryMessages,
        maxTotalTokens: this.maxTotalTokens,
        similarityThreshold: this.similarityThreshold,
      },
    };
  }

  /**
   * 更新配置
   * @param {Object} options - 新的配置选项
   */
  updateConfig(options) {
    if (options.enableDeduplication !== undefined) {
      this.enableDeduplication = options.enableDeduplication;
    }
    if (options.enableSummarization !== undefined) {
      this.enableSummarization = options.enableSummarization;
    }
    if (options.enableTruncation !== undefined) {
      this.enableTruncation = options.enableTruncation;
    }
    if (options.maxHistoryMessages !== undefined) {
      this.maxHistoryMessages = options.maxHistoryMessages;
    }
    if (options.maxTotalTokens !== undefined) {
      this.maxTotalTokens = options.maxTotalTokens;
    }
    if (options.similarityThreshold !== undefined) {
      this.similarityThreshold = options.similarityThreshold;
    }

    console.log('[PromptCompressor] 配置已更新:', this.getStats());
  }
}

module.exports = {
  PromptCompressor,
  estimateTokens, // 导出供其他模块使用
};

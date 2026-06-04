/**
 * SessionManager — compression methods (prototype mixin).
 * Split verbatim from session-manager.js; mixed into SessionManager.prototype.
 * Methods reference `this` (db / sessionCache / llmManager / ...) exactly as before.
 *
 * @module llm/session-manager-compression
 */
const { logger } = require("../utils/logger.js");
const { PromptCompressor } = require("./prompt-compressor");

module.exports = {
  async compressSession(sessionId) {
    try {
      const session = await this.loadSession(sessionId);

      if (session.messages.length <= this.maxHistoryMessages) {
        logger.info("[SessionManager] 消息数未超过最大限制，跳过压缩");
        return { compressed: false };
      }

      logger.info("[SessionManager] 开始压缩会话:", sessionId);

      // 🚀 Phase 3: 预压缩记忆刷新
      if (
        this.enableMemoryFlush &&
        this.permanentMemoryManager &&
        this.llmManager
      ) {
        try {
          await this.flushMemoryBeforeCompaction(sessionId);
        } catch (error) {
          logger.error("[SessionManager] 预压缩记忆刷新失败:", error.message);
          // 继续压缩流程，不因记忆刷新失败而中断
        }
      }

      // 使用 PromptCompressor 压缩
      const result = await this.promptCompressor.compress(session.messages, {
        preserveSystemMessage: true,
        preserveLastUserMessage: true,
      });

      // 保存压缩后的消息
      session.messages = result.messages;
      session.compressedHistory = JSON.stringify({
        originalCount: result.originalTokens,
        compressedCount: result.compressedTokens,
        compressionRatio: result.compressionRatio,
        strategy: result.strategy,
        compressedAt: Date.now(),
      });

      // 更新元数据
      session.metadata.compressionCount =
        (session.metadata.compressionCount || 0) + 1;
      session.metadata.totalTokensSaved =
        (session.metadata.totalTokensSaved || 0) +
        (result.originalTokens - result.compressedTokens);

      // 保存
      await this.saveSession(sessionId);

      logger.info("[SessionManager] 压缩完成:", {
        原始Tokens: result.originalTokens,
        压缩后Tokens: result.compressedTokens,
        压缩率: result.compressionRatio.toFixed(2),
        策略: result.strategy,
      });

      this.emit("session-compressed", {
        sessionId,
        compressionRatio: result.compressionRatio,
        tokensSaved: result.originalTokens - result.compressedTokens,
      });

      return {
        compressed: true,
        ...result,
      };
    } catch (error) {
      logger.error("[SessionManager] 压缩会话失败:", error);
      throw error;
    }
  },

  async flushMemoryBeforeCompaction(sessionId) {
    logger.info("[SessionManager] 开始预压缩记忆刷新:", sessionId);

    try {
      const session = await this.loadSession(sessionId);

      // 提取最近的消息（避免传递过多上下文）
      const recentMessages = session.messages.slice(-10);

      if (recentMessages.length === 0) {
        logger.info("[SessionManager] 没有消息需要提取记忆");
        return;
      }

      // 构建 LLM Prompt
      const extractionPrompt = this.buildMemoryExtractionPrompt(recentMessages);

      // 使用 LLM 提取重要信息
      const response = await this.llmManager.chat({
        model: "qwen2:7b", // 使用本地模型，免费
        messages: [
          {
            role: "system",
            content: `你是一个记忆提取助手。从对话中提取重要信息，分为两类：
1. **今日活动** (保存到 Daily Notes): 对话摘要、完成的任务、待办事项、技术发现
2. **长期记忆** (保存到 MEMORY.md): 用户偏好、架构决策、问题解决方案、重要配置

请以 JSON 格式返回，格式如下：
{
  "dailyNotes": "今日活动的 Markdown 内容",
  "longTermMemory": "长期记忆的 Markdown 内容",
  "shouldSave": true/false
}`,
          },
          {
            role: "user",
            content: extractionPrompt,
          },
        ],
        stream: false,
        temperature: 0.3, // 低温度，确保稳定输出
      });

      // 解析响应
      const extraction = this.parseMemoryExtraction(response.content);

      if (!extraction.shouldSave) {
        logger.info("[SessionManager] LLM 判断无需保存记忆");
        return;
      }

      // 保存到 Daily Notes
      if (extraction.dailyNotes && extraction.dailyNotes.trim()) {
        await this.permanentMemoryManager.writeDailyNote(
          extraction.dailyNotes,
          {
            append: true,
          },
        );
        logger.info("[SessionManager] Daily Notes 已更新");
      }

      // 保存到 MEMORY.md
      if (extraction.longTermMemory && extraction.longTermMemory.trim()) {
        // 根据内容判断章节
        const section = this.detectMemorySection(extraction.longTermMemory);
        await this.permanentMemoryManager.appendToMemory(
          extraction.longTermMemory,
          {
            section,
          },
        );
        logger.info(`[SessionManager] MEMORY.md 已更新 (章节: ${section})`);
      }

      logger.info("[SessionManager] 预压缩记忆刷新完成");
    } catch (error) {
      logger.error("[SessionManager] 预压缩记忆刷新失败:", error);
      throw error;
    }
  },

  buildMemoryExtractionPrompt(messages) {
    const conversationText = messages
      .map((msg, idx) => {
        const role = msg.role === "user" ? "用户" : "AI";
        const content = msg.content.substring(0, 500); // 限制长度
        return `[${idx + 1}] ${role}: ${content}`;
      })
      .join("\n\n");

    return `请从以下对话中提取重要信息：

${conversationText}

请分析并提取：
1. **今日活动**: 对话主题、完成的任务、待办事项、技术发现
2. **长期记忆**: 用户偏好、架构决策、问题解决方案、重要配置

如果没有重要信息需要保存，请设置 shouldSave 为 false。`;
  },

  parseMemoryExtraction(content) {
    try {
      // 尝试提取 JSON 代码块
      const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[1]);
      }

      // 尝试直接解析
      const parsed = JSON.parse(content);
      return parsed;
    } catch (error) {
      logger.warn("[SessionManager] 无法解析 LLM 响应，使用简单模式");

      // 回退：简单提取
      return {
        dailyNotes: `## ${new Date().toLocaleTimeString()} - 对话记录\n\n${content.substring(0, 200)}`,
        longTermMemory: "",
        shouldSave: true,
      };
    }
  },

  detectMemorySection(content) {
    const lowerContent = content.toLowerCase();

    if (lowerContent.includes("偏好") || lowerContent.includes("习惯")) {
      return "🧑 用户偏好";
    }

    if (
      lowerContent.includes("决策") ||
      lowerContent.includes("架构") ||
      lowerContent.includes("设计")
    ) {
      return "🏗️ 架构决策";
    }

    if (
      lowerContent.includes("问题") ||
      lowerContent.includes("错误") ||
      lowerContent.includes("解决")
    ) {
      return "🐛 常见问题解决方案";
    }

    if (
      lowerContent.includes("发现") ||
      lowerContent.includes("技巧") ||
      lowerContent.includes("最佳")
    ) {
      return "📚 重要技术发现";
    }

    if (
      lowerContent.includes("配置") ||
      lowerContent.includes("环境") ||
      lowerContent.includes("变量")
    ) {
      return "🔧 系统配置";
    }

    // 默认章节
    return "📚 重要技术发现";
  },
};

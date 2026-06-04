/**
 * SessionManager — summary methods (prototype mixin).
 * Split verbatim from session-manager.js; mixed into SessionManager.prototype.
 * Methods reference `this` (db / sessionCache / llmManager / ...) exactly as before.
 *
 * @module llm/session-manager-summary
 */
const { logger } = require("../utils/logger.js");

module.exports = {
  _shouldAutoGenerateSummary(session) {
    // 已有摘要且最近更新过，不重新生成
    if (session.metadata.summary && session.metadata.summaryGeneratedAt) {
      const timeSinceLastSummary =
        Date.now() - session.metadata.summaryGeneratedAt;
      // 如果摘要生成后消息数增加不多，不重新生成
      const messagesAfterSummary =
        session.metadata.messageCount -
        (session.metadata.messageCountAtSummary || 0);
      if (messagesAfterSummary < this.autoSummaryThreshold) {
        return false;
      }
    }

    // 消息数达到阈值才生成
    return session.messages.length >= this.autoSummaryThreshold;
  },

  _queueAutoSummary(sessionId) {
    // 避免重复加入队列
    if (!this._summaryQueue.includes(sessionId)) {
      this._summaryQueue.push(sessionId);
      logger.info(
        `[SessionManager] 会话 ${sessionId} 加入自动摘要队列，队列长度: ${this._summaryQueue.length}`,
      );
    }

    // 如果没有正在进行的摘要生成，立即处理
    if (!this._isGeneratingSummary) {
      this._processAutoSummaryQueue();
    }
  },

  async _processAutoSummaryQueue() {
    if (this._isGeneratingSummary || this._summaryQueue.length === 0) {
      return;
    }

    this._isGeneratingSummary = true;

    while (this._summaryQueue.length > 0) {
      const sessionId = this._summaryQueue.shift();

      try {
        await this._generateAutoSummary(sessionId);
      } catch (error) {
        logger.error(
          `[SessionManager] 自动摘要生成失败 ${sessionId}:`,
          error.message,
        );
      }

      // 短暂延迟，避免过于频繁的 LLM 调用
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    this._isGeneratingSummary = false;
  },

  async _generateAutoSummary(sessionId) {
    try {
      const session = await this.loadSession(sessionId);

      // 再次检查是否需要生成
      if (!this._shouldAutoGenerateSummary(session)) {
        logger.info(`[SessionManager] 会话 ${sessionId} 不需要自动摘要，跳过`);
        return null;
      }

      logger.info(`[SessionManager] 开始自动生成摘要: ${sessionId}`);

      const summary = await this.generateSummary(sessionId, {
        useLLM: true,
        maxLength: 200,
      });

      // 记录摘要生成时的消息数
      session.metadata.messageCountAtSummary = session.metadata.messageCount;
      session.metadata.autoSummaryGenerated = true;
      await this.saveSession(sessionId);

      logger.info(`[SessionManager] 自动摘要完成: ${sessionId}`);
      this.emit("auto-summary-generated", { sessionId, summary });

      return summary;
    } catch (error) {
      logger.error(
        `[SessionManager] 自动摘要生成失败 ${sessionId}:`,
        error.message,
      );
      throw error;
    }
  },

  async generateSummary(sessionId, options = {}) {
    const { useLLM = true, maxLength = 200 } = options;

    try {
      const session = await this.loadSession(sessionId);

      if (session.messages.length === 0) {
        return "空会话";
      }

      // 方式1：使用 LLM 生成摘要
      if (useLLM && this.llmManager) {
        const messagesText = session.messages
          .map((msg) => {
            const role = msg.role === "user" ? "用户" : "助手";
            const content =
              typeof msg.content === "string"
                ? msg.content
                : JSON.stringify(msg.content);
            return `${role}: ${content}`;
          })
          .join("\n");

        const prompt = `请用一句话（不超过${maxLength}字）总结以下对话的主要内容：\n\n${messagesText}\n\n摘要：`;

        try {
          const result = await this.llmManager.query(prompt, {
            max_tokens: 100,
            temperature: 0.3,
          });
          const summary = (result.text || result.content || "").trim();

          // 更新会话元数据
          session.metadata.summary = summary;
          session.metadata.summaryGeneratedAt = Date.now();
          await this.saveSession(sessionId);

          logger.info(`[SessionManager] LLM 生成摘要: ${summary}`);
          return summary;
        } catch (llmError) {
          logger.warn(
            "[SessionManager] LLM 摘要生成失败，使用简单摘要:",
            llmError.message,
          );
        }
      }

      // 方式2：简单摘要（提取首条用户消息）
      const firstUserMessage = session.messages.find(
        (msg) => msg.role === "user",
      );
      if (firstUserMessage) {
        const content =
          typeof firstUserMessage.content === "string"
            ? firstUserMessage.content
            : JSON.stringify(firstUserMessage.content);
        const summary =
          content.length > maxLength
            ? content.substring(0, maxLength) + "..."
            : content;

        session.metadata.summary = summary;
        await this.saveSession(sessionId);

        return summary;
      }

      return "无用户消息";
    } catch (error) {
      logger.error("[SessionManager] 生成摘要失败:", error);
      throw error;
    }
  },

  async generateSummariesBatch(options = {}) {
    const { overwrite = false, limit = 50 } = options;

    try {
      const sessions = await this.listSessions({ limit });
      let processed = 0;
      let skipped = 0;

      for (const session of sessions) {
        if (!overwrite && session.metadata?.summary) {
          skipped++;
          continue;
        }

        try {
          await this.generateSummary(session.id, { useLLM: true });
          processed++;
        } catch (err) {
          logger.warn(
            `[SessionManager] 会话 ${session.id} 摘要生成失败:`,
            err.message,
          );
        }
      }

      logger.info(
        `[SessionManager] 批量摘要完成: 处理 ${processed}, 跳过 ${skipped}`,
      );
      return { processed, skipped };
    } catch (error) {
      logger.error("[SessionManager] 批量生成摘要失败:", error);
      throw error;
    }
  },

  startBackgroundSummaryGenerator() {
    if (this._backgroundSummaryTimer) {
      logger.info("[SessionManager] 后台摘要生成器已在运行");
      return;
    }

    logger.info(
      `[SessionManager] 启动后台摘要生成器，间隔: ${this.autoSummaryInterval}ms`,
    );

    this._backgroundSummaryTimer = setInterval(async () => {
      await this._runBackgroundSummaryGeneration();
    }, this.autoSummaryInterval);

    // 立即执行一次
    this._runBackgroundSummaryGeneration();

    this.emit("background-summary-started");
  },

  stopBackgroundSummaryGenerator() {
    if (this._backgroundSummaryTimer) {
      clearInterval(this._backgroundSummaryTimer);
      this._backgroundSummaryTimer = null;
      logger.info("[SessionManager] 后台摘要生成器已停止");
      this.emit("background-summary-stopped");
    }
  },

  async _runBackgroundSummaryGeneration() {
    if (!this.llmManager) {
      logger.info("[SessionManager] 无 LLM 管理器，跳过后台摘要生成");
      return;
    }

    if (this._isGeneratingSummary) {
      logger.info("[SessionManager] 摘要生成正在进行中，跳过本轮");
      return;
    }

    try {
      logger.info("[SessionManager] 开始后台摘要生成检查...");

      // 获取没有摘要的会话
      const sessionsWithoutSummary = await this.getSessionsWithoutSummary({
        limit: 10,
        minMessages: this.autoSummaryThreshold,
      });

      if (sessionsWithoutSummary.length === 0) {
        logger.info("[SessionManager] 所有会话都已有摘要");
        return;
      }

      logger.info(
        `[SessionManager] 发现 ${sessionsWithoutSummary.length} 个会话需要生成摘要`,
      );

      // 将会话加入队列
      for (const session of sessionsWithoutSummary) {
        this._queueAutoSummary(session.id);
      }

      this.emit("background-summary-queued", {
        count: sessionsWithoutSummary.length,
      });
    } catch (error) {
      logger.error("[SessionManager] 后台摘要生成失败:", error.message);
    }
  },

  async getSessionsWithoutSummary(options = {}) {
    const { limit = 50, minMessages = 5 } = options;

    try {
      const stmt = this.db.prepare(`
        SELECT id, conversation_id, title, metadata, created_at, updated_at
        FROM llm_sessions
        WHERE (
          json_extract(metadata, '$.summary') IS NULL
          OR json_extract(metadata, '$.summary') = ''
        )
        AND json_extract(metadata, '$.messageCount') >= ?
        ORDER BY updated_at DESC
        LIMIT ?
      `);

      const rows = stmt.all(minMessages, limit);

      return rows.map((row) => ({
        id: row.id,
        conversationId: row.conversation_id,
        title: row.title,
        metadata:
          typeof row.metadata === "string"
            ? JSON.parse(row.metadata || "{}")
            : row.metadata || {},
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    } catch (error) {
      logger.error("[SessionManager] 获取无摘要会话列表失败:", error);
      throw error;
    }
  },

  getAutoSummaryConfig() {
    return {
      enabled: this.enableAutoSummary,
      threshold: this.autoSummaryThreshold,
      interval: this.autoSummaryInterval,
      backgroundEnabled: this.enableBackgroundSummary,
      isRunning: !!this._backgroundSummaryTimer,
      queueLength: this._summaryQueue.length,
      isGenerating: this._isGeneratingSummary,
    };
  },

  updateAutoSummaryConfig(config = {}) {
    if (typeof config.enabled === "boolean") {
      this.enableAutoSummary = config.enabled;
    }

    if (typeof config.threshold === "number" && config.threshold > 0) {
      this.autoSummaryThreshold = config.threshold;
    }

    if (typeof config.interval === "number" && config.interval >= 60000) {
      this.autoSummaryInterval = config.interval;
      // 如果后台生成器正在运行，重新启动以应用新间隔
      if (this._backgroundSummaryTimer) {
        this.stopBackgroundSummaryGenerator();
        this.startBackgroundSummaryGenerator();
      }
    }

    if (typeof config.backgroundEnabled === "boolean") {
      this.enableBackgroundSummary = config.backgroundEnabled;
      if (config.backgroundEnabled && this.llmManager) {
        this.startBackgroundSummaryGenerator();
      } else {
        this.stopBackgroundSummaryGenerator();
      }
    }

    logger.info(
      "[SessionManager] 自动摘要配置已更新:",
      this.getAutoSummaryConfig(),
    );
    this.emit("auto-summary-config-updated", this.getAutoSummaryConfig());

    return this.getAutoSummaryConfig();
  },

  async triggerBulkSummaryGeneration(options = {}) {
    const { overwrite = false, limit = 100 } = options;

    try {
      let sessions;

      if (overwrite) {
        // 获取所有会话
        sessions = await this.listSessions({ limit });
      } else {
        // 只获取没有摘要的会话
        sessions = await this.getSessionsWithoutSummary({
          limit,
          minMessages: this.autoSummaryThreshold,
        });
      }

      logger.info(
        `[SessionManager] 触发批量摘要生成: ${sessions.length} 个会话`,
      );

      // 加入队列
      for (const session of sessions) {
        this._queueAutoSummary(session.id);
      }

      this.emit("bulk-summary-triggered", { count: sessions.length });

      return {
        queued: sessions.length,
        queueLength: this._summaryQueue.length,
      };
    } catch (error) {
      logger.error("[SessionManager] 触发批量摘要生成失败:", error);
      throw error;
    }
  },

  async getAutoSummaryStats() {
    try {
      // 总会话数
      const totalStmt = this.db.prepare(
        "SELECT COUNT(*) as count FROM llm_sessions",
      );
      const totalResult = totalStmt.get();

      // 有摘要的会话数
      const withSummaryStmt = this.db.prepare(`
        SELECT COUNT(*) as count FROM llm_sessions
        WHERE json_extract(metadata, '$.summary') IS NOT NULL
        AND json_extract(metadata, '$.summary') != ''
      `);
      const withSummaryResult = withSummaryStmt.get();

      // 自动生成的摘要数
      const autoGeneratedStmt = this.db.prepare(`
        SELECT COUNT(*) as count FROM llm_sessions
        WHERE json_extract(metadata, '$.autoSummaryGenerated') = 1
      `);
      const autoGeneratedResult = autoGeneratedStmt.get();

      // 符合摘要条件的会话数
      const eligibleStmt = this.db.prepare(`
        SELECT COUNT(*) as count FROM llm_sessions
        WHERE json_extract(metadata, '$.messageCount') >= ?
      `);
      const eligibleResult = eligibleStmt.get(this.autoSummaryThreshold);

      const total = totalResult.count || 0;
      const withSummary = withSummaryResult.count || 0;
      const autoGenerated = autoGeneratedResult.count || 0;
      const eligible = eligibleResult.count || 0;

      return {
        totalSessions: total,
        withSummary,
        withoutSummary: total - withSummary,
        autoGenerated,
        manualGenerated: withSummary - autoGenerated,
        eligible,
        coverage: total > 0 ? ((withSummary / total) * 100).toFixed(1) : 0,
        eligibleCoverage:
          eligible > 0 ? ((withSummary / eligible) * 100).toFixed(1) : 0,
        config: this.getAutoSummaryConfig(),
      };
    } catch (error) {
      logger.error("[SessionManager] 获取自动摘要统计失败:", error);
      throw error;
    }
  },
};

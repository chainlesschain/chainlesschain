/**
 * TokenTracker - LLM Token 追踪和成本管理核心模块
 *
 * 功能:
 * - 记录每次 LLM API 调用的 token 使用和成本
 * - 多提供商定价数据 (OpenAI, Anthropic, DeepSeek, Volcengine, Ollama)
 * - 预算管理和告警
 * - 统计查询和报告导出
 */

const { logger } = require("../utils/logger.js");
const { EventEmitter } = require("events");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const fs = require("fs");

// 导入 Volcengine 定价数据
let VolcengineModels;
try {
  VolcengineModels = require("./volcengine-models");
} catch (e) {
  logger.warn("[TokenTracker] volcengine-models 不可用:", e.message);
}

/**
 * LLM 提供商定价数据 (按百万 tokens 计费, USD)
 *
 * 数据来源:
 * - OpenAI: https://openai.com/pricing (2026-01)
 * - Anthropic: https://www.anthropic.com/pricing (2026-01)
 * - DeepSeek: https://platform.deepseek.com/pricing (2026-01)
 * - Volcengine: volcengine-models.js
 */
const PRICING_DATA = {
  openai: {
    // GPT-4o 系列
    "gpt-4o": { input: 2.5, output: 10.0 },
    "gpt-4o-2024-08-06": { input: 2.5, output: 10.0 },
    "gpt-4o-2024-05-13": { input: 5.0, output: 15.0 },
    "gpt-4o-mini": { input: 0.15, output: 0.6 },
    "gpt-4o-mini-2024-07-18": { input: 0.15, output: 0.6 },

    // GPT-4 Turbo 系列
    "gpt-4-turbo": { input: 10.0, output: 30.0 },
    "gpt-4-turbo-2024-04-09": { input: 10.0, output: 30.0 },
    "gpt-4-turbo-preview": { input: 10.0, output: 30.0 },

    // GPT-4 系列
    "gpt-4": { input: 30.0, output: 60.0 },
    "gpt-4-0613": { input: 30.0, output: 60.0 },
    "gpt-4-32k": { input: 60.0, output: 120.0 },

    // GPT-3.5 系列
    "gpt-3.5-turbo": { input: 0.5, output: 1.5 },
    "gpt-3.5-turbo-0125": { input: 0.5, output: 1.5 },
    "gpt-3.5-turbo-1106": { input: 1.0, output: 2.0 },
    "gpt-3.5-turbo-16k": { input: 3.0, output: 4.0 },

    // O1 系列 (推理模型)
    "o1-preview": { input: 15.0, output: 60.0 },
    "o1-mini": { input: 3.0, output: 12.0 },
  },

  anthropic: {
    // Claude 3.5 系列 (2024新版支持 Prompt Caching)
    "claude-3-5-sonnet-20241022": {
      input: 3.0,
      output: 15.0,
      cache: 0.3,
      cacheWrite: 3.75,
    },
    "claude-3-5-sonnet-20240620": {
      input: 3.0,
      output: 15.0,
      cache: 0.3,
      cacheWrite: 3.75,
    },
    "claude-3-5-haiku-20241022": {
      input: 0.8,
      output: 4.0,
      cache: 0.08,
      cacheWrite: 1.0,
    },

    // Claude 3 系列
    "claude-3-opus-20240229": {
      input: 15.0,
      output: 75.0,
      cache: 1.5,
      cacheWrite: 18.75,
    },
    "claude-3-sonnet-20240229": {
      input: 3.0,
      output: 15.0,
      cache: 0.3,
      cacheWrite: 3.75,
    },
    "claude-3-haiku-20240307": {
      input: 0.25,
      output: 1.25,
      cache: 0.03,
      cacheWrite: 0.3,
    },

    // 旧版本
    "claude-2.1": { input: 8.0, output: 24.0 },
    "claude-2.0": { input: 8.0, output: 24.0 },
    "claude-instant-1.2": { input: 0.8, output: 2.4 },
  },

  deepseek: {
    // DeepSeek V3 系列 (2025年最新)
    "deepseek-chat": { input: 0.14, output: 0.28 },
    "deepseek-coder": { input: 0.14, output: 0.28 },

    // 旧版本
    "deepseek-v2.5": { input: 0.14, output: 0.28 },
    "deepseek-v2": { input: 0.14, output: 0.28 },
  },

  volcengine: {
    // Volcengine (豆包) 定价将从 volcengine-models.js 动态加载
    // 这里提供默认值作为后备
    "doubao-seed-1-6-251015": { input: 0.0026, output: 0.0078 }, // 人民币/百万 tokens
    "doubao-pro-32k": { input: 0.0008, output: 0.002 },
    "doubao-lite-32k": { input: 0.0003, output: 0.0006 },
  },

  ollama: {
    // Ollama 本地运行，免费
    "*": { input: 0, output: 0 },
  },

  custom: {
    // 自定义提供商，默认使用 OpenAI 兼容定价
    "*": { input: 0.5, output: 1.5 },
  },
};

/**
 * TokenTracker 类
 */
class TokenTracker extends EventEmitter {
  /**
   * 构造函数
   * @param {Object} database - 数据库管理器实例
   * @param {Object} options - 配置选项
   * @param {boolean} options.enableCostTracking - 启用成本追踪 (默认: true)
   * @param {boolean} options.enableBudgetAlerts - 启用预算告警 (默认: true)
   * @param {number} options.exchangeRate - 美元到人民币汇率 (默认: 7.2)
   */
  constructor(database, options = {}) {
    super();

    if (!database) {
      throw new Error("[TokenTracker] database 参数是必需的");
    }

    this.db = database;
    this.options = {
      enableCostTracking: options.enableCostTracking !== false,
      enableBudgetAlerts: options.enableBudgetAlerts !== false,
      exchangeRate: options.exchangeRate || 7.2,
    };

    // 加载 Volcengine 定价数据
    this.loadVolcenginePricing();

    logger.info("[TokenTracker] 初始化完成", this.options);
  }

  /**
   * 从 volcengine-models.js 加载定价数据
   */
  loadVolcenginePricing() {
    if (!VolcengineModels) {
      logger.warn("[TokenTracker] Volcengine 定价数据不可用，使用默认值");
      return;
    }

    try {
      const selector = VolcengineModels.getModelSelector();
      const models = selector.models || {};

      Object.keys(models).forEach((modelId) => {
        const model = models[modelId];
        if (model.pricing) {
          PRICING_DATA.volcengine[modelId] = {
            input: model.pricing.input || 0,
            output: model.pricing.output || 0,
            imagePrice: model.pricing.imagePrice || 0,
          };
        }
      });

      logger.info(
        `[TokenTracker] 已加载 ${Object.keys(PRICING_DATA.volcengine).length} 个 Volcengine 模型定价`,
      );
    } catch (e) {
      logger.error("[TokenTracker] 加载 Volcengine 定价失败:", e);
    }
  }

  /**
   * 记录单次 LLM API 调用
   * @param {Object} params - 使用参数
   * @param {string} params.conversationId - 对话 ID
   * @param {string} params.messageId - 消息 ID
   * @param {string} params.provider - 提供商 (ollama/openai/anthropic/deepseek/volcengine/custom)
   * @param {string} params.model - 模型名称
   * @param {number} params.inputTokens - 输入 tokens
   * @param {number} params.outputTokens - 输出 tokens
   * @param {number} params.cachedTokens - 缓存 tokens (Anthropic Prompt Caching)
   * @param {boolean} params.wasCached - 是否来自响应缓存
   * @param {boolean} params.wasCompressed - 是否使用了 Prompt 压缩
   * @param {number} params.compressionRatio - 压缩率 (0-1)
   * @param {number} params.responseTime - 响应时间 (毫秒)
   * @param {string} params.endpoint - API 端点
   * @param {string} params.userId - 用户 ID (默认: 'default')
   */
  async recordUsage(params) {
    const {
      conversationId,
      messageId,
      provider,
      model,
      inputTokens = 0,
      outputTokens = 0,
      cachedTokens = 0,
      wasCached = false,
      wasCompressed = false,
      compressionRatio = 1.0,
      responseTime,
      endpoint,
      userId = "default",
    } = params;

    if (!provider || !model) {
      logger.error("[TokenTracker] recordUsage: provider 和 model 是必需的");
      return;
    }

    try {
      const totalTokens = inputTokens + outputTokens;
      const latencyMs = responseTime || null;

      // 计算成本
      const costResult = this.calculateCost(
        provider,
        model,
        inputTokens,
        outputTokens,
        cachedTokens,
      );

      // 插入使用日志
      const id = uuidv4();
      const createdAt = Date.now();

      const stmt = this.db.prepare(`
        INSERT INTO llm_usage_log (
          id, conversation_id, message_id, provider, model,
          input_tokens, output_tokens, total_tokens, cached_tokens,
          cost_usd, cost_cny,
          was_cached, was_compressed, compression_ratio,
          latency_ms, response_time,
          endpoint, user_id, session_id, created_at
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?,
          ?, ?, ?,
          ?, ?,
          ?, ?, ?, ?
        )
      `);

      stmt.run(
        id,
        conversationId,
        messageId,
        provider,
        model,
        inputTokens,
        outputTokens,
        totalTokens,
        cachedTokens,
        costResult.costUsd,
        costResult.costCny,
        wasCached ? 1 : 0,
        wasCompressed ? 1 : 0,
        compressionRatio,
        latencyMs,
        responseTime,
        endpoint,
        userId,
        null,
        createdAt,
      );

      // 更新对话统计
      if (conversationId) {
        this.updateConversationStats(
          conversationId,
          inputTokens,
          outputTokens,
          costResult.costUsd,
          costResult.costCny,
        );
      }

      // 更新预算支出
      await this.updateBudgetSpend(userId, costResult.costUsd);

      // 检查预算告警
      if (this.options.enableBudgetAlerts) {
        await this.checkBudgetAlerts(userId);
      }

      logger.info(
        `[TokenTracker] 记录使用: ${provider}/${model}, ${totalTokens} tokens, $${costResult.costUsd.toFixed(5)}`,
      );

      return {
        id,
        totalTokens,
        costUsd: costResult.costUsd,
        costCny: costResult.costCny,
      };
    } catch (error) {
      logger.error("[TokenTracker] recordUsage 失败:", error);
      throw error;
    }
  }

  /**
   * 计算成本
   * @param {string} provider - 提供商
   * @param {string} model - 模型名称
   * @param {number} inputTokens - 输入 tokens
   * @param {number} outputTokens - 输出 tokens
   * @param {number} cachedTokens - 缓存 tokens (Anthropic)
   * @returns {Object} { costUsd, costCny, pricing }
   */
  calculateCost(
    provider,
    model,
    inputTokens = 0,
    outputTokens = 0,
    cachedTokens = 0,
  ) {
    if (!this.options.enableCostTracking) {
      return { costUsd: 0, costCny: 0, pricing: null };
    }

    const providerLower = provider.toLowerCase();
    let pricing = null;
    let costUsd = 0;

    // 获取定价数据
    if (PRICING_DATA[providerLower]) {
      pricing =
        PRICING_DATA[providerLower][model] || PRICING_DATA[providerLower]["*"];
    }

    if (!pricing) {
      logger.warn(
        `[TokenTracker] 未找到 ${provider}/${model} 的定价数据，使用默认值`,
      );
      pricing = { input: 0.5, output: 1.5 };
    }

    // 计算成本 (按百万 tokens)
    costUsd += (inputTokens / 1000000) * pricing.input;
    costUsd += (outputTokens / 1000000) * pricing.output;

    // Anthropic Prompt Caching 优惠价
    if (pricing.cache && cachedTokens > 0) {
      // 缓存读取的 tokens 使用优惠价
      costUsd += (cachedTokens / 1000000) * pricing.cache;
    }

    // 转换为人民币
    const costCny = costUsd * this.options.exchangeRate;

    return {
      costUsd,
      costCny,
      pricing,
    };
  }

  /**
   * 更新对话统计
   * @param {string} conversationId
   * @param {number} inputTokens
   * @param {number} outputTokens
   * @param {number} costUsd
   * @param {number} costCny
   */
  updateConversationStats(
    conversationId,
    inputTokens,
    outputTokens,
    costUsd,
    costCny,
  ) {
    try {
      const stmt = this.db.prepare(`
        UPDATE conversations
        SET
          total_input_tokens = COALESCE(total_input_tokens, 0) + ?,
          total_output_tokens = COALESCE(total_output_tokens, 0) + ?,
          total_cost_usd = COALESCE(total_cost_usd, 0) + ?,
          total_cost_cny = COALESCE(total_cost_cny, 0) + ?
        WHERE id = ?
      `);

      stmt.run(inputTokens, outputTokens, costUsd, costCny, conversationId);
    } catch (error) {
      logger.error("[TokenTracker] updateConversationStats 失败:", error);
    }
  }

  /**
   * 更新预算支出
   * @param {string} userId
   * @param {number} costUsd
   */
  async updateBudgetSpend(userId, costUsd) {
    try {
      const now = Date.now();
      const config = await this.getBudgetConfig(userId);

      if (!config) {
        return;
      }

      // 检查是否需要重置计数器
      const needsDailyReset =
        config.daily_reset_at && now >= config.daily_reset_at;
      const needsWeeklyReset =
        config.weekly_reset_at && now >= config.weekly_reset_at;
      const needsMonthlyReset =
        config.monthly_reset_at && now >= config.monthly_reset_at;

      let dailySpend = config.current_daily_spend || 0;
      let weeklySpend = config.current_weekly_spend || 0;
      let monthlySpend = config.current_monthly_spend || 0;

      if (needsDailyReset) {
        dailySpend = 0;
      }
      if (needsWeeklyReset) {
        weeklySpend = 0;
      }
      if (needsMonthlyReset) {
        monthlySpend = 0;
      }

      // 累加支出
      dailySpend += costUsd;
      weeklySpend += costUsd;
      monthlySpend += costUsd;

      // 更新数据库
      const stmt = this.db.prepare(`
        UPDATE llm_budget_config
        SET
          current_daily_spend = ?,
          current_weekly_spend = ?,
          current_monthly_spend = ?,
          daily_reset_at = ?,
          weekly_reset_at = ?,
          monthly_reset_at = ?,
          updated_at = ?
        WHERE user_id = ?
      `);

      stmt.run(
        dailySpend,
        weeklySpend,
        monthlySpend,
        needsDailyReset ? now + 24 * 60 * 60 * 1000 : config.daily_reset_at,
        needsWeeklyReset
          ? now + 7 * 24 * 60 * 60 * 1000
          : config.weekly_reset_at,
        needsMonthlyReset
          ? now + 30 * 24 * 60 * 60 * 1000
          : config.monthly_reset_at,
        now,
        userId,
      );
    } catch (error) {
      logger.error("[TokenTracker] updateBudgetSpend 失败:", error);
    }
  }

  /**
   * 检查预算告警
   * @param {string} userId
   */
  async checkBudgetAlerts(userId) {
    try {
      const config = await this.getBudgetConfig(userId);

      if (!config || !config.desktop_alerts) {
        return;
      }

      const { warning_threshold, critical_threshold } = config;
      const dailyUsage =
        (config.current_daily_spend || 0) /
        (config.daily_limit_usd || Infinity);
      const weeklyUsage =
        (config.current_weekly_spend || 0) /
        (config.weekly_limit_usd || Infinity);
      const monthlyUsage =
        (config.current_monthly_spend || 0) /
        (config.monthly_limit_usd || Infinity);

      // 检查是否超过阈值
      const alerts = [];

      if (dailyUsage >= critical_threshold) {
        alerts.push({
          level: "critical",
          period: "daily",
          usage: dailyUsage,
          spent: config.current_daily_spend,
          limit: config.daily_limit_usd,
        });
      } else if (dailyUsage >= warning_threshold) {
        alerts.push({
          level: "warning",
          period: "daily",
          usage: dailyUsage,
          spent: config.current_daily_spend,
          limit: config.daily_limit_usd,
        });
      }

      if (weeklyUsage >= critical_threshold) {
        alerts.push({
          level: "critical",
          period: "weekly",
          usage: weeklyUsage,
          spent: config.current_weekly_spend,
          limit: config.weekly_limit_usd,
        });
      } else if (weeklyUsage >= warning_threshold) {
        alerts.push({
          level: "warning",
          period: "weekly",
          usage: weeklyUsage,
          spent: config.current_weekly_spend,
          limit: config.weekly_limit_usd,
        });
      }

      if (monthlyUsage >= critical_threshold) {
        alerts.push({
          level: "critical",
          period: "monthly",
          usage: monthlyUsage,
          spent: config.current_monthly_spend,
          limit: config.monthly_limit_usd,
        });
      } else if (monthlyUsage >= warning_threshold) {
        alerts.push({
          level: "warning",
          period: "monthly",
          usage: monthlyUsage,
          spent: config.current_monthly_spend,
          limit: config.monthly_limit_usd,
        });
      }

      // 发送告警事件
      alerts.forEach((alert) => {
        this.emit("budget-alert", {
          userId,
          ...alert,
          timestamp: Date.now(),
        });
      });
    } catch (error) {
      logger.error("[TokenTracker] checkBudgetAlerts 失败:", error);
    }
  }

  /**
   * 获取预算配置
   * @param {string} userId
   * @returns {Promise<Object|null>}
   */
  async getBudgetConfig(userId = "default") {
    try {
      const stmt = this.db.prepare(
        "SELECT * FROM llm_budget_config WHERE user_id = ?",
      );
      const result = stmt.get(userId);
      return result || null;
    } catch (error) {
      logger.error("[TokenTracker] getBudgetConfig 失败:", error);
      return null;
    }
  }

  /**
   * 保存预算配置
   * @param {string} userId
   * @param {Object} config
   */
  async saveBudgetConfig(userId, config) {
    try {
      const now = Date.now();
      const existing = await this.getBudgetConfig(userId);

      if (existing) {
        // 更新
        const stmt = this.db.prepare(`
          UPDATE llm_budget_config
          SET
            daily_limit_usd = ?,
            weekly_limit_usd = ?,
            monthly_limit_usd = ?,
            warning_threshold = ?,
            critical_threshold = ?,
            desktop_alerts = ?,
            auto_pause_on_limit = ?,
            auto_switch_to_cheaper_model = ?,
            updated_at = ?
          WHERE user_id = ?
        `);

        stmt.run(
          config.dailyLimit,
          config.weeklyLimit,
          config.monthlyLimit,
          config.warningThreshold || 0.8,
          config.criticalThreshold || 0.95,
          config.desktopAlerts ? 1 : 0,
          config.autoPauseOnLimit ? 1 : 0,
          config.autoSwitchToCheaperModel ? 1 : 0,
          now,
          userId,
        );
      } else {
        // 插入
        const stmt = this.db.prepare(`
          INSERT INTO llm_budget_config (
            id, user_id,
            daily_limit_usd, weekly_limit_usd, monthly_limit_usd,
            current_daily_spend, current_weekly_spend, current_monthly_spend,
            daily_reset_at, weekly_reset_at, monthly_reset_at,
            warning_threshold, critical_threshold,
            desktop_alerts, auto_pause_on_limit, auto_switch_to_cheaper_model,
            created_at, updated_at
          ) VALUES (
            ?, ?,
            ?, ?, ?,
            0, 0, 0,
            ?, ?, ?,
            ?, ?,
            ?, ?, ?,
            ?, ?
          )
        `);

        stmt.run(
          uuidv4(),
          userId,
          config.dailyLimit,
          config.weeklyLimit,
          config.monthlyLimit,
          now + 24 * 60 * 60 * 1000, // daily_reset_at
          now + 7 * 24 * 60 * 60 * 1000, // weekly_reset_at
          now + 30 * 24 * 60 * 60 * 1000, // monthly_reset_at
          config.warningThreshold || 0.8,
          config.criticalThreshold || 0.95,
          config.desktopAlerts ? 1 : 0,
          config.autoPauseOnLimit ? 1 : 0,
          config.autoSwitchToCheaperModel ? 1 : 0,
          now,
          now,
        );
      }

      logger.info("[TokenTracker] 预算配置已保存:", userId);
      return { success: true };
    } catch (error) {
      logger.error("[TokenTracker] saveBudgetConfig 失败:", error);
      throw error;
    }
  }

  /**
   * 获取使用统计
   * @param {Object} options
   * @param {number} options.startDate - 开始时间戳
   * @param {number} options.endDate - 结束时间戳
   * @param {string} options.provider - 提供商过滤
   * @param {string} options.groupBy - 分组方式 (day/week/month)
   * @returns {Promise<Object>}
   */
  async getUsageStats(options = {}) {
    const {
      startDate = Date.now() - 7 * 24 * 60 * 60 * 1000, // 默认: 过去7天
      endDate = Date.now(),
      provider,
      groupBy,
    } = options;

    try {
      let sql = `
        SELECT
          COUNT(*) as total_calls,
          SUM(input_tokens) as total_input_tokens,
          SUM(output_tokens) as total_output_tokens,
          SUM(total_tokens) as total_tokens,
          SUM(cost_usd) as total_cost_usd,
          SUM(cost_cny) as total_cost_cny,
          SUM(CASE WHEN was_cached = 1 THEN 1 ELSE 0 END) as cached_calls,
          SUM(CASE WHEN was_compressed = 1 THEN 1 ELSE 0 END) as compressed_calls,
          AVG(response_time) as avg_response_time
        FROM llm_usage_log
        WHERE created_at >= ? AND created_at <= ?
      `;

      const params = [startDate, endDate];

      if (provider) {
        sql += " AND provider = ?";
        params.push(provider);
      }

      const stmt = this.db.prepare(sql);
      const stats = stmt.get(params);

      // 计算缓存命中率
      const cacheHitRate =
        stats.total_calls > 0
          ? (((stats.cached_calls || 0) / stats.total_calls) * 100).toFixed(2)
          : 0;

      return {
        totalCalls: stats.total_calls || 0,
        totalInputTokens: stats.total_input_tokens || 0,
        totalOutputTokens: stats.total_output_tokens || 0,
        totalTokens: stats.total_tokens || 0,
        totalCostUsd: stats.total_cost_usd || 0,
        totalCostCny: stats.total_cost_cny || 0,
        cachedCalls: stats.cached_calls || 0,
        compressedCalls: stats.compressed_calls || 0,
        cacheHitRate: parseFloat(cacheHitRate),
        avgResponseTime: Math.round(stats.avg_response_time || 0),
        startDate,
        endDate,
      };
    } catch (error) {
      logger.error("[TokenTracker] getUsageStats 失败:", error);
      throw error;
    }
  }

  /**
   * 获取时间序列数据 (用于图表)
   * @param {Object} options
   * @param {number} options.startDate
   * @param {number} options.endDate
   * @param {string} options.interval - 时间间隔 (hour/day/week)
   * @returns {Promise<Array>}
   */
  async getTimeSeriesData(options = {}) {
    const {
      startDate = Date.now() - 7 * 24 * 60 * 60 * 1000,
      endDate = Date.now(),
      interval = "day",
    } = options;

    try {
      // 根据 interval 计算时间桶大小
      let bucketSize;
      switch (interval) {
        case "hour":
          bucketSize = 60 * 60 * 1000;
          break;
        case "day":
          bucketSize = 24 * 60 * 60 * 1000;
          break;
        case "week":
          bucketSize = 7 * 24 * 60 * 60 * 1000;
          break;
        default:
          bucketSize = 24 * 60 * 60 * 1000;
      }

      const sql = `
        SELECT
          (created_at / ${bucketSize}) * ${bucketSize} as time_bucket,
          COUNT(*) as calls,
          SUM(total_tokens) as tokens,
          SUM(cost_usd) as cost_usd
        FROM llm_usage_log
        WHERE created_at >= ? AND created_at <= ?
        GROUP BY time_bucket
        ORDER BY time_bucket
      `;

      const stmt = this.db.prepare(sql);
      const results = stmt.all(startDate, endDate);

      return results.map((row) => ({
        timestamp: row.time_bucket,
        calls: row.calls,
        tokens: row.tokens,
        costUsd: row.cost_usd,
      }));
    } catch (error) {
      logger.error("[TokenTracker] getTimeSeriesData 失败:", error);
      throw error;
    }
  }

  /**
   * 获取成本分解 (按提供商/模型)
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async getCostBreakdown(options = {}) {
    const {
      startDate = Date.now() - 7 * 24 * 60 * 60 * 1000,
      endDate = Date.now(),
    } = options;

    try {
      // 按提供商分组
      const providerSql = `
        SELECT
          provider,
          COUNT(*) as calls,
          SUM(total_tokens) as tokens,
          SUM(cost_usd) as cost_usd
        FROM llm_usage_log
        WHERE created_at >= ? AND created_at <= ?
        GROUP BY provider
        ORDER BY cost_usd DESC
      `;

      const providerStmt = this.db.prepare(providerSql);
      const providerBreakdown = providerStmt.all(startDate, endDate);

      // 按模型分组
      const modelSql = `
        SELECT
          provider,
          model,
          COUNT(*) as calls,
          SUM(total_tokens) as tokens,
          SUM(cost_usd) as cost_usd
        FROM llm_usage_log
        WHERE created_at >= ? AND created_at <= ?
        GROUP BY provider, model
        ORDER BY cost_usd DESC
        LIMIT 20
      `;

      const modelStmt = this.db.prepare(modelSql);
      const modelBreakdown = modelStmt.all(startDate, endDate);

      return {
        byProvider: providerBreakdown,
        byModel: modelBreakdown,
      };
    } catch (error) {
      logger.error("[TokenTracker] getCostBreakdown 失败:", error);
      throw error;
    }
  }

  /**
   * 导出成本报告 (CSV)
   * @param {Object} options
   * @returns {Promise<string>} CSV 文件路径
   */
  async exportCostReport(options = {}) {
    const {
      startDate = Date.now() - 30 * 24 * 60 * 60 * 1000, // 默认: 过去30天
      endDate = Date.now(),
      format = "csv",
    } = options;

    try {
      const sql = `
        SELECT
          id,
          conversation_id,
          message_id,
          provider,
          model,
          input_tokens,
          output_tokens,
          total_tokens,
          cached_tokens,
          cost_usd,
          cost_cny,
          was_cached,
          was_compressed,
          compression_ratio,
          response_time,
          created_at
        FROM llm_usage_log
        WHERE created_at >= ? AND created_at <= ?
        ORDER BY created_at DESC
      `;

      const stmt = this.db.prepare(sql);
      const results = stmt.all(startDate, endDate);

      if (format === "csv") {
        // 生成 CSV
        const headers = [
          "ID",
          "Conversation ID",
          "Message ID",
          "Provider",
          "Model",
          "Input Tokens",
          "Output Tokens",
          "Total Tokens",
          "Cached Tokens",
          "Cost (USD)",
          "Cost (CNY)",
          "Was Cached",
          "Was Compressed",
          "Compression Ratio",
          "Response Time (ms)",
          "Created At",
        ];

        let csv = headers.join(",") + "\n";

        results.forEach((row) => {
          const line = [
            row.id,
            row.conversation_id || "",
            row.message_id || "",
            row.provider,
            row.model,
            row.input_tokens,
            row.output_tokens,
            row.total_tokens,
            row.cached_tokens,
            row.cost_usd.toFixed(6),
            row.cost_cny.toFixed(4),
            row.was_cached ? "Yes" : "No",
            row.was_compressed ? "Yes" : "No",
            row.compression_ratio?.toFixed(2) || "1.00",
            row.response_time || "",
            new Date(row.created_at).toISOString(),
          ].join(",");

          csv += line + "\n";
        });

        // 保存到临时文件
        const { app } = require("electron");
        const tempDir = app.getPath("temp");
        const fileName = `llm-cost-report-${Date.now()}.csv`;
        const filePath = path.join(tempDir, fileName);

        fs.writeFileSync(filePath, csv, "utf-8");

        logger.info(`[TokenTracker] 成本报告已导出: ${filePath}`);

        return { success: true, filePath };
      }

      throw new Error(`不支持的导出格式: ${format}`);
    } catch (error) {
      logger.error("[TokenTracker] exportCostReport 失败:", error);
      throw error;
    }
  }
}

module.exports = {
  TokenTracker,
  PRICING_DATA,
};

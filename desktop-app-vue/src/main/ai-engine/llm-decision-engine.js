/**
 * LLM-Assisted Multi-Agent Decision Engine
 *
 * 智能决策引擎,使用三层决策策略:
 * 1. 基础规则快速判断 (性能优化)
 * 2. LLM辅助决策 (边界情况)
 * 3. 历史学习 (强化学习)
 *
 * 核心功能:
 * - 智能分析任务特征
 * - LLM辅助复杂决策
 * - 历史性能追踪
 * - 自动策略调整
 *
 * @module ai-engine/llm-decision-engine
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");

/**
 * 决策策略类型
 */
const DecisionStrategy = {
  DIVIDE_CONTEXT: "divide_context", // 上下文分割策略
  PARALLEL_EXECUTION: "parallel_execution", // 并行执行策略
  SPECIALIZED_AGENTS: "specialized_agents", // 专业化代理策略
  SINGLE_AGENT: "single_agent", // 单代理策略
};

/**
 * 决策结果
 */
class DecisionResult {
  constructor(
    useMultiAgent,
    strategy,
    confidence,
    reason,
    agentCount = 1,
    metrics = {},
  ) {
    this.useMultiAgent = useMultiAgent;
    this.strategy = strategy;
    this.confidence = confidence;
    this.reason = reason;
    this.agentCount = agentCount;
    this.metrics = metrics;
    this.timestamp = Date.now();
  }
}

/**
 * LLM决策引擎类
 */
class LLMDecisionEngine extends EventEmitter {
  constructor(options = {}) {
    super();

    this.enabled = options.enabled !== false;
    this.llmManager = options.llmManager; // LLM服务管理器
    this.database = options.database; // 数据库连接

    // 配置参数
    this.config = {
      // 基础规则阈值
      highConfidenceThreshold: options.highConfidenceThreshold || 0.9,
      lowConfidenceThreshold: options.lowConfidenceThreshold || 0.5,

      // 任务特征阈值
      contextLengthThreshold: options.contextLengthThreshold || 10000, // 上下文长度阈值
      subtaskCountThreshold: options.subtaskCountThreshold || 3, // 子任务数量阈值
      durationThreshold: options.durationThreshold || 60000, // 预计耗时阈值 (60s)

      // LLM配置
      llmTemperature: options.llmTemperature || 0.3,
      llmMaxTokens: options.llmMaxTokens || 200,

      // 历史数据权重
      historicalWeight: options.historicalWeight || 0.3,

      // 性能阈值
      multiAgentSpeedupThreshold: options.multiAgentSpeedupThreshold || 0.8, // 多代理加速比阈值
      successRateThreshold: options.successRateThreshold || 0.95, // 成功率阈值
    };

    // 统计信息
    this.stats = {
      totalDecisions: 0,
      multiAgentDecisions: 0,
      singleAgentDecisions: 0,
      llmCallCount: 0,
      basicRuleCount: 0,
      historicalAdjustments: 0,
      avgDecisionTime: 0,
    };

    // 决策缓存 (相同任务特征)
    this.decisionCache = new Map(); // taskFingerprint => DecisionResult

    logger.info("[LLMDecisionEngine] 已初始化", {
      enabled: this.enabled,
      contextThreshold: this.config.contextLengthThreshold,
      subtaskThreshold: this.config.subtaskCountThreshold,
    });
  }

  /**
   * 主决策接口: 判断是否应该使用多代理模式
   * @param {Object} task - 任务信息
   * @param {Object} context - 上下文信息
   * @returns {Promise<DecisionResult>} 决策结果
   */
  async shouldUseMultiAgent(task, context = {}) {
    if (!this.enabled) {
      return new DecisionResult(
        false,
        DecisionStrategy.SINGLE_AGENT,
        1.0,
        "Engine disabled",
      );
    }

    const startTime = Date.now();
    this.stats.totalDecisions++;

    try {
      // 生成任务指纹 (用于缓存)
      const fingerprint = this._generateFingerprint(task, context);

      // 检查缓存
      if (this.decisionCache.has(fingerprint)) {
        const cachedDecision = this.decisionCache.get(fingerprint);
        logger.debug("[LLMDecisionEngine] 使用缓存决策", { fingerprint });
        return cachedDecision;
      }

      // 1. 基础规则快速判断 (性能优化)
      const basicRules = this._checkBasicRules(task, context);
      if (basicRules.confidence >= this.config.highConfidenceThreshold) {
        logger.info("[LLMDecisionEngine] 基础规则高置信度决策", {
          decision: basicRules.useMultiAgent,
          confidence: basicRules.confidence,
          reason: basicRules.reason,
        });

        this.stats.basicRuleCount++;
        this._updateStats(startTime);
        this._cacheDecision(fingerprint, basicRules);
        this._recordDecisionResult(basicRules);

        return basicRules;
      }

      // 2. LLM辅助决策 (边界情况)
      let llmDecision = basicRules;
      if (
        this.llmManager &&
        basicRules.confidence < this.config.highConfidenceThreshold
      ) {
        try {
          llmDecision = await this._llmAssistedDecision(task, context);
          this.stats.llmCallCount++;
          logger.info("[LLMDecisionEngine] LLM辅助决策完成", {
            decision: llmDecision.useMultiAgent,
            confidence: llmDecision.confidence,
            strategy: llmDecision.strategy,
          });
        } catch (error) {
          logger.warn(
            "[LLMDecisionEngine] LLM决策失败，使用基础规则",
            error.message,
          );
          llmDecision = basicRules;
        }
      }

      // 3. 历史学习 (强化学习)
      const historicalData = await this._getHistoricalPerformance(task);
      const finalDecision = this._adjustWithHistory(
        llmDecision,
        historicalData,
      );

      if (finalDecision !== llmDecision) {
        this.stats.historicalAdjustments++;
        logger.info("[LLMDecisionEngine] 历史数据调整决策", {
          original: llmDecision.useMultiAgent,
          adjusted: finalDecision.useMultiAgent,
        });
      }

      // 缓存决策
      this._cacheDecision(fingerprint, finalDecision);

      // 更新统计
      this._updateStats(startTime);
      this._recordDecisionResult(finalDecision);

      return finalDecision;
    } catch (error) {
      logger.error("[LLMDecisionEngine] 决策失败:", error);
      this._updateStats(startTime);

      // 降级为单代理模式
      return new DecisionResult(
        false,
        DecisionStrategy.SINGLE_AGENT,
        0.5,
        `Error: ${error.message}`,
      );
    }
  }

  /**
   * 基础规则快速判断
   * @private
   */
  _checkBasicRules(task, context) {
    const metrics = {
      subtaskCount: task.subtasks ? task.subtasks.length : 0,
      contextLength: context.length || 0,
      estimatedDuration: task.estimated_duration || 0,
      hasParallelTasks: task.subtasks
        ? this._detectParallelTasks(task.subtasks)
        : false,
      requiresSpecialization: task.subtasks
        ? this._detectSpecialization(task.subtasks)
        : false,
    };

    let score = 0;
    let confidence = 0;
    const reasons = [];

    // 规则1: 子任务数量
    if (metrics.subtaskCount >= this.config.subtaskCountThreshold) {
      score += 30;
      confidence += 0.3;
      reasons.push(`子任务数量较多(${metrics.subtaskCount}个)`);
    } else if (metrics.subtaskCount <= 1) {
      score -= 40;
      confidence += 0.4;
      reasons.push(`子任务太少(${metrics.subtaskCount}个)`);
    }

    // 规则2: 上下文长度
    if (metrics.contextLength > this.config.contextLengthThreshold) {
      score += 25;
      confidence += 0.25;
      reasons.push(`上下文过长(${Math.round(metrics.contextLength / 1000)}KB)`);
    }

    // 规则3: 预计耗时
    if (metrics.estimatedDuration > this.config.durationThreshold) {
      score += 20;
      confidence += 0.2;
      reasons.push(
        `预计耗时较长(${Math.round(metrics.estimatedDuration / 1000)}s)`,
      );
    }

    // 规则4: 可并行化
    if (metrics.hasParallelTasks) {
      score += 35;
      confidence += 0.35;
      reasons.push("子任务可并行执行");
    }

    // 规则5: 专业化需求
    if (metrics.requiresSpecialization) {
      score += 30;
      confidence += 0.3;
      reasons.push("需要不同领域专业知识");
    }

    // 决策
    const useMultiAgent = score >= 50;
    const normalizedConfidence = Math.min(confidence, 1.0);

    // 确定策略
    let strategy = DecisionStrategy.SINGLE_AGENT;
    if (useMultiAgent) {
      if (metrics.contextLength > this.config.contextLengthThreshold) {
        strategy = DecisionStrategy.DIVIDE_CONTEXT;
      } else if (metrics.hasParallelTasks) {
        strategy = DecisionStrategy.PARALLEL_EXECUTION;
      } else if (metrics.requiresSpecialization) {
        strategy = DecisionStrategy.SPECIALIZED_AGENTS;
      }
    }

    // 计算建议代理数量
    const agentCount = useMultiAgent
      ? Math.min(Math.max(Math.ceil(metrics.subtaskCount / 2), 2), 5)
      : 1;

    return new DecisionResult(
      useMultiAgent,
      strategy,
      normalizedConfidence,
      `基础规则: ${reasons.join("; ")} (得分: ${score})`,
      agentCount,
      metrics,
    );
  }

  /**
   * 检测任务是否可并行
   * @private
   */
  _detectParallelTasks(subtasks) {
    if (!subtasks || subtasks.length < 2) {
      return false;
    }

    // 简单启发式: 检查子任务是否有依赖关系
    let hasIndependentTasks = 0;

    for (const subtask of subtasks) {
      // 如果子任务没有明确的依赖，认为可并行
      if (!subtask.dependencies || subtask.dependencies.length === 0) {
        hasIndependentTasks++;
      }
    }

    return hasIndependentTasks >= 2;
  }

  /**
   * 检测是否需要专业化代理
   * @private
   */
  _detectSpecialization(subtasks) {
    if (!subtasks || subtasks.length < 2) {
      return false;
    }

    // 检查子任务使用的工具多样性
    const tools = new Set();
    for (const subtask of subtasks) {
      if (subtask.tool) {
        tools.add(subtask.tool);
      }
    }

    // 如果使用了3种以上不同工具，认为需要专业化
    return tools.size >= 3;
  }

  /**
   * LLM辅助决策
   * @private
   */
  async _llmAssistedDecision(task, context) {
    const subtaskInfo = task.subtasks
      ? task.subtasks
          .map(
            (st) =>
              `- ${st.title || st.description} (工具: ${st.tool || "unknown"})`,
          )
          .join("\n")
      : "无子任务";

    const prompt = `你是一个多代理系统决策专家。请判断以下任务是否应该使用多代理模式。

**任务信息**:
- 任务标题: ${task.task_title || task.title || "未知任务"}
- 子任务数量: ${task.subtasks ? task.subtasks.length : 0}
- 预计耗时: ${task.estimated_duration || "unknown"} ms
- 上下文长度: ${context.length || 0} 字符

**子任务列表**:
${subtaskInfo}

**决策因素**:
1. 上下文污染: 上下文是否过长导致LLM性能下降？
2. 可并行化: 子任务之间是否独立，可以并行执行？
3. 专业化: 是否需要不同领域的专业知识？
4. 复杂度: 任务是否足够复杂需要分解？

请以JSON格式回复:
{
  "useMultiAgent": true/false,
  "strategy": "divide_context/parallel_execution/specialized_agents/single_agent",
  "confidence": 0.0-1.0,
  "reason": "决策理由",
  "agentCount": 建议的代理数量 (1-5)
}

只输出JSON，不要有其他内容。`;

    const response = await this.llmManager.query({
      prompt,
      temperature: this.config.llmTemperature,
      maxTokens: this.config.llmMaxTokens,
    });

    // 解析LLM响应
    let llmResult;
    try {
      // 提取JSON (可能包含markdown代码块)
      let jsonText = response.text || response.content || "";
      jsonText = jsonText
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();
      llmResult = JSON.parse(jsonText);
    } catch (error) {
      logger.warn("[LLMDecisionEngine] LLM响应解析失败:", response.text);
      throw new Error("Invalid LLM response format");
    }

    return new DecisionResult(
      llmResult.useMultiAgent,
      llmResult.strategy || DecisionStrategy.SINGLE_AGENT,
      llmResult.confidence || 0.7,
      llmResult.reason || "LLM decision",
      llmResult.agentCount || 1,
    );
  }

  /**
   * 获取历史性能数据
   * @private
   */
  async _getHistoricalPerformance(task) {
    if (!this.database) {
      return null;
    }

    try {
      const subtaskCount = task.subtasks ? task.subtasks.length : 0;

      // 查询相似任务的历史执行记录
      const query = `
        SELECT
          use_multi_agent,
          AVG(execution_time) as avg_time,
          AVG(success_rate) as avg_success,
          COUNT(*) as count
        FROM task_execution_history
        WHERE task_type = ? AND subtask_count BETWEEN ? AND ?
        GROUP BY use_multi_agent
      `;

      const params = [
        task.task_type || "default",
        Math.max(subtaskCount - 2, 0),
        subtaskCount + 2,
      ];

      const result = await this.database.all(query, params);
      return result || [];
    } catch (error) {
      logger.warn("[LLMDecisionEngine] 查询历史数据失败:", error.message);
      return null;
    }
  }

  /**
   * 根据历史数据调整决策
   * @private
   */
  _adjustWithHistory(decision, historicalData) {
    if (!historicalData || historicalData.length === 0) {
      return decision;
    }

    // 查找多代理和单代理的历史记录
    const multiAgent = historicalData.find((d) => d.use_multi_agent === 1);
    const singleAgent = historicalData.find((d) => d.use_multi_agent === 0);

    if (!multiAgent || !singleAgent) {
      return decision;
    }

    // 数据量太少，不可靠
    if (multiAgent.count < 3 && singleAgent.count < 3) {
      return decision;
    }

    const adjustedDecision = { ...decision };
    const reasons = [];

    // 比较性能: 多代理更快且成功率高
    if (
      multiAgent.avg_time <
        singleAgent.avg_time * this.config.multiAgentSpeedupThreshold &&
      multiAgent.avg_success >=
        singleAgent.avg_success * this.config.successRateThreshold
    ) {
      adjustedDecision.useMultiAgent = true;
      const speedup = Math.round(
        (1 - multiAgent.avg_time / singleAgent.avg_time) * 100,
      );
      reasons.push(`历史数据显示多代理平均快${speedup}%`);

      // 提升置信度
      adjustedDecision.confidence = Math.min(
        adjustedDecision.confidence + this.config.historicalWeight,
        1.0,
      );
    }
    // 比较稳定性: 单代理成功率更高
    else if (singleAgent.avg_success > multiAgent.avg_success * 1.1) {
      adjustedDecision.useMultiAgent = false;
      adjustedDecision.strategy = DecisionStrategy.SINGLE_AGENT;
      reasons.push(
        `历史数据显示单代理成功率更高(${Math.round(singleAgent.avg_success * 100)}% vs ${Math.round(multiAgent.avg_success * 100)}%)`,
      );

      // 提升置信度
      adjustedDecision.confidence = Math.min(
        adjustedDecision.confidence + this.config.historicalWeight,
        1.0,
      );
    }

    if (reasons.length > 0) {
      adjustedDecision.reason = `${adjustedDecision.reason} | ${reasons.join("; ")}`;
      return new DecisionResult(
        adjustedDecision.useMultiAgent,
        adjustedDecision.strategy,
        adjustedDecision.confidence,
        adjustedDecision.reason,
        adjustedDecision.agentCount,
        adjustedDecision.metrics,
      );
    }

    return decision;
  }

  /**
   * 生成任务指纹 (用于缓存)
   * @private
   */
  _generateFingerprint(task, context) {
    const subtaskCount = task.subtasks ? task.subtasks.length : 0;
    const contextLength = context.length || 0;
    const taskType = task.task_type || task.type || "default";

    return `${taskType}:${subtaskCount}:${Math.floor(contextLength / 1000)}k`;
  }

  /**
   * 缓存决策结果
   * @private
   */
  _cacheDecision(fingerprint, decision) {
    this.decisionCache.set(fingerprint, decision);

    // LRU驱逐: 保持缓存大小在100以内
    if (this.decisionCache.size > 100) {
      const firstKey = this.decisionCache.keys().next().value;
      this.decisionCache.delete(firstKey);
    }
  }

  /**
   * 记录决策结果 (用于事件通知)
   * @private
   */
  _recordDecisionResult(decision) {
    if (decision.useMultiAgent) {
      this.stats.multiAgentDecisions++;
    } else {
      this.stats.singleAgentDecisions++;
    }

    this.emit("decision-made", {
      useMultiAgent: decision.useMultiAgent,
      strategy: decision.strategy,
      confidence: decision.confidence,
      agentCount: decision.agentCount,
    });
  }

  /**
   * 更新统计信息
   * @private
   */
  _updateStats(startTime) {
    const duration = Date.now() - startTime;
    const { totalDecisions, avgDecisionTime } = this.stats;

    // 计算移动平均
    this.stats.avgDecisionTime =
      (avgDecisionTime * (totalDecisions - 1) + duration) / totalDecisions;
  }

  /**
   * 记录任务执行结果 (用于历史学习)
   * @param {Object} taskResult - 任务执行结果
   */
  async recordExecutionResult(taskResult) {
    if (!this.database) {
      return;
    }

    try {
      const query = `
        INSERT INTO task_execution_history (
          task_type,
          subtask_count,
          use_multi_agent,
          execution_time,
          success_rate,
          created_at
        ) VALUES (?, ?, ?, ?, ?, datetime('now'))
      `;

      const params = [
        taskResult.task_type || "default",
        taskResult.subtask_count || 0,
        taskResult.use_multi_agent ? 1 : 0,
        taskResult.execution_time || 0,
        taskResult.success_rate || 1.0,
      ];

      await this.database.run(query, params);
      logger.debug("[LLMDecisionEngine] 记录执行结果", params);
    } catch (error) {
      logger.warn("[LLMDecisionEngine] 记录执行结果失败:", error.message);
    }
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      multiAgentRate:
        this.stats.totalDecisions > 0
          ? (
              (this.stats.multiAgentDecisions / this.stats.totalDecisions) *
              100
            ).toFixed(2) + "%"
          : "0%",
      llmCallRate:
        this.stats.totalDecisions > 0
          ? (
              (this.stats.llmCallCount / this.stats.totalDecisions) *
              100
            ).toFixed(2) + "%"
          : "0%",
      avgDecisionTime: this.stats.avgDecisionTime.toFixed(2) + "ms",
      cacheSize: this.decisionCache.size,
    };
  }

  /**
   * 重置统计信息
   */
  resetStats() {
    this.stats = {
      totalDecisions: 0,
      multiAgentDecisions: 0,
      singleAgentDecisions: 0,
      llmCallCount: 0,
      basicRuleCount: 0,
      historicalAdjustments: 0,
      avgDecisionTime: 0,
    };
  }

  /**
   * 清空决策缓存
   */
  clearCache() {
    this.decisionCache.clear();
    logger.info("[LLMDecisionEngine] 决策缓存已清空");
  }
}

module.exports = { LLMDecisionEngine, DecisionResult, DecisionStrategy };

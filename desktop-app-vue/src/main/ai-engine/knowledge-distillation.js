const { logger } = require("../utils/logger.js");

/**
 * 知识蒸馏模块 (Knowledge Distillation)
 *
 * 功能:
 * 1. 复杂度评估 - 判断任务复杂度
 * 2. 路由决策 - 选择小模型/大模型
 * 3. 质量检查 - 验证结果质量
 * 4. 回退策略 - 低质量结果回退到大模型
 * 5. 数据库日志 - 记录蒸馏决策
 *
 * @module knowledge-distillation
 */

/**
 * 复杂度级别
 */
const ComplexityLevel = {
  SIMPLE: "simple", // 简单任务 → 小模型
  MEDIUM: "medium", // 中等任务 → 大模型
  COMPLEX: "complex", // 复杂任务 → 大模型
};

/**
 * 模型类型
 */
const ModelType = {
  SMALL: "small", // qwen2:1.5b
  LARGE: "large", // qwen2:7b
};

/**
 * 知识蒸馏引擎
 */
class KnowledgeDistillation {
  constructor(config = {}) {
    this.config = {
      enableDistillation: true,
      smallModel: "qwen2:1.5b",
      largeModel: "qwen2:7b",
      qualityThreshold: 0.7, // 质量阈值
      enableFallback: true, // 启用回退
      enableLearning: true, // 启用学习
      maxRetries: 1, // 最大重试次数
      complexityThreshold: 0.35, // 复杂度阈值（超过此值使用大模型）
      ...config,
    };

    this.db = null;
    this.llmManager = null;

    // 性能统计
    this.stats = {
      totalRequests: 0,
      smallModelUsage: 0,
      largeModelUsage: 0,
      fallbacks: 0,
      totalSavings: 0, // 节省的计算量(相对于全用大模型)
    };

    // 复杂度特征权重(可通过学习调整)
    this.complexityWeights = {
      intentCount: 0.3,
      parameterComplexity: 0.2,
      taskType: 0.3,
      contextSize: 0.2,
    };
  }

  /**
   * 设置数据库连接
   */
  setDatabase(db) {
    this.db = db;
  }

  /**
   * 设置LLM管理器
   */
  setLLM(llmManager) {
    this.llmManager = llmManager;
  }

  /**
   * 评估任务复杂度
   *
   * @param {Object} task - 任务对象
   * @param {Array} task.intents - 意图列表
   * @param {Object} task.context - 上下文
   * @returns {Object} { level, score, features }
   */
  evaluateComplexity(task) {
    const features = this._extractComplexityFeatures(task);
    const score = this._calculateComplexityScore(features);

    // 使用配置的阈值判断复杂度级别
    const threshold = this.config.complexityThreshold || 0.35;
    let level;
    if (score < threshold) {
      level = ComplexityLevel.SIMPLE;
    } else if (score < threshold + 0.25) {
      level = ComplexityLevel.MEDIUM;
    } else {
      level = ComplexityLevel.COMPLEX;
    }

    return {
      level,
      score,
      features,
      timestamp: Date.now(),
    };
  }

  /**
   * 提取复杂度特征
   *
   * @private
   * @param {Object} task
   * @returns {Object} 特征对象
   */
  _extractComplexityFeatures(task) {
    const intents = task.intents || [];
    const context = task.context || {};

    // 特征1: 意图数量
    const intentCountScore = Math.min(intents.length / 5, 1.0);

    // 特征2: 参数复杂度
    let parameterComplexity = 0;
    for (const intent of intents) {
      const params = intent.params || {};
      const paramCount = Object.keys(params).length;
      parameterComplexity += paramCount;
    }
    const avgParamComplexity =
      intents.length > 0 ? parameterComplexity / intents.length : 0;
    const parameterScore = Math.min(avgParamComplexity / 5, 1.0);

    // 特征3: 任务类型复杂度
    const taskTypeScore = this._evaluateTaskTypeComplexity(intents);

    // 特征4: 上下文大小
    const contextStr = JSON.stringify(context);
    const contextScore = Math.min(contextStr.length / 1000, 1.0);

    return {
      intentCount: intentCountScore,
      parameterComplexity: parameterScore,
      taskType: taskTypeScore,
      contextSize: contextScore,
    };
  }

  /**
   * 评估任务类型复杂度
   *
   * @private
   * @param {Array} intents
   * @returns {number} 0-1之间的分数
   */
  _evaluateTaskTypeComplexity(intents) {
    // 简单任务类型 (0.2)
    const simpleTasks = new Set([
      "CREATE_FILE",
      "DELETE_FILE",
      "RENAME_FILE",
      "READ_FILE",
      "LIST_FILES",
      "SIMPLE_QUERY",
      "GET_TIME",
      "GET_WEATHER",
    ]);

    // 中等任务类型 (0.5)
    const mediumTasks = new Set([
      "WRITE_FILE",
      "UPDATE_FILE",
      "SEARCH_FILES",
      "GIT_ADD",
      "GIT_COMMIT",
      "GIT_PUSH",
      "NPM_INSTALL",
      "NPM_BUILD",
      "COMPRESS_IMAGE",
      "CONVERT_FORMAT",
    ]);

    // 复杂任务类型 (0.8)
    const complexTasks = new Set([
      "CODE_GENERATION",
      "CODE_REFACTOR",
      "CODE_ANALYSIS",
      "COMPLEX_QUERY",
      "DATA_ANALYSIS",
      "SECURITY_SCAN",
      "PERFORMANCE_OPTIMIZATION",
      "API_DESIGN",
      "DATABASE_MIGRATION",
    ]);

    let totalScore = 0;
    for (const intent of intents) {
      const type = intent.type;
      if (complexTasks.has(type)) {
        totalScore += 0.8;
      } else if (mediumTasks.has(type)) {
        totalScore += 0.5;
      } else if (simpleTasks.has(type)) {
        totalScore += 0.2;
      } else {
        // 未知任务类型，假设为中等
        totalScore += 0.5;
      }
    }

    return intents.length > 0 ? totalScore / intents.length : 0.5;
  }

  /**
   * 计算复杂度分数
   *
   * @private
   * @param {Object} features
   * @returns {number} 0-1之间的复杂度分数
   */
  _calculateComplexityScore(features) {
    const weights = this.complexityWeights;

    return (
      features.intentCount * weights.intentCount +
      features.parameterComplexity * weights.parameterComplexity +
      features.taskType * weights.taskType +
      features.contextSize * weights.contextSize
    );
  }

  /**
   * 路由决策 - 选择模型
   *
   * @param {Object} complexity - 复杂度评估结果
   * @returns {Object} { modelType, modelName, reason }
   */
  routeToModel(complexity) {
    if (!this.config.enableDistillation) {
      return {
        modelType: ModelType.LARGE,
        modelName: this.config.largeModel,
        reason: "distillation_disabled",
      };
    }

    let modelType;
    let reason;

    // 路由策略：只有 SIMPLE 使用小模型，MEDIUM 和 COMPLEX 使用大模型
    // 通过调整阈值（从 0.3 降到 0.35），更多任务会被判定为 SIMPLE
    if (complexity.level === ComplexityLevel.SIMPLE) {
      modelType = ModelType.SMALL;
      reason = "simple_task";
    } else {
      modelType = ModelType.LARGE;
      reason =
        complexity.level === ComplexityLevel.MEDIUM
          ? "medium_task"
          : "complex_task";
    }

    const modelName =
      modelType === ModelType.SMALL
        ? this.config.smallModel
        : this.config.largeModel;

    return {
      modelType,
      modelName,
      reason,
      complexityScore: complexity.score,
    };
  }

  /**
   * 检查结果质量
   *
   * @param {Object} result - LLM返回结果
   * @param {Object} task - 原始任务
   * @returns {Object} { isQualified, score, issues }
   */
  checkQuality(result, task) {
    const issues = [];
    let score = 1.0;

    // 检查1: 结果是否为空
    if (!result || Object.keys(result).length === 0) {
      issues.push("empty_result");
      score -= 0.5;
    }

    // 检查2: 是否包含错误
    if (result.error) {
      issues.push("contains_error");
      score -= 0.3;
    }

    // 检查3: 置信度检查(如果LLM返回了置信度)
    if (result.confidence !== undefined && result.confidence < 0.6) {
      issues.push("low_confidence");
      score -= 0.2;
    }

    // 检查4: 结果完整性(是否处理了所有意图)
    const intents = task.intents || [];
    const processedIntents = result.processedIntents || [];
    if (processedIntents.length < intents.length) {
      issues.push("incomplete_processing");
      score -= 0.2;
    }

    // 检查5: 输出格式正确性
    if (result.output === undefined && result.result === undefined) {
      issues.push("missing_output");
      score -= 0.3;
    }

    score = Math.max(0, score);
    const isQualified = score >= this.config.qualityThreshold;

    return {
      isQualified,
      score,
      issues,
      threshold: this.config.qualityThreshold,
    };
  }

  /**
   * 执行任务(带知识蒸馏)
   *
   * @param {Object} task - 任务对象
   * @param {Object} context - 执行上下文
   * @returns {Object} 执行结果
   */
  async executeWithDistillation(task, context = {}) {
    this.stats.totalRequests++;

    // Step 1: 评估复杂度
    const complexity = this.evaluateComplexity(task);
    logger.info(
      `[KnowledgeDistillation] 复杂度评估: ${complexity.level} (分数: ${complexity.score.toFixed(2)})`,
    );

    // Step 2: 路由决策
    const routing = this.routeToModel(complexity);
    logger.info(
      `[KnowledgeDistillation] 路由到: ${routing.modelName} (${routing.reason})`,
    );

    // Step 3: 执行任务
    let result;
    let finalModelType = routing.modelType;
    let usedFallback = false;

    try {
      // 使用选定的模型执行
      result = await this._executeTask(task, routing.modelName, context);

      // Step 4: 质量检查(仅对小模型结果)
      if (routing.modelType === ModelType.SMALL) {
        const quality = this.checkQuality(result, task);
        logger.info(
          `[KnowledgeDistillation] 质量检查: ${quality.isQualified ? "通过" : "未通过"} (分数: ${quality.score.toFixed(2)})`,
        );

        // Step 5: 回退策略
        if (!quality.isQualified && this.config.enableFallback) {
          logger.info(
            `[KnowledgeDistillation] 质量不合格，回退到大模型 (问题: ${quality.issues.join(", ")})`,
          );
          result = await this._executeTask(
            task,
            this.config.largeModel,
            context,
          );
          finalModelType = ModelType.LARGE;
          usedFallback = true;
          this.stats.fallbacks++;
        }
      }

      // 更新统计
      if (finalModelType === ModelType.SMALL) {
        this.stats.smallModelUsage++;
        this.stats.totalSavings += 1; // 小模型节省1单位成本
      } else {
        this.stats.largeModelUsage++;
      }
    } catch (error) {
      logger.error("[KnowledgeDistillation] 执行失败:", error);

      // 如果小模型失败且启用回退，尝试大模型
      if (routing.modelType === ModelType.SMALL && this.config.enableFallback) {
        logger.info("[KnowledgeDistillation] 小模型执行失败，回退到大模型");
        result = await this._executeTask(task, this.config.largeModel, context);
        finalModelType = ModelType.LARGE;
        usedFallback = true;
        this.stats.fallbacks++;
        this.stats.largeModelUsage++;
      } else {
        throw error;
      }
    }

    // Step 6: 记录到数据库
    await this._recordDistillation({
      task,
      complexity,
      routing,
      finalModelType,
      usedFallback,
      context,
    });

    return {
      ...result,
      _distillation: {
        complexity: complexity.level,
        complexityScore: complexity.score,
        modelUsed: finalModelType,
        usedFallback,
      },
    };
  }

  /**
   * 执行任务(内部方法)
   *
   * @private
   * @param {Object} task
   * @param {string} modelName
   * @param {Object} context
   * @returns {Object} 执行结果
   */
  async _executeTask(task, modelName, context) {
    if (!this.llmManager) {
      throw new Error("LLM管理器未初始化");
    }

    logger.info(`[KnowledgeDistillation] 使用模型 ${modelName} 执行任务...`);

    try {
      // 构建任务提示词
      const taskPrompt = this._buildTaskPrompt(task);

      // 调用 LLM 执行任务
      const response = await this.llmManager.query(taskPrompt, {
        model: modelName,
        temperature: context.temperature || 0.7,
        maxTokens: context.maxTokens || 2000,
        ...context,
      });

      // 解析响应
      const output = response.text || response.content || "";
      const confidence = this._estimateConfidence(output, modelName);

      return {
        success: true,
        processedIntents: task.intents || [],
        output,
        confidence,
        tokensUsed: response.usage?.total_tokens || 0,
      };
    } catch (error) {
      logger.error(`[KnowledgeDistillation] LLM执行失败:`, error);

      // 返回失败结果，让调用方可以尝试降级
      return {
        success: false,
        processedIntents: task.intents || [],
        output: null,
        confidence: 0,
        error: error.message,
      };
    }
  }

  /**
   * 构建任务提示词
   * @private
   */
  _buildTaskPrompt(task) {
    const intents = task.intents || [];
    const intentStr =
      intents.length > 0 ? `任务意图: ${intents.join(", ")}\n` : "";

    return `${intentStr}${task.prompt || task.content || JSON.stringify(task)}`;
  }

  /**
   * 估计执行置信度
   * @private
   */
  _estimateConfidence(output, modelName) {
    if (!output) {
      return 0;
    }

    // 基于模型大小的基础置信度
    let baseConfidence = 0.85;
    if (modelName.includes("1.5b") || modelName.includes("small")) {
      baseConfidence = 0.7;
    } else if (
      modelName.includes("70b") ||
      modelName.includes("large") ||
      modelName.includes("opus")
    ) {
      baseConfidence = 0.95;
    }

    // 根据输出长度调整
    const outputLength = output.length;
    if (outputLength < 50) {
      baseConfidence *= 0.8; // 输出过短，可能不完整
    } else if (outputLength > 500) {
      baseConfidence *= 1.05; // 输出较详细
    }

    return Math.min(baseConfidence, 1.0);
  }

  /**
   * 记录蒸馏决策到数据库
   *
   * @private
   * @param {Object} record
   */
  async _recordDistillation(record) {
    if (!this.db || !this.config.enableLearning) {
      return;
    }

    try {
      const insertStmt = this.db.prepare(`
        INSERT INTO knowledge_distillation_history (
          task_id,
          complexity_level,
          complexity_score,
          planned_model,
          actual_model,
          used_fallback,
          task_intents,
          context_data,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      insertStmt.run(
        record.context.sessionId || `kd-${Date.now()}`,
        record.complexity.level,
        record.complexity.score,
        record.routing.modelType,
        record.finalModelType,
        record.usedFallback ? 1 : 0,
        JSON.stringify(record.task.intents || []),
        JSON.stringify(record.context),
        new Date().toISOString(),
      );
    } catch (error) {
      logger.error("[KnowledgeDistillation] 记录蒸馏历史失败:", error);
    }
  }

  /**
   * 获取蒸馏统计
   *
   * @param {Object} options - 过滤选项
   * @returns {Object} 统计信息
   */
  async getDistillationStats(options = {}) {
    // 运行时统计
    const runtimeStats = {
      totalRequests: this.stats.totalRequests,
      smallModelUsage: this.stats.smallModelUsage,
      largeModelUsage: this.stats.largeModelUsage,
      smallModelRate:
        this.stats.totalRequests > 0
          ? this.stats.smallModelUsage / this.stats.totalRequests
          : 0,
      fallbacks: this.stats.fallbacks,
      fallbackRate:
        this.stats.smallModelUsage > 0
          ? this.stats.fallbacks / this.stats.smallModelUsage
          : 0,
      totalSavings: this.stats.totalSavings,
      savingsRate:
        this.stats.totalRequests > 0
          ? this.stats.totalSavings / this.stats.totalRequests
          : 0,
    };

    // 数据库统计
    if (!this.db) {
      return { runtime: runtimeStats };
    }

    try {
      const { startTime, endTime } = options;

      const whereClauses = [];
      const params = [];

      if (startTime) {
        whereClauses.push("created_at >= ?");
        params.push(startTime);
      }
      if (endTime) {
        whereClauses.push("created_at <= ?");
        params.push(endTime);
      }

      const whereClause =
        whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

      const query = `
        SELECT
          COUNT(*) as totalDistillations,
          SUM(CASE WHEN actual_model = 'small' THEN 1 ELSE 0 END) as smallModelCount,
          SUM(CASE WHEN actual_model = 'large' THEN 1 ELSE 0 END) as largeModelCount,
          SUM(CASE WHEN used_fallback = 1 THEN 1 ELSE 0 END) as fallbackCount,
          AVG(complexity_score) as avgComplexityScore,
          AVG(CASE WHEN complexity_level = 'simple' THEN 1.0 ELSE 0.0 END) as simpleTaskRate,
          AVG(CASE WHEN complexity_level = 'medium' THEN 1.0 ELSE 0.0 END) as mediumTaskRate,
          AVG(CASE WHEN complexity_level = 'complex' THEN 1.0 ELSE 0.0 END) as complexTaskRate
        FROM knowledge_distillation_history
        ${whereClause}
      `;

      const dbStats = this.db.prepare(query).get(...params);

      return {
        runtime: runtimeStats,
        database: {
          totalDistillations: dbStats.totalDistillations || 0,
          smallModelCount: dbStats.smallModelCount || 0,
          largeModelCount: dbStats.largeModelCount || 0,
          fallbackCount: dbStats.fallbackCount || 0,
          avgComplexityScore: dbStats.avgComplexityScore || 0,
          simpleTaskRate: dbStats.simpleTaskRate || 0,
          mediumTaskRate: dbStats.mediumTaskRate || 0,
          complexTaskRate: dbStats.complexTaskRate || 0,
        },
      };
    } catch (error) {
      logger.error("[KnowledgeDistillation] 获取蒸馏统计失败:", error);
      return { runtime: runtimeStats };
    }
  }

  /**
   * 学习和优化复杂度权重(基于历史数据)
   *
   * @returns {Object} 优化结果
   */
  async learnFromHistory() {
    if (!this.db || !this.config.enableLearning) {
      return { success: false, reason: "learning_disabled" };
    }

    try {
      // 查询回退案例
      const fallbackCases = this.db
        .prepare(
          `
        SELECT
          complexity_level,
          complexity_score,
          task_intents
        FROM knowledge_distillation_history
        WHERE used_fallback = 1
        ORDER BY created_at DESC
        LIMIT 100
      `,
        )
        .all();

      if (fallbackCases.length === 0) {
        return { success: true, adjustments: 0, reason: "no_fallback_cases" };
      }

      logger.info(
        `[KnowledgeDistillation] 从${fallbackCases.length}个回退案例中学习...`,
      );

      // 分析回退案例，调整复杂度阈值
      // 如果很多simple任务被回退，说明复杂度评估过于乐观，需要调整权重
      const simpleFallbacks = fallbackCases.filter(
        (c) => c.complexity_level === "simple",
      ).length;
      const fallbackRate = simpleFallbacks / fallbackCases.length;

      if (fallbackRate > 0.3) {
        // 30%以上的simple任务被回退，说明需要更保守的评估
        logger.info(
          `[KnowledgeDistillation] 检测到高回退率(${(fallbackRate * 100).toFixed(1)}%)，调整权重...`,
        );

        // 增加taskType权重，降低intentCount权重
        this.complexityWeights.taskType += 0.05;
        this.complexityWeights.intentCount -= 0.05;

        // 归一化权重
        const total = Object.values(this.complexityWeights).reduce(
          (a, b) => a + b,
          0,
        );
        for (const key in this.complexityWeights) {
          this.complexityWeights[key] /= total;
        }

        return {
          success: true,
          adjustments: 1,
          newWeights: this.complexityWeights,
          fallbackRate,
        };
      }

      return {
        success: true,
        adjustments: 0,
        fallbackRate,
        reason: "weights_optimal",
      };
    } catch (error) {
      logger.error("[KnowledgeDistillation] 学习失败:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 获取性能统计
   */
  getPerformanceStats() {
    return {
      ...this.stats,
      smallModelRate:
        this.stats.totalRequests > 0
          ? (
              (this.stats.smallModelUsage / this.stats.totalRequests) *
              100
            ).toFixed(2) + "%"
          : "0%",
      fallbackRate:
        this.stats.smallModelUsage > 0
          ? ((this.stats.fallbacks / this.stats.smallModelUsage) * 100).toFixed(
              2,
            ) + "%"
          : "0%",
      savingsRate:
        this.stats.totalRequests > 0
          ? (
              (this.stats.totalSavings / this.stats.totalRequests) *
              100
            ).toFixed(2) + "%"
          : "0%",
    };
  }

  /**
   * 清理资源
   */
  cleanup() {
    this.db = null;
    this.llmManager = null;
  }
}

module.exports = {
  KnowledgeDistillation,
  ComplexityLevel,
  ModelType,
};

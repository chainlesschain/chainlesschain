const { logger } = require("../utils/logger.js");

/**
 * 分层任务规划器
 *
 * 功能:
 * 1. 三层分解：业务逻辑层 → 技术任务层 → 工具调用层
 * 2. 可控粒度（coarse/medium/fine/auto）
 * 3. 估算执行时间
 * 4. 生成用户友好的执行计划
 *
 * 优势:
 * - 分层展示，用户更容易理解
 * - 可控粒度，适配不同场景
 * - 便于进度可视化
 *
 * 版本: v0.17.0-P1
 * 更新: 2026-01-01
 */

class HierarchicalTaskPlanner {
  constructor(llmService, taskPlanner, functionCaller) {
    this.llmService = llmService;
    this.taskPlanner = taskPlanner;
    this.functionCaller = functionCaller;

    // 粒度配置
    this.granularityConfig = {
      coarse: {
        maxBusinessSteps: 3,
        maxTechnicalSteps: 5,
        description: "粗粒度（快速，3-5步）",
      },
      medium: {
        maxBusinessSteps: 5,
        maxTechnicalSteps: 10,
        description: "中粒度（平衡，5-10步）",
      },
      fine: {
        maxBusinessSteps: 8,
        maxTechnicalSteps: 20,
        description: "细粒度（详细，10-20步）",
      },
      auto: {
        description: "自动根据任务复杂度选择",
      },
    };

    // 工具执行时间估算（秒）
    this.toolDurationEstimates = {
      html_generator: 3,
      css_generator: 2,
      js_generator: 3,
      word_generator: 5,
      pdf_generator: 8,
      file_writer: 1,
      file_reader: 1,
      data_analyzer: 10,
      image_generator: 15,
      git_commit: 2,
      deploy_to_cloud: 20,
      default: 5,
    };
  }

  /**
   * 分层规划
   * @param {Object} intent - 用户意图
   * @param {Object} context - 上下文
   * @param {Object} options - 选项
   * @returns {Object} 分层计划
   */
  async plan(intent, context, options = {}) {
    const {
      granularity = "auto",
      includeBusinessLayer = true,
      includeTechnicalLayer = true,
      includeExecutionLayer = true,
    } = options;

    // 1. 确定实际粒度
    const actualGranularity = this.determineGranularity(
      granularity,
      intent,
      context,
    );

    const plan = {
      intent,
      granularity: actualGranularity,
      layers: {},
    };

    // 2. 高层分解（业务逻辑）
    if (includeBusinessLayer) {
      plan.layers.business = await this.decomposeBusinessLogic(
        intent,
        context,
        actualGranularity,
      );
    }

    // 3. 中层分解（技术任务）
    if (includeTechnicalLayer) {
      plan.layers.technical = await this.decomposeTechnical(
        plan.layers.business || [intent.description],
        context,
        actualGranularity,
      );
    }

    // 4. 底层分解（工具调用）
    if (includeExecutionLayer) {
      plan.layers.execution = await this.decomposeToTools(
        plan.layers.technical || [],
        context,
        actualGranularity,
      );
    }

    // 5. 生成汇总信息
    plan.summary = this.generatePlanSummary(plan);

    return plan;
  }

  /**
   * 确定实际粒度
   * @param {string} requestedGranularity - 请求的粒度
   * @param {Object} intent - 意图
   * @param {Object} context - 上下文
   * @returns {string} 实际粒度
   */
  determineGranularity(requestedGranularity, intent, context) {
    if (requestedGranularity !== "auto") {
      return requestedGranularity;
    }

    // 自动判断任务复杂度
    const complexity = this.assessComplexity(intent, context);

    if (complexity < 3) {
      return "coarse"; // 简单任务，粗粒度
    } else if (complexity < 7) {
      return "medium"; // 中等任务，中粒度
    } else {
      return "fine"; // 复杂任务，细粒度
    }
  }

  /**
   * 评估任务复杂度（0-10分）
   * @param {Object} intent - 意图
   * @param {Object} context - 上下文
   * @returns {number} 复杂度分数
   */
  assessComplexity(intent, context) {
    let score = 0;

    // 因素1: 实体数量
    const entityCount = Object.keys(intent.entities || {}).length;
    score += Math.min(entityCount, 3);

    // 因素2: 是否涉及多个文件
    if (context.projectFiles && context.projectFiles.length > 3) {
      score += 2;
    }

    // 因素3: 是否涉及复杂操作
    const complexIntents = ["ANALYZE_DATA", "DEPLOY_PROJECT", "REFACTOR_CODE"];
    if (complexIntents.includes(intent.intent)) {
      score += 3;
    }

    // 因素4: 用户输入长度
    const inputLength = intent.description?.length || 0;
    if (inputLength > 100) {
      score += 2;
    }

    return Math.min(score, 10);
  }

  /**
   * 业务逻辑层分解
   * @param {Object} intent - 意图
   * @param {Object} context - 上下文
   * @param {string} granularity - 粒度
   * @returns {Array} 业务步骤数组
   */
  async decomposeBusinessLogic(intent, context, granularity) {
    const config =
      this.granularityConfig[granularity] || this.granularityConfig["medium"];
    const maxSteps = config.maxBusinessSteps || 5;

    const prompt = `
将用户意图分解为 ${maxSteps} 个以内的高层业务步骤（面向用户的描述）。

意图: ${JSON.stringify(intent)}
上下文: ${JSON.stringify(context)}

要求:
1. 使用用户能理解的业务术语（避免技术细节）
2. 每个步骤应该是独立的业务目标
3. 步骤数量控制在 ${maxSteps} 个以内
4. 步骤之间有逻辑顺序

输出格式（JSON数组，无其他文本）:
[
  "步骤1描述",
  "步骤2描述",
  "步骤3描述"
]
`;

    try {
      const result = await this.llmService.complete({
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
      });

      const parsed = this.parseJSON(result.content || result);

      if (Array.isArray(parsed)) {
        return parsed.slice(0, maxSteps);
      }

      // 降级策略
      return this.ruleBasedBusinessDecompose(intent, maxSteps);
    } catch (error) {
      logger.error("业务逻辑分解失败:", error);
      return this.ruleBasedBusinessDecompose(intent, maxSteps);
    }
  }

  /**
   * 基于规则的业务分解（降级策略）
   * @param {Object} intent - 意图
   * @param {number} maxSteps - 最大步骤数
   * @returns {Array} 业务步骤
   */
  ruleBasedBusinessDecompose(intent, maxSteps) {
    const steps = [];

    // 根据意图类型提供默认分解
    switch (intent.intent) {
      case "CREATE_FILE":
        steps.push("设计内容结构");
        steps.push("生成文件内容");
        steps.push("保存文件到磁盘");
        break;

      case "DEPLOY_PROJECT":
        steps.push("准备部署文件");
        steps.push("配置部署参数");
        steps.push("上传到云端");
        steps.push("验证部署结果");
        break;

      case "ANALYZE_DATA":
        steps.push("读取数据文件");
        steps.push("数据清洗和预处理");
        steps.push("执行统计分析");
        steps.push("生成分析报告");
        break;

      default:
        steps.push(`执行${intent.description}`);
    }

    return steps.slice(0, maxSteps);
  }

  /**
   * 技术任务层分解
   * @param {Array} businessSteps - 业务步骤
   * @param {Object} context - 上下文
   * @param {string} granularity - 粒度
   * @returns {Array} 技术任务数组
   */
  async decomposeTechnical(businessSteps, context, granularity) {
    const config =
      this.granularityConfig[granularity] || this.granularityConfig["medium"];
    const maxSteps = config.maxTechnicalSteps || 10;

    const technicalTasks = [];

    for (const businessStep of businessSteps) {
      const tasks = await this.decomposeSingleBusinessStep(
        businessStep,
        context,
        Math.ceil(maxSteps / businessSteps.length),
      );

      technicalTasks.push(...tasks);
    }

    return technicalTasks.slice(0, maxSteps);
  }

  /**
   * 分解单个业务步骤为技术任务
   * @param {string} businessStep - 业务步骤
   * @param {Object} context - 上下文
   * @param {number} maxSubTasks - 最大子任务数
   * @returns {Array} 技术任务
   */
  async decomposeSingleBusinessStep(businessStep, context, maxSubTasks) {
    const prompt = `
将业务步骤分解为具体的技术任务。

业务步骤: "${businessStep}"
上下文: ${JSON.stringify(context)}

要求:
1. 使用技术术语描述
2. 每个任务应该是具体可执行的
3. 最多${maxSubTasks}个子任务
4. 包含必要的技术细节

输出格式（JSON数组）:
[
  "技术任务1",
  "技术任务2"
]
`;

    try {
      const result = await this.llmService.complete({
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
      });

      const parsed = this.parseJSON(result.content || result);

      if (Array.isArray(parsed)) {
        return parsed.slice(0, maxSubTasks);
      }

      return this.ruleBasedTechnicalDecompose(businessStep, maxSubTasks);
    } catch (error) {
      logger.error("技术任务分解失败:", error);
      return this.ruleBasedTechnicalDecompose(businessStep, maxSubTasks);
    }
  }

  /**
   * 基于规则的技术分解
   * @param {string} businessStep - 业务步骤
   * @param {number} maxSubTasks - 最大子任务数
   * @returns {Array} 技术任务
   */
  ruleBasedTechnicalDecompose(businessStep, maxSubTasks) {
    const tasks = [];

    // 简单的关键词匹配
    if (businessStep.includes("生成") || businessStep.includes("创建")) {
      tasks.push("调用生成器工具");
      tasks.push("写入文件系统");
    }

    if (businessStep.includes("部署") || businessStep.includes("上传")) {
      tasks.push("构建项目");
      tasks.push("上传文件");
      tasks.push("配置服务器");
    }

    if (businessStep.includes("分析") || businessStep.includes("统计")) {
      tasks.push("读取数据源");
      tasks.push("执行计算");
      tasks.push("生成图表");
    }

    // 如果没有匹配，返回通用任务
    if (tasks.length === 0) {
      tasks.push(businessStep);
    }

    return tasks.slice(0, maxSubTasks);
  }

  /**
   * 工具调用层分解
   * @param {Array} technicalTasks - 技术任务
   * @param {Object} context - 上下文
   * @param {string} granularity - 粒度
   * @returns {Array} 工具调用数组
   */
  async decomposeToTools(technicalTasks, context, granularity) {
    const toolCalls = [];

    for (const task of technicalTasks) {
      const tools = await this.taskToTools(task, context);
      toolCalls.push(...tools);
    }

    return toolCalls;
  }

  /**
   * 将技术任务转换为工具调用
   * @param {string} task - 技术任务
   * @param {Object} context - 上下文
   * @returns {Array} 工具调用
   */
  async taskToTools(task, context) {
    // 使用原有的TaskPlanner
    if (this.taskPlanner && this.taskPlanner.quickDecompose) {
      try {
        const plan = await this.taskPlanner.quickDecompose({
          description: task,
          entities: context,
        });

        return plan.subtasks || [];
      } catch (error) {
        logger.error("任务转工具失败:", error);
      }
    }

    // 降级策略：简单的关键词映射
    return this.ruleBasedToolMapping(task, context);
  }

  /**
   * 基于规则的工具映射
   * @param {string} task - 技术任务
   * @param {Object} context - 上下文
   * @returns {Array} 工具调用
   */
  ruleBasedToolMapping(task, context) {
    const tools = [];

    // HTML生成
    if (task.includes("HTML") || task.includes("网页")) {
      tools.push({
        tool: "html_generator",
        params: context,
        title: "生成HTML",
      });
    }

    // CSS生成
    if (task.includes("CSS") || task.includes("样式")) {
      tools.push({
        tool: "css_generator",
        params: context,
        title: "生成CSS",
      });
    }

    // Word生成
    if (task.includes("Word") || task.includes("文档")) {
      tools.push({
        tool: "word_generator",
        params: context,
        title: "生成Word文档",
      });
    }

    // 文件读写
    if (task.includes("读取") || task.includes("读")) {
      tools.push({
        tool: "file_reader",
        params: { filePath: context.filePath },
        title: "读取文件",
      });
    }

    if (task.includes("写入") || task.includes("保存")) {
      tools.push({
        tool: "file_writer",
        params: context,
        title: "写入文件",
      });
    }

    // 数据分析
    if (task.includes("分析") || task.includes("统计")) {
      tools.push({
        tool: "data_analyzer",
        params: context,
        title: "数据分析",
      });
    }

    // Git操作
    if (task.includes("提交") || task.includes("commit")) {
      tools.push({
        tool: "git_commit",
        params: { message: task },
        title: "Git提交",
      });
    }

    return tools;
  }

  /**
   * 生成计划摘要
   * @param {Object} plan - 完整计划
   * @returns {Object} 摘要信息
   */
  generatePlanSummary(plan) {
    const summary = {
      granularity: plan.granularity,
      granularityDescription:
        this.granularityConfig[plan.granularity]?.description || "未知",
      layerCounts: {},
      totalSteps: 0,
      estimatedDuration: 0,
      complexity: "unknown",
    };

    // 统计各层级步骤数
    if (plan.layers.business) {
      summary.layerCounts.business = plan.layers.business.length;
      summary.totalSteps += plan.layers.business.length;
    }

    if (plan.layers.technical) {
      summary.layerCounts.technical = plan.layers.technical.length;
      summary.totalSteps += plan.layers.technical.length;
    }

    if (plan.layers.execution) {
      summary.layerCounts.execution = plan.layers.execution.length;
      summary.totalSteps += plan.layers.execution.length;

      // 估算执行时间
      summary.estimatedDuration = this.estimateDuration(plan.layers.execution);
    }

    // 评估复杂度
    if (summary.totalSteps <= 5) {
      summary.complexity = "simple";
    } else if (summary.totalSteps <= 15) {
      summary.complexity = "medium";
    } else {
      summary.complexity = "complex";
    }

    return summary;
  }

  /**
   * 估算执行时间
   * @param {Array} executionPlan - 执行计划
   * @returns {number} 估算时间（秒）
   */
  estimateDuration(executionPlan) {
    let totalDuration = 0;

    for (const step of executionPlan) {
      const toolName = step.tool;
      const duration =
        this.toolDurationEstimates[toolName] ||
        this.toolDurationEstimates["default"];

      totalDuration += duration;
    }

    return totalDuration;
  }

  /**
   * 解析JSON（容错）
   * @param {string} text - JSON字符串
   * @returns {any} 解析结果
   */
  parseJSON(text) {
    try {
      return JSON.parse(text);
    } catch (error) {
      const jsonMatch = text.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch (e) {
          logger.error("JSON解析失败:", e);
          return null;
        }
      }
      return null;
    }
  }

  /**
   * 生成可视化文本
   * @param {Object} plan - 计划
   * @returns {string} 可视化文本
   */
  visualize(plan) {
    const lines = [];

    lines.push(`\n╔════════════════════════════════════════╗`);
    lines.push(`║        分层任务规划                    ║`);
    lines.push(`╚════════════════════════════════════════╝\n`);

    lines.push(`粒度: ${plan.summary.granularityDescription}`);
    lines.push(`总步骤数: ${plan.summary.totalSteps}`);
    lines.push(`预计耗时: ${plan.summary.estimatedDuration}秒`);
    lines.push(`复杂度: ${plan.summary.complexity}\n`);

    if (plan.layers.business) {
      lines.push(`━━━ 业务逻辑层 (${plan.layers.business.length}步) ━━━`);
      plan.layers.business.forEach((step, i) => {
        lines.push(`  ${i + 1}. ${step}`);
      });
      lines.push("");
    }

    if (plan.layers.technical) {
      lines.push(`━━━ 技术任务层 (${plan.layers.technical.length}步) ━━━`);
      plan.layers.technical.forEach((step, i) => {
        lines.push(`  ${i + 1}. ${step}`);
      });
      lines.push("");
    }

    if (plan.layers.execution) {
      lines.push(`━━━ 工具调用层 (${plan.layers.execution.length}步) ━━━`);
      plan.layers.execution.forEach((step, i) => {
        lines.push(`  ${i + 1}. ${step.tool} - ${step.title || "未命名"}`);
      });
      lines.push("");
    }

    return lines.join("\n");
  }
}

module.exports = HierarchicalTaskPlanner;

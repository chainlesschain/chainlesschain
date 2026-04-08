/**
 * AI引擎主管理器 (优化版)
 * 集成了槽位填充、工具沙箱、性能监控三大优化模块
 *
 * 核心改进:
 * 1. 意图识别后自动进行槽位填充
 * 2. 所有工具调用都通过沙箱执行
 * 3. 全流程性能监控和瓶颈分析
 */

const { logger } = require("../utils/logger.js");
const IntentClassifier = require("./intent-classifier");
const SlotFiller = require("./slot-filler");
const { TaskPlanner } = require("./task-planner");
const TaskPlannerEnhanced = require("./task-planner-enhanced");
const FunctionCaller = require("./function-caller");
const ToolSandbox = require("./tool-sandbox");
const PerformanceMonitor = require("../monitoring/performance-monitor");
const { getAIEngineConfig, mergeConfig } = require("./ai-engine-config");

class AIEngineManagerOptimized {
  constructor() {
    this.intentClassifier = new IntentClassifier();
    this.taskPlanner = new TaskPlanner();
    this.functionCaller = new FunctionCaller();

    // 新增优化模块（延迟初始化）
    this.slotFiller = null;
    this.toolSandbox = null;
    this.performanceMonitor = null;

    // 增强版任务规划器（需要初始化）
    this.taskPlannerEnhanced = null;

    // 依赖项（延迟注入）
    this.llmManager = null;
    this.database = null;
    this.projectConfig = null;

    // 执行历史（用于上下文理解）
    this.executionHistory = [];

    // 当前会话ID
    this.sessionId = null;

    // 用户ID（可配置）
    this.userId = "default_user";

    // 配置选项（从配置文件加载默认值）
    this.config = getAIEngineConfig();
  }

  /**
   * 初始化AI引擎管理器
   * 注入依赖项并初始化所有模块
   */
  async initialize(options = {}) {
    try {
      logger.info("[AIEngineManager-Optimized] 开始初始化...");

      // 合并用户配置
      this.config = mergeConfig(options);
      logger.info("[AIEngineManager-Optimized] 配置已加载:", {
        slotFilling: this.config.enableSlotFilling,
        toolSandbox: this.config.enableToolSandbox,
        performanceMonitor: this.config.enablePerformanceMonitor,
      });

      // 获取依赖项
      if (!this.llmManager) {
        const { getLLMManager } = require("../llm/llm-manager");
        const { getDatabase } = require("../database");
        const { getProjectConfigAsync } = require("../project/project-config");

        this.llmManager = getLLMManager();
        this.database = getDatabase();
        // M2: 异步加载，避免阻塞事件循环
        this.projectConfig = await getProjectConfigAsync();

        // 确保LLM管理器已初始化
        if (!this.llmManager.isInitialized) {
          await this.llmManager.initialize();
        }
      }

      // 初始化优化模块
      if (this.config.enableSlotFilling) {
        this.slotFiller = new SlotFiller(this.llmManager, this.database);
        logger.info("[AIEngineManager-Optimized] ✅ 槽位填充器已初始化");
      }

      if (this.config.enableToolSandbox) {
        this.toolSandbox = new ToolSandbox(this.functionCaller, this.database);
        logger.info("[AIEngineManager-Optimized] ✅ 工具沙箱已初始化");
      }

      if (this.config.enablePerformanceMonitor) {
        this.performanceMonitor = new PerformanceMonitor(this.database);
        logger.info("[AIEngineManager-Optimized] ✅ 性能监控已初始化");
      }

      // 初始化增强版任务规划器
      if (!this.taskPlannerEnhanced) {
        this.taskPlannerEnhanced = new TaskPlannerEnhanced({
          llmManager: this.llmManager,
          database: this.database,
          projectConfig: this.projectConfig,
        });

        logger.info("[AIEngineManager-Optimized] ✅ 增强版任务规划器已初始化");
      }

      // 生成会话ID
      this.sessionId = `session_${Date.now()}`;

      logger.info("[AIEngineManager-Optimized] ✅ 初始化完成");
      return true;
    } catch (error) {
      logger.error("[AIEngineManager-Optimized] ❌ 初始化失败:", error);
      throw error;
    }
  }

  /**
   * 处理用户输入的核心方法（优化版）
   * @param {string} userInput - 用户输入的文本
   * @param {Object} context - 上下文信息（当前项目、文件等）
   * @param {Function} onStepUpdate - 步骤更新回调函数
   * @param {Function} askUserCallback - 询问用户回调函数 (question, options) => Promise<answer>
   * @returns {Promise<Object>} 执行结果
   */
  async processUserInput(
    userInput,
    context = {},
    onStepUpdate = null,
    askUserCallback = null,
  ) {
    const pipelineStartTime = Date.now();
    const executionId = `exec_${Date.now()}`;

    try {
      logger.info(`\n${"=".repeat(60)}`);
      logger.info(`[AI Engine] 🚀 开始处理用户输入: "${userInput}"`);
      logger.info(`[AI Engine] 会话ID: ${this.sessionId}`);
      logger.info(`${"=".repeat(60)}\n`);

      // =====================================================
      // 步骤1: 意图识别 (Intent Recognition)
      // =====================================================
      logger.info("[步骤1] 意图识别...");
      const intentStartTime = Date.now();

      const intentStep = {
        id: `${executionId}_step_1`,
        name: "理解用户意图",
        status: "running",
        startTime: intentStartTime,
      };

      if (onStepUpdate) {
        onStepUpdate(intentStep);
      }

      const intent = await this.intentClassifier.classify(userInput, context);

      const intentDuration = Date.now() - intentStartTime;

      intentStep.status = "completed";
      intentStep.endTime = Date.now();
      intentStep.duration = intentDuration;
      intentStep.result = intent;

      if (onStepUpdate) {
        onStepUpdate(intentStep);
      }

      logger.info(
        `[步骤1] ✅ 识别完成: ${intent.intent}, 置信度: ${intent.confidence}`,
      );

      // 记录性能
      if (this.performanceMonitor) {
        await this.performanceMonitor.recordPhase(
          "intent_recognition",
          intentDuration,
          { intent: intent.intent, confidence: intent.confidence },
          this.userId,
          this.sessionId,
        );
      }

      // =====================================================
      // 步骤2: 槽位填充 (Slot Filling)
      // =====================================================
      let slotFillingResult = {
        entities: intent.entities,
        validation: { valid: true },
      };

      if (this.config.enableSlotFilling && this.slotFiller) {
        logger.info("[步骤2] 槽位填充...");
        const slotStartTime = Date.now();

        const slotStep = {
          id: `${executionId}_step_2`,
          name: "填充必需参数",
          status: "running",
          startTime: slotStartTime,
        };

        if (onStepUpdate) {
          onStepUpdate(slotStep);
        }

        slotFillingResult = await this.slotFiller.fillSlots(
          intent,
          context,
          askUserCallback,
        );

        const slotDuration = Date.now() - slotStartTime;

        slotStep.status = "completed";
        slotStep.endTime = Date.now();
        slotStep.duration = slotDuration;
        slotStep.result = this.slotFiller.getSummary(slotFillingResult);

        if (onStepUpdate) {
          onStepUpdate(slotStep);
        }

        logger.info(
          `[步骤2] ✅ 槽位填充完成: 完整度 ${slotFillingResult.validation.completeness}%`,
        );

        // 更新intent的entities
        intent.entities = slotFillingResult.entities;

        // 记录槽位填充历史
        if (this.database && this.slotFiller) {
          await this.slotFiller.recordFillingHistory(
            this.userId,
            intent.intent,
            slotFillingResult.entities,
          );
        }
      }

      // =====================================================
      // 步骤3: 任务规划 (Task Planning)
      // =====================================================
      logger.info("[步骤3] 任务规划...");
      const planStartTime = Date.now();

      const planStep = {
        id: `${executionId}_step_3`,
        name: "制定执行计划",
        status: "running",
        startTime: planStartTime,
      };

      if (onStepUpdate) {
        onStepUpdate(planStep);
      }

      const plan = await this.taskPlanner.plan(intent, context);

      const planDuration = Date.now() - planStartTime;

      planStep.status = "completed";
      planStep.endTime = Date.now();
      planStep.duration = planDuration;
      planStep.result = plan;

      if (onStepUpdate) {
        onStepUpdate(planStep);
      }

      logger.info(`[步骤3] ✅ 规划完成: ${plan.steps.length} 个步骤`);

      // 记录性能
      if (this.performanceMonitor) {
        await this.performanceMonitor.recordPhase(
          "task_planning",
          planDuration,
          { stepsCount: plan.steps.length },
          this.userId,
          this.sessionId,
        );
      }

      // =====================================================
      // 步骤4: 执行任务步骤 (Tool Execution)
      // =====================================================
      logger.info("[步骤4] 执行任务步骤...");
      const results = [];
      let failedStepIndex = null;

      for (let i = 0; i < plan.steps.length; i++) {
        const taskStep = plan.steps[i];

        logger.info(`  [${i + 1}/${plan.steps.length}] 执行: ${taskStep.tool}`);

        const execStep = {
          id: `${executionId}_step_${i + 4}`,
          name: taskStep.name || taskStep.description || `执行步骤 ${i + 1}`,
          status: "running",
          startTime: Date.now(),
          tool: taskStep.tool,
          params: taskStep.params,
        };

        if (onStepUpdate) {
          onStepUpdate(execStep);
        }

        try {
          let result;

          // 使用工具沙箱执行（如果启用）
          if (this.config.enableToolSandbox && this.toolSandbox) {
            result = await this.toolSandbox.executeSafely(
              taskStep.tool,
              taskStep.params,
              context,
              this.config.sandboxConfig,
            );
          } else {
            // 直接执行
            const toolStartTime = Date.now();
            const toolResult = await this.functionCaller.call(
              taskStep.tool,
              taskStep.params,
              context,
            );
            const toolDuration = Date.now() - toolStartTime;

            result = {
              success: true,
              result: toolResult,
              duration: toolDuration,
              toolName: taskStep.tool,
            };
          }

          execStep.status = "completed";
          execStep.endTime = Date.now();
          execStep.duration = execStep.endTime - execStep.startTime;
          execStep.result = result.result;

          if (onStepUpdate) {
            onStepUpdate(execStep);
          }

          results.push(result.result);

          logger.info(
            `  ✅ 完成: ${taskStep.tool}, 耗时: ${result.duration}ms`,
          );

          // 记录工具执行性能
          if (this.performanceMonitor) {
            await this.performanceMonitor.recordPhase(
              "tool_execution",
              result.duration,
              { toolName: taskStep.tool, stepIndex: i },
              this.userId,
              this.sessionId,
            );
          }
        } catch (error) {
          logger.error(`  ❌ 失败: ${taskStep.tool}`, error.message);

          execStep.status = "failed";
          execStep.endTime = Date.now();
          execStep.duration = execStep.endTime - execStep.startTime;
          execStep.error = error.message;

          if (onStepUpdate) {
            onStepUpdate(execStep);
          }

          failedStepIndex = i;

          // 询问用户是否继续
          if (askUserCallback) {
            const shouldContinue = await askUserCallback(
              `步骤 ${i + 1} 执行失败: ${error.message}\n是否继续执行剩余步骤？`,
              ["继续", "中止"],
            );

            if (shouldContinue !== "继续") {
              break;
            }
          } else {
            break; // 默认中止
          }
        }
      }

      // =====================================================
      // 完成统计
      // =====================================================
      const pipelineDuration = Date.now() - pipelineStartTime;
      const allSuccess = results.every((r) => r.success !== false);

      logger.info(`\n${"=".repeat(60)}`);
      logger.info(`[AI Engine] ${allSuccess ? "✅ 执行成功" : "⚠️ 部分失败"}`);
      logger.info(`[AI Engine] 总耗时: ${pipelineDuration}ms`);
      logger.info(
        `[AI Engine] 成功步骤: ${results.length}/${plan.steps.length}`,
      );
      logger.info(`${"=".repeat(60)}\n`);

      // 记录整体Pipeline性能
      if (this.performanceMonitor) {
        await this.performanceMonitor.recordPhase(
          "total_pipeline",
          pipelineDuration,
          {
            totalSteps: plan.steps.length,
            successSteps: results.length,
            allSuccess,
          },
          this.userId,
          this.sessionId,
        );
      }

      // 返回结果
      return {
        id: executionId,
        sessionId: this.sessionId,
        userInput,
        intent,
        slotFilling: slotFillingResult,
        plan,
        results,
        success: allSuccess,
        failedStepIndex,
        duration: pipelineDuration,
        performance: {
          intent_recognition: intentDuration,
          task_planning: planDuration,
          total: pipelineDuration,
        },
      };
    } catch (error) {
      const pipelineDuration = Date.now() - pipelineStartTime;

      logger.error(`\n[AI Engine] ❌ 处理失败:`, error);

      // 记录失败
      if (this.performanceMonitor) {
        await this.performanceMonitor.recordPhase(
          "total_pipeline",
          pipelineDuration,
          { error: error.message },
          this.userId,
          this.sessionId,
        );
      }

      throw error;
    }
  }

  /**
   * 获取性能报告
   * @param {number} timeRange - 时间范围（毫秒）
   * @returns {Promise<Object>} 性能报告
   */
  async getPerformanceReport(timeRange = 7 * 24 * 60 * 60 * 1000) {
    if (!this.performanceMonitor) {
      throw new Error("性能监控未启用");
    }

    const report = await this.performanceMonitor.generateReport(timeRange);
    const bottlenecks = await this.performanceMonitor.findBottlenecks(5000, 10);
    const suggestions =
      this.performanceMonitor.generateOptimizationSuggestions(report);

    return {
      ...report,
      bottlenecks,
      suggestions,
    };
  }

  /**
   * 获取会话性能详情
   * @param {string} sessionId - 会话ID（可选，默认当前会话）
   * @returns {Promise<Object>} 会话性能数据
   */
  async getSessionPerformance(sessionId = null) {
    if (!this.performanceMonitor) {
      throw new Error("性能监控未启用");
    }

    return await this.performanceMonitor.getSessionPerformance(
      sessionId || this.sessionId,
    );
  }

  /**
   * 设置用户ID
   * @param {string} userId - 用户ID
   */
  setUserId(userId) {
    this.userId = userId;
  }

  /**
   * 清理旧的性能数据
   * @param {number} keepDays - 保留天数
   */
  async cleanOldPerformanceData(keepDays = 30) {
    if (this.performanceMonitor) {
      await this.performanceMonitor.cleanOldData(keepDays);
    }
  }

  /**
   * 获取增强版任务规划器
   * @returns {TaskPlannerEnhanced}
   */
  getTaskPlanner() {
    if (!this.taskPlannerEnhanced) {
      throw new Error("增强版任务规划器未初始化，请先调用 initialize()");
    }
    return this.taskPlannerEnhanced;
  }

  /**
   * 注册自定义工具
   * @param {string} name - 工具名称
   * @param {Function} implementation - 工具实现函数
   * @param {Object} schema - 工具参数schema
   */
  registerTool(name, implementation, schema = {}) {
    this.functionCaller.registerTool(name, implementation, schema);
  }

  /**
   * 注销工具
   * @param {string} name - 工具名称
   */
  unregisterTool(name) {
    this.functionCaller.unregisterTool(name);
  }

  /**
   * 获取所有可用工具
   * @returns {Array} 工具列表
   */
  getAvailableTools() {
    return this.functionCaller.getAvailableTools();
  }
}

// 单例模式
let aiEngineManagerOptimizedInstance = null;

/**
 * 获取AI引擎管理器优化版单例
 * @returns {AIEngineManagerOptimized}
 */
function getAIEngineManagerOptimized() {
  if (!aiEngineManagerOptimizedInstance) {
    aiEngineManagerOptimizedInstance = new AIEngineManagerOptimized();
  }
  return aiEngineManagerOptimizedInstance;
}

module.exports = {
  AIEngineManagerOptimized,
  getAIEngineManagerOptimized,
};

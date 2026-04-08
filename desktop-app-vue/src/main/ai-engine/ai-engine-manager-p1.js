/**
 * AI引擎主管理器 (P1集成版)
 * 在P0优化的基础上集成P1五大优化模块
 *
 * P0优化（已有）:
 * 1. 槽位填充 - 自动补全缺失参数
 * 2. 工具沙箱 - 超时保护、自动重试、结果校验
 * 3. 性能监控 - P50/P90/P95统计、瓶颈识别
 *
 * P1优化（新增）:
 * 1. 多意图识别 - 自动拆分复合任务
 * 2. 动态Few-shot学习 - 个性化意图识别
 * 3. 分层任务规划 - 三层任务分解
 * 4. 检查点校验 - 中间结果验证
 * 5. 自我修正循环 - 自动错误恢复
 *
 * 版本: v0.17.0
 * 更新: 2026-01-01
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

// P1优化模块
const MultiIntentRecognizer = require("./multi-intent-recognizer");
const DynamicFewShotLearner = require("./dynamic-few-shot-learner");
const HierarchicalTaskPlanner = require("./hierarchical-task-planner");
const CheckpointValidator = require("./checkpoint-validator");
const SelfCorrectionLoop = require("./self-correction-loop");

class AIEngineManagerP1 {
  constructor() {
    // P0模块
    this.intentClassifier = new IntentClassifier();
    this.taskPlanner = new TaskPlanner();
    this.functionCaller = new FunctionCaller();

    // P0优化模块（延迟初始化）
    this.slotFiller = null;
    this.toolSandbox = null;
    this.performanceMonitor = null;
    this.taskPlannerEnhanced = null;

    // P1优化模块（延迟初始化）
    this.multiIntentRecognizer = null;
    this.fewShotLearner = null;
    this.hierarchicalPlanner = null;
    this.checkpointValidator = null;
    this.selfCorrectionLoop = null;

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
      logger.info("[AIEngineManager-P1] 开始初始化...");

      // 合并用户配置
      this.config = mergeConfig(options);
      logger.info("[AIEngineManager-P1] 配置已加载:", {
        // P0模块
        slotFilling: this.config.enableSlotFilling,
        toolSandbox: this.config.enableToolSandbox,
        performanceMonitor: this.config.enablePerformanceMonitor,
        // P1模块
        multiIntent: this.config.enableMultiIntent,
        fewShot: this.config.enableDynamicFewShot,
        hierarchicalPlanning: this.config.enableHierarchicalPlanning,
        checkpointValidation: this.config.enableCheckpointValidation,
        selfCorrection: this.config.enableSelfCorrection,
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

      // ============================================
      // 初始化P0优化模块
      // ============================================
      if (this.config.enableSlotFilling) {
        this.slotFiller = new SlotFiller(this.llmManager, this.database);
        logger.info("[AIEngineManager-P1] ✅ P0: 槽位填充器已初始化");
      }

      if (this.config.enableToolSandbox) {
        this.toolSandbox = new ToolSandbox(this.functionCaller, this.database);
        logger.info("[AIEngineManager-P1] ✅ P0: 工具沙箱已初始化");
      }

      if (this.config.enablePerformanceMonitor) {
        this.performanceMonitor = new PerformanceMonitor(this.database);
        logger.info("[AIEngineManager-P1] ✅ P0: 性能监控已初始化");
      }

      // 增强版任务规划器
      if (!this.taskPlannerEnhanced) {
        this.taskPlannerEnhanced = new TaskPlannerEnhanced({
          llmManager: this.llmManager,
          database: this.database,
          projectConfig: this.projectConfig,
        });
        logger.info("[AIEngineManager-P1] ✅ P0: 增强版任务规划器已初始化");
      }

      // ============================================
      // 初始化P1优化模块
      // ============================================

      // 1. 多意图识别器
      if (this.config.enableMultiIntent) {
        this.multiIntentRecognizer = new MultiIntentRecognizer(
          this.llmManager,
          this.intentClassifier,
        );
        logger.info("[AIEngineManager-P1] ✅ P1: 多意图识别器已初始化");
      }

      // 2. 动态Few-shot学习器
      if (this.config.enableDynamicFewShot) {
        this.fewShotLearner = new DynamicFewShotLearner(this.database);
        logger.info("[AIEngineManager-P1] ✅ P1: 动态Few-shot学习器已初始化");
      }

      // 3. 分层任务规划器
      if (this.config.enableHierarchicalPlanning) {
        this.hierarchicalPlanner = new HierarchicalTaskPlanner(
          this.llmManager,
          this.taskPlannerEnhanced,
        );
        logger.info("[AIEngineManager-P1] ✅ P1: 分层任务规划器已初始化");
      }

      // 4. 检查点校验器
      if (this.config.enableCheckpointValidation) {
        this.checkpointValidator = new CheckpointValidator(
          this.llmManager,
          this.config.checkpointValidationConfig,
        );
        logger.info("[AIEngineManager-P1] ✅ P1: 检查点校验器已初始化");
      }

      // 5. 自我修正循环
      if (this.config.enableSelfCorrection) {
        this.selfCorrectionLoop = new SelfCorrectionLoop(
          this.llmManager,
          this.database,
          this.config.selfCorrectionConfig,
        );
        logger.info("[AIEngineManager-P1] ✅ P1: 自我修正循环已初始化");
      }

      // 生成会话ID
      this.sessionId = `session_${Date.now()}`;

      logger.info("[AIEngineManager-P1] ✅ 初始化完成 (P0+P1全集成)");
      return true;
    } catch (error) {
      logger.error("[AIEngineManager-P1] ❌ 初始化失败:", error);
      throw error;
    }
  }

  /**
   * 处理用户输入的核心方法（P1集成版）
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
      logger.info(`\n${"=".repeat(70)}`);
      logger.info(`[AI Engine P1] 🚀 开始处理用户输入: "${userInput}"`);
      logger.info(`[AI Engine P1] 会话ID: ${this.sessionId}`);
      logger.info(`${"=".repeat(70)}\n`);

      // =====================================================
      // 步骤1: 多意图识别 (Multi-Intent Recognition)
      // =====================================================
      logger.info("[步骤1] 多意图识别...");
      const intentStartTime = Date.now();

      const intentStep = {
        id: `${executionId}_step_1`,
        name: "识别用户意图（支持多意图）",
        status: "running",
        startTime: intentStartTime,
      };

      if (onStepUpdate) {
        onStepUpdate(intentStep);
      }

      let intents = [];
      let isMultiIntent = false;

      if (this.config.enableMultiIntent && this.multiIntentRecognizer) {
        // 使用多意图识别器
        const multiIntentResult =
          await this.multiIntentRecognizer.classifyMultiple(userInput, context);

        intents = multiIntentResult.intents;
        isMultiIntent = multiIntentResult.isMultiIntent;

        // 记录到数据库
        if (this.database) {
          await this.database.run(
            `
            INSERT INTO multi_intent_history (
              user_id, user_input, is_multi_intent, intent_count, intents,
              recognition_duration, confidence, success, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
            [
              this.userId,
              userInput,
              isMultiIntent ? 1 : 0,
              intents.length,
              JSON.stringify(intents),
              Date.now() - intentStartTime,
              intents[0]?.confidence || 0,
              1,
              Date.now(),
            ],
          );
        }
      } else {
        // 降级：使用标准意图识别
        const singleIntent = await this.intentClassifier.classify(
          userInput,
          context,
        );
        intents = [{ ...singleIntent, priority: 1, dependencies: [] }];
        isMultiIntent = false;
      }

      const intentDuration = Date.now() - intentStartTime;

      intentStep.status = "completed";
      intentStep.endTime = Date.now();
      intentStep.duration = intentDuration;
      intentStep.result = { intents, isMultiIntent };

      if (onStepUpdate) {
        onStepUpdate(intentStep);
      }

      logger.info(
        `[步骤1] ✅ 识别完成: ${isMultiIntent ? "多意图" : "单意图"}, 数量: ${intents.length}`,
      );
      intents.forEach((intent, i) => {
        logger.info(
          `  [${i + 1}] ${intent.intent} (置信度: ${intent.confidence}, 优先级: ${intent.priority})`,
        );
      });

      // 记录性能
      if (this.performanceMonitor) {
        await this.performanceMonitor.recordPhase(
          "multi_intent_recognition",
          intentDuration,
          { intentCount: intents.length, isMultiIntent },
          this.userId,
          this.sessionId,
        );
      }

      // =====================================================
      // 步骤2: 动态Few-shot学习（可选增强）
      // =====================================================
      if (this.config.enableDynamicFewShot && this.fewShotLearner) {
        logger.info(
          "[步骤2] 动态Few-shot学习（为每个意图构建个性化上下文）...",
        );

        for (let i = 0; i < intents.length; i++) {
          const intent = intents[i];

          // 获取用户历史示例
          const userExamples = await this.fewShotLearner.getUserExamples(
            this.userId,
            intent.intent,
            this.config.fewShotConfig.defaultExampleCount,
          );

          // 增强意图上下文
          intent.fewShotExamples = userExamples;

          logger.info(
            `  [${i + 1}/${intents.length}] ${intent.intent}: 找到 ${userExamples.length} 个历史示例`,
          );
        }
      }

      // =====================================================
      // 处理每个意图（按优先级顺序）
      // =====================================================
      const allResults = [];

      for (let intentIndex = 0; intentIndex < intents.length; intentIndex++) {
        const currentIntent = intents[intentIndex];

        logger.info(`\n${"─".repeat(70)}`);
        logger.info(
          `处理意图 [${intentIndex + 1}/${intents.length}]: ${currentIntent.intent}`,
        );
        logger.info(`${"─".repeat(70)}\n`);

        // =====================================================
        // 步骤3: 槽位填充 (Slot Filling)
        // =====================================================
        let slotFillingResult = {
          entities: currentIntent.entities,
          validation: { valid: true },
        };

        if (this.config.enableSlotFilling && this.slotFiller) {
          logger.info(`[步骤3.${intentIndex + 1}] 槽位填充...`);
          const slotStartTime = Date.now();

          const slotStep = {
            id: `${executionId}_intent_${intentIndex}_slot`,
            name: `填充必需参数 (意图${intentIndex + 1})`,
            status: "running",
            startTime: slotStartTime,
          };

          if (onStepUpdate) {
            onStepUpdate(slotStep);
          }

          slotFillingResult = await this.slotFiller.fillSlots(
            currentIntent,
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
            `[步骤3.${intentIndex + 1}] ✅ 槽位填充完成: 完整度 ${slotFillingResult.validation.completeness}%`,
          );

          // 更新intent的entities
          currentIntent.entities = slotFillingResult.entities;

          // 记录槽位填充历史
          if (this.database && this.slotFiller) {
            await this.slotFiller.recordFillingHistory(
              this.userId,
              currentIntent.intent,
              slotFillingResult.entities,
            );
          }
        }

        // =====================================================
        // 步骤4: 分层任务规划 (Hierarchical Task Planning)
        // =====================================================
        logger.info(`[步骤4.${intentIndex + 1}] 分层任务规划...`);
        const planStartTime = Date.now();

        const planStep = {
          id: `${executionId}_intent_${intentIndex}_plan`,
          name: `制定执行计划 (意图${intentIndex + 1})`,
          status: "running",
          startTime: planStartTime,
        };

        if (onStepUpdate) {
          onStepUpdate(planStep);
        }

        let plan;

        if (
          this.config.enableHierarchicalPlanning &&
          this.hierarchicalPlanner
        ) {
          // 使用分层任务规划器
          plan = await this.hierarchicalPlanner.plan(currentIntent, context, {
            granularity:
              this.config.hierarchicalPlanningConfig.defaultGranularity,
          });

          logger.info(`[步骤4.${intentIndex + 1}] ✅ 分层规划完成:`);
          logger.info(`  粒度: ${plan.granularity}`);
          logger.info(`  业务层步骤: ${plan.layers?.business?.length || 0}`);
          logger.info(`  技术层步骤: ${plan.layers?.technical?.length || 0}`);
          logger.info(`  执行层步骤: ${plan.layers?.execution?.length || 0}`);

          // 记录到数据库
          if (this.database) {
            await this.database.run(
              `
              INSERT INTO hierarchical_planning_history (
                user_id, intent_type, intent_description, granularity,
                business_steps, technical_steps, execution_steps, total_steps,
                planning_duration, estimated_duration, plan_details, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
              [
                this.userId,
                currentIntent.intent,
                currentIntent.description || userInput,
                plan.granularity,
                plan.layers?.business?.length || 0,
                plan.layers?.technical?.length || 0,
                plan.layers?.execution?.length || 0,
                plan.summary?.totalSteps || 0,
                Date.now() - planStartTime,
                plan.summary?.estimatedDuration || 0,
                JSON.stringify(plan),
                Date.now(),
              ],
            );
          }
        } else {
          // 降级：使用标准任务规划器
          plan = await this.taskPlanner.plan(currentIntent, context);
        }

        const planDuration = Date.now() - planStartTime;

        planStep.status = "completed";
        planStep.endTime = Date.now();
        planStep.duration = planDuration;
        planStep.result = plan;

        if (onStepUpdate) {
          onStepUpdate(planStep);
        }

        // 记录性能
        if (this.performanceMonitor) {
          await this.performanceMonitor.recordPhase(
            "hierarchical_planning",
            planDuration,
            { totalSteps: plan.summary?.totalSteps || plan.steps?.length || 0 },
            this.userId,
            this.sessionId,
          );
        }

        // =====================================================
        // 步骤5: 执行任务（带自我修正循环和检查点校验）
        // =====================================================
        logger.info(
          `[步骤5.${intentIndex + 1}] 执行任务步骤（带检查点校验和自我修正）...`,
        );

        let executionResult;

        if (this.config.enableSelfCorrection && this.selfCorrectionLoop) {
          // 使用自我修正循环执行
          executionResult = await this.selfCorrectionLoop.executeWithCorrection(
            plan,
            async (currentPlan) => {
              return await this._executeTaskSteps(
                currentPlan,
                context,
                executionId,
                intentIndex,
                onStepUpdate,
              );
            },
            { maxRetries: this.config.selfCorrectionConfig.maxRetries },
          );

          logger.info(
            `[步骤5.${intentIndex + 1}] ${executionResult.success ? "✅ 执行成功" : "⚠️ 执行失败"}`,
          );
          logger.info(`  尝试次数: ${executionResult.attempts}`);
          logger.info(
            `  修正次数: ${executionResult.corrections?.length || 0}`,
          );

          // 记录自我修正历史
          if (this.database && !executionResult.success) {
            await this.database.run(
              `
              INSERT INTO self_correction_history (
                plan_description, total_steps, success_count, failed_count,
                attempts, corrections, final_success, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `,
              [
                plan.summary?.description || currentIntent.intent,
                executionResult.result?.totalSteps || 0,
                executionResult.result?.successSteps || 0,
                executionResult.result?.failedSteps || 0,
                executionResult.attempts,
                JSON.stringify(executionResult.corrections || []),
                executionResult.success ? 1 : 0,
                Date.now(),
              ],
            );
          }
        } else {
          // 直接执行（无自我修正）
          executionResult = {
            success: true,
            result: await this._executeTaskSteps(
              plan,
              context,
              executionId,
              intentIndex,
              onStepUpdate,
            ),
            attempts: 1,
            corrections: [],
          };
        }

        // 保存结果
        allResults.push({
          intent: currentIntent,
          plan,
          executionResult: executionResult.result,
          success: executionResult.success,
          attempts: executionResult.attempts,
          corrections: executionResult.corrections,
        });

        // 记录意图识别历史（用于Few-shot学习）
        if (this.fewShotLearner && this.database) {
          await this.fewShotLearner.recordRecognition(
            this.userId,
            userInput,
            currentIntent,
            executionResult.success,
          );
        }
      }

      // =====================================================
      // 完成统计
      // =====================================================
      const pipelineDuration = Date.now() - pipelineStartTime;
      const allSuccess = allResults.every((r) => r.success);

      logger.info(`\n${"=".repeat(70)}`);
      logger.info(
        `[AI Engine P1] ${allSuccess ? "✅ 全部执行成功" : "⚠️ 部分失败"}`,
      );
      logger.info(`[AI Engine P1] 总耗时: ${pipelineDuration}ms`);
      logger.info(`[AI Engine P1] 意图数量: ${intents.length}`);
      logger.info(
        `[AI Engine P1] 成功意图: ${allResults.filter((r) => r.success).length}/${intents.length}`,
      );
      logger.info(`${"=".repeat(70)}\n`);

      // 记录整体Pipeline性能
      if (this.performanceMonitor) {
        await this.performanceMonitor.recordPhase(
          "total_pipeline_p1",
          pipelineDuration,
          {
            totalIntents: intents.length,
            successIntents: allResults.filter((r) => r.success).length,
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
        isMultiIntent,
        intents,
        results: allResults,
        success: allSuccess,
        duration: pipelineDuration,
        performance: {
          intent_recognition: intentDuration,
          total: pipelineDuration,
        },
      };
    } catch (error) {
      const pipelineDuration = Date.now() - pipelineStartTime;

      logger.error(`\n[AI Engine P1] ❌ 处理失败:`, error);

      // 记录失败
      if (this.performanceMonitor) {
        await this.performanceMonitor.recordPhase(
          "total_pipeline_p1",
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
   * 执行任务步骤（内部方法，包含检查点校验）
   * @private
   */
  async _executeTaskSteps(
    plan,
    context,
    executionId,
    intentIndex,
    onStepUpdate,
  ) {
    const results = [];
    let failedStepIndex = null;

    // 确定步骤列表
    const steps = plan.layers?.execution || plan.steps || [];

    logger.info(`  开始执行 ${steps.length} 个步骤...`);

    for (let i = 0; i < steps.length; i++) {
      const taskStep = steps[i];

      logger.info(
        `  [${i + 1}/${steps.length}] 执行: ${taskStep.tool || taskStep.name}`,
      );

      const execStep = {
        id: `${executionId}_intent_${intentIndex}_step_${i}`,
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

        logger.info(`  ✅ 完成: ${taskStep.tool}, 耗时: ${result.duration}ms`);

        // =====================================================
        // 检查点校验（在关键步骤后执行）
        // =====================================================
        if (
          this.config.enableCheckpointValidation &&
          this.checkpointValidator
        ) {
          const validation = await this.checkpointValidator.validateCheckpoint(
            i,
            result.result,
            { subtasks: steps },
            {},
          );

          logger.info(
            `  🔍 检查点校验: ${validation.passed ? "✅ 通过" : "⚠️ 未通过"}`,
          );

          if (!validation.passed) {
            logger.info(
              `    失败项: ${validation.failedCount}, 推荐: ${validation.recommendation}`,
            );

            // 记录到数据库
            if (this.database) {
              await this.database.run(
                `
                INSERT INTO checkpoint_validations (
                  step_index, step_title, passed, failed_count, critical_failures,
                  validations, recommendation, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              `,
                [
                  i,
                  taskStep.name || taskStep.description || `步骤${i + 1}`,
                  validation.passed ? 1 : 0,
                  validation.failedCount,
                  validation.validations.filter(
                    (v) => !v.passed && v.severity === "critical",
                  ).length,
                  JSON.stringify(validation.validations),
                  validation.recommendation,
                  Date.now(),
                ],
              );
            }

            // 根据推荐采取行动
            if (
              validation.recommendation === "skip" &&
              validation.failedCount > 2
            ) {
              throw new Error(
                `检查点校验失败 (${validation.failedCount}项): 推荐跳过此步骤`,
              );
            }
          }
        }

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

        // 抛出错误让自我修正循环处理
        throw error;
      }
    }

    return {
      allSuccess: failedStepIndex === null,
      totalSteps: steps.length,
      successSteps: results.length,
      failedSteps: failedStepIndex !== null ? steps.length - results.length : 0,
      failedStepIndex,
      results,
    };
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
   * 获取P1优化效果统计
   * @returns {Promise<Object>} P1优化统计数据
   */
  async getP1OptimizationStats() {
    if (!this.database) {
      throw new Error("数据库未初始化");
    }

    const stats = {};

    // 多意图识别统计
    if (this.config.enableMultiIntent) {
      const multiIntentStats = await this.database.all(`
        SELECT * FROM v_multi_intent_stats
        ORDER BY date DESC LIMIT 7
      `);
      stats.multiIntent = multiIntentStats;
    }

    // 检查点校验统计
    if (this.config.enableCheckpointValidation) {
      const checkpointStats = await this.database.all(`
        SELECT * FROM v_checkpoint_stats
        ORDER BY date DESC LIMIT 7
      `);
      stats.checkpoint = checkpointStats;
    }

    // 自我修正效果统计
    if (this.config.enableSelfCorrection) {
      const correctionStats = await this.database.all(`
        SELECT * FROM v_correction_effectiveness
        ORDER BY date DESC LIMIT 7
      `);
      stats.correction = correctionStats;
    }

    // 分层规划统计
    if (this.config.enableHierarchicalPlanning) {
      const planningStats = await this.database.all(`
        SELECT * FROM v_hierarchical_planning_stats
      `);
      stats.hierarchicalPlanning = planningStats;
    }

    // P1综合统计（最近7天）
    const summary = await this.database.all(`
      SELECT * FROM v_p1_optimization_summary
    `);
    stats.summary = summary;

    return stats;
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
   * 获取分层任务规划器
   * @returns {HierarchicalTaskPlanner}
   */
  getHierarchicalPlanner() {
    if (!this.hierarchicalPlanner) {
      throw new Error("分层任务规划器未初始化，请先调用 initialize()");
    }
    return this.hierarchicalPlanner;
  }

  /**
   * 获取任务规划器（兼容旧API）
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
let aiEngineManagerP1Instance = null;

/**
 * 获取AI引擎管理器P1版单例
 * @returns {AIEngineManagerP1}
 */
function getAIEngineManagerP1() {
  if (!aiEngineManagerP1Instance) {
    aiEngineManagerP1Instance = new AIEngineManagerP1();
  }
  return aiEngineManagerP1Instance;
}

module.exports = {
  AIEngineManagerP1,
  getAIEngineManagerP1,
};

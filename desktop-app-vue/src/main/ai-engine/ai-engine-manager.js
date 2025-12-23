/**
 * AI引擎主管理器
 * 负责协调意图识别、任务规划和Function Calling
 */

const IntentClassifier = require('./intent-classifier');
const TaskPlanner = require('./task-planner');
const TaskPlannerEnhanced = require('./task-planner-enhanced');
const FunctionCaller = require('./function-caller');

class AIEngineManager {
  constructor() {
    this.intentClassifier = new IntentClassifier();
    this.taskPlanner = new TaskPlanner();
    this.functionCaller = new FunctionCaller();

    // 增强版任务规划器（需要初始化）
    this.taskPlannerEnhanced = null;

    // 依赖项（延迟注入）
    this.llmManager = null;
    this.database = null;
    this.projectConfig = null;

    // 执行历史（用于上下文理解）
    this.executionHistory = [];
  }

  /**
   * 初始化AI引擎管理器
   * 注入依赖项并初始化增强版任务规划器
   */
  async initialize() {
    try {
      // 获取LLM管理器
      if (!this.llmManager) {
        const { getLLMManager } = require('../llm/llm-manager');
        const { getDatabase } = require('../database');
        const { getProjectConfig } = require('../project/project-config');

        this.llmManager = getLLMManager();
        this.database = getDatabase();
        this.projectConfig = getProjectConfig();

        // 确保LLM管理器已初始化
        if (!this.llmManager.isInitialized) {
          await this.llmManager.initialize();
        }
      }

      // 初始化增强版任务规划器
      if (!this.taskPlannerEnhanced) {
        this.taskPlannerEnhanced = new TaskPlannerEnhanced({
          llmManager: this.llmManager,
          database: this.database,
          projectConfig: this.projectConfig
        });

        console.log('[AIEngineManager] 增强版任务规划器已初始化');
      }

      return true;
    } catch (error) {
      console.error('[AIEngineManager] 初始化失败:', error);
      throw error;
    }
  }

  /**
   * 获取增强版任务规划器
   * @returns {TaskPlannerEnhanced}
   */
  getTaskPlanner() {
    if (!this.taskPlannerEnhanced) {
      throw new Error('增强版任务规划器未初始化，请先调用 initialize()');
    }
    return this.taskPlannerEnhanced;
  }

  /**
   * 处理用户输入的核心方法
   * @param {string} userInput - 用户输入的文本
   * @param {Object} context - 上下文信息（当前项目、文件等）
   * @param {Function} onStepUpdate - 步骤更新回调函数
   * @returns {Promise<Object>} 执行结果
   */
  async processUserInput(userInput, context = {}, onStepUpdate = null) {
    const startTime = Date.now();
    const executionId = `exec_${Date.now()}`;

    try {
      console.log(`[AI Engine] 开始处理用户输入: "${userInput}"`);

      // 步骤1: 意图识别
      const intentStep = {
        id: `${executionId}_step_1`,
        name: '理解用户意图',
        status: 'running',
        startTime: Date.now(),
      };

      if (onStepUpdate) onStepUpdate(intentStep);

      const intent = await this.intentClassifier.classify(userInput, context);

      intentStep.status = 'completed';
      intentStep.endTime = Date.now();
      intentStep.duration = intentStep.endTime - intentStep.startTime;
      intentStep.result = intent;

      if (onStepUpdate) onStepUpdate(intentStep);

      console.log(`[AI Engine] 识别意图:`, intent);

      // 步骤2: 任务规划
      const planStep = {
        id: `${executionId}_step_2`,
        name: '制定执行计划',
        status: 'running',
        startTime: Date.now(),
      };

      if (onStepUpdate) onStepUpdate(planStep);

      const plan = await this.taskPlanner.plan(intent, context);

      planStep.status = 'completed';
      planStep.endTime = Date.now();
      planStep.duration = planStep.endTime - planStep.startTime;
      planStep.result = plan;

      if (onStepUpdate) onStepUpdate(planStep);

      console.log(`[AI Engine] 生成计划:`, plan);

      // 步骤3: 执行任务步骤
      const results = [];

      for (let i = 0; i < plan.steps.length; i++) {
        const taskStep = plan.steps[i];

        const execStep = {
          id: `${executionId}_step_${i + 3}`,
          name: taskStep.name || taskStep.description || `执行步骤 ${i + 1}`,
          status: 'running',
          startTime: Date.now(),
          tool: taskStep.tool,
          params: taskStep.params,
        };

        if (onStepUpdate) onStepUpdate(execStep);

        try {
          const result = await this.functionCaller.call(
            taskStep.tool,
            taskStep.params,
            context
          );

          execStep.status = 'completed';
          execStep.endTime = Date.now();
          execStep.duration = execStep.endTime - execStep.startTime;
          execStep.result = result;

          results.push(result);
        } catch (error) {
          console.error(`[AI Engine] 执行步骤失败:`, error);

          execStep.status = 'failed';
          execStep.endTime = Date.now();
          execStep.duration = execStep.endTime - execStep.startTime;
          execStep.error = error.message;

          results.push({
            success: false,
            error: error.message,
          });
        }

        if (onStepUpdate) onStepUpdate(execStep);
      }

      // 汇总执行结果
      const execution = {
        id: executionId,
        userInput,
        intent,
        plan,
        results,
        success: results.every(r => r.success !== false),
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };

      // 保存到执行历史
      this.executionHistory.push(execution);

      // 限制历史记录数量（最多保留100条）
      if (this.executionHistory.length > 100) {
        this.executionHistory = this.executionHistory.slice(-100);
      }

      console.log(`[AI Engine] 执行完成，耗时 ${execution.duration}ms`);

      return execution;
    } catch (error) {
      console.error(`[AI Engine] 处理失败:`, error);

      throw new Error(`AI引擎处理失败: ${error.message}`);
    }
  }

  /**
   * 获取执行历史
   * @param {number} limit - 返回的最大记录数
   * @returns {Array} 执行历史记录
   */
  getExecutionHistory(limit = 10) {
    return this.executionHistory.slice(-limit);
  }

  /**
   * 清除执行历史
   */
  clearHistory() {
    this.executionHistory = [];
  }

  /**
   * 注册自定义工具
   * @param {string} name - 工具名称
   * @param {Function} handler - 工具处理函数
   * @param {Object} schema - 工具参数schema
   */
  registerTool(name, handler, schema) {
    this.functionCaller.registerTool(name, handler, schema);
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
let aiEngineManagerInstance = null;

/**
 * 获取AI引擎管理器单例
 * @returns {AIEngineManager}
 */
function getAIEngineManager() {
  if (!aiEngineManagerInstance) {
    aiEngineManagerInstance = new AIEngineManager();
  }
  return aiEngineManagerInstance;
}

module.exports = {
  AIEngineManager,
  getAIEngineManager
};

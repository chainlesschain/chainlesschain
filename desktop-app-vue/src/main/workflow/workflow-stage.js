/**
 * 工作流阶段定义与执行
 *
 * 定义工作流的6个核心阶段:
 * 1. 需求分析 (Analysis)
 * 2. 方案设计 (Design)
 * 3. 内容生成 (Generation)
 * 4. 质量验证 (Validation)
 * 5. 集成优化 (Integration)
 * 6. 交付确认 (Delivery)
 *
 * v0.27.0: 新建文件
 */

const { EventEmitter } = require("events");
const { logger } = require("../utils/logger.js");

/**
 * 阶段状态枚举
 */
const StageStatus = {
  PENDING: "pending", // 等待执行
  RUNNING: "running", // 执行中
  COMPLETED: "completed", // 已完成
  FAILED: "failed", // 失败
  SKIPPED: "skipped", // 跳过
};

/**
 * 预定义阶段配置
 */
const DEFAULT_STAGES = [
  {
    id: "stage_1",
    name: "需求分析",
    icon: "1",
    description: "理解用户意图，收集上下文信息",
    steps: [
      {
        id: "intent_recognition",
        name: "意图识别",
        description: "分析用户请求，识别核心意图",
      },
      {
        id: "context_collection",
        name: "上下文收集",
        description: "收集项目相关上下文信息",
      },
      {
        id: "rag_retrieval",
        name: "RAG知识检索",
        description: "检索相关知识库内容",
      },
    ],
    qualityGateId: "gate_1_analysis",
    estimatedWeight: 10, // 权重用于计算整体进度
  },
  {
    id: "stage_2",
    name: "方案设计",
    icon: "2",
    description: "规划架构，分解任务，评估资源",
    steps: [
      {
        id: "architecture_planning",
        name: "架构规划",
        description: "设计整体实现架构",
      },
      {
        id: "task_decomposition",
        name: "任务分解",
        description: "将需求拆解为可执行任务",
      },
      {
        id: "resource_evaluation",
        name: "资源评估",
        description: "评估所需资源和依赖",
      },
    ],
    qualityGateId: "gate_2_design",
    estimatedWeight: 15,
  },
  {
    id: "stage_3",
    name: "内容生成",
    icon: "3",
    description: "AI生成内容，质量初检，迭代优化",
    steps: [
      {
        id: "ai_generation",
        name: "AI生成内容",
        description: "使用AI模型生成内容",
      },
      {
        id: "initial_quality_check",
        name: "质量初检",
        description: "初步检查生成内容质量",
      },
      {
        id: "iterative_optimization",
        name: "迭代优化",
        description: "根据检查结果优化内容",
      },
    ],
    qualityGateId: "gate_3_generation",
    estimatedWeight: 35,
  },
  {
    id: "stage_4",
    name: "质量验证",
    icon: "4",
    description: "完整性检查，一致性验证，LLM评估",
    steps: [
      {
        id: "completeness_check",
        name: "完整性检查",
        description: "验证内容完整性",
      },
      {
        id: "consistency_validation",
        name: "一致性验证",
        description: "检查内容一致性",
      },
      {
        id: "llm_evaluation",
        name: "LLM质量评估",
        description: "使用LLM进行质量评估",
      },
    ],
    qualityGateId: "gate_4_validation",
    estimatedWeight: 15,
  },
  {
    id: "stage_5",
    name: "集成优化",
    icon: "5",
    description: "格式转换，性能优化，资源打包",
    steps: [
      {
        id: "format_conversion",
        name: "格式转换",
        description: "转换为目标格式",
      },
      {
        id: "performance_optimization",
        name: "性能优化",
        description: "优化输出性能",
      },
      {
        id: "resource_packaging",
        name: "资源打包",
        description: "打包相关资源",
      },
    ],
    qualityGateId: "gate_5_integration",
    estimatedWeight: 15,
  },
  {
    id: "stage_6",
    name: "交付确认",
    icon: "6",
    description: "最终预览，用户确认，导出发布",
    steps: [
      {
        id: "final_preview",
        name: "最终预览",
        description: "生成预览供用户查看",
      },
      {
        id: "user_confirmation",
        name: "用户确认",
        description: "等待用户确认",
      },
      {
        id: "export_publish",
        name: "导出/发布",
        description: "导出或发布最终结果",
      },
    ],
    qualityGateId: "gate_6_delivery",
    estimatedWeight: 10,
  },
];

/**
 * 工作流阶段类
 */
class WorkflowStage extends EventEmitter {
  constructor(config) {
    super();
    this.id = config.id;
    this.name = config.name;
    this.icon = config.icon || "";
    this.description = config.description || "";
    this.steps = config.steps || [];
    this.qualityGateId = config.qualityGateId;
    this.estimatedWeight = config.estimatedWeight || 10;
    this.executor = config.executor; // 执行函数

    // 运行时状态
    this.status = StageStatus.PENDING;
    this.progress = 0;
    this.currentStepIndex = -1;
    this.stepStatuses = {};
    this.result = null;
    this.error = null;
    this.startTime = null;
    this.endTime = null;
    this.duration = 0;

    // 初始化步骤状态
    this.steps.forEach((step) => {
      this.stepStatuses[step.id] = {
        status: StageStatus.PENDING,
        progress: 0,
        message: "",
        startTime: null,
        endTime: null,
        duration: 0,
      };
    });
  }

  /**
   * 执行阶段
   * @param {Object} input - 输入数据
   * @param {Object} context - 上下文
   * @returns {Object} 执行结果
   */
  async execute(input, context = {}) {
    this.status = StageStatus.RUNNING;
    this.startTime = Date.now();
    this.progress = 0;

    this.emit("stage-start", this._getStageInfo());

    try {
      // 如果有自定义执行器，使用自定义执行器
      if (this.executor) {
        this.result = await this.executor(input, context, this);
      } else {
        // 默认执行：顺序执行所有步骤
        this.result = await this._executeDefaultSteps(input, context);
      }

      this.status = StageStatus.COMPLETED;
      this.progress = 100;
      this.endTime = Date.now();
      this.duration = this.endTime - this.startTime;

      this.emit("stage-complete", {
        ...this._getStageInfo(),
        result: this.result,
      });

      return this.result;
    } catch (error) {
      this.status = StageStatus.FAILED;
      this.error = error.message;
      this.endTime = Date.now();
      this.duration = this.endTime - this.startTime;

      this.emit("stage-error", {
        ...this._getStageInfo(),
        error: error.message,
      });

      throw error;
    }
  }

  /**
   * 默认步骤执行
   * @private
   */
  async _executeDefaultSteps(input, context) {
    const result = input;

    for (let i = 0; i < this.steps.length; i++) {
      const step = this.steps[i];
      this.currentStepIndex = i;

      await this._executeStep(step, result, context);

      // 更新总进度
      this.progress = Math.round(((i + 1) / this.steps.length) * 100);
      this.emit("stage-progress", this._getStageInfo());
    }

    return result;
  }

  /**
   * 执行单个步骤
   * @private
   */
  async _executeStep(step, input, context) {
    const stepStatus = this.stepStatuses[step.id];
    stepStatus.status = StageStatus.RUNNING;
    stepStatus.startTime = Date.now();

    this.emit("step-start", {
      stageId: this.id,
      stageName: this.name,
      step: { ...step },
      stepIndex: this.currentStepIndex,
    });

    try {
      // 默认步骤实现（子类可重写）
      // 模拟步骤执行
      await this._simulateStepExecution(step, input, context);

      stepStatus.status = StageStatus.COMPLETED;
      stepStatus.progress = 100;
      stepStatus.endTime = Date.now();
      stepStatus.duration = stepStatus.endTime - stepStatus.startTime;

      this.emit("step-complete", {
        stageId: this.id,
        stageName: this.name,
        step: { ...step },
        stepIndex: this.currentStepIndex,
        duration: stepStatus.duration,
      });
    } catch (error) {
      stepStatus.status = StageStatus.FAILED;
      stepStatus.message = error.message;
      stepStatus.endTime = Date.now();
      stepStatus.duration = stepStatus.endTime - stepStatus.startTime;

      this.emit("step-error", {
        stageId: this.id,
        stageName: this.name,
        step: { ...step },
        stepIndex: this.currentStepIndex,
        error: error.message,
      });

      throw error;
    }
  }

  /**
   * 模拟步骤执行（默认实现）
   * @private
   */
  async _simulateStepExecution(step, input, context) {
    // 子类应该重写这个方法
    // 默认实现仅用于演示
    const stepStatus = this.stepStatuses[step.id];

    // 模拟进度更新
    for (let progress = 0; progress <= 100; progress += 20) {
      stepStatus.progress = progress;
      stepStatus.message = `${step.name}: ${progress}%`;

      this.emit("step-progress", {
        stageId: this.id,
        stageName: this.name,
        stepId: step.id,
        stepName: step.name,
        progress,
        message: stepStatus.message,
      });

      // 模拟异步操作
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /**
   * 更新步骤进度
   * @param {string} stepId - 步骤ID
   * @param {number} progress - 进度 (0-100)
   * @param {string} message - 消息
   */
  updateStepProgress(stepId, progress, message = "") {
    const stepStatus = this.stepStatuses[stepId];
    if (!stepStatus) {
      return;
    }

    stepStatus.progress = progress;
    stepStatus.message = message;

    // 计算阶段总进度
    const totalProgress = Object.values(this.stepStatuses).reduce(
      (sum, s) => sum + s.progress,
      0,
    );
    this.progress = Math.round(totalProgress / this.steps.length);

    this.emit("step-progress", {
      stageId: this.id,
      stageName: this.name,
      stepId,
      progress,
      message,
      stageProgress: this.progress,
    });
  }

  /**
   * 标记步骤完成
   * @param {string} stepId - 步骤ID
   * @param {Object} result - 结果
   */
  completeStep(stepId, result = {}) {
    const stepStatus = this.stepStatuses[stepId];
    if (!stepStatus) {
      return;
    }

    stepStatus.status = StageStatus.COMPLETED;
    stepStatus.progress = 100;
    stepStatus.endTime = Date.now();
    stepStatus.duration =
      stepStatus.endTime - (stepStatus.startTime || Date.now());
    stepStatus.result = result;

    this.emit("step-complete", {
      stageId: this.id,
      stageName: this.name,
      stepId,
      result,
      duration: stepStatus.duration,
    });
  }

  /**
   * 标记步骤失败
   * @param {string} stepId - 步骤ID
   * @param {string} error - 错误信息
   */
  failStep(stepId, error) {
    const stepStatus = this.stepStatuses[stepId];
    if (!stepStatus) {
      return;
    }

    stepStatus.status = StageStatus.FAILED;
    stepStatus.message = error;
    stepStatus.endTime = Date.now();
    stepStatus.duration =
      stepStatus.endTime - (stepStatus.startTime || Date.now());

    this.emit("step-error", {
      stageId: this.id,
      stageName: this.name,
      stepId,
      error,
    });
  }

  /**
   * 获取阶段信息
   * @private
   */
  _getStageInfo() {
    return {
      id: this.id,
      name: this.name,
      icon: this.icon,
      description: this.description,
      status: this.status,
      progress: this.progress,
      currentStepIndex: this.currentStepIndex,
      totalSteps: this.steps.length,
      steps: this.steps.map((step) => ({
        ...step,
        ...this.stepStatuses[step.id],
      })),
      startTime: this.startTime,
      endTime: this.endTime,
      duration: this.duration,
      error: this.error,
    };
  }

  /**
   * 获取当前状态
   * @returns {Object} 阶段状态
   */
  getStatus() {
    return this._getStageInfo();
  }

  /**
   * 重置阶段
   */
  reset() {
    this.status = StageStatus.PENDING;
    this.progress = 0;
    this.currentStepIndex = -1;
    this.result = null;
    this.error = null;
    this.startTime = null;
    this.endTime = null;
    this.duration = 0;

    this.steps.forEach((step) => {
      this.stepStatuses[step.id] = {
        status: StageStatus.PENDING,
        progress: 0,
        message: "",
        startTime: null,
        endTime: null,
        duration: 0,
      };
    });
  }

  /**
   * 跳过阶段
   * @param {string} reason - 跳过原因
   */
  skip(reason = "") {
    this.status = StageStatus.SKIPPED;
    this.progress = 100;
    this.error = reason;

    this.emit("stage-skipped", {
      ...this._getStageInfo(),
      reason,
    });
  }
}

/**
 * 工作流阶段工厂
 */
class WorkflowStageFactory {
  /**
   * 创建默认阶段集合
   * @param {Object} executors - 阶段执行器映射
   * @returns {Array<WorkflowStage>} 阶段实例数组
   */
  static createDefaultStages(executors = {}) {
    return DEFAULT_STAGES.map((config) => {
      const executor = executors[config.id];
      return new WorkflowStage({
        ...config,
        executor,
      });
    });
  }

  /**
   * 创建单个阶段
   * @param {Object} config - 阶段配置
   * @returns {WorkflowStage} 阶段实例
   */
  static createStage(config) {
    return new WorkflowStage(config);
  }

  /**
   * 获取默认阶段配置
   * @returns {Array} 默认阶段配置
   */
  static getDefaultStageConfigs() {
    return [...DEFAULT_STAGES];
  }
}

module.exports = {
  WorkflowStage,
  WorkflowStageFactory,
  StageStatus,
  DEFAULT_STAGES,
};

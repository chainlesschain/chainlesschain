/**
 * WorkflowEngine - 工作流引擎
 *
 * 支持：
 * - 定义多步骤工作流
 * - 条件分支
 * - 循环执行
 * - 错误处理和重试
 * - 变量和上下文
 *
 * @module browser/actions/workflow-engine
 * @author ChainlessChain Team
 * @since v0.33.0
 */

const { EventEmitter } = require("events");
const fs = require("fs").promises;
const path = require("path");
const vm = require("vm");

/**
 * 工作流状态
 */
const WorkflowState = {
  IDLE: "idle",
  RUNNING: "running",
  PAUSED: "paused",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

/**
 * 步骤类型
 */
const StepType = {
  ACTION: "action", // 执行操作
  CONDITION: "condition", // 条件分支
  LOOP: "loop", // 循环
  WAIT: "wait", // 等待
  PARALLEL: "parallel", // 并行执行
  SUB_WORKFLOW: "subWorkflow", // 子工作流
  SCRIPT: "script", // 自定义脚本
};

class WorkflowEngine extends EventEmitter {
  constructor(browserEngine = null, config = {}) {
    super();

    this.browserEngine = browserEngine;
    this.config = {
      maxRetries: config.maxRetries || 3,
      retryDelay: config.retryDelay || 1000,
      defaultTimeout: config.defaultTimeout || 30000,
      workflowDir:
        config.workflowDir ||
        path.join(process.cwd(), ".chainlesschain", "workflows"),
      ...config,
    };

    // 当前执行状态
    this.state = WorkflowState.IDLE;
    this.currentWorkflow = null;
    this.currentStepIndex = 0;
    this.context = {};

    // 已保存的工作流
    this.workflows = new Map();

    // 操作执行器
    this.actionReplay = null;
  }

  /**
   * 设置浏览器引擎
   * @param {Object} browserEngine
   */
  setBrowserEngine(browserEngine) {
    this.browserEngine = browserEngine;
  }

  /**
   * 设置操作回放引擎
   * @param {Object} actionReplay
   */
  setActionReplay(actionReplay) {
    this.actionReplay = actionReplay;
  }

  /**
   * 创建工作流
   * @param {Object} definition - 工作流定义
   * @returns {Object}
   */
  createWorkflow(definition) {
    const workflow = {
      id:
        definition.id ||
        `wf_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: definition.name || "Unnamed Workflow",
      description: definition.description || "",
      version: definition.version || "1.0.0",
      variables: definition.variables || {},
      steps: definition.steps || [],
      triggers: definition.triggers || [],
      onError: definition.onError || "stop",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // 验证工作流
    this._validateWorkflow(workflow);

    this.workflows.set(workflow.id, workflow);

    this.emit("workflowCreated", { id: workflow.id, name: workflow.name });

    return {
      success: true,
      workflow,
    };
  }

  /**
   * 验证工作流
   * @private
   */
  _validateWorkflow(workflow) {
    if (!workflow.steps || workflow.steps.length === 0) {
      throw new Error("Workflow must have at least one step");
    }

    for (let i = 0; i < workflow.steps.length; i++) {
      const step = workflow.steps[i];
      if (!step.type) {
        throw new Error(`Step ${i} must have a type`);
      }
      if (!Object.values(StepType).includes(step.type)) {
        throw new Error(`Invalid step type: ${step.type}`);
      }
    }
  }

  /**
   * 执行工作流
   * @param {string} workflowId - 工作流 ID
   * @param {Object} options - 执行选项
   * @returns {Promise<Object>}
   */
  async execute(workflowId, options = {}) {
    const workflow = this.workflows.get(workflowId);

    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    if (this.state === WorkflowState.RUNNING) {
      throw new Error("Another workflow is running");
    }

    // 初始化执行上下文
    this.currentWorkflow = {
      ...workflow,
      execution: {
        id: `exec_${Date.now()}`,
        startTime: new Date().toISOString(),
        endTime: null,
        targetId: options.targetId,
        results: [],
        errors: [],
      },
    };

    this.context = {
      ...workflow.variables,
      ...options.variables,
      _targetId: options.targetId,
      _workflowId: workflowId,
      _executionId: this.currentWorkflow.execution.id,
    };

    this.currentStepIndex = 0;
    this.state = WorkflowState.RUNNING;

    this.emit("started", {
      workflowId,
      executionId: this.currentWorkflow.execution.id,
    });

    try {
      await this._executeSteps(workflow.steps);

      this.currentWorkflow.execution.endTime = new Date().toISOString();
      this.state = WorkflowState.COMPLETED;

      const result = {
        success: true,
        workflowId,
        executionId: this.currentWorkflow.execution.id,
        duration:
          new Date(this.currentWorkflow.execution.endTime) -
          new Date(this.currentWorkflow.execution.startTime),
        results: this.currentWorkflow.execution.results,
        context: this.context,
      };

      this.emit("completed", result);

      return result;
    } catch (error) {
      this.currentWorkflow.execution.endTime = new Date().toISOString();
      this.currentWorkflow.execution.errors.push({
        step: this.currentStepIndex,
        error: error.message,
        timestamp: new Date().toISOString(),
      });

      this.state = WorkflowState.FAILED;

      this.emit("failed", {
        workflowId,
        executionId: this.currentWorkflow.execution.id,
        error: error.message,
        step: this.currentStepIndex,
      });

      throw error;
    }
  }

  /**
   * 执行步骤列表
   * @private
   */
  async _executeSteps(steps) {
    for (let i = 0; i < steps.length; i++) {
      if (this.state === WorkflowState.PAUSED) {
        await this._waitForResume();
      }

      if (this.state === WorkflowState.CANCELLED) {
        throw new Error("Workflow cancelled");
      }

      this.currentStepIndex = i;
      const step = steps[i];

      this.emit("stepStarted", {
        index: i,
        step: step.name || step.type,
        type: step.type,
      });

      try {
        const result = await this._executeStep(step);

        this.currentWorkflow.execution.results.push({
          index: i,
          step: step.name || step.type,
          success: true,
          result,
        });

        this.emit("stepCompleted", {
          index: i,
          step: step.name || step.type,
          result,
        });

        // 存储结果到上下文
        if (step.outputVariable) {
          this.context[step.outputVariable] = result;
        }
      } catch (error) {
        this.emit("stepFailed", {
          index: i,
          step: step.name || step.type,
          error: error.message,
        });

        // 重试逻辑
        if (step.retry && step.retry.enabled) {
          const retried = await this._retryStep(step, error);
          if (!retried) {
            throw error;
          }
        } else if (this.currentWorkflow.onError === "stop") {
          throw error;
        }
        // onError === 'continue' 时继续执行
      }
    }
  }

  /**
   * 执行单个步骤
   * @private
   */
  async _executeStep(step) {
    switch (step.type) {
      case StepType.ACTION:
        return this._executeAction(step);

      case StepType.CONDITION:
        return this._executeCondition(step);

      case StepType.LOOP:
        return this._executeLoop(step);

      case StepType.WAIT:
        return this._executeWait(step);

      case StepType.PARALLEL:
        return this._executeParallel(step);

      case StepType.SUB_WORKFLOW:
        return this._executeSubWorkflow(step);

      case StepType.SCRIPT:
        return this._executeScript(step);

      default:
        throw new Error(`Unknown step type: ${step.type}`);
    }
  }

  /**
   * 执行操作
   * @private
   */
  async _executeAction(step) {
    const action = this._resolveVariables(step.action);

    // 使用 ActionReplay 执行
    if (this.actionReplay) {
      this.actionReplay.load([action], { targetId: this.context._targetId });
      const result = await this.actionReplay.step();
      return result;
    }

    // 直接执行（需要浏览器引擎）
    if (!this.browserEngine) {
      throw new Error("No browser engine or action replay available");
    }

    // 根据操作类型调用相应模块
    const { CoordinateAction } = require("./coordinate-action");
    const { KeyboardAction } = require("./keyboard-action");

    switch (action.type) {
      case "click": {
        const coord = new CoordinateAction(this.browserEngine);
        return coord.clickAt(this.context._targetId, action.x, action.y);
      }

      case "type": {
        const keyboard = new KeyboardAction(this.browserEngine);
        return keyboard.execute(this.context._targetId, {
          action: "type",
          text: action.text,
        });
      }

      case "navigate":
        return this.browserEngine.navigate(this.context._targetId, action.url);

      case "screenshot": {
        const buffer = await this.browserEngine.screenshot(
          this.context._targetId,
        );
        return { screenshot: buffer.toString("base64") };
      }

      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }
  }

  /**
   * 执行条件分支
   * @private
   */
  async _executeCondition(step) {
    const condition = this._evaluateCondition(step.condition);

    if (condition) {
      if (step.then && step.then.length > 0) {
        await this._executeSteps(step.then);
      }
      return { branch: "then", conditionMet: true };
    } else {
      if (step.else && step.else.length > 0) {
        await this._executeSteps(step.else);
      }
      return { branch: "else", conditionMet: false };
    }
  }

  /**
   * 评估条件
   * @private
   */
  _evaluateCondition(condition) {
    if (typeof condition === "boolean") {
      return condition;
    }

    if (typeof condition === "string") {
      // 简单变量检查
      const value = this._resolveVariable(condition);
      return !!value;
    }

    if (typeof condition === "object") {
      const { left, operator, right } = condition;
      const leftVal = this._resolveVariable(left);
      const rightVal = this._resolveVariable(right);

      switch (operator) {
        case "==":
          return leftVal == rightVal;
        case "===":
          return leftVal === rightVal;

        case "!=":
          return leftVal != rightVal;
        case "!==":
          return leftVal !== rightVal;
        case ">":
          return leftVal > rightVal;
        case ">=":
          return leftVal >= rightVal;
        case "<":
          return leftVal < rightVal;
        case "<=":
          return leftVal <= rightVal;
        case "contains":
          return String(leftVal).includes(String(rightVal));
        case "matches":
          return new RegExp(rightVal).test(String(leftVal));
        default:
          throw new Error(`Unknown operator: ${operator}`);
      }
    }

    return false;
  }

  /**
   * 执行循环
   * @private
   */
  async _executeLoop(step) {
    const results = [];
    let iteration = 0;
    const maxIterations = step.maxIterations || 100;

    if (step.loopType === "forEach" && step.items) {
      const items = this._resolveVariable(step.items);

      for (const item of items) {
        if (iteration >= maxIterations) {
          break;
        }

        this.context[step.itemVariable || "item"] = item;
        this.context._loopIndex = iteration;

        await this._executeSteps(step.steps);

        results.push({ iteration, item });
        iteration++;
      }
    } else if (step.loopType === "while") {
      while (
        this._evaluateCondition(step.condition) &&
        iteration < maxIterations
      ) {
        this.context._loopIndex = iteration;

        await this._executeSteps(step.steps);

        results.push({ iteration });
        iteration++;
      }
    } else if (step.loopType === "times") {
      const times = this._resolveVariable(step.times) || 1;

      for (let i = 0; i < Math.min(times, maxIterations); i++) {
        this.context._loopIndex = i;

        await this._executeSteps(step.steps);

        results.push({ iteration: i });
        iteration++;
      }
    }

    return { iterations: iteration, results };
  }

  /**
   * 执行等待
   * @private
   */
  async _executeWait(step) {
    const duration = this._resolveVariable(step.duration) || 1000;
    await new Promise((resolve) => setTimeout(resolve, duration));
    return { waited: duration };
  }

  /**
   * 并行执行
   * @private
   */
  async _executeParallel(step) {
    const promises = step.branches.map(async (branch, index) => {
      try {
        // 创建分支上下文
        const branchContext = { ...this.context, _branchIndex: index };
        const originalContext = this.context;
        this.context = branchContext;

        await this._executeSteps(branch.steps);

        this.context = originalContext;
        return { branch: index, success: true };
      } catch (error) {
        return { branch: index, success: false, error: error.message };
      }
    });

    const results = await Promise.all(promises);
    return { branches: results };
  }

  /**
   * 执行子工作流
   * @private
   */
  async _executeSubWorkflow(step) {
    const subWorkflowId = this._resolveVariable(step.workflowId);
    const subWorkflow = this.workflows.get(subWorkflowId);

    if (!subWorkflow) {
      throw new Error(`Sub-workflow not found: ${subWorkflowId}`);
    }

    // 保存当前状态
    const parentContext = this.context;
    const parentWorkflow = this.currentWorkflow;
    const parentIndex = this.currentStepIndex;

    // 执行子工作流
    const result = await this.execute(subWorkflowId, {
      targetId: this.context._targetId,
      variables: step.variables,
    });

    // 恢复父工作流状态
    this.context = { ...parentContext, _subWorkflowResult: result };
    this.currentWorkflow = parentWorkflow;
    this.currentStepIndex = parentIndex;
    this.state = WorkflowState.RUNNING;

    return result;
  }

  /**
   * 执行脚本
   * @private
   */
  async _executeScript(step) {
    // 创建安全的执行环境
    const sandbox = {
      context: this.context,
      console: {
        log: (...args) => this.emit("scriptLog", { level: "log", args }),
        warn: (...args) => this.emit("scriptLog", { level: "warn", args }),
        error: (...args) => this.emit("scriptLog", { level: "error", args }),
      },
      setTimeout,
      Promise,
      __resolve: null,
      __reject: null,
    };

    // 创建一个 Promise 来等待异步脚本完成
    const resultPromise = new Promise((resolve, reject) => {
      sandbox.__resolve = resolve;
      sandbox.__reject = reject;
    });

    // 使用 vm 模块执行脚本（Node.js 推荐方式）
    const vmContext = vm.createContext(sandbox);
    const wrappedScript = `
      (async () => {
        ${step.script}
      })().then(__resolve).catch(__reject);
    `;

    const script = new vm.Script(wrappedScript);
    script.runInContext(vmContext);

    // 等待异步脚本完成
    const result = await resultPromise;

    // 更新上下文
    Object.assign(this.context, sandbox.context);

    return result;
  }

  /**
   * 重试步骤
   * @private
   */
  async _retryStep(step, _lastError) {
    const maxRetries = step.retry.maxRetries || this.config.maxRetries;
    const delay = step.retry.delay || this.config.retryDelay;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      this.emit("retrying", {
        step: step.name || step.type,
        attempt,
        maxRetries,
      });

      await new Promise((resolve) => setTimeout(resolve, delay));

      try {
        await this._executeStep(step);
        return true;
      } catch (_err) {
        if (attempt === maxRetries) {
          return false;
        }
      }
    }

    return false;
  }

  /**
   * 解析变量
   * @private
   */
  _resolveVariable(value) {
    if (typeof value !== "string") {
      return value;
    }

    // 检查是否是变量引用 ${varName}
    const match = value.match(/^\$\{(.+)\}$/);
    if (match) {
      return this.context[match[1]];
    }

    // 替换字符串中的变量
    return value.replace(/\$\{(.+?)\}/g, (_, varName) => {
      return this.context[varName] !== undefined ? this.context[varName] : "";
    });
  }

  /**
   * 解析对象中的变量
   * @private
   */
  _resolveVariables(obj) {
    if (typeof obj !== "object" || obj === null) {
      return this._resolveVariable(obj);
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this._resolveVariables(item));
    }

    const resolved = {};
    for (const [key, value] of Object.entries(obj)) {
      resolved[key] = this._resolveVariables(value);
    }
    return resolved;
  }

  /**
   * 等待恢复
   * @private
   */
  async _waitForResume() {
    return new Promise((resolve) => {
      const handler = () => {
        if (this.state !== WorkflowState.PAUSED) {
          this.removeListener("resumed", handler);
          resolve();
        }
      };
      this.on("resumed", handler);
    });
  }

  /**
   * 暂停工作流
   */
  pause() {
    if (this.state !== WorkflowState.RUNNING) {
      throw new Error("Workflow is not running");
    }

    this.state = WorkflowState.PAUSED;
    this.emit("paused", { step: this.currentStepIndex });

    return { success: true, pausedAt: this.currentStepIndex };
  }

  /**
   * 恢复工作流
   */
  resume() {
    if (this.state !== WorkflowState.PAUSED) {
      throw new Error("Workflow is not paused");
    }

    this.state = WorkflowState.RUNNING;
    this.emit("resumed", { step: this.currentStepIndex });

    return { success: true, resumedAt: this.currentStepIndex };
  }

  /**
   * 取消工作流
   */
  cancel() {
    if (
      this.state !== WorkflowState.RUNNING &&
      this.state !== WorkflowState.PAUSED
    ) {
      return { success: true, reason: "Not running" };
    }

    this.state = WorkflowState.CANCELLED;
    this.emit("cancelled", { step: this.currentStepIndex });

    return { success: true, cancelledAt: this.currentStepIndex };
  }

  /**
   * 获取状态
   */
  getStatus() {
    return {
      state: this.state,
      workflowId: this.currentWorkflow?.id,
      executionId: this.currentWorkflow?.execution?.id,
      currentStep: this.currentStepIndex,
      totalSteps: this.currentWorkflow?.steps?.length || 0,
      context: this.context,
    };
  }

  /**
   * 保存工作流到文件
   */
  async saveWorkflow(workflowId) {
    const workflow = this.workflows.get(workflowId);

    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    await fs.mkdir(this.config.workflowDir, { recursive: true });

    const filePath = path.join(this.config.workflowDir, `${workflowId}.json`);
    await fs.writeFile(filePath, JSON.stringify(workflow, null, 2));

    return { success: true, path: filePath };
  }

  /**
   * 从文件加载工作流
   */
  async loadWorkflow(workflowId) {
    const filePath = path.join(this.config.workflowDir, `${workflowId}.json`);

    try {
      const content = await fs.readFile(filePath, "utf-8");
      const workflow = JSON.parse(content);

      this.workflows.set(workflow.id, workflow);

      return { success: true, workflow };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 列出所有工作流
   */
  listWorkflows() {
    return Array.from(this.workflows.values()).map((w) => ({
      id: w.id,
      name: w.name,
      description: w.description,
      version: w.version,
      stepCount: w.steps.length,
      createdAt: w.createdAt,
    }));
  }

  /**
   * 获取工作流详情
   */
  getWorkflow(workflowId) {
    return this.workflows.get(workflowId);
  }

  /**
   * 删除工作流
   */
  deleteWorkflow(workflowId) {
    const deleted = this.workflows.delete(workflowId);
    return { success: deleted };
  }
}

// 单例
let workflowEngineInstance = null;

function getWorkflowEngine(browserEngine, config) {
  if (!workflowEngineInstance) {
    workflowEngineInstance = new WorkflowEngine(browserEngine, config);
  } else if (browserEngine) {
    workflowEngineInstance.setBrowserEngine(browserEngine);
  }
  return workflowEngineInstance;
}

module.exports = {
  WorkflowEngine,
  WorkflowState,
  StepType,
  getWorkflowEngine,
};

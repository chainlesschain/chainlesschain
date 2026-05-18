/**
 * 工作流执行引擎
 *
 * 提供类似 OpenClaw 的任务自动化能力：
 * - 工作流定义解析（JSON/YAML格式）
 * - 步骤顺序执行
 * - 条件判断（if/else）
 * - 循环执行（forEach/while）
 * - 变量和上下文管理
 * - 错误处理和回滚
 * - 执行状态跟踪
 *
 * @module remote/workflow/workflow-engine
 */

const { logger } = require("../../utils/logger");
const { EventEmitter } = require("events");
const crypto = require("crypto");

/**
 * 工作流状态
 */
const WORKFLOW_STATUS = {
  PENDING: "pending",
  RUNNING: "running",
  PAUSED: "paused",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

/**
 * 步骤状态
 */
const STEP_STATUS = {
  PENDING: "pending",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  SKIPPED: "skipped",
};

/**
 * 内置动作类型
 */
const ACTION_TYPES = {
  // 系统操作
  "system.delay": async (params, context) => {
    const { ms = 1000 } = params;
    await new Promise((resolve) => setTimeout(resolve, ms));
    return { delayed: ms };
  },

  "system.log": async (params, context) => {
    const { message, level = "info" } = params;
    const resolvedMessage = context.resolveVariables(message);
    logger[level](`[Workflow] ${resolvedMessage}`);
    return { logged: resolvedMessage };
  },

  "system.setVariable": async (params, context) => {
    const { name, value } = params;
    const resolvedValue = context.resolveVariables(value);
    context.setVariable(name, resolvedValue);
    return { [name]: resolvedValue };
  },

  // 条件操作
  "control.if": async (params, context, engine) => {
    const { condition, then: thenSteps, else: elseSteps } = params;
    const conditionResult = context.evaluateCondition(condition);

    if (conditionResult) {
      if (thenSteps && thenSteps.length > 0) {
        return await engine.executeSteps(thenSteps, context);
      }
    } else {
      if (elseSteps && elseSteps.length > 0) {
        return await engine.executeSteps(elseSteps, context);
      }
    }
    return { conditionResult, branch: conditionResult ? "then" : "else" };
  },

  "control.forEach": async (params, context, engine) => {
    const { items, itemVar = "item", indexVar = "index", steps } = params;
    const resolvedItems = context.resolveVariables(items);
    const results = [];

    if (Array.isArray(resolvedItems)) {
      for (let i = 0; i < resolvedItems.length; i++) {
        context.setVariable(itemVar, resolvedItems[i]);
        context.setVariable(indexVar, i);

        const stepResults = await engine.executeSteps(steps, context);
        results.push(stepResults);

        // 检查是否需要中断
        if (context.shouldBreak) {
          context.shouldBreak = false;
          break;
        }
      }
    }

    return { iterations: results.length, results };
  },

  "control.while": async (params, context, engine) => {
    const { condition, steps, maxIterations = 1000 } = params;
    const results = [];
    let iterations = 0;

    while (context.evaluateCondition(condition) && iterations < maxIterations) {
      const stepResults = await engine.executeSteps(steps, context);
      results.push(stepResults);
      iterations++;

      if (context.shouldBreak) {
        context.shouldBreak = false;
        break;
      }
    }

    return { iterations, results };
  },

  "control.break": async (params, context) => {
    context.shouldBreak = true;
    return { break: true };
  },

  "control.return": async (params, context) => {
    const { value } = params;
    context.returnValue = context.resolveVariables(value);
    context.shouldReturn = true;
    return { return: context.returnValue };
  },
};

/**
 * 执行上下文
 */
class ExecutionContext {
  constructor(initialVariables = {}) {
    this.variables = { ...initialVariables };
    this.results = {};
    this.shouldBreak = false;
    this.shouldReturn = false;
    this.returnValue = null;
    this.error = null;
  }

  /**
   * 设置变量
   */
  setVariable(name, value) {
    this.variables[name] = value;
  }

  /**
   * 获取变量
   */
  getVariable(name) {
    return this.variables[name];
  }

  /**
   * 解析变量引用（支持 ${variable} 和 ${variable.path} 语法）
   */
  resolveVariables(value) {
    if (typeof value !== "string") {
      return value;
    }

    return value.replace(/\$\{([^}]+)\}/g, (match, path) => {
      const parts = path.split(".");
      let current = this.variables;

      for (const part of parts) {
        if (current === undefined || current === null) {
          return match; // 保留原始引用
        }
        current = current[part];
      }

      return current !== undefined ? String(current) : match;
    });
  }

  /**
   * 评估条件表达式
   */
  evaluateCondition(condition) {
    if (typeof condition === "boolean") {
      return condition;
    }

    if (typeof condition === "string") {
      // 简单条件：变量名
      if (!condition.includes(" ")) {
        return Boolean(this.getVariable(condition));
      }

      // 复杂条件：表达式
      const resolved = this.resolveVariables(condition);

      // 安全评估简单表达式
      try {
        // 支持的操作符
        const operators = [
          "===",
          "!==",
          "==",
          "!=",
          ">=",
          "<=",
          ">",
          "<",
          "&&",
          "||",
        ];

        for (const op of operators) {
          if (resolved.includes(op)) {
            const [left, right] = resolved.split(op).map((s) => s.trim());
            const leftVal = this.parseValue(left);
            const rightVal = this.parseValue(right);

            switch (op) {
              case "===":
                return leftVal === rightVal;
              case "!==":
                return leftVal !== rightVal;
              case "==":
                return leftVal == rightVal;
              case "!=":
                return leftVal != rightVal;
              case ">=":
                return leftVal >= rightVal;
              case "<=":
                return leftVal <= rightVal;
              case ">":
                return leftVal > rightVal;
              case "<":
                return leftVal < rightVal;
              case "&&":
                return Boolean(leftVal) && Boolean(rightVal);
              case "||":
                return Boolean(leftVal) || Boolean(rightVal);
            }
          }
        }

        return Boolean(resolved);
      } catch (e) {
        logger.warn(`[ExecutionContext] 条件评估失败: ${condition}`, e);
        return false;
      }
    }

    if (typeof condition === "object") {
      // 对象条件：{ variable: 'x', operator: '==', value: 10 }
      const { variable, operator, value } = condition;
      const varValue = this.getVariable(variable);

      switch (operator) {
        case "==":
        case "eq":
          return varValue == value;
        case "===":
        case "seq":
          return varValue === value;
        case "!=":
        case "ne":
          return varValue != value;
        case ">":
        case "gt":
          return varValue > value;
        case ">=":
        case "gte":
          return varValue >= value;
        case "<":
        case "lt":
          return varValue < value;
        case "<=":
        case "lte":
          return varValue <= value;
        case "contains":
          return String(varValue).includes(value);
        case "startsWith":
          return String(varValue).startsWith(value);
        case "endsWith":
          return String(varValue).endsWith(value);
        case "matches":
          return new RegExp(value).test(String(varValue));
        default:
          return Boolean(varValue);
      }
    }

    return Boolean(condition);
  }

  /**
   * 解析值
   */
  parseValue(str) {
    str = str.trim();

    // 数字
    if (/^-?\d+(\.\d+)?$/.test(str)) {
      return parseFloat(str);
    }

    // 布尔值
    if (str === "true") {
      return true;
    }
    if (str === "false") {
      return false;
    }
    if (str === "null") {
      return null;
    }

    // 字符串（带引号）
    if (
      (str.startsWith('"') && str.endsWith('"')) ||
      (str.startsWith("'") && str.endsWith("'"))
    ) {
      return str.slice(1, -1);
    }

    // 变量引用
    if (str.startsWith("${") && str.endsWith("}")) {
      return this.resolveVariables(str);
    }

    // 直接变量名
    const varValue = this.getVariable(str);
    return varValue !== undefined ? varValue : str;
  }

  /**
   * 保存步骤结果
   */
  saveStepResult(stepId, result) {
    this.results[stepId] = result;
    this.setVariable(`steps.${stepId}`, result);
  }

  /**
   * 创建子上下文
   */
  createChildContext() {
    const child = new ExecutionContext({ ...this.variables });
    child.results = { ...this.results };
    return child;
  }
}

/**
 * 工作流引擎类
 */
class WorkflowEngine extends EventEmitter {
  constructor(commandExecutor, options = {}) {
    super();

    this.commandExecutor = commandExecutor; // 执行远程命令的函数
    this.options = {
      maxSteps: options.maxSteps || 1000,
      stepTimeout: options.stepTimeout || 60000,
      enableRollback: options.enableRollback !== false,
      ...options,
    };

    // 注册的动作
    this.actions = { ...ACTION_TYPES };

    // 运行中的工作流
    this.runningWorkflows = new Map();

    logger.info("[WorkflowEngine] 工作流引擎已初始化");
  }

  /**
   * 注册自定义动作
   */
  registerAction(type, handler) {
    this.actions[type] = handler;
    logger.info(`[WorkflowEngine] 注册动作: ${type}`);
  }

  /**
   * 注册命令动作（基于远程命令）
   */
  registerCommandAction(namespace) {
    this.actions[`${namespace}.*`] = async (params, context) => {
      const { method, ...restParams } = params;
      const resolvedParams = {};

      // 解析参数中的变量
      for (const [key, value] of Object.entries(restParams)) {
        resolvedParams[key] = context.resolveVariables(value);
      }

      // 执行远程命令
      if (this.commandExecutor) {
        return await this.commandExecutor(method, resolvedParams);
      }

      throw new Error(`Command executor not available for ${method}`);
    };
  }

  /**
   * 执行工作流
   */
  async execute(workflow, initialVariables = {}) {
    const workflowId = workflow.id || this.generateWorkflowId();
    const startTime = Date.now();

    logger.info(`[WorkflowEngine] 开始执行工作流: ${workflowId}`);

    // 创建执行上下文
    const context = new ExecutionContext({
      ...initialVariables,
      ...workflow.variables,
      _workflowId: workflowId,
      _startTime: startTime,
    });

    // 创建工作流状态
    const state = {
      id: workflowId,
      name: workflow.name,
      status: WORKFLOW_STATUS.RUNNING,
      startTime,
      endTime: null,
      currentStep: null,
      completedSteps: [],
      failedStep: null,
      error: null,
      results: {},
    };

    this.runningWorkflows.set(workflowId, { workflow, state, context });
    this.emit("workflow:start", { workflowId, workflow });

    try {
      // 执行步骤
      const results = await this.executeSteps(workflow.steps, context, state);

      state.status = WORKFLOW_STATUS.COMPLETED;
      state.endTime = Date.now();
      state.results = results;

      logger.info(
        `[WorkflowEngine] 工作流完成: ${workflowId} (${state.endTime - startTime}ms)`,
      );
      this.emit("workflow:complete", { workflowId, state, results });

      return {
        success: true,
        workflowId,
        status: state.status,
        results,
        duration: state.endTime - startTime,
      };
    } catch (error) {
      state.status = WORKFLOW_STATUS.FAILED;
      state.endTime = Date.now();
      state.error = error.message;

      logger.error(`[WorkflowEngine] 工作流失败: ${workflowId}`, error);
      this.emit("workflow:error", { workflowId, state, error });

      // 尝试回滚
      if (this.options.enableRollback && workflow.rollback) {
        await this.executeRollback(workflow.rollback, context);
      }

      return {
        success: false,
        workflowId,
        status: state.status,
        error: error.message,
        failedStep: state.failedStep,
        duration: state.endTime - startTime,
      };
    } finally {
      this.runningWorkflows.delete(workflowId);
    }
  }

  /**
   * 执行步骤列表
   */
  async executeSteps(steps, context, state = null) {
    const results = [];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      // 检查是否需要返回
      if (context.shouldReturn) {
        break;
      }

      // 检查步骤限制
      if (state && state.completedSteps.length >= this.options.maxSteps) {
        throw new Error(`Maximum steps (${this.options.maxSteps}) exceeded`);
      }

      // 执行单个步骤
      const result = await this.executeStep(step, context, state);
      results.push(result);

      // 保存结果
      if (step.id) {
        context.saveStepResult(step.id, result);
      }

      if (state) {
        state.completedSteps.push({
          id: step.id || `step_${i}`,
          action: step.action,
          result,
          timestamp: Date.now(),
        });
      }
    }

    return results;
  }

  /**
   * 执行单个步骤
   */
  async executeStep(step, context, state = null) {
    const stepId = step.id || `step_${Date.now()}`;
    const { action, params = {}, condition, retry = 0, timeout } = step;

    logger.debug(`[WorkflowEngine] 执行步骤: ${stepId} (${action})`);

    if (state) {
      state.currentStep = stepId;
    }

    this.emit("step:start", { stepId, action, params });

    try {
      // 检查条件
      if (condition !== undefined) {
        const shouldRun = context.evaluateCondition(condition);
        if (!shouldRun) {
          logger.debug(`[WorkflowEngine] 跳过步骤: ${stepId} (条件不满足)`);
          this.emit("step:skip", { stepId, reason: "condition_not_met" });
          return { status: STEP_STATUS.SKIPPED };
        }
      }

      // 解析参数
      const resolvedParams = this.resolveParams(params, context);

      // 查找动作处理器
      const handler = this.findActionHandler(action);
      if (!handler) {
        throw new Error(`Unknown action: ${action}`);
      }

      // 执行动作（带超时和重试）
      const result = await this.executeWithRetry(
        () =>
          this.executeWithTimeout(
            () => handler(resolvedParams, context, this),
            timeout || this.options.stepTimeout,
          ),
        retry,
      );

      this.emit("step:complete", { stepId, action, result });

      return {
        status: STEP_STATUS.COMPLETED,
        result,
      };
    } catch (error) {
      logger.error(`[WorkflowEngine] 步骤失败: ${stepId}`, error);

      if (state) {
        state.failedStep = stepId;
      }

      this.emit("step:error", { stepId, action, error });

      // 如果有 onError 处理
      if (step.onError) {
        if (step.onError === "continue") {
          return { status: STEP_STATUS.FAILED, error: error.message };
        } else if (step.onError === "skip") {
          return { status: STEP_STATUS.SKIPPED, error: error.message };
        } else if (typeof step.onError === "object" && step.onError.steps) {
          // 执行错误处理步骤
          await this.executeSteps(step.onError.steps, context, state);
          return {
            status: STEP_STATUS.FAILED,
            error: error.message,
            handled: true,
          };
        }
      }

      throw error;
    }
  }

  /**
   * 查找动作处理器
   */
  findActionHandler(action) {
    // 精确匹配
    if (this.actions[action]) {
      return this.actions[action];
    }

    // 通配符匹配
    for (const [pattern, handler] of Object.entries(this.actions)) {
      if (pattern.includes("*")) {
        const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
        if (regex.test(action)) {
          return handler;
        }
      }
    }

    // 命令动作
    if (action.includes(".") && this.commandExecutor) {
      return async (params, context) => {
        const resolvedParams = {};
        for (const [key, value] of Object.entries(params)) {
          resolvedParams[key] = context.resolveVariables(value);
        }
        return await this.commandExecutor(action, resolvedParams);
      };
    }

    return null;
  }

  /**
   * 解析参数中的变量
   */
  resolveParams(params, context) {
    if (typeof params !== "object" || params === null) {
      return context.resolveVariables(params);
    }

    if (Array.isArray(params)) {
      return params.map((item) => this.resolveParams(item, context));
    }

    const resolved = {};
    for (const [key, value] of Object.entries(params)) {
      resolved[key] = this.resolveParams(value, context);
    }
    return resolved;
  }

  /**
   * 带超时执行
   */
  async executeWithTimeout(fn, timeout) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Step timeout (${timeout}ms)`));
      }, timeout);

      fn()
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  /**
   * 带重试执行
   */
  async executeWithRetry(fn, maxRetries) {
    let lastError;

    for (let i = 0; i <= maxRetries; i++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        if (i < maxRetries) {
          const delay = Math.pow(2, i) * 1000; // 指数退避
          logger.warn(
            `[WorkflowEngine] 步骤失败，${delay}ms 后重试 (${i + 1}/${maxRetries})`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  }

  /**
   * 执行回滚
   */
  async executeRollback(rollbackSteps, context) {
    logger.info("[WorkflowEngine] 开始执行回滚...");

    try {
      await this.executeSteps(rollbackSteps, context);
      logger.info("[WorkflowEngine] 回滚完成");
    } catch (error) {
      logger.error("[WorkflowEngine] 回滚失败:", error);
    }
  }

  /**
   * 取消工作流
   */
  cancelWorkflow(workflowId) {
    const running = this.runningWorkflows.get(workflowId);
    if (running) {
      running.state.status = WORKFLOW_STATUS.CANCELLED;
      running.context.shouldReturn = true;

      this.emit("workflow:cancel", { workflowId });
      logger.info(`[WorkflowEngine] 工作流已取消: ${workflowId}`);

      return true;
    }
    return false;
  }

  /**
   * 获取工作流状态
   */
  getWorkflowStatus(workflowId) {
    const running = this.runningWorkflows.get(workflowId);
    if (running) {
      return { ...running.state };
    }
    return null;
  }

  /**
   * 获取所有运行中的工作流
   */
  getRunningWorkflows() {
    const workflows = [];
    for (const [id, { state }] of this.runningWorkflows.entries()) {
      workflows.push({ id, ...state });
    }
    return workflows;
  }

  /**
   * 生成工作流 ID
   */
  generateWorkflowId() {
    return `wf-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  }

  /**
   * 验证工作流定义
   */
  validateWorkflow(workflow) {
    const errors = [];

    if (!workflow) {
      errors.push("Workflow definition is required");
      return { valid: false, errors };
    }

    if (!workflow.steps || !Array.isArray(workflow.steps)) {
      errors.push("Workflow must have a steps array");
    } else {
      for (let i = 0; i < workflow.steps.length; i++) {
        const step = workflow.steps[i];
        if (!step.action) {
          errors.push(`Step ${i} is missing action`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

module.exports = {
  WorkflowEngine,
  ExecutionContext,
  WORKFLOW_STATUS,
  STEP_STATUS,
  ACTION_TYPES,
};

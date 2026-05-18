/**
 * SkillPipelineEngine - 技能流水线引擎
 *
 * 支持技能的串联、并行、条件分支执行，实现工作流自动化。
 *
 * @module ai-engine/cowork/skills/skill-pipeline-engine
 * @version 1.1.0
 */

const EventEmitter = require("events");
const { v4: uuidv4 } = require("uuid");
const { logger } = require("../../../utils/logger.js");

/**
 * Step types
 */
const StepType = {
  SKILL: "skill",
  CONDITION: "condition",
  PARALLEL: "parallel",
  TRANSFORM: "transform",
  LOOP: "loop",
};

/**
 * Pipeline execution states
 */
const PipelineState = {
  IDLE: "idle",
  RUNNING: "running",
  PAUSED: "paused",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

/**
 * Resolve variable references like ${stepName.result.field}
 */
function resolveVariables(template, context) {
  if (typeof template !== "string") {
    return template;
  }
  return template.replace(/\$\{([^}]+)\}/g, (match, path) => {
    const parts = path.split(".");
    let value = context;
    for (const part of parts) {
      if (value == null) {
        return match;
      }
      value = value[part];
    }
    return value !== undefined
      ? typeof value === "object"
        ? JSON.stringify(value)
        : String(value)
      : match;
  });
}

/**
 * Deep-resolve variables in an object
 */
function resolveDeep(obj, context) {
  if (typeof obj === "string") {
    return resolveVariables(obj, context);
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => resolveDeep(item, context));
  }
  if (obj && typeof obj === "object") {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = resolveDeep(value, context);
    }
    return result;
  }
  return obj;
}

/**
 * Evaluate a simple expression against context
 */
function evaluateExpression(expr, context) {
  if (typeof expr === "boolean") {
    return expr;
  }
  if (typeof expr !== "string") {
    return !!expr;
  }

  // Simple expression evaluator (safe subset)
  const resolved = resolveVariables(expr, context);

  // Handle common comparisons
  const comparisons = [
    { op: "===", fn: (a, b) => a === b },
    { op: "!==", fn: (a, b) => a !== b },
    { op: ">=", fn: (a, b) => Number(a) >= Number(b) },
    { op: "<=", fn: (a, b) => Number(a) <= Number(b) },
    { op: ">", fn: (a, b) => Number(a) > Number(b) },
    { op: "<", fn: (a, b) => Number(a) < Number(b) },
    { op: "==", fn: (a, b) => a == b },
    { op: "!=", fn: (a, b) => a != b },
  ];

  for (const { op, fn } of comparisons) {
    if (resolved.includes(op)) {
      const [left, right] = resolved.split(op).map((s) => s.trim());
      return fn(left, right);
    }
  }

  // Truthy check
  return (
    resolved !== "" &&
    resolved !== "false" &&
    resolved !== "null" &&
    resolved !== "undefined" &&
    resolved !== "0"
  );
}

class SkillPipelineEngine extends EventEmitter {
  /**
   * @param {Object} options
   * @param {Object} options.skillRegistry - SkillRegistry instance
   * @param {Object} [options.metricsCollector] - SkillMetricsCollector instance
   */
  constructor(options = {}) {
    super();
    this.skillRegistry = options.skillRegistry;
    this.metricsCollector = options.metricsCollector || null;

    /** @type {Map<string, object>} Pipeline definitions */
    this.pipelines = new Map();

    /** @type {Map<string, object>} Active executions */
    this.executions = new Map();

    logger.info("[SkillPipelineEngine] Initialized");
  }

  /**
   * Create a new pipeline from definition
   * @param {object} definition - Pipeline definition
   * @returns {string} Pipeline ID
   */
  createPipeline(definition) {
    const id = definition.id || uuidv4();
    const pipeline = {
      id,
      name: definition.name || "Unnamed Pipeline",
      description: definition.description || "",
      category: definition.category || "custom",
      tags: definition.tags || [],
      steps: definition.steps || [],
      variables: definition.variables || {},
      isTemplate: definition.isTemplate || false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      executionCount: 0,
      lastExecutedAt: null,
    };

    this.pipelines.set(id, pipeline);
    this.emit("pipeline:created", { pipelineId: id, name: pipeline.name });
    logger.info(
      `[SkillPipelineEngine] Pipeline created: ${pipeline.name} (${id})`,
    );
    return id;
  }

  /**
   * Execute a pipeline
   * @param {string} pipelineId - Pipeline ID
   * @param {object} [initialContext={}] - Initial context variables
   * @returns {Promise<object>} PipelineResult
   */
  async executePipeline(pipelineId, initialContext = {}) {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) {
      throw new Error(`Pipeline not found: ${pipelineId}`);
    }

    const executionId = uuidv4();
    const execution = {
      id: executionId,
      pipelineId,
      state: PipelineState.RUNNING,
      context: { ...pipeline.variables, ...initialContext },
      stepResults: [],
      currentStepIndex: 0,
      startedAt: Date.now(),
      completedAt: null,
      error: null,
      _pauseResolve: null,
    };

    this.executions.set(executionId, execution);
    pipeline.executionCount++;
    pipeline.lastExecutedAt = Date.now();

    this.emit("pipeline:started", {
      executionId,
      pipelineId,
      name: pipeline.name,
    });

    try {
      await this._executeSteps(execution, pipeline.steps);

      execution.state = PipelineState.COMPLETED;
      execution.completedAt = Date.now();

      const result = {
        executionId,
        pipelineId,
        state: PipelineState.COMPLETED,
        context: execution.context,
        stepResults: execution.stepResults,
        duration: execution.completedAt - execution.startedAt,
      };

      this.emit("pipeline:completed", result);
      logger.info(
        `[SkillPipelineEngine] Pipeline completed: ${pipeline.name} (${execution.completedAt - execution.startedAt}ms)`,
      );
      return result;
    } catch (error) {
      if (execution.state === PipelineState.CANCELLED) {
        const result = {
          executionId,
          pipelineId,
          state: PipelineState.CANCELLED,
          context: execution.context,
          stepResults: execution.stepResults,
          duration: Date.now() - execution.startedAt,
        };
        this.emit("pipeline:cancelled", result);
        return result;
      }

      execution.state = PipelineState.FAILED;
      execution.error = error.message;
      execution.completedAt = Date.now();

      const result = {
        executionId,
        pipelineId,
        state: PipelineState.FAILED,
        error: error.message,
        context: execution.context,
        stepResults: execution.stepResults,
        duration: execution.completedAt - execution.startedAt,
      };

      this.emit("pipeline:failed", result);
      logger.error(
        `[SkillPipelineEngine] Pipeline failed: ${pipeline.name}: ${error.message}`,
      );
      return result;
    }
  }

  /**
   * Pause a running pipeline
   * @param {string} executionId
   */
  pausePipeline(executionId) {
    const execution = this.executions.get(executionId);
    if (!execution || execution.state !== PipelineState.RUNNING) {
      throw new Error(`Cannot pause execution: ${executionId}`);
    }
    execution.state = PipelineState.PAUSED;
    this.emit("pipeline:paused", { executionId });
    logger.info(`[SkillPipelineEngine] Pipeline paused: ${executionId}`);
  }

  /**
   * Resume a paused pipeline
   * @param {string} executionId
   */
  resumePipeline(executionId) {
    const execution = this.executions.get(executionId);
    if (!execution || execution.state !== PipelineState.PAUSED) {
      throw new Error(`Cannot resume execution: ${executionId}`);
    }
    execution.state = PipelineState.RUNNING;
    if (execution._pauseResolve) {
      execution._pauseResolve();
      execution._pauseResolve = null;
    }
    this.emit("pipeline:resumed", { executionId });
    logger.info(`[SkillPipelineEngine] Pipeline resumed: ${executionId}`);
  }

  /**
   * Cancel a running/paused pipeline
   * @param {string} executionId
   */
  cancelPipeline(executionId) {
    const execution = this.executions.get(executionId);
    if (!execution) {
      throw new Error(`Execution not found: ${executionId}`);
    }
    execution.state = PipelineState.CANCELLED;
    if (execution._pauseResolve) {
      execution._pauseResolve();
      execution._pauseResolve = null;
    }
    this.emit("pipeline:cancelled", { executionId });
    logger.info(`[SkillPipelineEngine] Pipeline cancelled: ${executionId}`);
  }

  /**
   * Get pipeline execution status
   * @param {string} executionId
   * @returns {object} PipelineStatus
   */
  getPipelineStatus(executionId) {
    const execution = this.executions.get(executionId);
    if (!execution) {
      return null;
    }
    return {
      executionId: execution.id,
      pipelineId: execution.pipelineId,
      state: execution.state,
      currentStepIndex: execution.currentStepIndex,
      totalSteps: this.pipelines.get(execution.pipelineId)?.steps?.length || 0,
      stepResults: execution.stepResults,
      startedAt: execution.startedAt,
      completedAt: execution.completedAt,
      error: execution.error,
      duration: (execution.completedAt || Date.now()) - execution.startedAt,
    };
  }

  /**
   * List all pipelines
   * @returns {object[]}
   */
  listPipelines() {
    return Array.from(this.pipelines.values()).map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      category: p.category,
      tags: p.tags,
      isTemplate: p.isTemplate,
      stepCount: p.steps.length,
      executionCount: p.executionCount,
      lastExecutedAt: p.lastExecutedAt,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));
  }

  /**
   * Get a pipeline definition
   * @param {string} pipelineId
   * @returns {object|null}
   */
  getPipeline(pipelineId) {
    return this.pipelines.get(pipelineId) || null;
  }

  /**
   * Save/update a pipeline definition
   * @param {string} pipelineId
   * @param {object} updates
   */
  savePipeline(pipelineId, updates = {}) {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) {
      throw new Error(`Pipeline not found: ${pipelineId}`);
    }
    Object.assign(pipeline, updates, { updatedAt: Date.now() });
    this.emit("pipeline:updated", { pipelineId });
  }

  /**
   * Delete a pipeline
   * @param {string} pipelineId
   */
  deletePipeline(pipelineId) {
    if (!this.pipelines.has(pipelineId)) {
      throw new Error(`Pipeline not found: ${pipelineId}`);
    }
    this.pipelines.delete(pipelineId);
    this.emit("pipeline:deleted", { pipelineId });
    logger.info(`[SkillPipelineEngine] Pipeline deleted: ${pipelineId}`);
  }

  // ==========================================
  // Private: Step Execution
  // ==========================================

  /** @private */
  async _executeSteps(execution, steps) {
    for (let i = execution.currentStepIndex; i < steps.length; i++) {
      // Check for pause/cancel
      if (execution.state === PipelineState.CANCELLED) {
        throw new Error("Pipeline cancelled");
      }
      if (execution.state === PipelineState.PAUSED) {
        await new Promise((resolve) => {
          execution._pauseResolve = resolve;
        });
        if (execution.state === PipelineState.CANCELLED) {
          throw new Error("Pipeline cancelled");
        }
      }

      execution.currentStepIndex = i;
      const step = steps[i];
      const stepName = step.name || `step_${i}`;

      this.emit("pipeline:step-started", {
        executionId: execution.id,
        stepIndex: i,
        stepName,
        stepType: step.type,
      });

      const startTime = Date.now();
      let result;
      let success = true;

      try {
        switch (step.type) {
          case StepType.SKILL:
            result = await this._executeSkillStep(step, execution.context);
            break;
          case StepType.CONDITION:
            result = await this._executeConditionStep(step, execution);
            break;
          case StepType.PARALLEL:
            result = await this._executeParallelStep(step, execution.context);
            break;
          case StepType.TRANSFORM:
            result = this._executeTransformStep(step, execution.context);
            break;
          case StepType.LOOP:
            result = await this._executeLoopStep(step, execution);
            break;
          default:
            throw new Error(`Unknown step type: ${step.type}`);
        }
      } catch (error) {
        success = false;
        // Retry logic
        if (step.retries && step.retries > 0) {
          for (let retry = 0; retry < step.retries; retry++) {
            try {
              logger.info(
                `[SkillPipelineEngine] Retrying step ${stepName} (${retry + 1}/${step.retries})`,
              );
              result = await this._executeSkillStep(step, execution.context);
              success = true;
              break;
            } catch (retryError) {
              if (retry === step.retries - 1) {
                throw retryError;
              }
            }
          }
          if (!success) {
            throw error;
          }
        } else {
          throw error;
        }
      }

      const duration = Date.now() - startTime;

      // Store result in context under outputVariable
      if (step.outputVariable && result !== undefined) {
        execution.context[step.outputVariable] = result;
      }

      // Also store under step name for ${stepName.xxx} references
      execution.context[stepName] = { result, duration, success };

      execution.stepResults.push({
        stepIndex: i,
        stepName,
        stepType: step.type,
        success,
        duration,
        outputVariable: step.outputVariable,
      });

      // Record metrics if available
      if (this.metricsCollector && step.type === StepType.SKILL) {
        this.metricsCollector.recordExecution(step.skillId, {
          duration,
          success,
          pipelineId: execution.pipelineId,
          tokensUsed: result?.tokensUsed || 0,
        });
      }

      this.emit("pipeline:step-completed", {
        executionId: execution.id,
        stepIndex: i,
        stepName,
        success,
        duration,
      });
    }
  }

  /** @private */
  async _executeSkillStep(step, context) {
    if (!this.skillRegistry) {
      throw new Error("SkillRegistry not available");
    }

    const skillId = resolveVariables(step.skillId, context);
    const input = step.inputMapping
      ? resolveDeep(step.inputMapping, context)
      : {};

    const task = {
      type: step.config?.taskType || "skill-execution",
      ...input,
      _pipelineStep: true,
    };

    return await this.skillRegistry.executeSkill(skillId, task, {
      ...context,
      pipelineContext: true,
    });
  }

  /** @private */
  async _executeConditionStep(step, execution) {
    const result = evaluateExpression(step.expression, execution.context);

    if (result && step.trueBranch) {
      await this._executeSteps(
        { ...execution, currentStepIndex: 0, stepResults: [] },
        step.trueBranch,
      );
    } else if (!result && step.falseBranch) {
      await this._executeSteps(
        { ...execution, currentStepIndex: 0, stepResults: [] },
        step.falseBranch,
      );
    }

    return { condition: result };
  }

  /** @private */
  async _executeParallelStep(step, context) {
    if (!step.branches || !Array.isArray(step.branches)) {
      throw new Error("Parallel step requires branches array");
    }

    const promises = step.branches.map(async (branch, idx) => {
      try {
        const result = await this._executeSkillStep(branch, context);
        return { index: idx, success: true, result };
      } catch (error) {
        return { index: idx, success: false, error: error.message };
      }
    });

    const results = await Promise.allSettled(promises);
    return results.map((r) =>
      r.status === "fulfilled"
        ? r.value
        : { success: false, error: r.reason?.message },
    );
  }

  /** @private */
  _executeTransformStep(step, context) {
    if (!step.expression) {
      throw new Error("Transform step requires expression");
    }
    const resolved = resolveVariables(step.expression, context);
    try {
      return JSON.parse(resolved);
    } catch {
      return resolved;
    }
  }

  /** @private */
  async _executeLoopStep(step, execution) {
    const items = resolveDeep(step.items, execution.context);
    const resolvedItems = typeof items === "string" ? JSON.parse(items) : items;

    if (!Array.isArray(resolvedItems)) {
      throw new Error("Loop step items must resolve to an array");
    }

    const results = [];
    for (let i = 0; i < resolvedItems.length; i++) {
      execution.context[step.itemVariable || "item"] = resolvedItems[i];
      execution.context[`${step.itemVariable || "item"}_index`] = i;

      if (step.body) {
        await this._executeSteps(
          { ...execution, currentStepIndex: 0, stepResults: [] },
          step.body,
        );
      }

      results.push(execution.context[step.outputVariable] || resolvedItems[i]);
    }

    return results;
  }
}

module.exports = { SkillPipelineEngine, StepType, PipelineState };

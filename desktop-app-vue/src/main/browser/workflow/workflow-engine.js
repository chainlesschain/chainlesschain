/**
 * Workflow Engine - Core execution engine for browser workflows
 *
 * @module browser/workflow/workflow-engine
 * @author ChainlessChain Team
 * @since v0.30.0
 */

const { EventEmitter } = require("events");
const { v4: uuidv4 } = require("uuid");
const { logger } = require("../../utils/logger");
const { VariableManager, VariableScope } = require("./workflow-variables");
const { ControlFlowManager, StepType } = require("./control-flow");

/**
 * Execution status enum
 */
const ExecutionStatus = {
  PENDING: "pending",
  RUNNING: "running",
  PAUSED: "paused",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

/**
 * Workflow execution context
 */
class ExecutionContext {
  constructor(executionId, workflow, options = {}) {
    this.executionId = executionId;
    this.workflowId = workflow.id;
    this.workflowName = workflow.name;
    this.targetId = options.targetId;
    this.status = ExecutionStatus.PENDING;
    this.currentStepIndex = 0;
    this.totalSteps = workflow.steps?.length || 0;
    this.results = [];
    this.startTime = null;
    this.endTime = null;
    this.pausedAt = null;
    this.error = null;
    this.errorStep = null;
    this.retryCount = 0;

    // Variable manager
    this.variables = new VariableManager({
      ...workflow.variables,
      ...options.initialVariables,
    });

    // Control flow manager
    this.controlFlow = new ControlFlowManager(this.variables);

    // Pause/resume support
    this.pauseRequested = false;
    this.cancelRequested = false;
    this.resumeResolve = null;
  }
}

/**
 * Workflow Execution Engine
 */
class WorkflowEngine extends EventEmitter {
  constructor(browserEngine, options = {}) {
    super();

    this.browserEngine = browserEngine;
    this.storage = options.storage; // WorkflowStorage instance
    this.options = {
      defaultTimeout: options.defaultTimeout || 30000,
      maxRetries: options.maxRetries || 2,
      retryDelay: options.retryDelay || 1000,
      ...options,
    };

    // Active executions
    this.executions = new Map();
  }

  /**
   * Execute a workflow
   * @param {Object} workflow - Workflow definition
   * @param {Object} options - Execution options
   * @returns {Promise<Object>} Execution result
   */
  async executeWorkflow(workflow, options = {}) {
    const executionId = options.executionId || uuidv4();
    const context = new ExecutionContext(executionId, workflow, options);

    this.executions.set(executionId, context);

    try {
      context.status = ExecutionStatus.RUNNING;
      context.startTime = Date.now();

      // Store execution record if storage available
      if (this.storage) {
        await this.storage.createExecution({
          id: executionId,
          workflowId: workflow.id,
          workflowName: workflow.name,
          targetId: options.targetId,
          variables: context.variables.getAll(),
          totalSteps: context.totalSteps,
        });
      }

      this.emit("workflow:started", {
        executionId,
        workflowId: workflow.id,
        workflowName: workflow.name,
      });

      // Set page info in variables if we have a target
      if (options.targetId && this.browserEngine) {
        try {
          const page = this.browserEngine.getPage(options.targetId);
          context.variables.set("page_url", page.url(), VariableScope.STEP);
          context.variables.set(
            "page_title",
            await page.title(),
            VariableScope.STEP,
          );
        } catch (e) {
          logger.warn("[WorkflowEngine] Could not get page info", {
            error: e.message,
          });
        }
      }

      // Execute steps
      const result = await this._executeSteps(workflow.steps, context);

      context.status = ExecutionStatus.COMPLETED;
      context.endTime = Date.now();

      // Update storage
      if (this.storage) {
        await this.storage.updateExecution(executionId, {
          status: ExecutionStatus.COMPLETED,
          results: context.results,
          currentStep: context.currentStepIndex,
        });

        // Update workflow stats
        await this.storage.updateWorkflowStats(
          workflow.id,
          true,
          context.endTime - context.startTime,
        );
      }

      this.emit("workflow:completed", {
        executionId,
        workflowId: workflow.id,
        duration: context.endTime - context.startTime,
        stepsExecuted: context.results.length,
      });

      return {
        executionId,
        status: ExecutionStatus.COMPLETED,
        results: context.results,
        variables: context.variables.getAll(),
        duration: context.endTime - context.startTime,
      };
    } catch (error) {
      context.status = ExecutionStatus.FAILED;
      context.endTime = Date.now();
      context.error = error.message;

      // Update storage
      if (this.storage) {
        await this.storage.updateExecution(executionId, {
          status: ExecutionStatus.FAILED,
          results: context.results,
          errorMessage: error.message,
          errorStep: context.errorStep,
        });

        // Update workflow stats
        await this.storage.updateWorkflowStats(
          workflow.id,
          false,
          context.endTime - context.startTime,
        );
      }

      this.emit("workflow:failed", {
        executionId,
        workflowId: workflow.id,
        error: error.message,
        errorStep: context.errorStep,
      });

      throw error;
    } finally {
      this.executions.delete(executionId);
    }
  }

  /**
   * Execute a single step
   * @param {Object} step - Step definition
   * @param {ExecutionContext} context - Execution context
   * @returns {Promise<Object>} Step result
   */
  async executeStep(step, context) {
    const stepIndex = context.currentStepIndex;

    // Check for pause/cancel
    await this._checkPauseCancel(context);

    this.emit("workflow:step:started", {
      executionId: context.executionId,
      stepIndex,
      stepType: step.type || StepType.ACTION,
      description: step.description,
    });

    try {
      // Interpolate step config with variables
      const interpolatedStep = context.variables.interpolateDeep(step);
      let result;

      switch (interpolatedStep.type || StepType.ACTION) {
        case StepType.ACTION:
          result = await this._executeAction(interpolatedStep, context);
          break;

        case StepType.CONDITION:
          result = await context.controlFlow.executeCondition(
            interpolatedStep,
            (steps) => this._executeSteps(steps, context),
          );
          break;

        case StepType.LOOP:
          result = await context.controlFlow.executeLoop(
            interpolatedStep,
            (steps) => this._executeSteps(steps, context),
            { stopOnError: interpolatedStep.stopOnError },
          );
          break;

        case StepType.VARIABLE:
          result = context.controlFlow.executeVariable(interpolatedStep);
          break;

        case StepType.WAIT:
          result = await this._executeWait(interpolatedStep, context);
          break;

        case StepType.SUBPROCESS:
          result = await this._executeSubprocess(interpolatedStep, context);
          break;

        case StepType.TRY_CATCH:
          result = await context.controlFlow.executeTryCatch(
            interpolatedStep,
            (steps) => this._executeSteps(steps, context),
          );
          break;

        case StepType.GROUP:
          result = await this._executeSteps(interpolatedStep.steps, context);
          break;

        default:
          // Assume action if unknown type
          result = await this._executeAction(interpolatedStep, context);
      }

      // Store step result
      context.variables.setStepResult(stepIndex, result);
      context.results.push({
        stepIndex,
        type: step.type || StepType.ACTION,
        description: step.description,
        success: true,
        result,
        timestamp: Date.now(),
      });

      this.emit("workflow:step:completed", {
        executionId: context.executionId,
        stepIndex,
        result,
      });

      return result;
    } catch (error) {
      // Handle retry
      if (this._shouldRetry(step, context, error)) {
        context.retryCount++;
        logger.info("[WorkflowEngine] Retrying step", {
          stepIndex,
          retryCount: context.retryCount,
        });

        await this._delay(this.options.retryDelay * context.retryCount);
        return this.executeStep(step, context);
      }

      // Record failure
      context.errorStep = stepIndex;
      context.results.push({
        stepIndex,
        type: step.type || StepType.ACTION,
        description: step.description,
        success: false,
        error: error.message,
        timestamp: Date.now(),
      });

      this.emit("workflow:step:failed", {
        executionId: context.executionId,
        stepIndex,
        error: error.message,
      });

      // Throw if critical
      if (step.critical !== false) {
        throw error;
      }

      return { error: error.message, skipped: true };
    }
  }

  /**
   * Pause workflow execution
   * @param {string} executionId - Execution ID
   * @returns {boolean} Success
   */
  pause(executionId) {
    const context = this.executions.get(executionId);
    if (!context || context.status !== ExecutionStatus.RUNNING) {
      return false;
    }

    context.pauseRequested = true;
    return true;
  }

  /**
   * Resume workflow execution
   * @param {string} executionId - Execution ID
   * @returns {boolean} Success
   */
  resume(executionId) {
    const context = this.executions.get(executionId);
    if (!context || context.status !== ExecutionStatus.PAUSED) {
      return false;
    }

    context.pauseRequested = false;
    context.status = ExecutionStatus.RUNNING;

    if (context.resumeResolve) {
      context.resumeResolve();
      context.resumeResolve = null;
    }

    this.emit("workflow:resumed", { executionId });
    return true;
  }

  /**
   * Cancel workflow execution
   * @param {string} executionId - Execution ID
   * @returns {boolean} Success
   */
  cancel(executionId) {
    const context = this.executions.get(executionId);
    if (!context) {
      return false;
    }

    context.cancelRequested = true;

    // If paused, resume to allow cancellation
    if (context.resumeResolve) {
      context.resumeResolve();
      context.resumeResolve = null;
    }

    return true;
  }

  /**
   * Get execution status
   * @param {string} executionId - Execution ID
   * @returns {Object|null} Status info
   */
  getStatus(executionId) {
    const context = this.executions.get(executionId);
    if (!context) {
      return null;
    }

    return {
      executionId,
      workflowId: context.workflowId,
      workflowName: context.workflowName,
      status: context.status,
      currentStep: context.currentStepIndex,
      totalSteps: context.totalSteps,
      stepsCompleted: context.results.length,
      startTime: context.startTime,
      duration: context.startTime ? Date.now() - context.startTime : 0,
      error: context.error,
    };
  }

  /**
   * List active executions
   * @returns {Array} Active execution statuses
   */
  listActiveExecutions() {
    return Array.from(this.executions.keys()).map((id) => this.getStatus(id));
  }

  // ==================== Private Methods ====================

  /**
   * Execute a list of steps
   * @param {Array} steps - Steps to execute
   * @param {ExecutionContext} context - Execution context
   * @returns {Promise<Array>} Results
   */
  async _executeSteps(steps, context) {
    const results = [];

    for (let i = 0; i < steps.length; i++) {
      context.currentStepIndex = i;

      // Update storage progress
      if (this.storage) {
        await this.storage.updateExecution(context.executionId, {
          currentStep: i,
          results: context.results,
        });
      }

      const result = await this.executeStep(steps[i], context);
      results.push(result);
    }

    return results;
  }

  /**
   * Execute a browser action step
   * @param {Object} step - Action step
   * @param {ExecutionContext} context - Execution context
   * @returns {Promise<Object>} Action result
   */
  async _executeAction(step, context) {
    const { action, ref, options = {} } = step;
    const targetId = context.targetId;

    if (!this.browserEngine) {
      throw new Error("Browser engine not available");
    }

    if (!targetId) {
      throw new Error("No target tab specified");
    }

    const timeout = step.timeout || this.options.defaultTimeout;

    switch (action) {
      case "navigate":
        return this.browserEngine.navigate(targetId, step.url, {
          timeout,
          ...options,
        });

      case "click":
        return this.browserEngine.act(targetId, "click", ref, {
          timeout,
          ...options,
        });

      case "type":
        return this.browserEngine.act(targetId, "type", ref, {
          text: step.text,
          timeout,
          ...options,
        });

      case "select":
        return this.browserEngine.act(targetId, "select", ref, {
          value: step.value,
          timeout,
          ...options,
        });

      case "hover":
        return this.browserEngine.act(targetId, "hover", ref, {
          timeout,
          ...options,
        });

      case "drag":
        return this.browserEngine.act(targetId, "drag", ref, {
          target: step.target,
          timeout,
          ...options,
        });

      case "screenshot":
        return this.browserEngine.screenshot(targetId, options);

      case "snapshot":
        return this.browserEngine.takeSnapshot(targetId, options);

      case "scroll":
        return this._executeScroll(targetId, step, context);

      case "keyboard":
        return this._executeKeyboard(targetId, step, context);

      case "upload":
        return this._executeUpload(targetId, step, context);

      case "extract":
        return this._executeExtract(targetId, step, context);

      case "evaluate":
        return this._executeEvaluate(targetId, step, context);

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  /**
   * Execute scroll action
   */
  async _executeScroll(targetId, step, context) {
    const page = this.browserEngine.getPage(targetId);
    const { direction, distance, element, behavior = "smooth" } = step;

    if (element) {
      // Scroll element into view
      const elem = this.browserEngine.findElement(targetId, element);
      if (!elem) {
        throw new Error(`Element ${element} not found`);
      }
      const locator = await require("../element-locator").ElementLocator.locate(
        page,
        elem,
      );
      await locator.scrollIntoViewIfNeeded();
      return { scrolledToElement: element };
    }

    // Scroll page
    const scrollOptions = { behavior };
    let x = 0,
      y = 0;

    switch (direction) {
      case "down":
        y = distance || 300;
        break;
      case "up":
        y = -(distance || 300);
        break;
      case "right":
        x = distance || 300;
        break;
      case "left":
        x = -(distance || 300);
        break;
      case "bottom":
        await page.evaluate(() =>
          window.scrollTo(0, document.body.scrollHeight),
        );
        return { scrolledTo: "bottom" };
      case "top":
        await page.evaluate(() => window.scrollTo(0, 0));
        return { scrolledTo: "top" };
    }

    await page.evaluate(
      ({ x, y, behavior }) => {
        window.scrollBy({ left: x, top: y, behavior });
      },
      { x, y, behavior },
    );

    return { scrolled: { x, y } };
  }

  /**
   * Execute keyboard action
   */
  async _executeKeyboard(targetId, step, context) {
    const page = this.browserEngine.getPage(targetId);
    const { keys, modifiers = [], text } = step;

    if (text) {
      // Type text
      await page.keyboard.type(text);
      return { typed: text };
    }

    if (keys) {
      // Press key combination
      const keyCombo = [...modifiers, keys].join("+");
      await page.keyboard.press(keyCombo);
      return { pressed: keyCombo };
    }

    return { noAction: true };
  }

  /**
   * Execute file upload action
   */
  async _executeUpload(targetId, step, context) {
    const page = this.browserEngine.getPage(targetId);
    const { files, inputRef } = step;

    if (!files || files.length === 0) {
      throw new Error("No files specified for upload");
    }

    if (inputRef) {
      // Use file input element
      const elem = this.browserEngine.findElement(targetId, inputRef);
      if (!elem) {
        throw new Error(`Element ${inputRef} not found`);
      }
      const locator = await require("../element-locator").ElementLocator.locate(
        page,
        elem,
      );
      await locator.setInputFiles(files);
    } else {
      // Use file chooser
      const [fileChooser] = await Promise.all([
        page.waitForEvent("filechooser"),
        // Trigger file selection (caller should have clicked upload button)
      ]);
      await fileChooser.setFiles(files);
    }

    return { uploaded: files };
  }

  /**
   * Execute data extraction
   */
  async _executeExtract(targetId, step, context) {
    const page = this.browserEngine.getPage(targetId);
    const { expression, type, selector, attribute, saveTo } = step;

    const value = await context.variables.extractFromPage(page, expression, {
      type,
      selector,
      attribute,
      saveTo,
    });

    return { extracted: value, savedTo: saveTo };
  }

  /**
   * Execute JavaScript evaluation
   */
  async _executeEvaluate(targetId, step, context) {
    const page = this.browserEngine.getPage(targetId);
    const { script, args = [] } = step;

    // Interpolate args
    const interpolatedArgs = args.map((arg) =>
      context.variables.interpolate(arg),
    );

    const result = await page.evaluate(script, ...interpolatedArgs);

    if (step.saveTo) {
      context.variables.set(step.saveTo, result, VariableScope.EXTRACTED);
    }

    return { result, savedTo: step.saveTo };
  }

  /**
   * Execute wait step
   */
  async _executeWait(step, context) {
    const { condition, timeout = 30000, interval = 100 } = step;

    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      if (context.controlFlow.evaluateCondition(condition)) {
        return { waited: Date.now() - startTime, conditionMet: true };
      }

      await this._delay(interval);
      await this._checkPauseCancel(context);
    }

    throw new Error(`Wait condition not met within ${timeout}ms`);
  }

  /**
   * Execute subprocess (sub-workflow)
   */
  async _executeSubprocess(step, context) {
    const { workflowId, workflow: inlineWorkflow, variables: inputVars } = step;

    let subWorkflow;

    if (workflowId && this.storage) {
      subWorkflow = await this.storage.getWorkflow(workflowId);
      if (!subWorkflow) {
        throw new Error(`Sub-workflow ${workflowId} not found`);
      }
    } else if (inlineWorkflow) {
      subWorkflow = inlineWorkflow;
    } else {
      throw new Error("No workflow specified for subprocess");
    }

    // Merge variables
    const subVars = {
      ...context.variables.getAll(),
      ...inputVars,
    };

    const result = await this.executeWorkflow(subWorkflow, {
      targetId: context.targetId,
      initialVariables: subVars,
    });

    // Copy output variables back if specified
    if (step.outputVars) {
      for (const [subVar, parentVar] of Object.entries(step.outputVars)) {
        const value = result.variables[subVar];
        if (value !== undefined) {
          context.variables.set(parentVar, value);
        }
      }
    }

    return { subWorkflowResult: result };
  }

  /**
   * Check for pause/cancel requests
   */
  async _checkPauseCancel(context) {
    if (context.cancelRequested) {
      context.status = ExecutionStatus.CANCELLED;
      throw new Error("Workflow cancelled");
    }

    if (context.pauseRequested) {
      context.status = ExecutionStatus.PAUSED;
      context.pausedAt = Date.now();

      this.emit("workflow:paused", {
        executionId: context.executionId,
        currentStep: context.currentStepIndex,
      });

      // Update storage
      if (this.storage) {
        await this.storage.updateExecution(context.executionId, {
          status: ExecutionStatus.PAUSED,
        });
      }

      // Wait for resume
      await new Promise((resolve) => {
        context.resumeResolve = resolve;
      });

      // Check cancel again after resume
      if (context.cancelRequested) {
        context.status = ExecutionStatus.CANCELLED;
        throw new Error("Workflow cancelled");
      }
    }
  }

  /**
   * Check if step should be retried
   */
  _shouldRetry(step, context, error) {
    if (step.noRetry) {
      return false;
    }

    const maxRetries = step.maxRetries || this.options.maxRetries;
    return context.retryCount < maxRetries;
  }

  /**
   * Delay helper
   */
  _delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = {
  WorkflowEngine,
  ExecutionContext,
  ExecutionStatus,
};

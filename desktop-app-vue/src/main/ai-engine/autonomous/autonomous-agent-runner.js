/**
 * Autonomous Agent Runner — ReAct Loop Engine
 *
 * Core engine for autonomous goal execution using the ReAct
 * (Reason-Act-Observe) loop pattern. Manages goal lifecycle
 * from submission through decomposition, execution, and completion.
 *
 * Supports pause/resume, user input requests, self-correction on
 * failure, checkpointing for recovery, and concurrent goal execution.
 *
 * @module ai-engine/autonomous/autonomous-agent-runner
 * @version 1.0.0
 */

"use strict";

const { EventEmitter } = require("events");
const { logger } = require("../../utils/logger.js");
const { v4: uuidv4 } = require("uuid");
const { SubAgentContext } = require("../agents/sub-agent-context.js");

// ============================================================
// Constants
// ============================================================

const GOAL_STATUS = {
  QUEUED: "queued",
  RUNNING: "running",
  PAUSED: "paused",
  WAITING_INPUT: "waiting_input",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

const ACTION_TYPES = {
  SKILL: "skill",
  TOOL: "tool",
  SEARCH: "search",
  FILE: "file",
  ASK_USER: "ask_user",
  COMPLETE: "complete",
};

const DEFAULT_CONFIG = {
  maxStepsPerGoal: 100,
  stepTimeoutMs: 120000,
  maxConcurrentGoals: 3,
  tokenBudgetPerGoal: 50000,
  evaluationIntervalMs: 1000,
  maxRetriesPerStep: 3,
  maxReplanAttempts: 3,
};

const TOOL_PERMISSION_CATEGORIES = {
  skills: "skills",
  "file-ops": "file-ops",
  browser: "browser",
  network: "network",
};

// ============================================================
// AutonomousAgentRunner
// ============================================================

class AutonomousAgentRunner extends EventEmitter {
  constructor() {
    super();
    this.database = null;
    this.llmManager = null;
    this.skillExecutor = null;
    this.toolRegistry = null;
    this.taskQueue = null;
    this.activeGoals = new Map(); // goalId -> goalState
    this.initialized = false;
    this.config = { ...DEFAULT_CONFIG };
  }

  /**
   * Initialize with dependencies
   * @param {Object} dependencies - { database, llmManager, skillExecutor, toolRegistry, taskQueue }
   */
  initialize(dependencies) {
    if (this.initialized) {
      return;
    }

    this.database = dependencies.database || null;
    this.llmManager = dependencies.llmManager || null;
    this.skillExecutor = dependencies.skillExecutor || null;
    this.toolRegistry = dependencies.toolRegistry || null;
    this.taskQueue = dependencies.taskQueue || null;

    this._ensureTables();
    this.initialized = true;
    logger.info("[AutonomousAgent] Runner initialized");
  }

  /**
   * Create database tables for autonomous goals
   * @private
   */
  _ensureTables() {
    if (!this.database) {
      return;
    }
    try {
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS autonomous_goals (
          id TEXT PRIMARY KEY,
          description TEXT NOT NULL,
          priority INTEGER DEFAULT 5,
          status TEXT DEFAULT 'queued',
          tool_permissions TEXT DEFAULT '[]',
          context TEXT DEFAULT '{}',
          plan TEXT DEFAULT '{}',
          result TEXT,
          step_count INTEGER DEFAULT 0,
          tokens_used INTEGER DEFAULT 0,
          error_message TEXT,
          created_by TEXT DEFAULT 'user',
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now')),
          completed_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_ag_status ON autonomous_goals(status);
        CREATE INDEX IF NOT EXISTS idx_ag_priority ON autonomous_goals(priority);
        CREATE INDEX IF NOT EXISTS idx_ag_created ON autonomous_goals(created_at);

        CREATE TABLE IF NOT EXISTS autonomous_goal_steps (
          id TEXT PRIMARY KEY,
          goal_id TEXT NOT NULL,
          step_number INTEGER NOT NULL,
          phase TEXT NOT NULL,
          thought TEXT,
          action_type TEXT,
          action_params TEXT DEFAULT '{}',
          result TEXT,
          success INTEGER DEFAULT 0,
          tokens_used INTEGER DEFAULT 0,
          duration_ms INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now')),
          FOREIGN KEY (goal_id) REFERENCES autonomous_goals(id)
        );
        CREATE INDEX IF NOT EXISTS idx_ags_goal ON autonomous_goal_steps(goal_id);

        CREATE TABLE IF NOT EXISTS autonomous_goal_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          goal_id TEXT NOT NULL,
          level TEXT DEFAULT 'info',
          type TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now')),
          FOREIGN KEY (goal_id) REFERENCES autonomous_goals(id)
        );
        CREATE INDEX IF NOT EXISTS idx_agl_goal ON autonomous_goal_logs(goal_id);
      `);
      if (this.database.saveToFile) {
        this.database.saveToFile();
      }
    } catch (e) {
      logger.error("[AutonomousAgent] Table creation error:", e.message);
    }
  }

  // ============================================================
  // Goal Submission & Lifecycle
  // ============================================================

  /**
   * Submit a new goal for autonomous execution
   * @param {Object} goalSpec - { description, priority, toolPermissions, context, createdBy }
   * @returns {Object} Goal record with status
   */
  async submitGoal(goalSpec) {
    if (!this.initialized) {
      return { success: false, error: "Runner not initialized" };
    }

    const goalId = uuidv4();
    const description = goalSpec.description;
    const priority = Math.max(1, Math.min(10, goalSpec.priority || 5));
    const toolPermissions = goalSpec.toolPermissions || [
      "skills",
      "file-ops",
      "browser",
      "network",
    ];
    const context = goalSpec.context || {};
    const createdBy = goalSpec.createdBy || "user";

    if (!description || !description.trim()) {
      return { success: false, error: "Goal description is required" };
    }

    // Check concurrent goal limit
    const runningCount = Array.from(this.activeGoals.values()).filter(
      (g) => g.status === GOAL_STATUS.RUNNING,
    ).length;
    if (runningCount >= this.config.maxConcurrentGoals) {
      logger.info(
        `[AutonomousAgent] Max concurrent goals reached (${runningCount}/${this.config.maxConcurrentGoals}), queuing goal ${goalId}`,
      );
    }

    logger.info(
      `[AutonomousAgent] Submitting goal ${goalId}: "${description.substring(0, 80)}..." (priority: ${priority})`,
    );

    // Decompose goal into plan
    let plan = {};
    try {
      plan = await this._decomposeGoal(description, context);
    } catch (e) {
      logger.warn(
        `[AutonomousAgent] Goal decomposition failed for ${goalId}:`,
        e.message,
      );
      plan = {
        steps: [{ description: description, estimatedComplexity: "unknown" }],
        strategy: "direct-execution",
      };
    }

    // Create goal state
    const goalState = {
      id: goalId,
      description,
      priority,
      status: GOAL_STATUS.RUNNING,
      toolPermissions,
      context,
      plan,
      result: null,
      stepCount: 0,
      tokensUsed: 0,
      stepHistory: [],
      paused: false,
      waitingForInput: false,
      inputRequest: null,
      lastUserInput: null,
      replanAttempts: 0,
      createdBy,
      createdAt: new Date().toISOString(),
      _abortController: new AbortController(),
      _resumeResolve: null,
      _inputResolve: null,
    };

    this.activeGoals.set(goalId, goalState);

    // Persist to DB
    this._saveGoalToDB(goalState);

    // Enqueue if task queue is available
    if (this.taskQueue) {
      await this.taskQueue.enqueue({
        goalId,
        priority,
        description,
        createdAt: goalState.createdAt,
      });
    }

    await this._logStep(
      goalId,
      "goal-submitted",
      `Goal submitted: ${description}`,
    );

    // Start execution (non-blocking)
    this._executeGoal(goalId).catch((err) => {
      logger.error(
        `[AutonomousAgent] Unhandled error in goal ${goalId}:`,
        err.message,
      );
    });

    this.emit("goal-submitted", {
      goalId,
      description,
      priority,
      plan,
    });

    return {
      success: true,
      data: {
        goalId,
        status: GOAL_STATUS.RUNNING,
        description,
        priority,
        plan,
        steps: [],
      },
    };
  }

  /**
   * Main ReAct execution loop
   * @param {string} goalId
   * @private
   */
  async _executeGoal(goalId) {
    const goal = this.activeGoals.get(goalId);
    if (!goal) {
      logger.warn(`[AutonomousAgent] Goal ${goalId} not found in active goals`);
      return;
    }

    logger.info(`[AutonomousAgent] Starting execution loop for goal ${goalId}`);

    while (
      goal.status === GOAL_STATUS.RUNNING &&
      goal.stepCount < this.config.maxStepsPerGoal
    ) {
      // Check if cancelled via AbortController
      if (goal._abortController.signal.aborted) {
        logger.info(`[AutonomousAgent] Goal ${goalId} aborted`);
        break;
      }

      // Handle pause state
      if (goal.paused) {
        logger.info(
          `[AutonomousAgent] Goal ${goalId} paused, waiting for resume`,
        );
        await this._waitForResume(goalId);
        if (goal._abortController.signal.aborted) {
          break;
        }
        continue;
      }

      // Handle waiting for user input
      if (goal.waitingForInput) {
        logger.info(`[AutonomousAgent] Goal ${goalId} waiting for user input`);
        await this._waitForInput(goalId);
        if (goal._abortController.signal.aborted) {
          break;
        }
        continue;
      }

      // Token budget check
      if (goal.tokensUsed >= this.config.tokenBudgetPerGoal) {
        logger.warn(
          `[AutonomousAgent] Goal ${goalId} exceeded token budget (${goal.tokensUsed}/${this.config.tokenBudgetPerGoal})`,
        );
        await this._failGoal(goalId, "Token budget exceeded");
        break;
      }

      const stepStartTime = Date.now();

      try {
        // REASON: Ask LLM what to do next
        const reasoning = await this._reason(goalId);

        // Check if goal is complete
        if (reasoning.complete) {
          await this._completeGoal(goalId, reasoning.result);
          break;
        }

        // ACT: Execute the planned action
        const actionResult = await this._act(goalId, reasoning.action);

        // OBSERVE: Process results and update state
        await this._observe(goalId, reasoning, actionResult, stepStartTime);

        // Checkpoint
        await this._checkpoint(goalId);

        goal.stepCount++;
        goal.tokensUsed += reasoning.tokensUsed || 0;

        // Emit progress
        this.emit("goal-progress", {
          goalId,
          step: goal.stepCount,
          reasoning: reasoning.thought,
          action: reasoning.action,
          result: actionResult.success ? "success" : "failed",
        });

        // Brief delay between steps
        await this._sleep(this.config.evaluationIntervalMs);
      } catch (error) {
        logger.error(
          `[AutonomousAgent] Step error in goal ${goalId}:`,
          error.message,
        );

        // Try self-correction
        const recovered = await this._replanOnFailure(goalId, error);
        if (!recovered) {
          await this._failGoal(goalId, error.message);
          break;
        }

        await this._logStep(
          goalId,
          "self-correction",
          `Recovered from error: ${error.message}`,
        );
      }
    }

    // Check if we hit step limit
    if (
      goal.status === GOAL_STATUS.RUNNING &&
      goal.stepCount >= this.config.maxStepsPerGoal
    ) {
      await this._failGoal(
        goalId,
        `Maximum step limit reached (${this.config.maxStepsPerGoal})`,
      );
    }
  }

  // ============================================================
  // ReAct Phases
  // ============================================================

  /**
   * REASON phase: Ask LLM to decide the next action
   * @param {string} goalId
   * @returns {Object} { thought, action, complete, result, tokensUsed }
   * @private
   */
  async _reason(goalId) {
    const goal = this.activeGoals.get(goalId);
    if (!goal) {
      throw new Error(`Goal ${goalId} not found`);
    }

    // Build context from step history
    const historyContext = goal.stepHistory
      .slice(-10)
      .map((step, i) => {
        return `Step ${step.stepNumber}: [${step.phase}] ${step.thought || ""}\n  Action: ${step.actionType || "none"}\n  Result: ${step.success ? "success" : "failed"} - ${(step.result || "").substring(0, 200)}`;
      })
      .join("\n\n");

    const userInputContext = goal.lastUserInput
      ? `\nUser provided input: "${goal.lastUserInput}"`
      : "";

    const planContext =
      goal.plan && goal.plan.steps
        ? `\nPlan:\n${goal.plan.steps.map((s, i) => `  ${i + 1}. ${s.description}`).join("\n")}`
        : "";

    const prompt = `You are an autonomous AI agent executing a goal step by step.

## Goal
${goal.description}

## Available Tools
Allowed tool categories: ${(goal.toolPermissions || []).join(", ")}
Available action types: skill, tool, search, file, ask_user, complete
${planContext}

## Execution History (last 10 steps)
${historyContext || "(no steps executed yet)"}
${userInputContext}

## Current State
- Steps completed: ${goal.stepCount}
- Tokens used: ${goal.tokensUsed}
- Token budget: ${this.config.tokenBudgetPerGoal}

## Instructions
Analyze the current state and decide the next action. Respond in JSON format:
{
  "thought": "your reasoning about what to do next",
  "complete": false,
  "action": {
    "type": "skill|tool|search|file|ask_user|complete",
    "name": "action name or skill name",
    "params": {}
  },
  "result": null
}

If the goal is fully achieved, set "complete": true and provide the final result in "result".
If you need clarification from the user, use action type "ask_user" with params: { "question": "your question", "options": ["option1", "option2"] }.

Respond ONLY with valid JSON.`;

    let response;
    let tokensUsed = 0;

    if (this.llmManager && typeof this.llmManager.query === "function") {
      try {
        const llmResult = await this.llmManager.query(prompt, {
          systemPrompt:
            "You are an autonomous agent executing a ReAct loop. Always respond with valid JSON.",
          maxTokens: 2000,
        });
        response = llmResult.text || llmResult.content || llmResult;
        tokensUsed =
          llmResult.tokensUsed ||
          llmResult.usage?.total_tokens ||
          this._estimateTokens(prompt + String(response));
      } catch (e) {
        logger.warn(
          `[AutonomousAgent] LLM query failed for goal ${goalId}:`,
          e.message,
        );
        // Fallback: try to execute plan steps sequentially
        return this._fallbackReason(goal);
      }
    } else {
      // No LLM available, use fallback reasoning
      return this._fallbackReason(goal);
    }

    // Parse LLM response
    try {
      const parsed = this._parseJSON(response);
      return {
        thought: parsed.thought || "No reasoning provided",
        action: parsed.action || { type: "complete", name: null, params: {} },
        complete: !!parsed.complete,
        result: parsed.result || null,
        tokensUsed,
      };
    } catch (e) {
      logger.warn(
        `[AutonomousAgent] Failed to parse LLM response for goal ${goalId}:`,
        e.message,
      );
      return {
        thought: `Failed to parse LLM response: ${String(response).substring(0, 200)}`,
        action: { type: "complete", name: null, params: {} },
        complete: true,
        result: `Could not parse reasoning. Raw response: ${String(response).substring(0, 500)}`,
        tokensUsed,
      };
    }
  }

  /**
   * Fallback reasoning when LLM is unavailable
   * @param {Object} goal
   * @returns {Object}
   * @private
   */
  _fallbackReason(goal) {
    const planSteps = goal.plan?.steps || [];
    const currentStepIndex = goal.stepCount;

    if (currentStepIndex >= planSteps.length) {
      return {
        thought: "All plan steps completed (fallback mode)",
        action: { type: "complete", name: null, params: {} },
        complete: true,
        result: `Completed ${goal.stepCount} steps in fallback mode`,
        tokensUsed: 0,
      };
    }

    const nextStep = planSteps[currentStepIndex];
    return {
      thought: `Executing plan step ${currentStepIndex + 1}: ${nextStep.description}`,
      action: {
        type: "skill",
        name: "execute-step",
        params: { description: nextStep.description },
      },
      complete: false,
      result: null,
      tokensUsed: 0,
    };
  }

  /**
   * ACT phase: Execute the planned action
   * @param {string} goalId
   * @param {Object} action - { type, name, params }
   * @returns {Object} { success, output, error }
   * @private
   */
  async _act(goalId, action) {
    const goal = this.activeGoals.get(goalId);
    if (!goal) {
      return { success: false, output: null, error: "Goal not found" };
    }

    const actionType = action?.type || "complete";
    const actionName = action?.name || "";
    const actionParams = action?.params || {};

    // Check tool permissions
    if (!this._checkPermission(goal, actionType)) {
      const msg = `Permission denied: action type "${actionType}" not allowed for this goal`;
      logger.warn(`[AutonomousAgent] ${msg} (goal: ${goalId})`);
      return { success: false, output: null, error: msg };
    }

    await this._logStep(
      goalId,
      "action",
      `Executing ${actionType}: ${actionName} with params: ${JSON.stringify(actionParams).substring(0, 300)}`,
    );

    // Set up timeout
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error("Step execution timed out")),
        this.config.stepTimeoutMs,
      );
    });

    try {
      let executionPromise;

      switch (actionType) {
        case ACTION_TYPES.SKILL:
          executionPromise = this._executeSkill(actionName, actionParams);
          break;

        case ACTION_TYPES.TOOL:
          executionPromise = this._executeTool(actionName, actionParams);
          break;

        case ACTION_TYPES.SEARCH:
          executionPromise = this._executeSearch(actionParams);
          break;

        case ACTION_TYPES.FILE:
          executionPromise = this._executeFileOp(actionName, actionParams);
          break;

        case ACTION_TYPES.ASK_USER:
          executionPromise = this._executeAskUser(
            goalId,
            actionParams.question,
            actionParams.options,
          );
          break;

        case ACTION_TYPES.COMPLETE:
          return {
            success: true,
            output: "Goal marked as complete by agent",
            error: null,
          };

        default:
          return {
            success: false,
            output: null,
            error: `Unknown action type: ${actionType}`,
          };
      }

      const result = await Promise.race([executionPromise, timeoutPromise]);
      return {
        success: result.success !== false,
        output: result.output || result.data || JSON.stringify(result),
        error: result.error || null,
      };
    } catch (error) {
      return {
        success: false,
        output: null,
        error: error.message,
      };
    }
  }

  /**
   * OBSERVE phase: Process results and update state
   * @param {string} goalId
   * @param {Object} reasoning - Reasoning result from _reason
   * @param {Object} actionResult - Result from _act
   * @param {number} stepStartTime - Step start timestamp
   * @private
   */
  async _observe(goalId, reasoning, actionResult, stepStartTime) {
    const goal = this.activeGoals.get(goalId);
    if (!goal) {
      return;
    }

    const durationMs = Date.now() - stepStartTime;
    const stepId = uuidv4();
    const stepNumber = goal.stepCount + 1;

    const stepRecord = {
      id: stepId,
      goalId,
      stepNumber,
      phase: "react",
      thought: reasoning.thought,
      actionType: reasoning.action?.type || "unknown",
      actionParams: reasoning.action?.params || {},
      result: actionResult.success
        ? String(actionResult.output || "").substring(0, 2000)
        : `ERROR: ${actionResult.error || "unknown error"}`,
      success: !!actionResult.success,
      tokensUsed: reasoning.tokensUsed || 0,
      durationMs,
    };

    // Add to in-memory history
    goal.stepHistory.push(stepRecord);

    // Persist step to DB
    this._saveStepToDB(stepRecord);

    // Log the observation
    const logContent = `Step ${stepNumber}: [${reasoning.action?.type}] ${actionResult.success ? "SUCCESS" : "FAILED"} (${durationMs}ms)`;
    await this._logStep(goalId, "observe", logContent);

    // Update goal in DB
    this._updateGoalInDB(goalId, {
      step_count: stepNumber,
      tokens_used: goal.tokensUsed + (reasoning.tokensUsed || 0),
      updated_at: new Date().toISOString(),
    });
  }

  // ============================================================
  // Goal Decomposition
  // ============================================================

  /**
   * Decompose a goal into sub-steps using LLM
   * @param {string} description - Goal description
   * @param {Object} context - Additional context
   * @returns {Object} { steps: [{ description, estimatedComplexity }], strategy }
   * @private
   */
  async _decomposeGoal(description, context) {
    const contextStr =
      context && Object.keys(context).length > 0
        ? `\nContext: ${JSON.stringify(context)}`
        : "";

    const prompt = `Break down the following goal into concrete steps.

Goal: ${description}${contextStr}

Respond in JSON format:
{
  "steps": [
    { "description": "step description", "estimatedComplexity": "low|medium|high" }
  ],
  "strategy": "brief strategy description"
}

Keep it practical (3-10 steps). Respond ONLY with valid JSON.`;

    if (this.llmManager && typeof this.llmManager.query === "function") {
      try {
        const result = await this.llmManager.query(prompt, {
          systemPrompt:
            "You are a task planning assistant. Respond only with valid JSON.",
          maxTokens: 1500,
        });
        const text = result.text || result.content || result;
        const parsed = this._parseJSON(text);
        return {
          steps: Array.isArray(parsed.steps) ? parsed.steps : [],
          strategy: parsed.strategy || "sequential-execution",
        };
      } catch (e) {
        logger.warn(
          "[AutonomousAgent] Goal decomposition LLM error:",
          e.message,
        );
      }
    }

    // Fallback: single step
    return {
      steps: [{ description, estimatedComplexity: "medium" }],
      strategy: "direct-execution",
    };
  }

  // ============================================================
  // Self-Correction
  // ============================================================

  /**
   * Attempt to replan after a failure
   * @param {string} goalId
   * @param {Error} error
   * @returns {boolean} Whether recovery was successful
   * @private
   */
  async _replanOnFailure(goalId, error) {
    const goal = this.activeGoals.get(goalId);
    if (!goal) {
      return false;
    }

    goal.replanAttempts++;

    if (goal.replanAttempts > this.config.maxReplanAttempts) {
      logger.warn(
        `[AutonomousAgent] Max replan attempts reached for goal ${goalId}`,
      );
      return false;
    }

    logger.info(
      `[AutonomousAgent] Attempting replan for goal ${goalId} (attempt ${goal.replanAttempts}/${this.config.maxReplanAttempts})`,
    );

    const errorContext = goal.stepHistory
      .slice(-3)
      .map((s) => `Step ${s.stepNumber}: ${s.result}`)
      .join("\n");

    const prompt = `The following error occurred during autonomous goal execution:

Goal: ${goal.description}
Error: ${error.message}
Recent steps:
${errorContext}

Suggest an alternative approach. Respond in JSON:
{
  "recoverable": true,
  "alternativeSteps": [
    { "description": "alternative step", "estimatedComplexity": "low|medium|high" }
  ],
  "strategy": "brief explanation of the new approach"
}

If the error is unrecoverable, set "recoverable": false.
Respond ONLY with valid JSON.`;

    if (this.llmManager && typeof this.llmManager.query === "function") {
      try {
        const result = await this.llmManager.query(prompt, {
          systemPrompt:
            "You are an error recovery assistant. Respond only with valid JSON.",
          maxTokens: 1000,
        });
        const text = result.text || result.content || result;
        const parsed = this._parseJSON(text);

        if (parsed.recoverable === false) {
          return false;
        }

        // Update plan with alternative steps
        if (parsed.alternativeSteps && parsed.alternativeSteps.length > 0) {
          goal.plan = {
            steps: parsed.alternativeSteps,
            strategy: parsed.strategy || "recovery-plan",
          };
          await this._logStep(
            goalId,
            "replan",
            `Replanned with ${parsed.alternativeSteps.length} alternative steps: ${parsed.strategy || "recovery"}`,
          );
          return true;
        }
      } catch (e) {
        logger.warn(
          `[AutonomousAgent] Replan LLM error for goal ${goalId}:`,
          e.message,
        );
      }
    }

    // Fallback: simple retry if under limit
    if (goal.replanAttempts <= 1) {
      await this._logStep(
        goalId,
        "replan",
        `Simple retry after error: ${error.message}`,
      );
      return true;
    }

    return false;
  }

  // ============================================================
  // Goal Control
  // ============================================================

  /**
   * Pause a running goal
   * @param {string} goalId
   */
  async pauseGoal(goalId) {
    const goal = this.activeGoals.get(goalId);
    if (!goal) {
      return { success: false, error: "Goal not found" };
    }
    if (goal.status !== GOAL_STATUS.RUNNING) {
      return {
        success: false,
        error: `Cannot pause goal in status: ${goal.status}`,
      };
    }

    goal.paused = true;
    goal.status = GOAL_STATUS.PAUSED;

    this._updateGoalInDB(goalId, {
      status: GOAL_STATUS.PAUSED,
      updated_at: new Date().toISOString(),
    });

    await this._logStep(goalId, "paused", "Goal paused by user");
    this.emit("goal-paused", { goalId });

    logger.info(`[AutonomousAgent] Goal ${goalId} paused`);
    return { success: true, data: { goalId, status: GOAL_STATUS.PAUSED } };
  }

  /**
   * Resume a paused goal
   * @param {string} goalId
   */
  async resumeGoal(goalId) {
    const goal = this.activeGoals.get(goalId);
    if (!goal) {
      return { success: false, error: "Goal not found" };
    }
    if (goal.status !== GOAL_STATUS.PAUSED) {
      return {
        success: false,
        error: `Cannot resume goal in status: ${goal.status}`,
      };
    }

    goal.paused = false;
    goal.status = GOAL_STATUS.RUNNING;

    this._updateGoalInDB(goalId, {
      status: GOAL_STATUS.RUNNING,
      updated_at: new Date().toISOString(),
    });

    // Resolve the pause promise to resume the loop
    if (goal._resumeResolve) {
      goal._resumeResolve();
      goal._resumeResolve = null;
    }

    await this._logStep(goalId, "resumed", "Goal resumed by user");
    this.emit("goal-resumed", { goalId });

    logger.info(`[AutonomousAgent] Goal ${goalId} resumed`);
    return { success: true, data: { goalId, status: GOAL_STATUS.RUNNING } };
  }

  /**
   * Cancel a goal
   * @param {string} goalId
   */
  async cancelGoal(goalId) {
    const goal = this.activeGoals.get(goalId);
    if (!goal) {
      return { success: false, error: "Goal not found" };
    }

    const previousStatus = goal.status;
    goal.status = GOAL_STATUS.CANCELLED;

    // Abort any in-flight operations
    if (goal._abortController) {
      goal._abortController.abort();
    }

    // Resolve any pending promises to unblock the loop
    if (goal._resumeResolve) {
      goal._resumeResolve();
    }
    if (goal._inputResolve) {
      goal._inputResolve(null);
    }

    this._updateGoalInDB(goalId, {
      status: GOAL_STATUS.CANCELLED,
      updated_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    });

    await this._logStep(
      goalId,
      "cancelled",
      `Goal cancelled (was: ${previousStatus})`,
    );

    this.activeGoals.delete(goalId);
    this.emit("goal-cancelled", { goalId });

    logger.info(`[AutonomousAgent] Goal ${goalId} cancelled`);
    return { success: true, data: { goalId, status: GOAL_STATUS.CANCELLED } };
  }

  /**
   * Request input from the user during goal execution
   * @param {string} goalId
   * @param {string} question
   * @param {Array} options
   */
  async requestUserInput(goalId, question, options) {
    const goal = this.activeGoals.get(goalId);
    if (!goal) {
      return;
    }

    goal.waitingForInput = true;
    goal.status = GOAL_STATUS.WAITING_INPUT;
    goal.inputRequest = {
      question,
      options: options || [],
      requestedAt: Date.now(),
    };

    this._updateGoalInDB(goalId, {
      status: GOAL_STATUS.WAITING_INPUT,
      updated_at: new Date().toISOString(),
    });

    await this._logStep(goalId, "input-requested", `Question: ${question}`);
    this.emit("input-requested", { goalId, question, options });

    logger.info(
      `[AutonomousAgent] Goal ${goalId} requesting user input: "${question}"`,
    );
  }

  /**
   * Provide user input to a waiting goal
   * @param {string} goalId
   * @param {string} input
   */
  async provideUserInput(goalId, input) {
    const goal = this.activeGoals.get(goalId);
    if (!goal) {
      return { success: false, error: "Goal not found" };
    }
    if (!goal.waitingForInput) {
      return { success: false, error: "Goal is not waiting for input" };
    }

    goal.waitingForInput = false;
    goal.status = GOAL_STATUS.RUNNING;
    goal.lastUserInput = input;
    goal.inputRequest = null;

    this._updateGoalInDB(goalId, {
      status: GOAL_STATUS.RUNNING,
      updated_at: new Date().toISOString(),
    });

    await this._logStep(goalId, "input-provided", `User input: ${input}`);

    // Resolve the input promise to resume the loop
    if (goal._inputResolve) {
      goal._inputResolve(input);
      goal._inputResolve = null;
    }

    this.emit("input-provided", { goalId, input });

    logger.info(`[AutonomousAgent] Goal ${goalId} received user input`);
    return { success: true, data: { goalId, status: GOAL_STATUS.RUNNING } };
  }

  // ============================================================
  // Status & History
  // ============================================================

  /**
   * Get current status of a goal
   * @param {string} goalId
   * @returns {Object}
   */
  async getGoalStatus(goalId) {
    // Check active goals first
    const active = this.activeGoals.get(goalId);
    if (active) {
      return {
        success: true,
        data: {
          id: active.id,
          description: active.description,
          priority: active.priority,
          status: active.status,
          stepCount: active.stepCount,
          tokensUsed: active.tokensUsed,
          plan: active.plan,
          result: active.result,
          paused: active.paused,
          waitingForInput: active.waitingForInput,
          inputRequest: active.inputRequest,
          replanAttempts: active.replanAttempts,
          createdAt: active.createdAt,
        },
      };
    }

    // Fall back to DB
    if (this.database) {
      try {
        const row = this.database
          .prepare("SELECT * FROM autonomous_goals WHERE id = ?")
          .get(goalId);
        if (row) {
          return { success: true, data: this._rowToGoal(row) };
        }
      } catch (e) {
        logger.error(
          `[AutonomousAgent] getGoalStatus DB error for ${goalId}:`,
          e.message,
        );
      }
    }

    return { success: false, error: "Goal not found" };
  }

  /**
   * Get all currently active goals
   * @returns {Object}
   */
  async getActiveGoals() {
    const goals = [];
    for (const [, goal] of this.activeGoals) {
      goals.push({
        id: goal.id,
        description: goal.description,
        priority: goal.priority,
        status: goal.status,
        stepCount: goal.stepCount,
        tokensUsed: goal.tokensUsed,
        paused: goal.paused,
        waitingForInput: goal.waitingForInput,
        inputRequest: goal.inputRequest,
        createdAt: goal.createdAt,
      });
    }

    return { success: true, data: goals };
  }

  /**
   * Get goal history from database
   * @param {number} limit
   * @param {number} offset
   * @returns {Object}
   */
  async getGoalHistory(limit = 50, offset = 0) {
    if (!this.database) {
      return { success: true, data: [] };
    }

    try {
      const rows = this.database
        .prepare(
          "SELECT * FROM autonomous_goals ORDER BY created_at DESC LIMIT ? OFFSET ?",
        )
        .all(limit, offset);

      const total = this.database
        .prepare("SELECT COUNT(*) as count FROM autonomous_goals")
        .get().count;

      return {
        success: true,
        data: {
          goals: rows.map(this._rowToGoal),
          total,
          limit,
          offset,
        },
      };
    } catch (e) {
      logger.error("[AutonomousAgent] getGoalHistory error:", e.message);
      return { success: false, error: e.message };
    }
  }

  /**
   * Get steps for a specific goal
   * @param {string} goalId
   * @returns {Object}
   */
  async getGoalSteps(goalId) {
    // Check in-memory first
    const active = this.activeGoals.get(goalId);
    if (active) {
      return { success: true, data: active.stepHistory };
    }

    // Fall back to DB
    if (!this.database) {
      return { success: true, data: [] };
    }

    try {
      const rows = this.database
        .prepare(
          "SELECT * FROM autonomous_goal_steps WHERE goal_id = ? ORDER BY step_number ASC",
        )
        .all(goalId);

      return {
        success: true,
        data: rows.map((row) => ({
          id: row.id,
          goalId: row.goal_id,
          stepNumber: row.step_number,
          phase: row.phase,
          thought: row.thought,
          actionType: row.action_type,
          actionParams: safeParseJSON(row.action_params),
          result: row.result,
          success: !!row.success,
          tokensUsed: row.tokens_used,
          durationMs: row.duration_ms,
          createdAt: row.created_at,
        })),
      };
    } catch (e) {
      logger.error("[AutonomousAgent] getGoalSteps error:", e.message);
      return { success: false, error: e.message };
    }
  }

  /**
   * Get logs for a goal
   * @param {string} goalId
   * @param {number} limit
   * @returns {Object}
   */
  async getGoalLogs(goalId, limit = 100) {
    if (!this.database) {
      return { success: true, data: [] };
    }

    try {
      const rows = this.database
        .prepare(
          "SELECT * FROM autonomous_goal_logs WHERE goal_id = ? ORDER BY created_at DESC LIMIT ?",
        )
        .all(goalId, limit);

      return {
        success: true,
        data: rows.map((row) => ({
          id: row.id,
          goalId: row.goal_id,
          level: row.level,
          type: row.type,
          content: row.content,
          createdAt: row.created_at,
        })),
      };
    } catch (e) {
      logger.error("[AutonomousAgent] getGoalLogs error:", e.message);
      return { success: false, error: e.message };
    }
  }

  // ============================================================
  // Configuration
  // ============================================================

  /**
   * Update runner configuration
   * @param {Object} config
   */
  updateConfig(config) {
    if (config.maxStepsPerGoal !== undefined) {
      this.config.maxStepsPerGoal = Math.max(
        1,
        Math.min(500, config.maxStepsPerGoal),
      );
    }
    if (config.stepTimeoutMs !== undefined) {
      this.config.stepTimeoutMs = Math.max(
        5000,
        Math.min(600000, config.stepTimeoutMs),
      );
    }
    if (config.maxConcurrentGoals !== undefined) {
      this.config.maxConcurrentGoals = Math.max(
        1,
        Math.min(10, config.maxConcurrentGoals),
      );
    }
    if (config.tokenBudgetPerGoal !== undefined) {
      this.config.tokenBudgetPerGoal = Math.max(
        1000,
        Math.min(500000, config.tokenBudgetPerGoal),
      );
    }
    if (config.evaluationIntervalMs !== undefined) {
      this.config.evaluationIntervalMs = Math.max(
        100,
        Math.min(10000, config.evaluationIntervalMs),
      );
    }
    if (config.maxRetriesPerStep !== undefined) {
      this.config.maxRetriesPerStep = Math.max(
        0,
        Math.min(10, config.maxRetriesPerStep),
      );
    }
    if (config.maxReplanAttempts !== undefined) {
      this.config.maxReplanAttempts = Math.max(
        0,
        Math.min(10, config.maxReplanAttempts),
      );
    }

    logger.info("[AutonomousAgent] Config updated:", this.config);
    return { success: true, data: { ...this.config } };
  }

  /**
   * Get current configuration
   * @returns {Object}
   */
  getConfig() {
    return { success: true, data: { ...this.config } };
  }

  /**
   * Get aggregate statistics
   * @returns {Object}
   */
  async getStats() {
    const stats = {
      activeGoals: this.activeGoals.size,
      runningGoals: 0,
      pausedGoals: 0,
      totalGoals: 0,
      completedGoals: 0,
      failedGoals: 0,
      cancelledGoals: 0,
      totalSteps: 0,
      totalTokensUsed: 0,
      avgStepsPerGoal: 0,
      successRate: 0,
    };

    // Count active goal statuses
    for (const [, goal] of this.activeGoals) {
      if (goal.status === GOAL_STATUS.RUNNING) {
        stats.runningGoals++;
      }
      if (goal.status === GOAL_STATUS.PAUSED) {
        stats.pausedGoals++;
      }
    }

    // Query DB for historical stats
    if (this.database) {
      try {
        const totalRow = this.database
          .prepare("SELECT COUNT(*) as count FROM autonomous_goals")
          .get();
        stats.totalGoals = totalRow?.count || 0;

        const completedRow = this.database
          .prepare(
            "SELECT COUNT(*) as count FROM autonomous_goals WHERE status = ?",
          )
          .get(GOAL_STATUS.COMPLETED);
        stats.completedGoals = completedRow?.count || 0;

        const failedRow = this.database
          .prepare(
            "SELECT COUNT(*) as count FROM autonomous_goals WHERE status = ?",
          )
          .get(GOAL_STATUS.FAILED);
        stats.failedGoals = failedRow?.count || 0;

        const cancelledRow = this.database
          .prepare(
            "SELECT COUNT(*) as count FROM autonomous_goals WHERE status = ?",
          )
          .get(GOAL_STATUS.CANCELLED);
        stats.cancelledGoals = cancelledRow?.count || 0;

        const stepsRow = this.database
          .prepare("SELECT COUNT(*) as count FROM autonomous_goal_steps")
          .get();
        stats.totalSteps = stepsRow?.count || 0;

        const tokensRow = this.database
          .prepare(
            "SELECT COALESCE(SUM(tokens_used), 0) as total FROM autonomous_goals",
          )
          .get();
        stats.totalTokensUsed = tokensRow?.total || 0;

        if (stats.totalGoals > 0) {
          stats.avgStepsPerGoal = Math.round(
            stats.totalSteps / stats.totalGoals,
          );
          const finishedGoals = stats.completedGoals + stats.failedGoals;
          stats.successRate =
            finishedGoals > 0
              ? Math.round((stats.completedGoals / finishedGoals) * 100)
              : 0;
        }
      } catch (e) {
        logger.error("[AutonomousAgent] getStats DB error:", e.message);
      }
    }

    return { success: true, data: stats };
  }

  /**
   * Clear history records before a given date
   * @param {string} before - ISO date string
   * @returns {Object}
   */
  async clearHistory(before) {
    if (!this.database) {
      return { success: false, error: "Database not available" };
    }

    try {
      const cutoff =
        before || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

      // Delete logs first (foreign key)
      const logsResult = this.database.run(
        "DELETE FROM autonomous_goal_logs WHERE goal_id IN (SELECT id FROM autonomous_goals WHERE created_at < ? AND status IN (?, ?, ?))",
        [
          cutoff,
          GOAL_STATUS.COMPLETED,
          GOAL_STATUS.FAILED,
          GOAL_STATUS.CANCELLED,
        ],
      );

      // Delete steps
      const stepsResult = this.database.run(
        "DELETE FROM autonomous_goal_steps WHERE goal_id IN (SELECT id FROM autonomous_goals WHERE created_at < ? AND status IN (?, ?, ?))",
        [
          cutoff,
          GOAL_STATUS.COMPLETED,
          GOAL_STATUS.FAILED,
          GOAL_STATUS.CANCELLED,
        ],
      );

      // Delete goals
      const goalsResult = this.database.run(
        "DELETE FROM autonomous_goals WHERE created_at < ? AND status IN (?, ?, ?)",
        [
          cutoff,
          GOAL_STATUS.COMPLETED,
          GOAL_STATUS.FAILED,
          GOAL_STATUS.CANCELLED,
        ],
      );

      if (this.database.saveToFile) {
        this.database.saveToFile();
      }

      const deleted = goalsResult?.changes || 0;
      logger.info(
        `[AutonomousAgent] Cleared ${deleted} historical goals before ${cutoff}`,
      );

      return {
        success: true,
        data: { deletedGoals: deleted, cutoff },
      };
    } catch (e) {
      logger.error("[AutonomousAgent] clearHistory error:", e.message);
      return { success: false, error: e.message };
    }
  }

  /**
   * Export a goal with all its steps and logs as JSON
   * @param {string} goalId
   * @returns {Object}
   */
  async exportGoal(goalId) {
    if (!this.database) {
      return { success: false, error: "Database not available" };
    }

    try {
      const goalRow = this.database
        .prepare("SELECT * FROM autonomous_goals WHERE id = ?")
        .get(goalId);

      if (!goalRow) {
        return { success: false, error: "Goal not found" };
      }

      const steps = this.database
        .prepare(
          "SELECT * FROM autonomous_goal_steps WHERE goal_id = ? ORDER BY step_number ASC",
        )
        .all(goalId);

      const logs = this.database
        .prepare(
          "SELECT * FROM autonomous_goal_logs WHERE goal_id = ? ORDER BY created_at ASC",
        )
        .all(goalId);

      const exportData = {
        goal: this._rowToGoal(goalRow),
        steps: steps.map((row) => ({
          id: row.id,
          stepNumber: row.step_number,
          phase: row.phase,
          thought: row.thought,
          actionType: row.action_type,
          actionParams: safeParseJSON(row.action_params),
          result: row.result,
          success: !!row.success,
          tokensUsed: row.tokens_used,
          durationMs: row.duration_ms,
          createdAt: row.created_at,
        })),
        logs: logs.map((row) => ({
          level: row.level,
          type: row.type,
          content: row.content,
          createdAt: row.created_at,
        })),
        exportedAt: new Date().toISOString(),
      };

      return { success: true, data: exportData };
    } catch (e) {
      logger.error("[AutonomousAgent] exportGoal error:", e.message);
      return { success: false, error: e.message };
    }
  }

  /**
   * Retry a failed goal by resubmitting it
   * @param {string} goalId
   * @returns {Object}
   */
  async retryGoal(goalId) {
    if (!this.database) {
      return { success: false, error: "Database not available" };
    }

    try {
      const goalRow = this.database
        .prepare("SELECT * FROM autonomous_goals WHERE id = ?")
        .get(goalId);

      if (!goalRow) {
        return { success: false, error: "Goal not found" };
      }

      if (
        goalRow.status !== GOAL_STATUS.FAILED &&
        goalRow.status !== GOAL_STATUS.CANCELLED
      ) {
        return {
          success: false,
          error: `Cannot retry goal in status: ${goalRow.status}`,
        };
      }

      // Resubmit as a new goal
      return await this.submitGoal({
        description: goalRow.description,
        priority: goalRow.priority,
        toolPermissions: safeParseJSON(goalRow.tool_permissions),
        context: {
          ...safeParseJSON(goalRow.context),
          retryOf: goalId,
        },
        createdBy: goalRow.created_by || "user",
      });
    } catch (e) {
      logger.error("[AutonomousAgent] retryGoal error:", e.message);
      return { success: false, error: e.message };
    }
  }

  // ============================================================
  // Action Executors
  // ============================================================

  /**
   * Execute a skill action
   * @private
   */
  async _executeSkill(skillName, params) {
    if (
      this.skillExecutor &&
      typeof this.skillExecutor.execute === "function"
    ) {
      try {
        const result = await this.skillExecutor.execute(skillName, params);
        return {
          success: true,
          output: typeof result === "string" ? result : JSON.stringify(result),
        };
      } catch (e) {
        return { success: false, error: `Skill execution error: ${e.message}` };
      }
    }
    return {
      success: false,
      error: `Skill executor not available for skill: ${skillName}`,
    };
  }

  /**
   * Execute a tool action
   * @private
   */
  async _executeTool(toolName, params) {
    if (this.toolRegistry) {
      try {
        const tool = this.toolRegistry.tools?.get?.(toolName);
        if (tool && typeof tool.execute === "function") {
          const result = await tool.execute(params);
          return {
            success: true,
            output:
              typeof result === "string" ? result : JSON.stringify(result),
          };
        }
      } catch (e) {
        return { success: false, error: `Tool execution error: ${e.message}` };
      }
    }
    return {
      success: false,
      error: `Tool not found or registry not available: ${toolName}`,
    };
  }

  /**
   * Execute a search action
   * @private
   */
  async _executeSearch(params) {
    const query = params.query || params.description || "";
    if (!query) {
      return { success: false, error: "No search query provided" };
    }

    // Try RAG search if available
    if (this.toolRegistry) {
      try {
        const searchTool = this.toolRegistry.tools?.get?.("search");
        if (searchTool && typeof searchTool.execute === "function") {
          const result = await searchTool.execute({ query });
          return {
            success: true,
            output:
              typeof result === "string" ? result : JSON.stringify(result),
          };
        }
      } catch (e) {
        return { success: false, error: `Search error: ${e.message}` };
      }
    }

    return {
      success: true,
      output: `Search for "${query}" completed (no search backend available)`,
    };
  }

  /**
   * Execute a file operation
   * @private
   */
  async _executeFileOp(operation, params) {
    const filePath = params.path || params.filePath || "";
    if (!filePath) {
      return { success: false, error: "No file path provided" };
    }

    if (this.toolRegistry) {
      try {
        const toolName = operation === "read" ? "file_reader" : "file_writer";
        const tool = this.toolRegistry.tools?.get?.(toolName);
        if (tool && typeof tool.execute === "function") {
          const result = await tool.execute(params);
          return {
            success: true,
            output:
              typeof result === "string" ? result : JSON.stringify(result),
          };
        }
      } catch (e) {
        return { success: false, error: `File operation error: ${e.message}` };
      }
    }

    return {
      success: false,
      error: `File operation "${operation}" not available`,
    };
  }

  /**
   * Execute an ask_user action (requests input and waits)
   * @private
   */
  async _executeAskUser(goalId, question, options) {
    await this.requestUserInput(
      goalId,
      question || "Please provide input",
      options,
    );

    // The loop will pause at _waitForInput, then continue after provideUserInput
    return {
      success: true,
      output: "Input request sent to user",
    };
  }

  // ============================================================
  // Internal Helpers
  // ============================================================

  /**
   * Check if an action type is permitted for a goal
   * @private
   */
  _checkPermission(goal, actionType) {
    const permissions = goal.toolPermissions || [];

    // ask_user and complete are always allowed
    if (
      actionType === ACTION_TYPES.ASK_USER ||
      actionType === ACTION_TYPES.COMPLETE
    ) {
      return true;
    }

    // Map action types to permission categories
    const permMap = {
      [ACTION_TYPES.SKILL]: "skills",
      [ACTION_TYPES.TOOL]: "skills",
      [ACTION_TYPES.SEARCH]: "skills",
      [ACTION_TYPES.FILE]: "file-ops",
    };

    const requiredPermission = permMap[actionType];
    if (!requiredPermission) {
      return true; // Unknown types are allowed by default
    }

    return permissions.includes(requiredPermission);
  }

  /**
   * Wait for goal to be resumed
   * @private
   */
  _waitForResume(goalId) {
    return new Promise((resolve) => {
      const goal = this.activeGoals.get(goalId);
      if (goal) {
        goal._resumeResolve = resolve;
      } else {
        resolve();
      }
    });
  }

  /**
   * Wait for user input
   * @private
   */
  _waitForInput(goalId) {
    return new Promise((resolve) => {
      const goal = this.activeGoals.get(goalId);
      if (goal) {
        goal._inputResolve = resolve;
      } else {
        resolve();
      }
    });
  }

  /**
   * Checkpoint goal state to DB for recovery
   * @private
   */
  async _checkpoint(goalId) {
    const goal = this.activeGoals.get(goalId);
    if (!goal || !this.database) {
      return;
    }

    try {
      this._updateGoalInDB(goalId, {
        step_count: goal.stepCount,
        tokens_used: goal.tokensUsed,
        plan: JSON.stringify(goal.plan || {}),
        updated_at: new Date().toISOString(),
      });
    } catch (e) {
      logger.warn(
        `[AutonomousAgent] Checkpoint error for goal ${goalId}:`,
        e.message,
      );
    }
  }

  /**
   * Mark a goal as completed
   * @private
   */
  async _completeGoal(goalId, result) {
    const goal = this.activeGoals.get(goalId);
    if (!goal) {
      return;
    }

    goal.status = GOAL_STATUS.COMPLETED;
    goal.result = result;

    const completedAt = new Date().toISOString();

    this._updateGoalInDB(goalId, {
      status: GOAL_STATUS.COMPLETED,
      result: typeof result === "string" ? result : JSON.stringify(result),
      step_count: goal.stepCount,
      tokens_used: goal.tokensUsed,
      updated_at: completedAt,
      completed_at: completedAt,
    });

    await this._logStep(
      goalId,
      "completed",
      `Goal completed after ${goal.stepCount} steps. Result: ${String(result).substring(0, 500)}`,
    );

    this.activeGoals.delete(goalId);

    this.emit("goal-completed", {
      goalId,
      result,
      stepCount: goal.stepCount,
      tokensUsed: goal.tokensUsed,
    });

    logger.info(
      `[AutonomousAgent] Goal ${goalId} completed (${goal.stepCount} steps, ${goal.tokensUsed} tokens)`,
    );
  }

  /**
   * Mark a goal as failed
   * @private
   */
  async _failGoal(goalId, reason) {
    const goal = this.activeGoals.get(goalId);
    if (!goal) {
      return;
    }

    goal.status = GOAL_STATUS.FAILED;

    const failedAt = new Date().toISOString();

    this._updateGoalInDB(goalId, {
      status: GOAL_STATUS.FAILED,
      error_message: reason,
      step_count: goal.stepCount,
      tokens_used: goal.tokensUsed,
      updated_at: failedAt,
      completed_at: failedAt,
    });

    await this._logStep(goalId, "failed", `Goal failed: ${reason}`);

    this.activeGoals.delete(goalId);

    this.emit("goal-failed", {
      goalId,
      error: reason,
      stepCount: goal.stepCount,
    });

    logger.error(
      `[AutonomousAgent] Goal ${goalId} failed: ${reason} (${goal.stepCount} steps)`,
    );
  }

  /**
   * Log a step event to the database
   * @private
   */
  async _logStep(goalId, type, content) {
    if (!this.database) {
      return;
    }

    try {
      this.database.run(
        "INSERT INTO autonomous_goal_logs (goal_id, level, type, content) VALUES (?, ?, ?, ?)",
        [goalId, "info", type, content],
      );
    } catch (e) {
      // Silently ignore log errors to avoid breaking the main flow
    }
  }

  // ============================================================
  // Database Persistence
  // ============================================================

  /**
   * Save goal to database
   * @private
   */
  _saveGoalToDB(goalState) {
    if (!this.database) {
      return;
    }

    try {
      this.database.run(
        `INSERT INTO autonomous_goals (id, description, priority, status, tool_permissions, context, plan, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          goalState.id,
          goalState.description,
          goalState.priority,
          goalState.status,
          JSON.stringify(goalState.toolPermissions || []),
          JSON.stringify(goalState.context || {}),
          JSON.stringify(goalState.plan || {}),
          goalState.createdBy,
          goalState.createdAt,
          goalState.createdAt,
        ],
      );
      if (this.database.saveToFile) {
        this.database.saveToFile();
      }
    } catch (e) {
      logger.error("[AutonomousAgent] Save goal error:", e.message);
    }
  }

  /**
   * Update goal fields in database
   * @private
   */
  _updateGoalInDB(goalId, fields) {
    if (!this.database) {
      return;
    }

    try {
      const setClauses = [];
      const values = [];

      for (const [key, value] of Object.entries(fields)) {
        setClauses.push(`${key} = ?`);
        values.push(value);
      }

      values.push(goalId);

      this.database.run(
        `UPDATE autonomous_goals SET ${setClauses.join(", ")} WHERE id = ?`,
        values,
      );
      if (this.database.saveToFile) {
        this.database.saveToFile();
      }
    } catch (e) {
      logger.error("[AutonomousAgent] Update goal error:", e.message);
    }
  }

  /**
   * Save a step record to database
   * @private
   */
  _saveStepToDB(step) {
    if (!this.database) {
      return;
    }

    try {
      this.database.run(
        `INSERT INTO autonomous_goal_steps (id, goal_id, step_number, phase, thought, action_type, action_params, result, success, tokens_used, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          step.id,
          step.goalId,
          step.stepNumber,
          step.phase,
          step.thought,
          step.actionType,
          JSON.stringify(step.actionParams || {}),
          step.result,
          step.success ? 1 : 0,
          step.tokensUsed || 0,
          step.durationMs || 0,
        ],
      );
    } catch (e) {
      logger.error("[AutonomousAgent] Save step error:", e.message);
    }
  }

  /**
   * Convert a DB row to goal object
   * @private
   */
  _rowToGoal(row) {
    return {
      id: row.id,
      description: row.description,
      priority: row.priority,
      status: row.status,
      toolPermissions: safeParseJSON(row.tool_permissions),
      context: safeParseJSON(row.context),
      plan: safeParseJSON(row.plan),
      result: row.result,
      stepCount: row.step_count,
      tokensUsed: row.tokens_used,
      errorMessage: row.error_message,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
    };
  }

  // ============================================================
  // Utility
  // ============================================================

  /**
   * Parse JSON safely, extracting from potential markdown
   * @private
   */
  _parseJSON(text) {
    if (!text) {
      throw new Error("Empty response");
    }

    const str = typeof text === "string" ? text : String(text);

    // Try direct parse first
    try {
      return JSON.parse(str);
    } catch {
      // Try extracting JSON from markdown code block
      const codeBlockMatch = str.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
      if (codeBlockMatch) {
        return JSON.parse(codeBlockMatch[1].trim());
      }

      // Try finding JSON object in text
      const jsonMatch = str.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }

      throw new Error("No valid JSON found in response");
    }
  }

  /**
   * Estimate token count from text
   * @private
   */
  _estimateTokens(text) {
    if (!text) {
      return 0;
    }
    return Math.ceil(String(text).length / 4);
  }

  /**
   * Sleep helper
   * @private
   */
  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================
// Utility Functions
// ============================================================

function safeParseJSON(str) {
  if (!str) {
    return {};
  }
  if (typeof str === "object") {
    return str;
  }
  try {
    return JSON.parse(str);
  } catch {
    return {};
  }
}

// Singleton
let instance = null;

function getAutonomousAgentRunner() {
  if (!instance) {
    instance = new AutonomousAgentRunner();
  }
  return instance;
}

/**
 * Add delegateToSubAgent to the prototype.
 * Used when a goal step requires a different role (e.g. code-review in a coding goal).
 *
 * @param {string} goalId - Parent goal ID
 * @param {object} delegation - { role, task, allowedTools?, inheritedContext? }
 * @returns {Promise<{ success: boolean, summary: string }>}
 */
AutonomousAgentRunner.prototype.delegateToSubAgent = async function (
  goalId,
  delegation,
) {
  const goal = this.activeGoals.get(goalId);
  if (!goal) {
    return { success: false, summary: `Goal ${goalId} not found` };
  }

  const subCtx = new SubAgentContext({
    role: delegation.role || "delegated",
    task: delegation.task || "",
    parentId: goalId,
    inheritedContext: delegation.inheritedContext || null,
    allowedTools: delegation.allowedTools || null,
    tokenBudget: delegation.tokenBudget || null,
    database: this.db || null,
    llmManager: this.llmManager || null,
  });

  // Track sub-agent in goal's sub-agent list
  if (!goal.subAgents) {
    goal.subAgents = [];
  }
  goal.subAgents.push({
    id: subCtx.id,
    role: delegation.role || "delegated",
    status: "active",
    createdAt: subCtx.createdAt,
  });

  logger.info(
    `[AutonomousAgent] Goal ${goalId} delegating to sub-agent ${subCtx.id} [${delegation.role}]`,
  );
  this.emit("goal:delegated", {
    goalId,
    subAgentId: subCtx.id,
    role: delegation.role,
  });

  try {
    const result = await subCtx.run(delegation.task);
    // Update tracker
    const tracker = goal.subAgents.find((s) => s.id === subCtx.id);
    if (tracker) {
      tracker.status = "completed";
      tracker.completedAt = subCtx.completedAt;
      tracker.summary = result.summary;
    }
    return { success: true, summary: result.summary };
  } catch (err) {
    subCtx.forceComplete(err.message);
    const tracker = goal.subAgents.find((s) => s.id === subCtx.id);
    if (tracker) {
      tracker.status = "failed";
      tracker.error = err.message;
    }
    return { success: false, summary: `Delegation failed: ${err.message}` };
  }
};

module.exports = {
  AutonomousAgentRunner,
  getAutonomousAgentRunner,
  GOAL_STATUS,
  ACTION_TYPES,
  DEFAULT_CONFIG,
};

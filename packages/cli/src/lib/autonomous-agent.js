/**
 * CLI Autonomous Agent — ReAct-style self-directed task execution.
 *
 * Submits a goal → decomposes into sub-steps → runs Reason→Act→Observe loop
 * with self-correction on failure. Single-goal, session-scoped.
 *
 * Lightweight port of desktop-app-vue/src/main/ai-engine/autonomous/autonomous-agent-runner.js
 */

import { EventEmitter } from "events";

// Exported for test injection
export const _deps = {
  Date,
};

/**
 * Goal status
 */
export const GoalStatus = {
  PENDING: "pending",
  RUNNING: "running",
  PAUSED: "paused",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

/**
 * Step status
 */
export const StepStatus = {
  PENDING: "pending",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  SKIPPED: "skipped",
};

export class CLIAutonomousAgent extends EventEmitter {
  constructor() {
    super();
    this._goals = new Map();
    this._llmChat = null;
    this._toolExecutor = null;
    this._hookManager = null;
    this._initialized = false;
    this._maxIterations = 20;
    this._maxRetries = 3;
  }

  /**
   * Initialize with required dependencies.
   */
  initialize({
    llmChat,
    toolExecutor,
    hookManager,
    maxIterations,
    iterationBudget,
  } = {}) {
    this._llmChat = llmChat || null;
    this._toolExecutor = toolExecutor || null;
    this._hookManager = hookManager || null;
    if (maxIterations) this._maxIterations = maxIterations;
    this._iterationBudget = iterationBudget || null; // shared budget from caller
    this._initialized = true;
  }

  /**
   * Submit a goal for autonomous execution.
   * @param {string} description - Natural language goal
   * @param {object} [options]
   * @param {number} [options.tokenBudget=50000] - Advisory token budget
   * @returns {{ goalId: string }}
   */
  async submitGoal(description, { tokenBudget = 50000 } = {}) {
    if (!this._initialized) throw new Error("Agent not initialized");
    if (!description) throw new Error("Goal description required");

    const goalId = `goal-${_deps.Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const goal = {
      id: goalId,
      description,
      status: GoalStatus.PENDING,
      tokenBudget,
      tokensUsed: 0,
      steps: [],
      iterations: 0,
      errors: [],
      result: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this._goals.set(goalId, goal);
    this.emit("goal:submitted", { goalId, description });

    // Start the ReAct loop asynchronously
    this._runReActLoop(goal).catch((err) => {
      goal.status = GoalStatus.FAILED;
      goal.errors.push(err.message);
      this.emit("goal:failed", { goalId, error: err.message });
    });

    return { goalId };
  }

  /**
   * Pause a running goal.
   */
  pauseGoal(goalId) {
    const goal = this._goals.get(goalId);
    if (!goal) return { error: "Goal not found" };
    if (goal.status !== GoalStatus.RUNNING)
      return { error: "Goal is not running" };

    goal.status = GoalStatus.PAUSED;
    goal.updatedAt = new Date().toISOString();
    this.emit("goal:paused", { goalId });
    return { success: true };
  }

  /**
   * Resume a paused goal.
   */
  resumeGoal(goalId) {
    const goal = this._goals.get(goalId);
    if (!goal) return { error: "Goal not found" };
    if (goal.status !== GoalStatus.PAUSED)
      return { error: "Goal is not paused" };

    goal.status = GoalStatus.RUNNING;
    goal.updatedAt = new Date().toISOString();
    this.emit("goal:resumed", { goalId });

    // Continue the loop
    this._runReActLoop(goal).catch((err) => {
      goal.status = GoalStatus.FAILED;
      goal.errors.push(err.message);
    });

    return { success: true };
  }

  /**
   * Cancel a goal.
   */
  cancelGoal(goalId) {
    const goal = this._goals.get(goalId);
    if (!goal) return { error: "Goal not found" };

    goal.status = GoalStatus.CANCELLED;
    goal.updatedAt = new Date().toISOString();
    this.emit("goal:cancelled", { goalId });
    return { success: true };
  }

  /**
   * Get goal status with steps.
   */
  getGoalStatus(goalId) {
    const goal = this._goals.get(goalId);
    if (!goal) return null;

    return {
      id: goal.id,
      description: goal.description,
      status: goal.status,
      steps: goal.steps.map((s) => ({
        description: s.description,
        status: s.status,
        tool: s.tool,
        result: s.result ? String(s.result).substring(0, 200) : null,
        error: s.error,
      })),
      iterations: goal.iterations,
      errors: goal.errors,
      result: goal.result,
      tokensUsed: goal.tokensUsed,
    };
  }

  /**
   * List all goals.
   */
  listGoals() {
    return [...this._goals.values()].map((g) => ({
      id: g.id,
      description: g.description.substring(0, 80),
      status: g.status,
      steps: g.steps.length,
      iterations: g.iterations,
    }));
  }

  // ─── ReAct Loop ─────────────────────────────────────────────

  async _runReActLoop(goal) {
    goal.status = GoalStatus.RUNNING;
    this.emit("goal:started", { goalId: goal.id });

    // Decompose goal into initial steps
    if (goal.steps.length === 0) {
      goal.steps = await this._decomposeGoal(goal);
      this.emit("goal:planned", {
        goalId: goal.id,
        stepCount: goal.steps.length,
      });
    }

    while (
      goal.status === GoalStatus.RUNNING &&
      goal.iterations < this._maxIterations
    ) {
      goal.iterations++;

      // Find next pending step
      const nextStep = goal.steps.find((s) => s.status === StepStatus.PENDING);
      if (!nextStep) {
        // All steps done or no pending steps
        const allDone = goal.steps.every(
          (s) =>
            s.status === StepStatus.COMPLETED ||
            s.status === StepStatus.SKIPPED,
        );
        if (allDone) {
          goal.status = GoalStatus.COMPLETED;
          goal.result = this._summarizeResults(goal);
          this.emit("goal:completed", { goalId: goal.id, result: goal.result });
        } else {
          goal.status = GoalStatus.FAILED;
          goal.errors.push("Not all steps completed");
          this.emit("goal:failed", {
            goalId: goal.id,
            error: "Not all steps completed",
          });
        }
        break;
      }

      // Execute step
      nextStep.status = StepStatus.RUNNING;
      this.emit("step:started", {
        goalId: goal.id,
        step: nextStep.description,
      });

      try {
        const result = await this._executeStep(nextStep);
        nextStep.status = StepStatus.COMPLETED;
        nextStep.result = result;
        this.emit("step:completed", {
          goalId: goal.id,
          step: nextStep.description,
        });
      } catch (err) {
        nextStep.error = err.message;

        // Self-correction: try to replan
        if (nextStep.retries < this._maxRetries) {
          nextStep.retries++;
          this.emit("step:retrying", {
            goalId: goal.id,
            step: nextStep.description,
            error: err.message,
          });

          const corrected = await this._selfCorrect(goal, err);
          if (corrected) {
            nextStep.status = StepStatus.PENDING; // Retry
            continue;
          }
        }

        nextStep.status = StepStatus.FAILED;
        this.emit("step:failed", {
          goalId: goal.id,
          step: nextStep.description,
          error: err.message,
        });

        // Check if failure is fatal
        if (nextStep.critical !== false) {
          goal.status = GoalStatus.FAILED;
          goal.errors.push(
            `Step failed: ${nextStep.description} — ${err.message}`,
          );
          this.emit("goal:failed", { goalId: goal.id, error: err.message });
          break;
        }
      }

      goal.updatedAt = new Date().toISOString();
    }

    if (
      goal.iterations >= this._maxIterations &&
      goal.status === GoalStatus.RUNNING
    ) {
      goal.status = GoalStatus.FAILED;
      goal.errors.push("Max iterations reached");
      this.emit("goal:failed", {
        goalId: goal.id,
        error: "Max iterations reached",
      });
    }
  }

  /**
   * Decompose a goal into executable steps using LLM.
   */
  async _decomposeGoal(goal) {
    if (!this._llmChat) {
      // No LLM — create a single step
      return [
        {
          description: goal.description,
          tool: null,
          params: {},
          status: StepStatus.PENDING,
          retries: 0,
          critical: true,
          result: null,
          error: null,
        },
      ];
    }

    try {
      const prompt = `Break down this goal into 2-6 concrete, executable steps. Each step should use one tool.

Goal: ${goal.description}

Available tools: read_file, write_file, edit_file, run_shell, search_files, list_dir, run_skill

Return a JSON array of steps, each with: { "description": "...", "tool": "tool_name", "params": {...} }
Only return the JSON array, no other text.`;

      const response = await this._llmChat(
        [{ role: "user", content: prompt }],
        { maxTokens: 1024 },
      );

      // Parse steps from LLM response
      const parsed = this._parseSteps(response);
      return parsed.map((s) => ({
        description: s.description || "Step",
        tool: s.tool || null,
        params: s.params || {},
        status: StepStatus.PENDING,
        retries: 0,
        critical: s.critical !== false,
        result: null,
        error: null,
      }));
    } catch (_err) {
      // Fallback: single step
      return [
        {
          description: goal.description,
          tool: null,
          params: {},
          status: StepStatus.PENDING,
          retries: 0,
          critical: true,
          result: null,
          error: null,
        },
      ];
    }
  }

  /**
   * Execute a single step using the tool executor.
   */
  async _executeStep(step) {
    if (!step.tool || !this._toolExecutor) {
      // No tool specified or no executor — skip as informational
      return "No tool action required";
    }

    return await this._toolExecutor(step.tool, step.params);
  }

  /**
   * Self-correct after a step failure.
   * Returns true if a correction was applied.
   */
  async _selfCorrect(goal, error) {
    if (!this._llmChat) return false;

    try {
      const context = goal.steps.map((s) => ({
        description: s.description,
        status: s.status,
        error: s.error,
      }));

      const prompt = `A step in my plan failed. Help me fix it.

Goal: ${goal.description}
Steps so far: ${JSON.stringify(context)}
Error: ${error.message}

Should I:
1. Retry the same step with different params
2. Add a new prerequisite step
3. Skip this step and continue

Reply with a JSON object: { "action": "retry|add_step|skip", "newParams": {...}, "newStep": {...} }`;

      const response = await this._llmChat(
        [{ role: "user", content: prompt }],
        { maxTokens: 512 },
      );

      const correction = this._parseJSON(response);
      if (!correction) return false;

      if (correction.action === "skip") {
        const failedStep = goal.steps.find(
          (s) => s.status === StepStatus.RUNNING,
        );
        if (failedStep) failedStep.status = StepStatus.SKIPPED;
        return true;
      }

      if (correction.action === "add_step" && correction.newStep) {
        const failedIdx = goal.steps.findIndex(
          (s) => s.status === StepStatus.RUNNING,
        );
        if (failedIdx >= 0) {
          goal.steps.splice(failedIdx, 0, {
            description: correction.newStep.description || "Corrective step",
            tool: correction.newStep.tool || null,
            params: correction.newStep.params || {},
            status: StepStatus.PENDING,
            retries: 0,
            critical: false,
            result: null,
            error: null,
          });
        }
        return true;
      }

      if (correction.action === "retry" && correction.newParams) {
        const failedStep = goal.steps.find(
          (s) => s.status === StepStatus.RUNNING,
        );
        if (failedStep) {
          Object.assign(failedStep.params, correction.newParams);
        }
        return true;
      }

      return false;
    } catch (_err) {
      return false;
    }
  }

  _summarizeResults(goal) {
    const completed = goal.steps.filter(
      (s) => s.status === StepStatus.COMPLETED,
    );
    return `Completed ${completed.length}/${goal.steps.length} steps for: ${goal.description}`;
  }

  _parseSteps(text) {
    try {
      // Extract JSON array from response
      const match = text.match(/\[[\s\S]*\]/);
      if (match) {
        return JSON.parse(match[0]);
      }
    } catch (_err) {
      // Parse failure
    }
    return [{ description: "Execute goal", tool: null, params: {} }];
  }

  _parseJSON(text) {
    try {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
    } catch (_err) {
      // Parse failure
    }
    return null;
  }
}

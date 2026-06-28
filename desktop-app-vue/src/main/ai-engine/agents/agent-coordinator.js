/**
 * Agent Coordinator - Multi-agent task decomposition, assignment, and result aggregation
 *
 * Provides intelligent orchestration of specialized agents:
 * 1. Task analysis and decomposition into subtasks
 * 2. Agent selection based on capability matching
 * 3. Subtask assignment and progress tracking
 * 4. Result aggregation from multiple agents
 *
 * @module ai-engine/agents/agent-coordinator
 */

const { logger } = require("../../utils/logger.js");
const { v4: uuidv4 } = require("uuid");
const { EventEmitter } = require("events");

/**
 * Parse a template's `capabilities` column robustly. A single template with a
 * corrupt (non-JSON) capabilities string must NOT abort the whole template-
 * matching loop in selectBestAgent — the outer try/catch would swallow the
 * throw and silently return no best agent. Treat an unparseable value as "no
 * capabilities" so that one template just doesn't match, and the rest are still
 * evaluated. Already-parsed arrays pass through; null/empty → [].
 */
function safeParseCapabilities(raw) {
  if (Array.isArray(raw)) {
    return raw;
  }
  if (typeof raw !== "string" || raw === "") {
    return [];
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    logger.warn(
      `[AgentCoordinator] Bad template capabilities JSON, skipping template: ${err.message}`,
    );
    return [];
  }
}

/**
 * Agent type keyword mappings for task analysis
 * @type {Object<string, string[]>}
 */
const AGENT_TYPE_KEYWORDS = {
  "code-generation": [
    "code",
    "generate",
    "implement",
    "function",
    "class",
    "module",
    "program",
    "script",
    "develop",
    "coding",
    "write code",
    "create code",
    "build",
    "scaffold",
    "boilerplate",
    "template code",
  ],
  "code-review": [
    "review",
    "audit",
    "inspect",
    "check",
    "lint",
    "quality",
    "code review",
    "pull request",
    "pr review",
    "static analysis",
    "code quality",
    "best practices",
  ],
  "data-analysis": [
    "data",
    "analyze",
    "analysis",
    "statistics",
    "chart",
    "graph",
    "dataset",
    "csv",
    "json",
    "parse",
    "transform",
    "aggregate",
    "metric",
    "report",
    "dashboard",
    "visualization",
    "trend",
  ],
  document: [
    "document",
    "documentation",
    "readme",
    "guide",
    "manual",
    "write",
    "article",
    "blog",
    "tutorial",
    "specification",
    "api doc",
    "jsdoc",
    "markdown",
    "content",
  ],
  testing: [
    "test",
    "testing",
    "unit test",
    "integration test",
    "e2e",
    "jest",
    "mocha",
    "vitest",
    "coverage",
    "assertion",
    "mock",
    "fixture",
    "spec",
    "test case",
    "qa",
  ],
  refactoring: [
    "refactor",
    "restructure",
    "reorganize",
    "optimize",
    "clean",
    "simplify",
    "extract",
    "inline",
    "rename",
    "move",
    "split",
    "merge",
    "decouple",
    "modularize",
  ],
  debugging: [
    "debug",
    "fix",
    "bug",
    "error",
    "issue",
    "crash",
    "exception",
    "stack trace",
    "breakpoint",
    "diagnose",
    "troubleshoot",
    "resolve",
    "patch",
    "hotfix",
  ],
  deployment: [
    "deploy",
    "release",
    "publish",
    "ci",
    "cd",
    "pipeline",
    "docker",
    "kubernetes",
    "container",
    "infrastructure",
    "production",
    "staging",
    "build",
    "package",
  ],
  security: [
    "security",
    "vulnerability",
    "auth",
    "authentication",
    "authorization",
    "encryption",
    "ssl",
    "tls",
    "xss",
    "csrf",
    "injection",
    "sanitize",
    "permission",
    "rbac",
    "owasp",
  ],
  design: [
    "design",
    "architecture",
    "pattern",
    "uml",
    "diagram",
    "schema",
    "model",
    "structure",
    "layout",
    "wireframe",
    "component",
    "system design",
    "api design",
  ],
};

/**
 * Task status enum
 * @type {Object<string, string>}
 */
const TASK_STATUS = {
  PENDING: "pending",
  ASSIGNED: "assigned",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

// Cap on retained in-memory tasks. Each assignment adds an activeTasks entry
// that is persisted to agent_task_history but never removed during operation,
// so without a bound the map grows forever. Only terminal tasks are evicted;
// getTaskStatus already falls back to the DB for them.
const MAX_ACTIVE_TASKS = 500;
// orchestrationSessions is set per orchestrate() call and only read via .size,
// never removed during operation — so it leaks one session object per run.
const MAX_ORCHESTRATION_SESSIONS = 200;
const TERMINAL_TASK_STATES = new Set([
  TASK_STATUS.COMPLETED,
  TASK_STATUS.FAILED,
  TASK_STATUS.CANCELLED,
]);

/**
 * Priority levels for subtasks
 * @type {Object<string, number>}
 */
const PRIORITY = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

/**
 * Multi-agent task coordinator
 *
 * Handles task decomposition, agent selection, assignment, and result aggregation.
 * Works with AgentRegistry for agent instances and AgentTemplateManager for templates.
 */
class AgentCoordinator extends EventEmitter {
  /**
   * @param {Object} options - Coordinator configuration
   * @param {Object} options.database - Database instance (better-sqlite3)
   * @param {Object} options.agentRegistry - AgentRegistry instance
   * @param {Object} options.templateManager - AgentTemplateManager instance
   */
  constructor({ database, agentRegistry, templateManager } = {}) {
    super();

    this.database = database;
    this.agentRegistry = agentRegistry;
    this.templateManager = templateManager;

    // Active task tracking
    this.activeTasks = new Map();
    this.maxActiveTasks = MAX_ACTIVE_TASKS;

    // Orchestration sessions
    this.orchestrationSessions = new Map();
    this.maxOrchestrationSessions = MAX_ORCHESTRATION_SESSIONS;

    // Configuration
    this.config = {
      maxConcurrentTasks: 5,
      taskTimeout: 120000, // 2 minutes per subtask
      orchestrationTimeout: 600000, // 10 minutes per orchestration
      maxRetries: 2,
      enableAutoDecomposition: true,
      minCapabilityScore: 0.3,
    };

    // Statistics
    this.stats = {
      totalOrchestrations: 0,
      successfulOrchestrations: 0,
      failedOrchestrations: 0,
      totalSubtasks: 0,
      totalAssignments: 0,
      averageOrchestrationTime: 0,
    };

    logger.info("[AgentCoordinator] Initialized");
  }

  // ==========================================
  // Main Orchestration
  // ==========================================

  /**
   * Main orchestration method - analyze, decompose, assign, and aggregate
   *
   * @param {string} taskDescription - Natural language description of the task
   * @param {Object} [options={}] - Orchestration options
   * @param {number} [options.maxAgents] - Maximum number of agents to use
   * @param {boolean} [options.parallel] - Whether to run subtasks in parallel
   * @param {string} [options.strategy] - Orchestration strategy: 'auto', 'sequential', 'parallel'
   * @param {Object} [options.context] - Additional context for agents
   * @returns {Promise<Object>} Orchestration result
   */
  async orchestrate(taskDescription, options = {}) {
    const sessionId = uuidv4();
    const startTime = Date.now();

    this.stats.totalOrchestrations++;

    logger.info(`[AgentCoordinator] Starting orchestration: ${sessionId}`);
    logger.info(
      `[AgentCoordinator] Task: ${taskDescription.substring(0, 200)}...`,
    );

    const session = {
      id: sessionId,
      taskDescription,
      options,
      status: TASK_STATUS.RUNNING,
      startTime,
      subtasks: [],
      results: [],
      errors: [],
    };

    this.orchestrationSessions.set(sessionId, session);
    this._evictTerminalSessions();
    this.emit("orchestration:start", { sessionId, taskDescription });

    try {
      // Step 1: Generate execution plan
      const plan = await this.getPlan(taskDescription, options);

      if (!plan || plan.subtasks.length === 0) {
        throw new Error("Failed to decompose task into subtasks");
      }

      session.subtasks = plan.subtasks;
      logger.info(
        `[AgentCoordinator] Plan generated: ${plan.subtasks.length} subtasks`,
      );

      this.emit("orchestration:plan-ready", { sessionId, plan });

      // Step 2: Execute subtasks
      const strategy = options.strategy || "auto";
      let results;

      if (
        strategy === "parallel" ||
        (strategy === "auto" && this._canRunParallel(plan.subtasks))
      ) {
        results = await this._executeParallel(
          sessionId,
          plan.subtasks,
          options,
        );
      } else {
        results = await this._executeSequential(
          sessionId,
          plan.subtasks,
          options,
        );
      }

      session.results = results;

      // Step 3: Aggregate results
      const summary = this.aggregateResults(results);

      // Update session
      session.status = TASK_STATUS.COMPLETED;
      session.completedTime = Date.now();

      // Update statistics
      const duration = Date.now() - startTime;
      this.stats.successfulOrchestrations++;
      this._updateAverageTime(duration);

      this.emit("orchestration:complete", { sessionId, summary, duration });

      logger.info(
        `[AgentCoordinator] Orchestration complete: ${sessionId} (${duration}ms)`,
      );

      return {
        success: true,
        data: {
          sessionId,
          plan,
          results,
          summary,
          duration,
          subtaskCount: plan.subtasks.length,
          successCount: results.filter((r) => r.success).length,
          failureCount: results.filter((r) => !r.success).length,
        },
      };
    } catch (error) {
      session.status = TASK_STATUS.FAILED;
      session.error = error.message;
      session.completedTime = Date.now();

      this.stats.failedOrchestrations++;

      this.emit("orchestration:error", { sessionId, error: error.message });
      logger.error(
        `[AgentCoordinator] Orchestration failed: ${sessionId} - ${error.message}`,
      );

      return {
        success: false,
        error: error.message,
        data: {
          sessionId,
          partialResults: session.results,
          errors: session.errors,
        },
      };
    }
  }

  // ==========================================
  // Task Decomposition
  // ==========================================

  /**
   * Decompose a task into subtasks with agent type assignments
   *
   * Uses keyword analysis to map task descriptions to agent types.
   * Each subtask includes the assigned agent type, priority, and dependencies.
   *
   * @param {string} taskDescription - Natural language task description
   * @returns {Array<Object>} Array of subtask objects
   */
  decompose(taskDescription) {
    if (!taskDescription || typeof taskDescription !== "string") {
      logger.warn(
        "[AgentCoordinator] Invalid task description for decomposition",
      );
      return [];
    }

    const normalizedDesc = taskDescription.toLowerCase();

    // Determine which agent types are needed
    const agentTypes = this._determineAgentTypes(normalizedDesc);

    if (agentTypes.length === 0) {
      // Default: assign to general-purpose agent type
      logger.info(
        "[AgentCoordinator] No specific agent types matched, using code-generation as default",
      );
      agentTypes.push({ type: "code-generation", score: 0.5 });
    }

    // Split task into subtasks based on identified agent types
    const subtasks = [];
    const sentences = this._splitIntoSegments(taskDescription);

    if (sentences.length <= 1 || agentTypes.length <= 1) {
      // Single subtask - assign to best matching agent
      const bestType = agentTypes[0];
      subtasks.push({
        id: uuidv4(),
        subtask: taskDescription,
        agentType: bestType.type,
        priority: PRIORITY.HIGH,
        dependencies: [],
        matchScore: bestType.score,
      });
    } else {
      // Multiple subtasks - try to assign segments to different agents
      let previousSubtaskId = null;

      for (let i = 0; i < sentences.length; i++) {
        const segment = sentences[i].trim();
        if (!segment) {
          continue;
        }

        const segmentTypes = this._determineAgentTypes(segment.toLowerCase());
        const bestType =
          segmentTypes.length > 0 ? segmentTypes[0] : agentTypes[0];

        const subtaskId = uuidv4();
        const subtask = {
          id: subtaskId,
          subtask: segment,
          agentType: bestType.type,
          priority: i === 0 ? PRIORITY.HIGH : PRIORITY.MEDIUM,
          dependencies: previousSubtaskId ? [previousSubtaskId] : [],
          matchScore: bestType.score,
        };

        subtasks.push(subtask);
        previousSubtaskId = subtaskId;
      }
    }

    this.stats.totalSubtasks += subtasks.length;

    logger.info(
      `[AgentCoordinator] Decomposed into ${subtasks.length} subtasks`,
    );

    return subtasks;
  }

  // ==========================================
  // Task Assignment
  // ==========================================

  /**
   * Assign a task to a specific agent
   *
   * Creates a task record in the database and tracks the assignment.
   *
   * @param {string} agentId - ID of the agent instance to assign to
   * @param {string} taskDescription - Task description
   * @param {Object} [options={}] - Assignment options
   * @param {string} [options.templateType] - Agent template type
   * @param {Object} [options.context] - Additional context
   * @returns {Promise<Object>} Assignment result with task ID and status
   */
  async assignTask(agentId, taskDescription, options = {}) {
    if (!agentId) {
      throw new Error("Agent ID is required for task assignment");
    }

    if (!taskDescription) {
      throw new Error("Task description is required");
    }

    const templateType = options.templateType || "unknown";
    const taskId = uuidv4();

    logger.info(
      `[AgentCoordinator] Assigning task ${taskId} to agent ${agentId}`,
    );

    // Create database record
    this._createTaskRecord(taskId, agentId, templateType, taskDescription);

    // Track active task
    const taskInfo = {
      id: taskId,
      agentId,
      templateType,
      description: taskDescription,
      status: TASK_STATUS.ASSIGNED,
      assignedAt: Date.now(),
      context: options.context || {},
    };

    this.activeTasks.set(taskId, taskInfo);
    this._evictTerminalTasks();
    this.stats.totalAssignments++;

    this.emit("task:assigned", { taskId, agentId, templateType });

    // Execute through agent registry if available
    try {
      taskInfo.status = TASK_STATUS.RUNNING;
      this._updateTaskRecord(taskId, {
        status: TASK_STATUS.RUNNING,
        started_at: Date.now(),
      });

      let result;

      if (this.agentRegistry) {
        const agent = this.agentRegistry.getInstance(agentId);

        if (agent && typeof agent.execute === "function") {
          result = await this._executeWithTimeout(
            agent.execute({
              type: templateType,
              input: taskDescription,
              context: options.context || {},
            }),
            this.config.taskTimeout,
          );
        } else {
          // Agent not found in registry, return pending status
          logger.warn(
            `[AgentCoordinator] Agent ${agentId} not found or has no execute method`,
          );
          result = {
            status: "pending",
            message: `Task assigned to agent ${agentId}, awaiting execution`,
          };
        }
      } else {
        result = {
          status: "pending",
          message: "Agent registry not available, task queued",
        };
      }

      // Update records on success
      taskInfo.status = TASK_STATUS.COMPLETED;
      taskInfo.result = result;
      taskInfo.completedAt = Date.now();

      this._updateTaskRecord(taskId, {
        status: TASK_STATUS.COMPLETED,
        completed_at: Date.now(),
        success: 1,
        result: JSON.stringify(result),
      });

      this.emit("task:completed", { taskId, agentId, result });

      return {
        success: true,
        data: {
          taskId,
          agentId,
          status: TASK_STATUS.COMPLETED,
          result,
        },
      };
    } catch (error) {
      taskInfo.status = TASK_STATUS.FAILED;
      taskInfo.error = error.message;
      taskInfo.completedAt = Date.now();

      this._updateTaskRecord(taskId, {
        status: TASK_STATUS.FAILED,
        completed_at: Date.now(),
        success: 0,
        result: JSON.stringify({ error: error.message }),
      });

      this.emit("task:failed", { taskId, agentId, error: error.message });
      logger.error(
        `[AgentCoordinator] Task ${taskId} failed: ${error.message}`,
      );

      return {
        success: false,
        error: error.message,
        data: {
          taskId,
          agentId,
          status: TASK_STATUS.FAILED,
        },
      };
    }
  }

  // ==========================================
  // Task Status and Control
  // ==========================================

  /**
   * Get the status of a task
   *
   * @param {string} taskId - Task ID to query
   * @returns {Object} Task status information
   */
  getTaskStatus(taskId) {
    // Check active tasks first
    const activeTask = this.activeTasks.get(taskId);
    if (activeTask) {
      return {
        success: true,
        data: {
          taskId: activeTask.id,
          agentId: activeTask.agentId,
          status: activeTask.status,
          description: activeTask.description,
          assignedAt: activeTask.assignedAt,
          completedAt: activeTask.completedAt || null,
          result: activeTask.result || null,
          error: activeTask.error || null,
        },
      };
    }

    // Fall back to database
    if (this.database) {
      try {
        const record = this.database
          .prepare("SELECT * FROM agent_task_history WHERE id = ?")
          .get(taskId);

        if (record) {
          return {
            success: true,
            data: {
              taskId: record.id,
              agentId: record.agent_id,
              templateType: record.template_type,
              description: record.task_description,
              startedAt: record.started_at,
              completedAt: record.completed_at,
              success: record.success === 1,
              result: record.result ? JSON.parse(record.result) : null,
              tokensUsed: record.tokens_used,
            },
          };
        }
      } catch (error) {
        logger.error(
          `[AgentCoordinator] Failed to query task status: ${error.message}`,
        );
      }
    }

    return {
      success: false,
      error: `Task not found: ${taskId}`,
    };
  }

  /**
   * Bound the in-memory activeTasks map. Evicts the oldest terminal tasks
   * (completed/failed/cancelled) once over maxActiveTasks; active tasks
   * (pending/assigned/running) are never evicted. Evicted tasks remain in
   * agent_task_history and getTaskStatus falls back to the DB for them.
   * @private
   */
  _evictTerminalTasks() {
    if (this.activeTasks.size <= this.maxActiveTasks) {
      return;
    }
    for (const [id, task] of this.activeTasks) {
      if (!TERMINAL_TASK_STATES.has(task.status)) {
        continue; // keep active tasks
      }
      this.activeTasks.delete(id);
      if (this.activeTasks.size <= this.maxActiveTasks) {
        break;
      }
    }
  }

  /**
   * Bound the in-memory orchestrationSessions map by evicting the oldest
   * terminal sessions (completed/failed/cancelled) past maxOrchestrationSessions.
   * Sessions are only read via .size, so this never affects an in-flight run
   * (orchestrate() works off its local session reference).
   * @private
   */
  _evictTerminalSessions() {
    if (this.orchestrationSessions.size <= this.maxOrchestrationSessions) {
      return;
    }
    for (const [id, session] of this.orchestrationSessions) {
      if (!TERMINAL_TASK_STATES.has(session.status)) {
        continue;
      }
      this.orchestrationSessions.delete(id);
      if (this.orchestrationSessions.size <= this.maxOrchestrationSessions) {
        break;
      }
    }
  }

  /**
   * Cancel a running task
   *
   * @param {string} taskId - Task ID to cancel
   * @param {string} [reason=''] - Cancellation reason
   * @returns {Object} Cancellation result
   */
  cancelTask(taskId, reason = "") {
    const activeTask = this.activeTasks.get(taskId);

    if (!activeTask) {
      return {
        success: false,
        error: `Active task not found: ${taskId}`,
      };
    }

    if (
      activeTask.status === TASK_STATUS.COMPLETED ||
      activeTask.status === TASK_STATUS.CANCELLED
    ) {
      return {
        success: false,
        error: `Task ${taskId} is already ${activeTask.status}`,
      };
    }

    // Update task status
    activeTask.status = TASK_STATUS.CANCELLED;
    activeTask.cancelledAt = Date.now();
    activeTask.cancelReason = reason;

    this._updateTaskRecord(taskId, {
      status: TASK_STATUS.CANCELLED,
      completed_at: Date.now(),
      success: 0,
      result: JSON.stringify({ cancelled: true, reason }),
    });

    this.emit("task:cancelled", { taskId, reason });
    logger.info(`[AgentCoordinator] Task ${taskId} cancelled: ${reason}`);

    return {
      success: true,
      data: {
        taskId,
        status: TASK_STATUS.CANCELLED,
        reason,
      },
    };
  }

  // ==========================================
  // Execution Plan
  // ==========================================

  /**
   * Generate an execution plan without running
   *
   * Analyzes the task, proposes agent assignments, and returns
   * the plan for review before execution.
   *
   * @param {string} taskDescription - Natural language task description
   * @param {Object} [options={}] - Planning options
   * @returns {Object} Proposed execution plan
   */
  getPlan(taskDescription, options = {}) {
    if (!taskDescription) {
      return {
        success: false,
        error: "Task description is required",
      };
    }

    // Decompose the task
    const subtasks = this.decompose(taskDescription);

    // For each subtask, find the best agent
    const assignments = subtasks.map((subtask) => {
      const bestAgent = this.selectBestAgent(subtask.agentType);

      return {
        subtaskId: subtask.id,
        subtask: subtask.subtask,
        agentType: subtask.agentType,
        priority: subtask.priority,
        dependencies: subtask.dependencies,
        matchScore: subtask.matchScore,
        proposedAgent: bestAgent
          ? {
              id: bestAgent.id,
              name: bestAgent.name,
              type: bestAgent.type,
              capabilities: bestAgent.capabilities,
              score: bestAgent.score,
            }
          : null,
        canExecute: bestAgent !== null,
      };
    });

    // Determine execution order based on dependencies
    const executionOrder = this._resolveExecutionOrder(assignments);

    // Estimate total time
    const estimatedTime = this._estimateExecutionTime(assignments);

    // Check if all subtasks can be executed
    const allExecutable = assignments.every((a) => a.canExecute);
    const executableCount = assignments.filter((a) => a.canExecute).length;

    const plan = {
      taskDescription,
      subtasks: assignments,
      executionOrder,
      estimatedTimeMs: estimatedTime,
      totalSubtasks: assignments.length,
      executableSubtasks: executableCount,
      allExecutable,
      strategy: this._determineStrategy(assignments, options),
      createdAt: Date.now(),
    };

    logger.info(
      `[AgentCoordinator] Plan: ${assignments.length} subtasks, ` +
        `${executableCount} executable, strategy: ${plan.strategy}`,
    );

    return plan;
  }

  // ==========================================
  // Result Aggregation
  // ==========================================

  /**
   * Combine results from multiple agent executions
   *
   * @param {Array<Object>} taskResults - Array of task result objects
   * @returns {Object} Aggregated summary
   */
  aggregateResults(taskResults) {
    if (!taskResults || !Array.isArray(taskResults)) {
      return {
        success: false,
        error: "No results to aggregate",
        totalTasks: 0,
        successCount: 0,
        failureCount: 0,
      };
    }

    const successResults = taskResults.filter((r) => r.success);
    const failedResults = taskResults.filter((r) => !r.success);

    // Calculate execution time stats
    const durations = taskResults
      .filter((r) => r.duration)
      .map((r) => r.duration);

    const totalDuration = durations.reduce((sum, d) => sum + d, 0);
    const avgDuration =
      durations.length > 0 ? totalDuration / durations.length : 0;
    const maxDuration = durations.length > 0 ? Math.max(...durations) : 0;
    const minDuration = durations.length > 0 ? Math.min(...durations) : 0;

    // Collect all output data
    const outputs = successResults
      .filter((r) => r.result)
      .map((r) => ({
        subtaskId: r.subtaskId,
        agentType: r.agentType,
        result: r.result,
      }));

    // Collect all errors
    const errors = failedResults.map((r) => ({
      subtaskId: r.subtaskId,
      agentType: r.agentType,
      error: r.error,
    }));

    // Agent type distribution
    const agentTypeUsage = {};
    for (const result of taskResults) {
      const type = result.agentType || "unknown";
      if (!agentTypeUsage[type]) {
        agentTypeUsage[type] = { total: 0, success: 0, failed: 0 };
      }
      agentTypeUsage[type].total++;
      if (result.success) {
        agentTypeUsage[type].success++;
      } else {
        agentTypeUsage[type].failed++;
      }
    }

    return {
      success: failedResults.length === 0,
      totalTasks: taskResults.length,
      successCount: successResults.length,
      failureCount: failedResults.length,
      successRate:
        taskResults.length > 0
          ? ((successResults.length / taskResults.length) * 100).toFixed(1) +
            "%"
          : "N/A",
      timing: {
        totalDuration,
        averageDuration: Math.round(avgDuration),
        maxDuration,
        minDuration,
      },
      outputs,
      errors,
      agentTypeUsage,
      aggregatedAt: Date.now(),
    };
  }

  // ==========================================
  // Agent Selection
  // ==========================================

  /**
   * Find the best matching agent template for required capabilities
   *
   * Searches available templates and running instances to find the
   * best match based on capability scoring.
   *
   * @param {string|string[]} capabilities - Required capabilities or agent type
   * @returns {Object|null} Best matching agent info, or null if none found
   */
  selectBestAgent(capabilities) {
    const requiredCapabilities = Array.isArray(capabilities)
      ? capabilities
      : [capabilities];

    let bestMatch = null;
    let bestScore = 0;

    // Check template manager for available templates
    if (this.templateManager) {
      try {
        const templates = this.templateManager.listTemplates
          ? this.templateManager.listTemplates()
          : [];

        for (const template of templates) {
          if (!template.enabled) {
            continue;
          }

          const templateCapabilities = safeParseCapabilities(
            template.capabilities,
          );

          const score = this._matchCapabilities(
            requiredCapabilities,
            templateCapabilities,
          );

          // Also check type match
          const typeScore = requiredCapabilities.some(
            (c) => c === template.type,
          )
            ? 0.5
            : 0;
          const totalScore = score + typeScore;

          if (
            totalScore > bestScore &&
            totalScore >= this.config.minCapabilityScore
          ) {
            bestScore = totalScore;
            bestMatch = {
              id: template.id,
              name: template.name,
              type: template.type,
              capabilities: templateCapabilities,
              score: totalScore,
              source: "template",
            };
          }
        }
      } catch (error) {
        logger.warn(
          `[AgentCoordinator] Template search error: ${error.message}`,
        );
      }
    }

    // Check agent registry for running instances
    if (this.agentRegistry) {
      try {
        const instances = this.agentRegistry.listInstances
          ? this.agentRegistry.listInstances()
          : [];

        for (const instance of instances) {
          if (instance.status !== "active") {
            continue;
          }

          const instanceCapabilities = instance.capabilities || [];
          const score = this._matchCapabilities(
            requiredCapabilities,
            instanceCapabilities,
          );
          const typeScore = requiredCapabilities.some(
            (c) => c === instance.type,
          )
            ? 0.5
            : 0;
          const totalScore = score + typeScore;

          if (
            totalScore > bestScore &&
            totalScore >= this.config.minCapabilityScore
          ) {
            bestScore = totalScore;
            bestMatch = {
              id: instance.id,
              name: instance.name || instance.id,
              type: instance.type,
              capabilities: instanceCapabilities,
              score: totalScore,
              source: "instance",
            };
          }
        }
      } catch (error) {
        logger.warn(
          `[AgentCoordinator] Registry search error: ${error.message}`,
        );
      }
    }

    // Fall back to database if no match found
    if (!bestMatch && this.database) {
      try {
        const dbTemplates = this.database
          .prepare("SELECT * FROM agent_templates WHERE enabled = 1")
          .all();

        for (const row of dbTemplates) {
          const templateCapabilities = safeParseCapabilities(row.capabilities);
          const score = this._matchCapabilities(
            requiredCapabilities,
            templateCapabilities,
          );
          const typeScore = requiredCapabilities.some((c) => c === row.type)
            ? 0.5
            : 0;
          const totalScore = score + typeScore;

          if (
            totalScore > bestScore &&
            totalScore >= this.config.minCapabilityScore
          ) {
            bestScore = totalScore;
            bestMatch = {
              id: row.id,
              name: row.name,
              type: row.type,
              capabilities: templateCapabilities,
              score: totalScore,
              source: "database",
            };
          }
        }
      } catch (error) {
        logger.warn(
          `[AgentCoordinator] Database search error: ${error.message}`,
        );
      }
    }

    if (bestMatch) {
      logger.debug(
        `[AgentCoordinator] Best agent for ${requiredCapabilities.join(",")}: ` +
          `${bestMatch.name} (score: ${bestMatch.score.toFixed(2)})`,
      );
    } else {
      logger.debug(
        `[AgentCoordinator] No suitable agent found for: ${requiredCapabilities.join(",")}`,
      );
    }

    return bestMatch;
  }

  // ==========================================
  // Statistics and Info
  // ==========================================

  /**
   * Get coordinator statistics
   *
   * @returns {Object} Statistics summary
   */
  getStats() {
    return {
      ...this.stats,
      activeTasks: this.activeTasks.size,
      activeOrchestrations: Array.from(
        this.orchestrationSessions.values(),
      ).filter((s) => s.status === TASK_STATUS.RUNNING).length,
      totalOrchestrationSessions: this.orchestrationSessions.size,
      config: { ...this.config },
    };
  }

  /**
   * Get performance metrics from task history
   *
   * @param {Object} [options={}] - Query options
   * @param {number} [options.limit=100] - Maximum records to query
   * @param {string} [options.agentId] - Filter by agent ID
   * @param {string} [options.templateType] - Filter by template type
   * @returns {Object} Performance metrics
   */
  getPerformance(options = {}) {
    const { limit = 100, agentId, templateType } = options;

    if (!this.database) {
      return {
        success: false,
        error: "Database not available",
      };
    }

    try {
      let query = "SELECT * FROM agent_task_history WHERE 1=1";
      const params = [];

      if (agentId) {
        query += " AND agent_id = ?";
        params.push(agentId);
      }

      if (templateType) {
        query += " AND template_type = ?";
        params.push(templateType);
      }

      query += " ORDER BY started_at DESC LIMIT ?";
      params.push(limit);

      const records = this.database.prepare(query).all(...params);

      // Calculate metrics
      const totalTasks = records.length;
      const successTasks = records.filter((r) => r.success === 1).length;
      const failedTasks = records.filter((r) => r.success === 0).length;

      const completedRecords = records.filter(
        (r) => r.completed_at && r.started_at,
      );
      const durations = completedRecords.map(
        (r) => r.completed_at - r.started_at,
      );

      const avgDuration =
        durations.length > 0
          ? durations.reduce((a, b) => a + b, 0) / durations.length
          : 0;

      const totalTokens = records.reduce(
        (sum, r) => sum + (r.tokens_used || 0),
        0,
      );

      // Group by agent
      const byAgent = {};
      for (const record of records) {
        const id = record.agent_id;
        if (!byAgent[id]) {
          byAgent[id] = { total: 0, success: 0, failed: 0, totalTime: 0 };
        }
        byAgent[id].total++;
        if (record.success === 1) {
          byAgent[id].success++;
        } else {
          byAgent[id].failed++;
        }
        if (record.completed_at && record.started_at) {
          byAgent[id].totalTime += record.completed_at - record.started_at;
        }
      }

      // Group by template type
      const byType = {};
      for (const record of records) {
        const type = record.template_type;
        if (!byType[type]) {
          byType[type] = { total: 0, success: 0, failed: 0 };
        }
        byType[type].total++;
        if (record.success === 1) {
          byType[type].success++;
        } else {
          byType[type].failed++;
        }
      }

      return {
        success: true,
        data: {
          totalTasks,
          successTasks,
          failedTasks,
          successRate:
            totalTasks > 0
              ? ((successTasks / totalTasks) * 100).toFixed(1) + "%"
              : "N/A",
          averageDurationMs: Math.round(avgDuration),
          totalTokensUsed: totalTokens,
          byAgent,
          byType,
          period: {
            from:
              records.length > 0
                ? records[records.length - 1].started_at
                : null,
            to: records.length > 0 ? records[0].started_at : null,
          },
        },
      };
    } catch (error) {
      logger.error(
        `[AgentCoordinator] Performance query error: ${error.message}`,
      );
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get overall system statistics
   *
   * @returns {Object} System statistics
   */
  getSystemStatistics() {
    const stats = this.getStats();

    // Add database statistics if available
    if (this.database) {
      try {
        const templateCount = this.database
          .prepare("SELECT COUNT(*) as count FROM agent_templates")
          .get();

        const taskCount = this.database
          .prepare("SELECT COUNT(*) as count FROM agent_task_history")
          .get();

        const recentTasks = this.database
          .prepare(
            `SELECT template_type, COUNT(*) as count,
           SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes
           FROM agent_task_history
           WHERE started_at > ?
           GROUP BY template_type`,
          )
          .all(Date.now() - 86400000); // Last 24 hours

        stats.database = {
          totalTemplates: templateCount ? templateCount.count : 0,
          totalHistoryRecords: taskCount ? taskCount.count : 0,
          recentActivity: recentTasks,
        };
      } catch (error) {
        logger.warn(`[AgentCoordinator] Stats query error: ${error.message}`);
        stats.database = { error: error.message };
      }
    }

    return stats;
  }

  // ==========================================
  // Private Helpers
  // ==========================================

  /**
   * Score capability match between required and available capabilities
   *
   * @param {string[]} required - Required capabilities
   * @param {string[]} available - Available capabilities
   * @returns {number} Match score (0 to 1)
   * @private
   */
  _matchCapabilities(required, available) {
    if (!required || required.length === 0) {
      return 0;
    }
    if (!available || available.length === 0) {
      return 0;
    }

    let matchCount = 0;
    let partialMatchCount = 0;

    for (const req of required) {
      const reqLower = req.toLowerCase();

      // Exact match
      if (available.some((a) => a.toLowerCase() === reqLower)) {
        matchCount++;
        continue;
      }

      // Partial match (substring)
      if (
        available.some(
          (a) =>
            a.toLowerCase().includes(reqLower) ||
            reqLower.includes(a.toLowerCase()),
        )
      ) {
        partialMatchCount++;
      }
    }

    // Full matches count for 1.0, partial for 0.5
    const score = (matchCount + partialMatchCount * 0.5) / required.length;
    return Math.min(score, 1.0);
  }

  /**
   * Determine agent types needed for a task based on keyword analysis
   *
   * @param {string} taskDescription - Normalized (lowercase) task description
   * @returns {Array<{type: string, score: number}>} Matched agent types sorted by score
   * @private
   */
  _determineAgentTypes(taskDescription) {
    const scores = {};

    for (const [agentType, keywords] of Object.entries(AGENT_TYPE_KEYWORDS)) {
      let score = 0;
      let matchedKeywords = 0;

      for (const keyword of keywords) {
        if (taskDescription.includes(keyword)) {
          // Longer keywords get higher weight
          const weight = keyword.includes(" ") ? 2.0 : 1.0;
          score += weight;
          matchedKeywords++;
        }
      }

      // Normalize score
      if (matchedKeywords > 0) {
        const normalizedScore = Math.min((score / keywords.length) * 3, 1.0);
        scores[agentType] = normalizedScore;
      }
    }

    // Sort by score descending
    const result = Object.entries(scores)
      .map(([type, score]) => ({ type, score }))
      .sort((a, b) => b.score - a.score);

    return result;
  }

  /**
   * Create a task record in the database
   *
   * @param {string} taskId - Task ID
   * @param {string} agentId - Agent ID
   * @param {string} templateType - Template type
   * @param {string} description - Task description
   * @private
   */
  _createTaskRecord(taskId, agentId, templateType, description) {
    if (!this.database) {
      return;
    }

    try {
      this.database
        .prepare(
          `INSERT INTO agent_task_history (id, agent_id, template_type, task_description, started_at)
         VALUES (?, ?, ?, ?, ?)`,
        )
        .run(taskId, agentId, templateType, description, Date.now());
    } catch (error) {
      logger.warn(
        `[AgentCoordinator] Failed to create task record: ${error.message}`,
      );
    }
  }

  /**
   * Update a task record in the database
   *
   * @param {string} taskId - Task ID
   * @param {Object} updates - Fields to update
   * @private
   */
  _updateTaskRecord(taskId, updates) {
    if (!this.database) {
      return;
    }

    try {
      const setClauses = [];
      const values = [];

      if (updates.completed_at !== undefined) {
        setClauses.push("completed_at = ?");
        values.push(updates.completed_at);
      }

      if (updates.success !== undefined) {
        setClauses.push("success = ?");
        values.push(updates.success);
      }

      if (updates.result !== undefined) {
        setClauses.push("result = ?");
        values.push(updates.result);
      }

      if (updates.tokens_used !== undefined) {
        setClauses.push("tokens_used = ?");
        values.push(updates.tokens_used);
      }

      if (setClauses.length === 0) {
        return;
      }

      values.push(taskId);

      this.database
        .prepare(
          `UPDATE agent_task_history SET ${setClauses.join(", ")} WHERE id = ?`,
        )
        .run(...values);
    } catch (error) {
      logger.warn(
        `[AgentCoordinator] Failed to update task record: ${error.message}`,
      );
    }
  }

  /**
   * Execute subtasks sequentially
   *
   * @param {string} sessionId - Orchestration session ID
   * @param {Array<Object>} subtasks - Subtasks to execute
   * @param {Object} options - Execution options
   * @returns {Promise<Array<Object>>} Results array
   * @private
   */
  async _executeSequential(sessionId, subtasks, options = {}) {
    const results = [];
    let previousResult = null;

    for (let i = 0; i < subtasks.length; i++) {
      const subtask = subtasks[i];

      this.emit("orchestration:subtask-start", {
        sessionId,
        subtaskId: subtask.subtaskId || subtask.id,
        index: i,
        total: subtasks.length,
      });

      const startTime = Date.now();

      try {
        const agentId = subtask.proposedAgent ? subtask.proposedAgent.id : null;
        const context = {
          ...options.context,
          previousResult,
          subtaskIndex: i,
          totalSubtasks: subtasks.length,
        };

        let result;

        if (agentId) {
          const assignResult = await this.assignTask(agentId, subtask.subtask, {
            templateType: subtask.agentType,
            context,
          });
          result = assignResult;
        } else {
          result = {
            success: false,
            error: "No agent available for this subtask",
          };
        }

        const duration = Date.now() - startTime;

        const taskResult = {
          subtaskId: subtask.subtaskId || subtask.id,
          agentType: subtask.agentType,
          success: result.success,
          result: result.data || result,
          error: result.error || null,
          duration,
        };

        results.push(taskResult);

        if (result.success) {
          previousResult = result.data;
        }

        this.emit("orchestration:subtask-complete", {
          sessionId,
          subtaskId: subtask.subtaskId || subtask.id,
          index: i,
          success: result.success,
          duration,
        });
      } catch (error) {
        const duration = Date.now() - startTime;

        results.push({
          subtaskId: subtask.subtaskId || subtask.id,
          agentType: subtask.agentType,
          success: false,
          error: error.message,
          duration,
        });

        logger.error(
          `[AgentCoordinator] Subtask ${i + 1}/${subtasks.length} failed: ${error.message}`,
        );

        // Continue to next subtask unless critical
        if (subtask.priority === PRIORITY.CRITICAL) {
          logger.error(
            "[AgentCoordinator] Critical subtask failed, stopping orchestration",
          );
          break;
        }
      }
    }

    return results;
  }

  /**
   * Execute subtasks in parallel (respecting dependencies)
   *
   * @param {string} sessionId - Orchestration session ID
   * @param {Array<Object>} subtasks - Subtasks to execute
   * @param {Object} options - Execution options
   * @returns {Promise<Array<Object>>} Results array
   * @private
   */
  async _executeParallel(sessionId, subtasks, options = {}) {
    const maxConcurrency = options.maxAgents || this.config.maxConcurrentTasks;
    const n = subtasks.length;
    const results = new Array(n).fill(null);
    const completed = new Set(); // original indices that finished
    const started = new Set(); // original indices that were launched
    let running = 0;

    // Resolve a dependency id → its ORIGINAL index. A dependency completes
    // ASYNCHRONOUSLY, so the old scheduler (which advanced a single `index`
    // cursor and `subtasks.push()`-ed deferred tasks back onto the SAME array it
    // used as the loop bound) spun forever: each synchronous pass re-deferred the
    // dep-blocked task and grew subtasks.length in lockstep with the cursor —
    // an unbounded array + infinite loop, plus out-of-bounds writes to `results`
    // (sized to the original length) and duplicate execution. This version never
    // mutates `subtasks`, schedules by scanning for runnable tasks, and tracks
    // each task by its fixed original index.
    const idToIndex = new Map();
    subtasks.forEach((s, i) => {
      if (s.subtaskId != null && !idToIndex.has(s.subtaskId)) {
        idToIndex.set(s.subtaskId, i);
      }
      if (s.id != null && !idToIndex.has(s.id)) {
        idToIndex.set(s.id, i);
      }
    });

    const depsMet = (subtask) => {
      const deps = subtask.dependencies || [];
      return deps.every((depId) => {
        const di = idToIndex.has(depId) ? idToIndex.get(depId) : -1;
        // An unknown dependency id can never be satisfied — let the deadlock
        // path surface it as an error rather than treating it as "met".
        return di >= 0 && completed.has(di);
      });
    };

    if (n === 0) {
      return results;
    }

    return new Promise((resolve) => {
      const tryExecuteNext = () => {
        if (completed.size === n) {
          resolve(results);
          return;
        }

        // Launch every not-yet-started, dependency-satisfied subtask up to the
        // concurrency cap (scan by fixed index — no cursor, no array mutation).
        for (let i = 0; i < n && running < maxConcurrency; i++) {
          if (started.has(i)) {
            continue;
          }
          const subtask = subtasks[i];
          if (!depsMet(subtask)) {
            continue;
          }
          started.add(i);
          running++;

          const currentIndex = i;
          this.emit("orchestration:subtask-start", {
            sessionId,
            subtaskId: subtask.subtaskId || subtask.id,
            index: currentIndex,
            total: n,
          });

          const startTime = Date.now();
          const agentId = subtask.proposedAgent
            ? subtask.proposedAgent.id
            : null;

          const executeSubtask = async () => {
            try {
              let result;
              if (agentId) {
                result = await this.assignTask(agentId, subtask.subtask, {
                  templateType: subtask.agentType,
                  context: options.context || {},
                });
              } else {
                result = {
                  success: false,
                  error: "No agent available for this subtask",
                };
              }
              results[currentIndex] = {
                subtaskId: subtask.subtaskId || subtask.id,
                agentType: subtask.agentType,
                success: result.success,
                result: result.data || result,
                error: result.error || null,
                duration: Date.now() - startTime,
              };
            } catch (error) {
              results[currentIndex] = {
                subtaskId: subtask.subtaskId || subtask.id,
                agentType: subtask.agentType,
                success: false,
                error: error.message,
                duration: Date.now() - startTime,
              };
            } finally {
              completed.add(currentIndex);
              running--;
              this.emit("orchestration:subtask-complete", {
                sessionId,
                subtaskId: subtask.subtaskId || subtask.id,
                index: currentIndex,
                success: results[currentIndex]?.success,
              });
              tryExecuteNext();
            }
          };

          executeSubtask();
        }

        // Deadlock: nothing is running, not everything finished, and no
        // remaining subtask can ever start (circular / unsatisfiable / unknown
        // dependencies). Fill the unfinished slots with errors and resolve.
        if (running === 0 && completed.size < n) {
          const anyRunnable = subtasks.some(
            (s, i) => !started.has(i) && depsMet(s),
          );
          if (!anyRunnable) {
            for (let i = 0; i < n; i++) {
              if (results[i] === null) {
                results[i] = {
                  subtaskId:
                    subtasks[i]?.subtaskId || subtasks[i]?.id || `unknown-${i}`,
                  agentType: subtasks[i]?.agentType || "unknown",
                  success: false,
                  error: "Unresolvable dependencies or scheduling error",
                  duration: 0,
                };
                completed.add(i);
                started.add(i);
              }
            }
            resolve(results);
          }
        }
      };

      tryExecuteNext();
    });
  }

  /**
   * Check if subtasks can run in parallel (no inter-dependencies)
   *
   * @param {Array<Object>} subtasks - Subtasks to check
   * @returns {boolean} True if can run in parallel
   * @private
   */
  _canRunParallel(subtasks) {
    if (subtasks.length <= 1) {
      return false;
    }

    // Check if any subtask has dependencies
    const hasDependencies = subtasks.some(
      (s) => s.dependencies && s.dependencies.length > 0,
    );

    return !hasDependencies;
  }

  /**
   * Resolve execution order based on dependency graph
   *
   * @param {Array<Object>} assignments - Subtask assignments
   * @returns {Array<string>} Ordered subtask IDs
   * @private
   */
  _resolveExecutionOrder(assignments) {
    // Simple topological sort
    const order = [];
    const visited = new Set();
    const inProgress = new Set();

    const visit = (subtask) => {
      const id = subtask.subtaskId;
      if (visited.has(id)) {
        return;
      }
      if (inProgress.has(id)) {
        // Circular dependency, skip
        logger.warn(
          `[AgentCoordinator] Circular dependency detected for subtask: ${id}`,
        );
        return;
      }

      inProgress.add(id);

      // Visit dependencies first
      for (const depId of subtask.dependencies || []) {
        const dep = assignments.find((a) => a.subtaskId === depId);
        if (dep) {
          visit(dep);
        }
      }

      inProgress.delete(id);
      visited.add(id);
      order.push(id);
    };

    for (const assignment of assignments) {
      visit(assignment);
    }

    return order;
  }

  /**
   * Estimate execution time for a plan
   *
   * @param {Array<Object>} assignments - Subtask assignments
   * @returns {number} Estimated time in milliseconds
   * @private
   */
  _estimateExecutionTime(assignments) {
    // Base estimate: 30 seconds per subtask
    const baseTimePerTask = 30000;

    // If sequential, sum up
    const hasDependencies = assignments.some(
      (a) => a.dependencies && a.dependencies.length > 0,
    );

    if (hasDependencies) {
      return assignments.length * baseTimePerTask;
    }

    // If parallel, take the max of concurrent groups
    const concurrency = Math.min(
      assignments.length,
      this.config.maxConcurrentTasks,
    );
    return Math.ceil(assignments.length / concurrency) * baseTimePerTask;
  }

  /**
   * Determine execution strategy based on subtask analysis
   *
   * @param {Array<Object>} assignments - Subtask assignments
   * @param {Object} options - User-provided options
   * @returns {string} Strategy name: 'sequential', 'parallel', or 'mixed'
   * @private
   */
  _determineStrategy(assignments, options = {}) {
    if (options.strategy && options.strategy !== "auto") {
      return options.strategy;
    }

    if (assignments.length <= 1) {
      return "sequential";
    }

    const hasDependencies = assignments.some(
      (a) => a.dependencies && a.dependencies.length > 0,
    );

    if (!hasDependencies) {
      return "parallel";
    }

    // Check if some can run in parallel
    const independentCount = assignments.filter(
      (a) => !a.dependencies || a.dependencies.length === 0,
    ).length;

    if (independentCount > 1) {
      return "mixed";
    }

    return "sequential";
  }

  /**
   * Split task description into logical segments
   *
   * @param {string} description - Task description
   * @returns {string[]} Array of segments
   * @private
   */
  _splitIntoSegments(description) {
    // Split on common delimiters: numbered lists, bullet points, "then", "and then", semicolons
    const segments = description
      .split(/(?:\d+[.)]\s+|[-*]\s+|;\s*|\bthen\b\s+|\band then\b\s+)/i)
      .map((s) => s.trim())
      .filter((s) => s.length > 10); // Filter out very short segments

    return segments.length > 0 ? segments : [description];
  }

  /**
   * Execute a promise with a timeout
   *
   * @param {Promise} promise - Promise to execute
   * @param {number} timeout - Timeout in milliseconds
   * @returns {Promise} Result or timeout error
   * @private
   */
  _executeWithTimeout(promise, timeout) {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(new Error(`Task execution timed out after ${timeout}ms`)),
          timeout,
        ),
      ),
    ]);
  }

  /**
   * Update running average orchestration time
   *
   * @param {number} duration - Latest orchestration duration
   * @private
   */
  _updateAverageTime(duration) {
    const total = this.stats.successfulOrchestrations;
    if (total <= 1) {
      this.stats.averageOrchestrationTime = duration;
    } else {
      this.stats.averageOrchestrationTime = Math.round(
        (this.stats.averageOrchestrationTime * (total - 1) + duration) / total,
      );
    }
  }

  /**
   * Clean up resources
   */
  destroy() {
    this.activeTasks.clear();
    this.orchestrationSessions.clear();
    this.removeAllListeners();
    logger.info("[AgentCoordinator] Destroyed");
  }
}

module.exports = {
  AgentCoordinator,
  TASK_STATUS,
  PRIORITY,
  AGENT_TYPE_KEYWORDS,
};

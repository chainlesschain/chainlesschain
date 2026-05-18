/**
 * Cross-Organization Task Router — v4.0.0
 *
 * Routes tasks across organizational boundaries in the decentralized
 * agent network. Discovers capable executors via FederatedAgentRegistry,
 * selects the best match using AgentReputation scores, and tracks
 * task lifecycle from submission through completion.
 *
 * Supports multiple routing strategies: nearest (network latency),
 * best-reputation, round-robin, and capability-match.
 *
 * Emits events: task:routed, task:completed, task:failed, task:cancelled
 *
 * @module ai-engine/cowork/cross-org-task-router
 */

const { EventEmitter } = require("events");
const { logger } = require("../../utils/logger.js");
const { v4: uuidv4 } = require("uuid");

// ============================================================
// Constants
// ============================================================

const TASK_STATUS = {
  PENDING: "pending",
  ROUTING: "routing",
  EXECUTING: "executing",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

const ROUTING_STRATEGY = {
  NEAREST: "nearest",
  BEST_REPUTATION: "best-reputation",
  ROUND_ROBIN: "round-robin",
  CAPABILITY_MATCH: "capability-match",
};

const DEFAULT_CONFIG = {
  defaultStrategy: ROUTING_STRATEGY.BEST_REPUTATION,
  maxRetries: 3,
  taskTimeoutMs: 300000, // 5 minutes
  routingTimeoutMs: 30000, // 30 seconds
  minReputationScore: 0.3,
  enableCredentialProof: true,
  roundRobinIndex: 0,
  maxConcurrentTasks: 50,
  cleanupIntervalMs: 600000, // 10 minutes
};

// ============================================================
// CrossOrgTaskRouter
// ============================================================

class CrossOrgTaskRouter extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.initialized = false;

    // Dependencies
    this._federatedRegistry = null;
    this._agentReputation = null;

    // In-memory state
    this._activeTasks = new Map(); // taskId → task
    this._roundRobinIndex = 0;
    this._config = { ...DEFAULT_CONFIG };
    this._cleanupTimer = null;
  }

  /**
   * Initialize with database and dependencies
   * @param {Object} db - Database manager
   * @param {Object} deps - { federatedRegistry, agentReputation }
   */
  async initialize(db, deps = {}) {
    if (this.initialized) {
      return;
    }
    this.db = db;
    this._federatedRegistry = deps.federatedRegistry || null;
    this._agentReputation = deps.agentReputation || null;

    this._ensureTables();
    await this._loadActiveTasks();
    this._startCleanupTimer();

    this.initialized = true;
    logger.info(
      `[TaskRouter] Initialized: ${this._activeTasks.size} active tasks, strategy=${this._config.defaultStrategy}`,
    );
  }

  // ============================================================
  // Table Setup
  // ============================================================

  _ensureTables() {
    if (!this.db) {
      return;
    }
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS federated_task_log (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          requester_did TEXT NOT NULL,
          executor_did TEXT,
          task_type TEXT NOT NULL,
          description TEXT,
          status TEXT DEFAULT 'pending',
          input_hash TEXT,
          output_hash TEXT,
          credential_proof TEXT,
          duration_ms INTEGER DEFAULT 0,
          result TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          completed_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_ftl_task_id ON federated_task_log(task_id);
        CREATE INDEX IF NOT EXISTS idx_ftl_requester ON federated_task_log(requester_did);
        CREATE INDEX IF NOT EXISTS idx_ftl_executor ON federated_task_log(executor_did);
        CREATE INDEX IF NOT EXISTS idx_ftl_status ON federated_task_log(status);
        CREATE INDEX IF NOT EXISTS idx_ftl_type ON federated_task_log(task_type);
        CREATE INDEX IF NOT EXISTS idx_ftl_created ON federated_task_log(created_at);
      `);
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }
    } catch (e) {
      logger.error("[TaskRouter] Table creation error:", e.message);
    }
  }

  // ============================================================
  // Configuration
  // ============================================================

  /**
   * Get current configuration
   * @returns {Object} Current config
   */
  getConfig() {
    return { ...this._config };
  }

  /**
   * Update configuration
   * @param {Object} updates - Configuration overrides
   */
  configure(updates = {}) {
    const validKeys = Object.keys(DEFAULT_CONFIG);
    for (const key of Object.keys(updates)) {
      if (validKeys.includes(key)) {
        this._config[key] = updates[key];
      }
    }

    // Restart cleanup timer if interval changed
    if (updates.cleanupIntervalMs !== undefined) {
      this._startCleanupTimer();
    }

    logger.info(
      `[TaskRouter] Configuration updated: ${JSON.stringify(updates)}`,
    );
  }

  // ============================================================
  // Task Routing — Main API
  // ============================================================

  /**
   * Route a task to the best available executor
   * @param {Object} task - { requesterDID, taskType, description, input, requirements, strategy, credentialProof }
   * @returns {Object} Routed task with assigned executor
   */
  async routeTask(task) {
    if (!task || !task.requesterDID || !task.taskType) {
      throw new Error("requesterDID and taskType are required");
    }

    if (this._activeTasks.size >= this._config.maxConcurrentTasks) {
      throw new Error(
        `Maximum concurrent tasks reached (${this._config.maxConcurrentTasks})`,
      );
    }

    const taskId = uuidv4();
    const strategy = task.strategy || this._config.defaultStrategy;
    const now = new Date().toISOString();

    const taskRecord = {
      id: taskId,
      taskId,
      requesterDID: task.requesterDID,
      executorDID: null,
      taskType: task.taskType,
      description: task.description || "",
      status: TASK_STATUS.ROUTING,
      inputHash: task.input ? this._computeHash(task.input) : null,
      outputHash: null,
      credentialProof: task.credentialProof || null,
      durationMs: 0,
      result: null,
      createdAt: now,
      completedAt: null,
      strategy,
      requirements: task.requirements || {},
      retryCount: 0,
    };

    // Persist initial record
    this._persistTask(taskRecord);
    this._activeTasks.set(taskId, taskRecord);

    logger.info(
      `[TaskRouter] Routing task ${taskId}: type=${task.taskType}, strategy=${strategy}`,
    );

    // Find best executor
    try {
      const executor = await this.findBestExecutor(task.requirements || {}, {
        strategy,
        excludeDID: task.requesterDID,
      });

      if (!executor) {
        taskRecord.status = TASK_STATUS.FAILED;
        taskRecord.result = JSON.stringify({
          error: "No suitable executor found",
        });
        taskRecord.completedAt = new Date().toISOString();
        this._updateTaskInDB(taskRecord);
        this._activeTasks.delete(taskId);

        this.emit("task:failed", {
          taskId,
          reason: "no-executor",
          task: taskRecord,
        });

        return taskRecord;
      }

      // Assign executor
      taskRecord.executorDID = executor.agentDID || executor.did;
      taskRecord.status = TASK_STATUS.EXECUTING;
      this._updateTaskInDB(taskRecord);

      this.emit("task:routed", {
        taskId,
        executorDID: taskRecord.executorDID,
        strategy,
        task: taskRecord,
      });

      logger.info(
        `[TaskRouter] Task ${taskId} routed to executor ${taskRecord.executorDID}`,
      );

      // Start execution timeout
      this._startTaskTimeout(taskId);

      return taskRecord;
    } catch (e) {
      logger.error(`[TaskRouter] Routing error for task ${taskId}:`, e.message);

      taskRecord.status = TASK_STATUS.FAILED;
      taskRecord.result = JSON.stringify({ error: e.message });
      taskRecord.completedAt = new Date().toISOString();
      this._updateTaskInDB(taskRecord);
      this._activeTasks.delete(taskId);

      this.emit("task:failed", {
        taskId,
        reason: "routing-error",
        error: e.message,
        task: taskRecord,
      });

      return taskRecord;
    }
  }

  /**
   * Mark a task as completed with result
   * @param {string} taskId - Task ID
   * @param {Object} result - { output, success, executorFeedback }
   * @returns {Object} Updated task
   */
  async completeTask(taskId, result = {}) {
    const task = this._activeTasks.get(taskId);
    if (!task) {
      // Try loading from DB
      const dbTask = this._loadTaskFromDB(taskId);
      if (!dbTask) {
        throw new Error(`Task not found: ${taskId}`);
      }
      if (
        dbTask.status === TASK_STATUS.COMPLETED ||
        dbTask.status === TASK_STATUS.CANCELLED
      ) {
        throw new Error(`Task already ${dbTask.status}: ${taskId}`);
      }
      return this._finalizeTask(dbTask, result);
    }

    return this._finalizeTask(task, result);
  }

  /**
   * Finalize a task with its result
   * @param {Object} task - Task record
   * @param {Object} result - Completion result
   * @returns {Object} Updated task
   */
  _finalizeTask(task, result) {
    const now = new Date().toISOString();
    const startTime = new Date(task.createdAt).getTime();
    const durationMs = Date.now() - startTime;

    task.status = TASK_STATUS.COMPLETED;
    task.result = JSON.stringify(result);
    task.outputHash = result.output ? this._computeHash(result.output) : null;
    task.durationMs = durationMs;
    task.completedAt = now;

    this._updateTaskInDB(task);
    this._activeTasks.delete(task.taskId || task.id);

    // Update executor reputation
    if (this._agentReputation && task.executorDID) {
      try {
        this._agentReputation.updateScore(task.executorDID, {
          success: result.success !== false,
          durationMs,
          quality: result.quality || null,
          taskType: task.taskType,
        });
      } catch (e) {
        logger.warn("[TaskRouter] Reputation update error:", e.message);
      }
    }

    this.emit("task:completed", {
      taskId: task.taskId || task.id,
      executorDID: task.executorDID,
      durationMs,
      task,
    });

    logger.info(
      `[TaskRouter] Task ${task.taskId || task.id} completed in ${durationMs}ms`,
    );

    return task;
  }

  /**
   * Get the current status of a task
   * @param {string} taskId - Task ID
   * @returns {Object|null} Task record
   */
  getTaskStatus(taskId) {
    // Check in-memory first
    const active = this._activeTasks.get(taskId);
    if (active) {
      return { ...active };
    }

    // Fall back to database
    return this._loadTaskFromDB(taskId);
  }

  /**
   * Cancel a pending or executing task
   * @param {string} taskId - Task ID
   * @returns {Object} Cancelled task
   */
  cancelTask(taskId) {
    const task = this._activeTasks.get(taskId) || this._loadTaskFromDB(taskId);

    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    if (
      task.status === TASK_STATUS.COMPLETED ||
      task.status === TASK_STATUS.CANCELLED
    ) {
      throw new Error(`Task already ${task.status}: ${taskId}`);
    }

    task.status = TASK_STATUS.CANCELLED;
    task.completedAt = new Date().toISOString();
    task.durationMs = Date.now() - new Date(task.createdAt).getTime();
    task.result = JSON.stringify({ cancelled: true });

    this._updateTaskInDB(task);
    this._activeTasks.delete(taskId);

    this.emit("task:cancelled", { taskId, task });

    logger.info(`[TaskRouter] Task ${taskId} cancelled`);

    return task;
  }

  /**
   * Get task log with optional filters
   * @param {Object} filter - { requesterDID, executorDID, taskType, status, limit, offset, since }
   * @returns {Array} Task log entries
   */
  getTaskLog(filter = {}) {
    const conditions = [];
    const params = [];

    if (filter.requesterDID) {
      conditions.push("requester_did = ?");
      params.push(filter.requesterDID);
    }
    if (filter.executorDID) {
      conditions.push("executor_did = ?");
      params.push(filter.executorDID);
    }
    if (filter.taskType) {
      conditions.push("task_type = ?");
      params.push(filter.taskType);
    }
    if (filter.status) {
      conditions.push("status = ?");
      params.push(filter.status);
    }
    if (filter.since) {
      conditions.push("created_at >= ?");
      params.push(filter.since);
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filter.limit || 50;
    const offset = filter.offset || 0;

    try {
      const rows = this.db
        .prepare(
          `SELECT * FROM federated_task_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        )
        .all(...params, limit, offset);
      return rows.map((r) => this._rowToTask(r));
    } catch (e) {
      logger.error("[TaskRouter] getTaskLog error:", e.message);
      return [];
    }
  }

  // ============================================================
  // Executor Discovery
  // ============================================================

  /**
   * Find the best executor for the given requirements
   * @param {Object} requirements - { capabilities, minReputation, preferredOrg, taskType }
   * @param {Object} options - { strategy, excludeDID }
   * @returns {Object|null} Best executor agent
   */
  async findBestExecutor(requirements = {}, options = {}) {
    const strategy = options.strategy || this._config.defaultStrategy;
    const excludeDID = options.excludeDID || null;

    // Discover candidate agents from federated registry
    let candidates = await this._discoverCandidates(requirements);

    // Exclude requester
    if (excludeDID) {
      candidates = candidates.filter(
        (c) => (c.agentDID || c.did) !== excludeDID,
      );
    }

    if (candidates.length === 0) {
      logger.warn("[TaskRouter] No candidate executors found");
      return null;
    }

    // Apply routing strategy
    switch (strategy) {
      case ROUTING_STRATEGY.NEAREST:
        return this._selectNearest(candidates);

      case ROUTING_STRATEGY.BEST_REPUTATION:
        return await this._selectBestReputation(candidates, requirements);

      case ROUTING_STRATEGY.ROUND_ROBIN:
        return this._selectRoundRobin(candidates);

      case ROUTING_STRATEGY.CAPABILITY_MATCH:
        return this._selectCapabilityMatch(candidates, requirements);

      default:
        return await this._selectBestReputation(candidates, requirements);
    }
  }

  /**
   * Discover candidate agents from the federated registry
   * @param {Object} requirements - Search requirements
   * @returns {Array} Candidate agents
   */
  async _discoverCandidates(requirements) {
    if (!this._federatedRegistry) {
      logger.warn("[TaskRouter] No federated registry available");
      return [];
    }

    try {
      const query = {};
      if (requirements.capabilities) {
        query.capabilities = requirements.capabilities;
      }
      if (requirements.taskType) {
        query.taskType = requirements.taskType;
      }
      if (requirements.preferredOrg) {
        query.orgId = requirements.preferredOrg;
      }

      const agents =
        typeof this._federatedRegistry.discoverAgents === "function"
          ? await this._federatedRegistry.discoverAgents(query)
          : typeof this._federatedRegistry.getAgents === "function"
            ? await this._federatedRegistry.getAgents(query)
            : [];

      return Array.isArray(agents) ? agents : [];
    } catch (e) {
      logger.error("[TaskRouter] Candidate discovery error:", e.message);
      return [];
    }
  }

  /**
   * Select executor with lowest network latency
   * @param {Array} candidates - Candidate agents
   * @returns {Object|null} Selected agent
   */
  _selectNearest(candidates) {
    if (candidates.length === 0) {
      return null;
    }

    // Sort by latency (lower is better), fallback to first
    const sorted = [...candidates].sort((a, b) => {
      const latA = a.latencyMs || a.metadata?.latencyMs || Infinity;
      const latB = b.latencyMs || b.metadata?.latencyMs || Infinity;
      return latA - latB;
    });

    return sorted[0];
  }

  /**
   * Select executor with best reputation score
   * @param {Array} candidates - Candidate agents
   * @param {Object} requirements - Requirements for minimum reputation
   * @returns {Object|null} Selected agent
   */
  async _selectBestReputation(candidates, requirements = {}) {
    if (candidates.length === 0) {
      return null;
    }

    const minScore =
      requirements.minReputation || this._config.minReputationScore;

    // Fetch reputation scores for all candidates
    const scored = [];
    for (const candidate of candidates) {
      const did = candidate.agentDID || candidate.did;
      let score = 0.5; // default neutral

      if (this._agentReputation) {
        try {
          const repData = this._agentReputation.getScore(did);
          score =
            typeof repData === "number" ? repData : (repData?.score ?? 0.5);
        } catch (e) {
          // Use default score
        }
      }

      if (score >= minScore) {
        scored.push({ candidate, score });
      }
    }

    if (scored.length === 0) {
      // No candidates meet minimum reputation, return best available
      logger.warn(
        `[TaskRouter] No candidates meet minimum reputation ${minScore}, selecting best available`,
      );
      return candidates[0];
    }

    scored.sort((a, b) => b.score - a.score);
    return scored[0].candidate;
  }

  /**
   * Select executor using round-robin rotation
   * @param {Array} candidates - Candidate agents
   * @returns {Object} Selected agent
   */
  _selectRoundRobin(candidates) {
    if (candidates.length === 0) {
      return null;
    }

    const index = this._roundRobinIndex % candidates.length;
    this._roundRobinIndex++;
    return candidates[index];
  }

  /**
   * Select executor with best capability match
   * @param {Array} candidates - Candidate agents
   * @param {Object} requirements - Required capabilities
   * @returns {Object|null} Selected agent
   */
  _selectCapabilityMatch(candidates, requirements = {}) {
    if (candidates.length === 0) {
      return null;
    }

    const requiredCaps = requirements.capabilities || [];
    if (requiredCaps.length === 0) {
      return candidates[0];
    }

    // Score each candidate by capability overlap
    const scored = candidates.map((candidate) => {
      const agentCaps = candidate.capabilities || candidate.skills || [];
      const agentCapSet = new Set(
        agentCaps.map((c) => (typeof c === "string" ? c : c.name || c.id)),
      );

      let matchCount = 0;
      for (const req of requiredCaps) {
        const reqName = typeof req === "string" ? req : req.name || req.id;
        if (agentCapSet.has(reqName)) {
          matchCount++;
        }
      }

      return {
        candidate,
        matchScore:
          requiredCaps.length > 0 ? matchCount / requiredCaps.length : 0,
        matchCount,
      };
    });

    scored.sort((a, b) => b.matchScore - a.matchScore);

    // Return best match if it has at least one capability match
    if (scored[0].matchCount > 0) {
      return scored[0].candidate;
    }

    return null;
  }

  // ============================================================
  // Task Timeout Management
  // ============================================================

  /**
   * Start a timeout for a task
   * @param {string} taskId - Task ID
   */
  _startTaskTimeout(taskId) {
    const timeoutMs = this._config.taskTimeoutMs;

    setTimeout(() => {
      const task = this._activeTasks.get(taskId);
      if (task && task.status === TASK_STATUS.EXECUTING) {
        logger.warn(
          `[TaskRouter] Task ${taskId} timed out after ${timeoutMs}ms`,
        );

        task.status = TASK_STATUS.FAILED;
        task.result = JSON.stringify({
          error: "Task execution timed out",
          timeoutMs,
        });
        task.completedAt = new Date().toISOString();
        task.durationMs = Date.now() - new Date(task.createdAt).getTime();

        this._updateTaskInDB(task);
        this._activeTasks.delete(taskId);

        // Update executor reputation for timeout
        if (this._agentReputation && task.executorDID) {
          try {
            this._agentReputation.updateScore(task.executorDID, {
              success: false,
              durationMs: task.durationMs,
              taskType: task.taskType,
              reason: "timeout",
            });
          } catch (e) {
            // Non-critical
          }
        }

        this.emit("task:failed", {
          taskId,
          reason: "timeout",
          task,
        });
      }
    }, timeoutMs);
  }

  // ============================================================
  // Retry Logic
  // ============================================================

  /**
   * Retry a failed task
   * @param {string} taskId - Task ID to retry
   * @returns {Object} New task record
   */
  async retryTask(taskId) {
    const task = this._activeTasks.get(taskId) || this._loadTaskFromDB(taskId);

    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    if (task.status !== TASK_STATUS.FAILED) {
      throw new Error(
        `Can only retry failed tasks, current status: ${task.status}`,
      );
    }

    if ((task.retryCount || 0) >= this._config.maxRetries) {
      throw new Error(
        `Maximum retries (${this._config.maxRetries}) exceeded for task ${taskId}`,
      );
    }

    logger.info(
      `[TaskRouter] Retrying task ${taskId} (attempt ${(task.retryCount || 0) + 1})`,
    );

    // Create a new routing attempt with the same parameters
    const retryTask = await this.routeTask({
      requesterDID: task.requesterDID,
      taskType: task.taskType,
      description: task.description,
      requirements: task.requirements || {},
      strategy: task.strategy,
      credentialProof: task.credentialProof,
    });

    retryTask.retryCount = (task.retryCount || 0) + 1;
    this._updateTaskInDB(retryTask);

    return retryTask;
  }

  // ============================================================
  // Statistics
  // ============================================================

  /**
   * Get router statistics
   * @returns {Object} Stats
   */
  getStats() {
    try {
      const total = this.db
        .prepare("SELECT COUNT(*) as count FROM federated_task_log")
        .get().count;

      const byStatus = this.db
        .prepare(
          "SELECT status, COUNT(*) as count FROM federated_task_log GROUP BY status",
        )
        .all();

      const byType = this.db
        .prepare(
          "SELECT task_type, COUNT(*) as count FROM federated_task_log GROUP BY task_type ORDER BY count DESC LIMIT 10",
        )
        .all();

      const avgDuration = this.db
        .prepare(
          "SELECT AVG(duration_ms) as avg FROM federated_task_log WHERE status = 'completed' AND duration_ms > 0",
        )
        .get();

      const successCount = this.db
        .prepare(
          "SELECT COUNT(*) as count FROM federated_task_log WHERE status = 'completed'",
        )
        .get().count;

      const failedCount = this.db
        .prepare(
          "SELECT COUNT(*) as count FROM federated_task_log WHERE status = 'failed'",
        )
        .get().count;

      return {
        totalTasks: total,
        activeTasks: this._activeTasks.size,
        byStatus: byStatus.reduce((acc, r) => {
          acc[r.status] = r.count;
          return acc;
        }, {}),
        byType: byType.reduce((acc, r) => {
          acc[r.task_type] = r.count;
          return acc;
        }, {}),
        avgDurationMs: avgDuration?.avg ? Math.round(avgDuration.avg) : 0,
        successRate:
          total > 0
            ? parseFloat(
                (successCount / (successCount + failedCount || 1)).toFixed(3),
              )
            : 0,
        strategy: this._config.defaultStrategy,
      };
    } catch (e) {
      logger.error("[TaskRouter] stats error:", e.message);
      return {
        totalTasks: 0,
        activeTasks: this._activeTasks.size,
        byStatus: {},
        byType: {},
        avgDurationMs: 0,
        successRate: 0,
        strategy: this._config.defaultStrategy,
      };
    }
  }

  // ============================================================
  // Cleanup
  // ============================================================

  /**
   * Start periodic cleanup of stale tasks
   */
  _startCleanupTimer() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
    }

    this._cleanupTimer = setInterval(() => {
      this._cleanupStaleTasks();
    }, this._config.cleanupIntervalMs);

    // Do not prevent process exit
    if (this._cleanupTimer.unref) {
      this._cleanupTimer.unref();
    }
  }

  /**
   * Clean up tasks stuck in routing/executing state beyond timeout
   */
  _cleanupStaleTasks() {
    const now = Date.now();
    let cleaned = 0;

    for (const [taskId, task] of this._activeTasks.entries()) {
      const age = now - new Date(task.createdAt).getTime();

      if (
        task.status === TASK_STATUS.ROUTING &&
        age > this._config.routingTimeoutMs
      ) {
        task.status = TASK_STATUS.FAILED;
        task.result = JSON.stringify({ error: "Routing timeout" });
        task.completedAt = new Date().toISOString();
        task.durationMs = age;
        this._updateTaskInDB(task);
        this._activeTasks.delete(taskId);
        cleaned++;
      } else if (
        task.status === TASK_STATUS.EXECUTING &&
        age > this._config.taskTimeoutMs * 2
      ) {
        task.status = TASK_STATUS.FAILED;
        task.result = JSON.stringify({ error: "Execution stale timeout" });
        task.completedAt = new Date().toISOString();
        task.durationMs = age;
        this._updateTaskInDB(task);
        this._activeTasks.delete(taskId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info(`[TaskRouter] Cleaned up ${cleaned} stale tasks`);
    }
  }

  /**
   * Destroy the router and clean up timers
   */
  destroy() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
    this._activeTasks.clear();
    this.removeAllListeners();
    this.initialized = false;
    logger.info("[TaskRouter] Destroyed");
  }

  // ============================================================
  // Persistence Helpers
  // ============================================================

  _persistTask(task) {
    try {
      this.db.run(
        `INSERT INTO federated_task_log
          (id, task_id, requester_did, executor_did, task_type, description, status, input_hash, output_hash, credential_proof, duration_ms, result, created_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          task.id,
          task.taskId,
          task.requesterDID,
          task.executorDID,
          task.taskType,
          task.description,
          task.status,
          task.inputHash,
          task.outputHash,
          task.credentialProof,
          task.durationMs,
          task.result,
          task.createdAt,
          task.completedAt,
        ],
      );
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }
    } catch (e) {
      logger.error("[TaskRouter] Persist task error:", e.message);
    }
  }

  _updateTaskInDB(task) {
    try {
      this.db.run(
        `UPDATE federated_task_log
         SET executor_did = ?, status = ?, output_hash = ?, duration_ms = ?, result = ?, completed_at = ?
         WHERE id = ?`,
        [
          task.executorDID,
          task.status,
          task.outputHash,
          task.durationMs,
          task.result,
          task.completedAt,
          task.id,
        ],
      );
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }
    } catch (e) {
      logger.error("[TaskRouter] Update task error:", e.message);
    }
  }

  _loadTaskFromDB(taskId) {
    try {
      const row = this.db
        .prepare(
          "SELECT * FROM federated_task_log WHERE task_id = ? OR id = ? LIMIT 1",
        )
        .get(taskId, taskId);
      return row ? this._rowToTask(row) : null;
    } catch (e) {
      logger.error("[TaskRouter] Load task error:", e.message);
      return null;
    }
  }

  async _loadActiveTasks() {
    try {
      const rows = this.db
        .prepare(
          `SELECT * FROM federated_task_log WHERE status IN ('pending', 'routing', 'executing')`,
        )
        .all();

      for (const row of rows) {
        const task = this._rowToTask(row);
        this._activeTasks.set(task.taskId, task);
      }
    } catch (e) {
      logger.error("[TaskRouter] Load active tasks error:", e.message);
    }
  }

  _rowToTask(row) {
    return {
      id: row.id,
      taskId: row.task_id,
      requesterDID: row.requester_did,
      executorDID: row.executor_did,
      taskType: row.task_type,
      description: row.description,
      status: row.status,
      inputHash: row.input_hash,
      outputHash: row.output_hash,
      credentialProof: row.credential_proof,
      durationMs: row.duration_ms,
      result: safeParseJSON(row.result),
      createdAt: row.created_at,
      completedAt: row.completed_at,
    };
  }

  // ============================================================
  // Utility
  // ============================================================

  /**
   * Compute a SHA-256 hash of data for integrity verification
   * @param {*} data - Data to hash
   * @returns {string} Hex hash (first 32 chars)
   */
  _computeHash(data) {
    const crypto = require("crypto");
    const str = typeof data === "string" ? data : JSON.stringify(data);
    return crypto.createHash("sha256").update(str).digest("hex").slice(0, 32);
  }
}

// ============================================================
// Utility
// ============================================================

function safeParseJSON(str) {
  if (!str) {
    return null;
  }
  if (typeof str === "object") {
    return str;
  }
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

// Singleton
let instance = null;

function getCrossOrgTaskRouter() {
  if (!instance) {
    instance = new CrossOrgTaskRouter();
  }
  return instance;
}

module.exports = {
  CrossOrgTaskRouter,
  getCrossOrgTaskRouter,
  TASK_STATUS,
  ROUTING_STRATEGY,
};

/**
 * Hybrid Executor — v2.0.0
 *
 * Intelligent task routing engine that evaluates task requirements against
 * device capabilities. Routes lightweight tasks locally and heavy tasks
 * to capable remote devices. Supports fallback strategies, load balancing,
 * and retry-on-failure with automatic re-routing.
 *
 * @module ai-engine/cowork/hybrid-executor
 */

const EventEmitter = require("events");
const { logger } = require("../../utils/logger.js");
const { v4: uuidv4 } = require("uuid");

/**
 * Execution strategies
 */
const EXEC_STRATEGY = {
  LOCAL_ONLY: "local-only", // Always execute locally
  REMOTE_ONLY: "remote-only", // Always delegate to remote
  LOCAL_FIRST: "local-first", // Try local, fallback to remote
  REMOTE_FIRST: "remote-first", // Try remote, fallback to local
  BEST_FIT: "best-fit", // Route to best capable device
  LOAD_BALANCE: "load-balance", // Distribute evenly across devices
};

/**
 * Task weight categories
 */
const TASK_WEIGHT = {
  LIGHT: "light", // < 5s, low compute (text analysis, formatting)
  MEDIUM: "medium", // 5-30s, moderate compute (code review, testing)
  HEAVY: "heavy", // 30s+, high compute (LLM inference, image processing)
  GPU: "gpu", // Requires GPU (vision, ML training)
};

/**
 * Default configuration
 */
const DEFAULTS = {
  defaultStrategy: EXEC_STRATEGY.BEST_FIT,
  maxRetries: 2,
  retryDelay: 3000,
  executionTimeout: 300000, // 5 min
  loadBalanceWindow: 60000, // 1 min rolling window for load stats
  preferLocalThreshold: 0.7, // Prefer local if score ratio ≥ 0.7
};

/**
 * Skill → weight classification (built-in heuristics)
 */
const SKILL_WEIGHT_MAP = {
  // Light skills
  "text-transformer": TASK_WEIGHT.LIGHT,
  "json-yaml-toolkit": TASK_WEIGHT.LIGHT,
  "regex-playground": TASK_WEIGHT.LIGHT,
  "clipboard-manager": TASK_WEIGHT.LIGHT,
  "color-picker": TASK_WEIGHT.LIGHT,
  "password-generator": TASK_WEIGHT.LIGHT,
  "snippet-library": TASK_WEIGHT.LIGHT,
  "markdown-enhancer": TASK_WEIGHT.LIGHT,

  // Medium skills
  "code-review": TASK_WEIGHT.MEDIUM,
  "explain-code": TASK_WEIGHT.MEDIUM,
  "git-commit": TASK_WEIGHT.MEDIUM,
  "lint-and-fix": TASK_WEIGHT.MEDIUM,
  "test-generator": TASK_WEIGHT.MEDIUM,
  "security-audit": TASK_WEIGHT.MEDIUM,
  refactor: TASK_WEIGHT.MEDIUM,
  "doc-generator": TASK_WEIGHT.MEDIUM,
  "dependency-analyzer": TASK_WEIGHT.MEDIUM,

  // Heavy skills
  "data-analysis": TASK_WEIGHT.HEAVY,
  "web-scraping": TASK_WEIGHT.HEAVY,
  "browser-automation": TASK_WEIGHT.HEAVY,
  "research-agent": TASK_WEIGHT.HEAVY,
  "knowledge-graph": TASK_WEIGHT.HEAVY,
  "image-generator": TASK_WEIGHT.HEAVY,
  "video-toolkit": TASK_WEIGHT.HEAVY,
  "audio-transcriber": TASK_WEIGHT.HEAVY,

  // GPU skills
  "computer-use": TASK_WEIGHT.GPU,
  "image-editor": TASK_WEIGHT.GPU,
  "ocr-scanner": TASK_WEIGHT.GPU,
  "screenshot-to-code": TASK_WEIGHT.GPU,
};

/**
 * HybridExecutor — Intelligent task routing
 */
class HybridExecutor extends EventEmitter {
  /**
   * @param {Object} options
   * @param {Object} options.p2pNetwork - P2PAgentNetwork instance
   * @param {Object} options.deviceDiscovery - DeviceDiscovery instance
   * @param {Object} options.skillRegistry - SkillRegistry instance (local)
   * @param {Object} options.config - Override defaults
   */
  constructor(options = {}) {
    super();
    this.p2pNetwork = options.p2pNetwork || null;
    this.deviceDiscovery = options.deviceDiscovery || null;
    this.skillRegistry = options.skillRegistry || null;

    this.config = { ...DEFAULTS, ...options.config };
    this.initialized = false;

    // Execution history for load balancing
    this.executionHistory = [];

    // Active executions: executionId → { task, device, startedAt }
    this.activeExecutions = new Map();

    // Stats
    this.stats = {
      totalExecutions: 0,
      localExecutions: 0,
      remoteExecutions: 0,
      fallbacks: 0,
      failures: 0,
      avgDurationMs: 0,
    };
  }

  /**
   * Initialize hybrid executor
   */
  async initialize() {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
    logger.info("[HybridExecutor] Initialized");
    this.emit("initialized");
  }

  // ============================================================
  // Core Execution
  // ============================================================

  /**
   * Execute a task using the optimal device
   * @param {Object} task - { skillId, input, description, strategy, weight, timeout }
   * @returns {Promise<Object>} Execution result
   */
  async execute(task) {
    const executionId = `exec-${uuidv4().slice(0, 12)}`;
    const startedAt = Date.now();

    const strategy = task.strategy || this.config.defaultStrategy;
    const weight = task.weight || this._classifyWeight(task.skillId);
    const timeout = task.timeout || this.config.executionTimeout;

    this.activeExecutions.set(executionId, {
      task,
      strategy,
      weight,
      startedAt,
    });

    this.emit("execution-started", { executionId, task, strategy, weight });

    try {
      const result = await this._executeWithStrategy(
        executionId,
        task,
        strategy,
        weight,
        timeout,
      );

      const duration = Date.now() - startedAt;
      this._recordExecution(executionId, task, result, duration, false);

      this.emit("execution-completed", {
        executionId,
        task,
        result,
        duration,
        executedOn: result._executedOn || "local",
      });

      return result;
    } catch (error) {
      const duration = Date.now() - startedAt;
      this._recordExecution(executionId, task, null, duration, true);

      this.emit("execution-failed", {
        executionId,
        task,
        error: error.message,
        duration,
      });

      throw error;
    } finally {
      this.activeExecutions.delete(executionId);
    }
  }

  /**
   * Execute a batch of tasks with load balancing
   * @param {Object[]} tasks - Array of task definitions
   * @param {Object} options - { concurrency, strategy }
   * @returns {Promise<Object[]>} Results array (same order as tasks)
   */
  async executeBatch(tasks, options = {}) {
    const concurrency = options.concurrency || 3;
    const results = new Array(tasks.length).fill(null);
    const errors = new Array(tasks.length).fill(null);

    // Execute in batches
    for (let i = 0; i < tasks.length; i += concurrency) {
      const batch = tasks.slice(i, i + concurrency);
      const batchResults = await Promise.allSettled(
        batch.map((task, idx) =>
          this.execute({
            ...task,
            strategy: options.strategy || EXEC_STRATEGY.LOAD_BALANCE,
          }).then((r) => ({ index: i + idx, result: r })),
        ),
      );

      for (const settled of batchResults) {
        if (settled.status === "fulfilled") {
          results[settled.value.index] = settled.value.result;
        } else {
          const idx = i + batchResults.indexOf(settled);
          errors[idx] = settled.reason?.message || "Unknown error";
        }
      }
    }

    return results.map((result, idx) => ({
      success: !errors[idx],
      result,
      error: errors[idx],
    }));
  }

  // ============================================================
  // Strategy Implementation
  // ============================================================

  async _executeWithStrategy(executionId, task, strategy, weight, timeout) {
    switch (strategy) {
      case EXEC_STRATEGY.LOCAL_ONLY:
        return this._executeLocal(task, timeout);

      case EXEC_STRATEGY.REMOTE_ONLY:
        return this._executeRemote(task, timeout);

      case EXEC_STRATEGY.LOCAL_FIRST:
        return this._executeLocalFirst(task, timeout);

      case EXEC_STRATEGY.REMOTE_FIRST:
        return this._executeRemoteFirst(task, timeout);

      case EXEC_STRATEGY.BEST_FIT:
        return this._executeBestFit(task, weight, timeout);

      case EXEC_STRATEGY.LOAD_BALANCE:
        return this._executeLoadBalanced(task, timeout);

      default:
        return this._executeBestFit(task, weight, timeout);
    }
  }

  async _executeLocal(task, timeout) {
    if (!this.skillRegistry) {
      throw new Error("Local skill registry not available");
    }

    const skill = this.skillRegistry.getSkill(task.skillId);
    if (!skill) {
      throw new Error(`Skill not found locally: ${task.skillId}`);
    }

    const result = await this._withTimeout(
      this.skillRegistry.executeSkill(task.skillId, {
        description: task.description,
        ...task.input,
      }),
      timeout,
    );

    result._executedOn = "local";
    return result;
  }

  async _executeRemote(task, timeout) {
    const target = this._findBestRemoteDevice(task.skillId);
    if (!target) {
      throw new Error(`No remote device available for skill: ${task.skillId}`);
    }

    const result = await this._withTimeout(
      this.p2pNetwork.delegateTask(target.peerId, {
        id: task.id,
        skillId: task.skillId,
        description: task.description,
        input: task.input,
        priority: task.priority,
        timeout,
      }),
      timeout,
    );

    result._executedOn = `remote:${target.deviceId}`;
    return result;
  }

  async _executeLocalFirst(task, timeout) {
    // Try local
    try {
      if (this.skillRegistry?.getSkill(task.skillId)) {
        return await this._executeLocal(task, timeout);
      }
    } catch (localErr) {
      logger.info(
        `[HybridExecutor] Local execution failed, falling back to remote: ${localErr.message}`,
      );
      this.stats.fallbacks++;
    }

    // Fallback to remote
    return this._executeRemote(task, timeout);
  }

  async _executeRemoteFirst(task, timeout) {
    // Try remote
    try {
      const target = this._findBestRemoteDevice(task.skillId);
      if (target) {
        return await this._executeRemote(task, timeout);
      }
    } catch (remoteErr) {
      logger.info(
        `[HybridExecutor] Remote execution failed, falling back to local: ${remoteErr.message}`,
      );
      this.stats.fallbacks++;
    }

    // Fallback to local
    return this._executeLocal(task, timeout);
  }

  async _executeBestFit(task, weight, timeout) {
    // Score local vs remote
    const localScore = this._scoreLocalExecution(task.skillId, weight);
    const remoteTarget = this._findBestRemoteDevice(task.skillId);
    const remoteScore = remoteTarget
      ? this._scoreRemoteExecution(remoteTarget, weight)
      : 0;

    if (
      localScore > 0 &&
      (remoteScore === 0 ||
        localScore / Math.max(remoteScore, 1) >=
          this.config.preferLocalThreshold)
    ) {
      // Execute locally
      try {
        return await this._executeLocal(task, timeout);
      } catch (err) {
        if (remoteTarget) {
          this.stats.fallbacks++;
          return this._executeRemote(task, timeout);
        }
        throw err;
      }
    } else if (remoteTarget) {
      // Execute remotely
      try {
        return await this._executeRemote(task, timeout);
      } catch (err) {
        if (localScore > 0) {
          this.stats.fallbacks++;
          return this._executeLocal(task, timeout);
        }
        throw err;
      }
    }

    throw new Error(
      `No device available for skill: ${task.skillId} (local: ${localScore}, remote: ${remoteScore})`,
    );
  }

  async _executeLoadBalanced(task, timeout) {
    // Count recent executions per device
    const recentCutoff = Date.now() - this.config.loadBalanceWindow;
    const loadMap = new Map();

    for (const entry of this.executionHistory) {
      if (entry.timestamp < recentCutoff) {
        continue;
      }
      const key = entry.executedOn || "local";
      loadMap.set(key, (loadMap.get(key) || 0) + 1);
    }

    // Get all capable devices
    const candidates = [];

    // Local
    if (this.skillRegistry?.getSkill(task.skillId)) {
      candidates.push({
        type: "local",
        device: null,
        load: loadMap.get("local") || 0,
      });
    }

    // Remote
    if (this.deviceDiscovery) {
      const remoteDevices = this.deviceDiscovery.findDevicesForSkill(
        task.skillId,
      );
      for (const { device } of remoteDevices) {
        if (device.isLocal) {
          continue;
        }
        const key = `remote:${device.deviceId}`;
        candidates.push({
          type: "remote",
          device,
          load: loadMap.get(key) || 0,
        });
      }
    }

    if (candidates.length === 0) {
      throw new Error(`No device available for skill: ${task.skillId}`);
    }

    // Select least loaded
    candidates.sort((a, b) => a.load - b.load);
    const selected = candidates[0];

    if (selected.type === "local") {
      return this._executeLocal(task, timeout);
    } else {
      const result = await this._withTimeout(
        this.p2pNetwork.delegateTask(selected.device.peerId, {
          skillId: task.skillId,
          description: task.description,
          input: task.input,
          timeout,
        }),
        timeout,
      );
      result._executedOn = `remote:${selected.device.deviceId}`;
      return result;
    }
  }

  // ============================================================
  // Scoring
  // ============================================================

  _scoreLocalExecution(skillId, weight) {
    if (!this.skillRegistry?.getSkill(skillId)) {
      return 0;
    }

    let score = 50; // Base score for local availability

    // Light tasks strongly prefer local
    if (weight === TASK_WEIGHT.LIGHT) {
      score += 40;
    }
    if (weight === TASK_WEIGHT.MEDIUM) {
      score += 20;
    }
    if (weight === TASK_WEIGHT.HEAVY) {
      score += 5;
    }
    if (weight === TASK_WEIGHT.GPU) {
      score += 10;
    }

    // Adjust by current local load
    const activeLocal = Array.from(this.activeExecutions.values()).filter(
      (e) => !e.executedOn || e.executedOn === "local",
    ).length;
    score -= activeLocal * 10;

    return Math.max(0, score);
  }

  _scoreRemoteExecution(target, weight) {
    let score = 30; // Base score

    // Heavy/GPU tasks prefer powerful remote devices
    if (weight === TASK_WEIGHT.HEAVY) {
      score += 30;
    }
    if (weight === TASK_WEIGHT.GPU) {
      score += 40;
    }
    if (weight === TASK_WEIGHT.MEDIUM) {
      score += 15;
    }
    if (weight === TASK_WEIGHT.LIGHT) {
      score -= 10;
    } // Latency penalty

    // Resource bonus
    if (target.resources?.cpus > 4) {
      score += 15;
    }
    if (target.resources?.heapTotalMB > 4096) {
      score += 10;
    }

    return Math.max(0, score);
  }

  _classifyWeight(skillId) {
    return SKILL_WEIGHT_MAP[skillId] || TASK_WEIGHT.MEDIUM;
  }

  // ============================================================
  // Statistics
  // ============================================================

  _recordExecution(executionId, task, result, duration, failed) {
    this.stats.totalExecutions++;
    if (failed) {
      this.stats.failures++;
    }

    const executedOn = result?._executedOn || "local";
    if (executedOn === "local") {
      this.stats.localExecutions++;
    } else {
      this.stats.remoteExecutions++;
    }

    // Rolling average duration
    this.stats.avgDurationMs =
      (this.stats.avgDurationMs * (this.stats.totalExecutions - 1) + duration) /
      this.stats.totalExecutions;

    this.executionHistory.push({
      executionId,
      skillId: task.skillId,
      executedOn,
      duration,
      failed,
      timestamp: Date.now(),
    });

    // Trim history (keep last 1000)
    if (this.executionHistory.length > 1000) {
      this.executionHistory = this.executionHistory.slice(-500);
    }
  }

  /**
   * Get executor statistics
   * @returns {Object}
   */
  getStats() {
    return {
      ...this.stats,
      activeExecutions: this.activeExecutions.size,
      successRate:
        this.stats.totalExecutions > 0
          ? (
              (this.stats.totalExecutions - this.stats.failures) /
              this.stats.totalExecutions
            ).toFixed(3)
          : "N/A",
      localRatio:
        this.stats.totalExecutions > 0
          ? (this.stats.localExecutions / this.stats.totalExecutions).toFixed(3)
          : "N/A",
    };
  }

  // ============================================================
  // Internal: Helpers
  // ============================================================

  _findBestRemoteDevice(skillId) {
    if (!this.deviceDiscovery) {
      return null;
    }

    const candidates = this.deviceDiscovery.findDevicesForSkill(skillId);
    for (const { device } of candidates) {
      if (!device.isLocal && device.state === "online") {
        return device;
      }
    }
    return null;
  }

  _withTimeout(promise, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Execution timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      promise
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }
}

// Singleton
let _instance = null;

function getHybridExecutor() {
  if (!_instance) {
    _instance = new HybridExecutor();
  }
  return _instance;
}

module.exports = {
  HybridExecutor,
  getHybridExecutor,
  EXEC_STRATEGY,
  TASK_WEIGHT,
};

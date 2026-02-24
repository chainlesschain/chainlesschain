/**
 * Rollback Manager — Automated Rollback Execution (v3.3)
 *
 * Supports multiple rollback strategies:
 * - Git revert: undo commits via isomorphic-git
 * - Docker rollback: revert to previous container image
 * - Config rollback: restore previous configuration snapshot
 * - Service restart: restart services after rollback
 *
 * Tracks rollback history and success/failure metrics.
 *
 * @module ai-engine/cowork/rollback-manager
 */

const { EventEmitter } = require("events");
const { logger } = require("../../utils/logger.js");

// ============================================================
// Constants
// ============================================================

const ROLLBACK_TYPE = {
  GIT_REVERT: "git-revert",
  DOCKER_ROLLBACK: "docker-rollback",
  CONFIG_RESTORE: "config-restore",
  SERVICE_RESTART: "service-restart",
  CUSTOM: "custom",
};

const ROLLBACK_STATUS = {
  PENDING: "pending",
  RUNNING: "running",
  SUCCESS: "success",
  FAILED: "failed",
};

const DEFAULT_CONFIG = {
  enabled: true,
  maxHistorySize: 100,
  configSnapshotDir: ".chainlesschain/rollback-snapshots",
  defaultTimeoutMs: 60000,
  autoGitRevert: false,
  keepSnapshots: 10,
};

// ============================================================
// RollbackManager Class
// ============================================================

class RollbackManager extends EventEmitter {
  constructor() {
    super();
    this.initialized = false;
    this.db = null;
    this.config = { ...DEFAULT_CONFIG };
    this.history = [];
    this.configSnapshots = new Map();
    this.stats = {
      totalRollbacks: 0,
      successCount: 0,
      failureCount: 0,
      rollbackTypeDistribution: {},
      averageDurationMs: 0,
    };
    this._durations = [];
  }

  /**
   * Initialize
   * @param {Object} db - Database instance
   */
  async initialize(db) {
    if (this.initialized) {
      return;
    }
    this.db = db;
    logger.info("[RollbackManager] Initialized");
    this.initialized = true;
  }

  // ============================================================
  // Public API
  // ============================================================

  /**
   * Execute a rollback operation
   * @param {Object} options
   * @param {string} [options.type] - Rollback type
   * @param {string} options.reason - Why we're rolling back
   * @param {string} [options.incidentId] - Related incident
   * @param {Array} [options.completedSteps] - Steps to undo
   * @param {Object} [options.target] - Rollback target details
   * @returns {Object} Rollback result
   */
  async rollback(options = {}) {
    if (!this.initialized || !this.config.enabled) {
      return { success: false, error: "RollbackManager disabled" };
    }

    const rollbackId = `rb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const startTime = Date.now();

    this.stats.totalRollbacks++;

    const type = options.type || this._inferRollbackType(options);
    this.stats.rollbackTypeDistribution[type] =
      (this.stats.rollbackTypeDistribution[type] || 0) + 1;

    logger.info(
      `[RollbackManager] Starting ${type} rollback: ${rollbackId} reason=${options.reason}`,
    );

    try {
      let result;

      switch (type) {
        case ROLLBACK_TYPE.GIT_REVERT:
          result = await this._gitRevert(options);
          break;
        case ROLLBACK_TYPE.DOCKER_ROLLBACK:
          result = await this._dockerRollback(options);
          break;
        case ROLLBACK_TYPE.CONFIG_RESTORE:
          result = await this._configRestore(options);
          break;
        case ROLLBACK_TYPE.SERVICE_RESTART:
          result = await this._serviceRestart(options);
          break;
        default:
          result = await this._undoSteps(options.completedSteps || []);
          break;
      }

      const elapsed = Date.now() - startTime;
      const success = result.success !== false;

      if (success) {
        this.stats.successCount++;
      } else {
        this.stats.failureCount++;
      }

      this._durations.push(elapsed);
      if (this._durations.length > 100) {
        this._durations.shift();
      }
      this.stats.averageDurationMs = Math.round(
        this._durations.reduce((a, b) => a + b, 0) / this._durations.length,
      );

      const record = {
        id: rollbackId,
        type,
        reason: options.reason,
        incidentId: options.incidentId || null,
        status: success ? ROLLBACK_STATUS.SUCCESS : ROLLBACK_STATUS.FAILED,
        result,
        duration: elapsed,
        timestamp: new Date().toISOString(),
      };

      this.history.unshift(record);
      if (this.history.length > this.config.maxHistorySize) {
        this.history.pop();
      }

      this.emit("rollback:completed", record);

      logger.info(
        `[RollbackManager] ${type} rollback ${success ? "succeeded" : "failed"} (${elapsed}ms)`,
      );

      return {
        success,
        rollbackId,
        type,
        duration: elapsed,
        details: result,
      };
    } catch (error) {
      this.stats.failureCount++;
      logger.error(`[RollbackManager] Rollback error: ${error.message}`);
      return {
        success: false,
        rollbackId,
        type,
        error: error.message,
      };
    }
  }

  /**
   * Take a config snapshot for later rollback
   * @param {string} name - Snapshot name
   * @param {Object} config - Configuration to snapshot
   * @returns {string} Snapshot ID
   */
  takeSnapshot(name, config) {
    const snapshotId = `snap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    this.configSnapshots.set(snapshotId, {
      id: snapshotId,
      name,
      config: JSON.parse(JSON.stringify(config)),
      timestamp: new Date().toISOString(),
    });

    // Evict old snapshots
    if (this.configSnapshots.size > this.config.keepSnapshots) {
      const oldest = [...this.configSnapshots.entries()]
        .sort((a, b) => a[1].timestamp.localeCompare(b[1].timestamp))
        .slice(0, this.configSnapshots.size - this.config.keepSnapshots);
      for (const [key] of oldest) {
        this.configSnapshots.delete(key);
      }
    }

    logger.info(`[RollbackManager] Snapshot taken: ${name} (${snapshotId})`);
    return snapshotId;
  }

  /**
   * Get rollback history
   * @param {number} [limit=20]
   * @returns {Array}
   */
  getHistory(limit = 20) {
    return this.history.slice(0, limit);
  }

  /**
   * Get stats
   */
  getStats() {
    return {
      ...this.stats,
      snapshotCount: this.configSnapshots.size,
      historySize: this.history.length,
    };
  }

  /**
   * Get config
   */
  getConfig() {
    return { ...this.config };
  }

  /**
   * Update config
   */
  configure(updates) {
    Object.assign(this.config, updates);
    return this.getConfig();
  }

  // ============================================================
  // Rollback Strategies
  // ============================================================

  async _gitRevert(options) {
    // Git revert via isomorphic-git or shell command
    try {
      const target = options.target || {};
      const commitHash = target.commitHash;

      if (!commitHash) {
        return {
          success: false,
          error: "No commit hash specified for git revert",
        };
      }

      // Emit event for external handler to perform actual git revert
      this.emit("action:git-revert", {
        commitHash,
        reason: options.reason,
      });

      logger.info(`[RollbackManager] Git revert queued: ${commitHash}`);
      return {
        success: true,
        action: "git-revert",
        commitHash,
        simulated: true,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async _dockerRollback(options) {
    const target = options.target || {};
    const service = target.service;
    const previousImage = target.previousImage;

    if (!service) {
      return {
        success: false,
        error: "No service specified for docker rollback",
      };
    }

    this.emit("action:docker-rollback", {
      service,
      previousImage,
      reason: options.reason,
    });

    logger.info(
      `[RollbackManager] Docker rollback queued: ${service} → ${previousImage || "previous"}`,
    );
    return {
      success: true,
      action: "docker-rollback",
      service,
      simulated: true,
    };
  }

  async _configRestore(options) {
    const target = options.target || {};
    const snapshotId = target.snapshotId;

    if (!snapshotId) {
      // Restore latest snapshot
      const snapshots = [...this.configSnapshots.values()].sort((a, b) =>
        b.timestamp.localeCompare(a.timestamp),
      );
      if (snapshots.length === 0) {
        return { success: false, error: "No config snapshots available" };
      }
      const latest = snapshots[0];
      this.emit("action:config-restore", { snapshot: latest });
      return { success: true, action: "config-restore", snapshotId: latest.id };
    }

    const snapshot = this.configSnapshots.get(snapshotId);
    if (!snapshot) {
      return { success: false, error: `Snapshot not found: ${snapshotId}` };
    }

    this.emit("action:config-restore", { snapshot });
    return { success: true, action: "config-restore", snapshotId };
  }

  async _serviceRestart(options) {
    const target = options.target || {};
    const service = target.service || "main";

    this.emit("action:service-restart", {
      service,
      reason: options.reason,
    });

    logger.info(`[RollbackManager] Service restart queued: ${service}`);
    return {
      success: true,
      action: "service-restart",
      service,
      simulated: true,
    };
  }

  async _undoSteps(completedSteps) {
    if (!completedSteps || completedSteps.length === 0) {
      return { success: true, message: "No steps to undo" };
    }

    // Reverse the completed steps
    const undone = [];
    for (let i = completedSteps.length - 1; i >= 0; i--) {
      const step = completedSteps[i];
      this.emit("action:undo-step", step);
      undone.push({ action: step.action, target: step.target, undone: true });
    }

    return { success: true, undoneSteps: undone };
  }

  // ============================================================
  // Helpers
  // ============================================================

  _inferRollbackType(options) {
    const completedSteps = options.completedSteps || [];

    // Check if any step was a git operation
    for (const step of completedSteps) {
      if (step.action === "git-commit" || step.action === "git-push") {
        return ROLLBACK_TYPE.GIT_REVERT;
      }
      if (step.action === "docker-deploy") {
        return ROLLBACK_TYPE.DOCKER_ROLLBACK;
      }
      if (step.action === "config-update") {
        return ROLLBACK_TYPE.CONFIG_RESTORE;
      }
    }

    return ROLLBACK_TYPE.CUSTOM;
  }
}

// ============================================================
// Singleton
// ============================================================

let instance = null;

function getRollbackManager() {
  if (!instance) {
    instance = new RollbackManager();
  }
  return instance;
}

module.exports = {
  RollbackManager,
  getRollbackManager,
  ROLLBACK_TYPE,
  ROLLBACK_STATUS,
};

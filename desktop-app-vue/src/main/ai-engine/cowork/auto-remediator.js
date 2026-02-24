/**
 * Auto Remediator — Playbook-based Auto-Remediation Engine (v3.3)
 *
 * Orchestrates automatic remediation for detected incidents:
 * - YAML-like playbook definitions (stored as JSON)
 * - Condition matching against incident severity & metric type
 * - Multi-step remediation execution with timeout
 * - Rollback-on-failure integration with RollbackManager
 * - Success/failure tracking per playbook
 *
 * @module ai-engine/cowork/auto-remediator
 */

const { EventEmitter } = require("events");
const { logger } = require("../../utils/logger.js");

// ============================================================
// Constants
// ============================================================

const REMEDIATION_STATUS = {
  PENDING: "pending",
  RUNNING: "running",
  SUCCESS: "success",
  FAILED: "failed",
  ROLLED_BACK: "rolled-back",
  SKIPPED: "skipped",
};

const ACTION_TYPES = {
  RESTART_SERVICE: "restart-service",
  CLEAR_CACHE: "clear-cache",
  SCALE_DOWN: "scale-down",
  SCALE_UP: "scale-up",
  KILL_PROCESS: "kill-process",
  RELOAD_CONFIG: "reload-config",
  RUN_SCRIPT: "run-script",
  NOTIFY: "notify",
  ROLLBACK: "rollback",
};

const DEFAULT_CONFIG = {
  enabled: true,
  maxConcurrentRemediations: 3,
  defaultStepTimeoutMs: 30000,
  maxRetries: 2,
  cooldownMs: 60000,
  autoTrigger: true,
};

// ============================================================
// Built-in Playbook Templates
// ============================================================

const BUILTIN_PLAYBOOKS = [
  {
    id: "pb-high-memory",
    name: "high-memory-remediation",
    description:
      "High memory usage auto-fix: clear caches + scale down workers",
    trigger: {
      metric: "memory_usage",
      condition: "above_threshold",
      minSeverity: "P2",
    },
    steps: [
      {
        action: ACTION_TYPES.CLEAR_CACHE,
        target: "embedding-cache",
        timeout: 10000,
      },
      {
        action: ACTION_TYPES.SCALE_DOWN,
        target: "worker-pool",
        params: { minWorkers: 1 },
        timeout: 15000,
      },
    ],
    rollbackOnFailure: true,
    notifyChannels: ["webhook"],
    enabled: true,
  },
  {
    id: "pb-high-cpu",
    name: "high-cpu-remediation",
    description:
      "High CPU usage: kill resource-heavy processes + restart service",
    trigger: {
      metric: "cpu_usage",
      condition: "above_threshold",
      minSeverity: "P2",
    },
    steps: [
      {
        action: ACTION_TYPES.KILL_PROCESS,
        target: "resource-heavy",
        timeout: 5000,
      },
      {
        action: ACTION_TYPES.RESTART_SERVICE,
        target: "ai-service",
        timeout: 30000,
      },
    ],
    rollbackOnFailure: true,
    notifyChannels: ["webhook", "email"],
    enabled: true,
  },
  {
    id: "pb-error-spike",
    name: "error-spike-remediation",
    description: "Error rate spike: reload config + restart affected service",
    trigger: {
      metric: "error_rate",
      condition: "above_threshold",
      minSeverity: "P1",
    },
    steps: [
      {
        action: ACTION_TYPES.RELOAD_CONFIG,
        target: "main-config",
        timeout: 5000,
      },
      {
        action: ACTION_TYPES.RESTART_SERVICE,
        target: "affected-service",
        timeout: 30000,
      },
    ],
    rollbackOnFailure: true,
    notifyChannels: ["webhook", "email"],
    enabled: true,
  },
];

// ============================================================
// AutoRemediator Class
// ============================================================

class AutoRemediator extends EventEmitter {
  constructor() {
    super();
    this.initialized = false;
    this.db = null;
    this.rollbackManager = null;
    this.alertManager = null;
    this.config = { ...DEFAULT_CONFIG };
    this.playbooks = new Map();
    this.activeRemediations = new Map();
    this.cooldowns = new Map();
    this.stats = {
      totalTriggered: 0,
      successCount: 0,
      failureCount: 0,
      rollbackCount: 0,
      skippedCount: 0,
      averageDurationMs: 0,
    };
    this._durations = [];
  }

  /**
   * Initialize with database and dependencies
   * @param {Object} db - Database instance
   * @param {Object} deps - Dependencies
   * @param {Object} [deps.rollbackManager] - RollbackManager instance
   * @param {Object} [deps.alertManager] - AlertManager instance
   */
  async initialize(db, deps = {}) {
    if (this.initialized) {
      return;
    }

    this.db = db;
    this.rollbackManager = deps.rollbackManager || null;
    this.alertManager = deps.alertManager || null;

    // Load playbooks from DB
    this._loadPlaybooks();

    // Register built-in playbooks if none exist
    if (this.playbooks.size === 0) {
      for (const pb of BUILTIN_PLAYBOOKS) {
        this.playbooks.set(pb.id, { ...pb });
        this._savePlaybook(pb);
      }
    }

    logger.info(
      `[AutoRemediator] Initialized with ${this.playbooks.size} playbooks`,
    );
    this.initialized = true;
  }

  // ============================================================
  // Public API
  // ============================================================

  /**
   * Trigger remediation for an incident
   * @param {Object} incident - Incident from IncidentClassifier
   * @returns {Object} Remediation result
   */
  async triggerRemediation(incident) {
    if (!this.initialized || !this.config.enabled) {
      return { status: REMEDIATION_STATUS.SKIPPED, reason: "disabled" };
    }

    // Check concurrent limit
    if (this.activeRemediations.size >= this.config.maxConcurrentRemediations) {
      this.stats.skippedCount++;
      return {
        status: REMEDIATION_STATUS.SKIPPED,
        reason: "max-concurrent-reached",
      };
    }

    // Find matching playbook
    const playbook = this._findMatchingPlaybook(incident);
    if (!playbook) {
      this.stats.skippedCount++;
      return {
        status: REMEDIATION_STATUS.SKIPPED,
        reason: "no-matching-playbook",
      };
    }

    // Check cooldown
    const cooldownKey = `${playbook.id}:${incident.metricName}`;
    if (this._isInCooldown(cooldownKey)) {
      this.stats.skippedCount++;
      return { status: REMEDIATION_STATUS.SKIPPED, reason: "cooldown-active" };
    }

    const remediationId = `rem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const startTime = Date.now();

    this.stats.totalTriggered++;
    this.activeRemediations.set(remediationId, {
      id: remediationId,
      incidentId: incident.id,
      playbookId: playbook.id,
      startTime,
    });

    logger.info(
      `[AutoRemediator] Triggering ${playbook.name} for incident ${incident.id}`,
    );

    try {
      // Execute playbook steps sequentially
      const stepResults = [];
      let allSuccess = true;

      for (let i = 0; i < playbook.steps.length; i++) {
        const step = playbook.steps[i];
        const stepResult = await this._executeStep(step, incident, i);
        stepResults.push(stepResult);

        if (!stepResult.success) {
          allSuccess = false;
          logger.error(
            `[AutoRemediator] Step ${i} failed: ${stepResult.error}`,
          );

          // Rollback if configured
          if (playbook.rollbackOnFailure && this.rollbackManager?.initialized) {
            const rollbackResult = await this._performRollback(
              remediationId,
              stepResults,
              incident,
            );
            stepResults.push({
              action: "rollback",
              success: rollbackResult.success,
              error: rollbackResult.error,
            });
            this.stats.rollbackCount++;
          }

          break;
        }
      }

      const elapsed = Date.now() - startTime;
      const status = allSuccess
        ? REMEDIATION_STATUS.SUCCESS
        : playbook.rollbackOnFailure
          ? REMEDIATION_STATUS.ROLLED_BACK
          : REMEDIATION_STATUS.FAILED;

      // Update stats
      if (allSuccess) {
        this.stats.successCount++;
        this._updatePlaybookStats(playbook.id, true, elapsed);
      } else {
        this.stats.failureCount++;
        this._updatePlaybookStats(playbook.id, false, elapsed);
      }

      this._durations.push(elapsed);
      if (this._durations.length > 100) {
        this._durations.shift();
      }
      this.stats.averageDurationMs = Math.round(
        this._durations.reduce((a, b) => a + b, 0) / this._durations.length,
      );

      // Set cooldown
      this._setCooldown(cooldownKey);

      // Notify
      if (
        this.alertManager?.initialized &&
        playbook.notifyChannels?.length > 0
      ) {
        this.alertManager.sendAlert({
          type: "remediation-result",
          remediationId,
          incidentId: incident.id,
          playbook: playbook.name,
          status,
          duration: elapsed,
          channels: playbook.notifyChannels,
        });
      }

      const result = {
        remediationId,
        incidentId: incident.id,
        playbookId: playbook.id,
        playbookName: playbook.name,
        status,
        steps: stepResults,
        duration: elapsed,
      };

      this.activeRemediations.delete(remediationId);
      this.emit("remediation:completed", result);

      logger.info(`[AutoRemediator] ${playbook.name} ${status} (${elapsed}ms)`);

      return result;
    } catch (error) {
      this.activeRemediations.delete(remediationId);
      this.stats.failureCount++;
      logger.error(`[AutoRemediator] Remediation error: ${error.message}`);
      return {
        remediationId,
        status: REMEDIATION_STATUS.FAILED,
        error: error.message,
      };
    }
  }

  /**
   * Get all playbooks
   * @returns {Array} Playbooks
   */
  getPlaybooks() {
    return [...this.playbooks.values()];
  }

  /**
   * Get a specific playbook
   * @param {string} playbookId
   * @returns {Object|null}
   */
  getPlaybook(playbookId) {
    return this.playbooks.get(playbookId) || null;
  }

  /**
   * Create a new playbook
   * @param {Object} playbook - Playbook definition
   * @returns {Object} Created playbook
   */
  createPlaybook(playbook) {
    const id =
      playbook.id ||
      `pb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const newPlaybook = {
      id,
      name: playbook.name || "unnamed-playbook",
      description: playbook.description || "",
      trigger: playbook.trigger || {},
      steps: playbook.steps || [],
      rollbackOnFailure: playbook.rollbackOnFailure !== false,
      notifyChannels: playbook.notifyChannels || [],
      enabled: playbook.enabled !== false,
      createdAt: new Date().toISOString(),
    };

    this.playbooks.set(id, newPlaybook);
    this._savePlaybook(newPlaybook);

    this.emit("playbook:created", { id, name: newPlaybook.name });
    logger.info(`[AutoRemediator] Created playbook: ${newPlaybook.name}`);

    return newPlaybook;
  }

  /**
   * Update a playbook
   * @param {string} playbookId
   * @param {Object} updates
   * @returns {Object} Updated playbook
   */
  updatePlaybook(playbookId, updates) {
    const existing = this.playbooks.get(playbookId);
    if (!existing) {
      throw new Error(`Playbook not found: ${playbookId}`);
    }

    const updated = { ...existing, ...updates, id: playbookId };
    this.playbooks.set(playbookId, updated);
    this._updatePlaybookDB(updated);

    return updated;
  }

  /**
   * Get stats
   */
  getStats() {
    return {
      ...this.stats,
      activeRemediations: this.activeRemediations.size,
      playbookCount: this.playbooks.size,
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
  // Playbook Matching
  // ============================================================

  _findMatchingPlaybook(incident) {
    const severityOrder = ["P0", "P1", "P2", "P3"];

    for (const [, playbook] of this.playbooks) {
      if (!playbook.enabled) {
        continue;
      }

      const trigger = playbook.trigger;
      if (!trigger) {
        continue;
      }

      // Match metric name
      if (trigger.metric && incident.metricName) {
        if (!incident.metricName.includes(trigger.metric)) {
          continue;
        }
      }

      // Match minimum severity
      if (trigger.minSeverity) {
        const incidentIdx = severityOrder.indexOf(incident.severity);
        const minIdx = severityOrder.indexOf(trigger.minSeverity);
        if (incidentIdx < 0 || minIdx < 0) {
          continue;
        }
        if (incidentIdx > minIdx) {
          continue;
        } // Lower severity = skip
      }

      return playbook;
    }

    return null;
  }

  // ============================================================
  // Step Execution
  // ============================================================

  async _executeStep(step, incident, stepIndex) {
    const timeout = step.timeout || this.config.defaultStepTimeoutMs;
    const startTime = Date.now();

    try {
      const result = await Promise.race([
        this._runAction(step, incident),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Step timeout")), timeout),
        ),
      ]);

      return {
        action: step.action,
        target: step.target,
        success: true,
        duration: Date.now() - startTime,
        result,
      };
    } catch (error) {
      return {
        action: step.action,
        target: step.target,
        success: false,
        duration: Date.now() - startTime,
        error: error.message,
      };
    }
  }

  async _runAction(step, incident) {
    // Simulated action execution — in production these would interface
    // with actual system management APIs
    switch (step.action) {
      case ACTION_TYPES.RESTART_SERVICE:
        logger.info(`[AutoRemediator] Restarting service: ${step.target}`);
        this.emit("action:restart", { target: step.target, incident });
        return { action: "restart", target: step.target, simulated: true };

      case ACTION_TYPES.CLEAR_CACHE:
        logger.info(`[AutoRemediator] Clearing cache: ${step.target}`);
        this.emit("action:clear-cache", { target: step.target });
        return { action: "clear-cache", target: step.target, simulated: true };

      case ACTION_TYPES.SCALE_DOWN:
        logger.info(
          `[AutoRemediator] Scaling down: ${step.target} params=${JSON.stringify(step.params)}`,
        );
        this.emit("action:scale", {
          target: step.target,
          direction: "down",
          params: step.params,
        });
        return { action: "scale-down", target: step.target, simulated: true };

      case ACTION_TYPES.SCALE_UP:
        logger.info(`[AutoRemediator] Scaling up: ${step.target}`);
        this.emit("action:scale", {
          target: step.target,
          direction: "up",
          params: step.params,
        });
        return { action: "scale-up", target: step.target, simulated: true };

      case ACTION_TYPES.KILL_PROCESS:
        logger.info(`[AutoRemediator] Killing process: ${step.target}`);
        this.emit("action:kill", { target: step.target });
        return { action: "kill-process", target: step.target, simulated: true };

      case ACTION_TYPES.RELOAD_CONFIG:
        logger.info(`[AutoRemediator] Reloading config: ${step.target}`);
        this.emit("action:reload-config", { target: step.target });
        return {
          action: "reload-config",
          target: step.target,
          simulated: true,
        };

      case ACTION_TYPES.NOTIFY:
        if (this.alertManager?.initialized) {
          await this.alertManager.sendAlert({
            type: "remediation-step",
            action: step.action,
            target: step.target,
            incident,
          });
        }
        return { action: "notify", target: step.target };

      default:
        logger.warn(`[AutoRemediator] Unknown action: ${step.action}`);
        return { action: step.action, target: step.target, unknown: true };
    }
  }

  // ============================================================
  // Rollback
  // ============================================================

  async _performRollback(remediationId, stepResults, incident) {
    try {
      if (!this.rollbackManager?.initialized) {
        return { success: false, error: "RollbackManager not available" };
      }

      const result = await this.rollbackManager.rollback({
        reason: `Remediation ${remediationId} failed`,
        incidentId: incident.id,
        completedSteps: stepResults.filter((s) => s.success),
      });

      return result;
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ============================================================
  // Cooldown
  // ============================================================

  _isInCooldown(key) {
    const until = this.cooldowns.get(key);
    if (!until) {
      return false;
    }
    if (Date.now() >= until) {
      this.cooldowns.delete(key);
      return false;
    }
    return true;
  }

  _setCooldown(key) {
    this.cooldowns.set(key, Date.now() + this.config.cooldownMs);
  }

  // ============================================================
  // Persistence
  // ============================================================

  _loadPlaybooks() {
    if (!this.db) {
      return;
    }
    try {
      const rows = this.db
        .prepare("SELECT * FROM ops_remediation_playbooks ORDER BY created_at")
        .all();
      for (const row of rows) {
        const pb = {
          id: row.id,
          name: row.name,
          description: row.description,
          trigger: JSON.parse(row.trigger_config || "{}"),
          steps: JSON.parse(row.steps || "[]"),
          rollbackOnFailure: Boolean(row.rollback_on_failure),
          notifyChannels: JSON.parse(row.notify_channels || "[]"),
          enabled: row.enabled !== 0,
          successCount: row.success_count || 0,
          failureCount: row.failure_count || 0,
          avgDuration: row.avg_duration_ms || 0,
          createdAt: row.created_at,
        };
        this.playbooks.set(pb.id, pb);
      }
    } catch (error) {
      logger.warn(`[AutoRemediator] Load playbooks error: ${error.message}`);
    }
  }

  _savePlaybook(pb) {
    if (!this.db) {
      return;
    }
    try {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO ops_remediation_playbooks
           (id, name, description, trigger_config, steps, rollback_on_failure,
            notify_channels, enabled, success_count, failure_count, avg_duration_ms, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, datetime('now'), datetime('now'))`,
        )
        .run(
          pb.id,
          pb.name,
          pb.description || "",
          JSON.stringify(pb.trigger || {}),
          JSON.stringify(pb.steps || []),
          pb.rollbackOnFailure ? 1 : 0,
          JSON.stringify(pb.notifyChannels || []),
          pb.enabled ? 1 : 0,
        );
    } catch (error) {
      logger.warn(`[AutoRemediator] Save playbook error: ${error.message}`);
    }
  }

  _updatePlaybookDB(pb) {
    if (!this.db) {
      return;
    }
    try {
      this.db
        .prepare(
          `UPDATE ops_remediation_playbooks
           SET name = ?, description = ?, trigger_config = ?, steps = ?,
               rollback_on_failure = ?, notify_channels = ?, enabled = ?, updated_at = datetime('now')
           WHERE id = ?`,
        )
        .run(
          pb.name,
          pb.description || "",
          JSON.stringify(pb.trigger || {}),
          JSON.stringify(pb.steps || []),
          pb.rollbackOnFailure ? 1 : 0,
          JSON.stringify(pb.notifyChannels || []),
          pb.enabled ? 1 : 0,
          pb.id,
        );
    } catch (error) {
      logger.warn(`[AutoRemediator] Update playbook error: ${error.message}`);
    }
  }

  _updatePlaybookStats(playbookId, success, duration) {
    if (!this.db) {
      return;
    }
    try {
      const col = success ? "success_count" : "failure_count";
      this.db
        .prepare(
          `UPDATE ops_remediation_playbooks
           SET ${col} = ${col} + 1,
               avg_duration_ms = (avg_duration_ms * (success_count + failure_count) + ?) / (success_count + failure_count + 1),
               updated_at = datetime('now')
           WHERE id = ?`,
        )
        .run(duration, playbookId);
    } catch (error) {
      logger.warn(`[AutoRemediator] Update stats error: ${error.message}`);
    }
  }
}

// ============================================================
// Singleton
// ============================================================

let instance = null;

function getAutoRemediator() {
  if (!instance) {
    instance = new AutoRemediator();
  }
  return instance;
}

module.exports = {
  AutoRemediator,
  getAutoRemediator,
  REMEDIATION_STATUS,
  ACTION_TYPES,
};

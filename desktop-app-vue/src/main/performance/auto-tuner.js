/**
 * Auto-Tuner — Rule-based Performance Auto-Tuning Engine
 *
 * Evaluates a set of tuning rules against live performance metrics
 * and automatically applies corrective actions when thresholds are exceeded.
 *
 * Built-in rules:
 * - db-slow-queries: Increase SQLite cache and enable WAL on persistent slow queries
 * - db-vacuum: Schedule VACUUM after extended uptime
 * - llm-high-latency: Reduce context window on sustained high LLM latency
 * - memory-pressure: Trigger GC and emit warning on high memory usage
 * - p2p-connections: Reduce max connections when connection count is excessive
 *
 * Supports custom rules, cooldown/hysteresis, and manual trigger.
 *
 * @module performance/auto-tuner
 * @version 1.0.0
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");

/**
 * Default cooldown period for rules (10 minutes)
 * @type {number}
 */
const DEFAULT_COOLDOWN_MS = 10 * 60 * 1000;

/**
 * Default evaluation interval (5 minutes)
 * @type {number}
 */
const DEFAULT_EVAL_INTERVAL_MS = 5 * 60 * 1000;

class AutoTuner extends EventEmitter {
  constructor() {
    super();

    /**
     * Map of rule id -> rule object
     * @type {Map<string, Object>}
     */
    this.rules = new Map();

    /**
     * History of tuning actions
     * @type {Array<Object>}
     */
    this.history = [];

    /**
     * Maximum history entries to keep
     * @type {number}
     */
    this.maxHistory = 500;

    /**
     * Whether the evaluation loop is running
     * @type {boolean}
     */
    this.running = false;

    /**
     * Evaluation interval timer
     * @type {NodeJS.Timeout|null}
     */
    this._intervalId = null;

    /**
     * Evaluation interval in milliseconds
     * @type {number}
     */
    this.evalInterval = DEFAULT_EVAL_INTERVAL_MS;

    /**
     * Dependency references
     * @type {Object}
     */
    this.deps = {
      database: null,
      performanceCollector: null,
      performanceMonitor: null,
    };

    /**
     * Statistics
     * @type {Object}
     */
    this._stats = {
      totalEvaluations: 0,
      totalTriggers: 0,
      lastEvaluationTime: null,
    };
  }

  /**
   * Initialize with dependency references
   * @param {Object} dependencies
   * @param {Object} [dependencies.database] - Database instance
   * @param {Object} [dependencies.performanceCollector] - UnifiedPerformanceCollector
   * @param {Object} [dependencies.performanceMonitor] - PerformanceMonitor
   */
  initialize(dependencies = {}) {
    this.deps.database = dependencies.database || null;
    this.deps.performanceCollector = dependencies.performanceCollector || null;
    this.deps.performanceMonitor = dependencies.performanceMonitor || null;

    // Load built-in rules
    this._loadDefaultRules();

    logger.info("[AutoTuner] Initialized", {
      database: !!this.deps.database,
      performanceCollector: !!this.deps.performanceCollector,
      performanceMonitor: !!this.deps.performanceMonitor,
      rulesLoaded: this.rules.size,
    });
  }

  /**
   * Load built-in tuning rules
   * @private
   */
  _loadDefaultRules() {
    const self = this;

    // Rule 1: Database slow queries
    this.rules.set("db-slow-queries", {
      id: "db-slow-queries",
      name: "Database Slow Query Optimization",
      description:
        "If average query time exceeds 100ms for 3 consecutive checks, increase SQLite cache_size and enable WAL mode",
      enabled: true,
      condition(metrics) {
        const dbSummary = metrics.ipc || {};
        const avgLatency = dbSummary.avgLatency || 0;
        return avgLatency > 100;
      },
      action(metrics) {
        const actions = [];

        // Increase SQLite cache_size
        if (self.deps.database) {
          try {
            const db = self.deps.database.db || self.deps.database;
            if (typeof db.pragma === "function") {
              db.pragma("cache_size = 20000");
              actions.push("Set cache_size to 20000");
            }
            if (typeof db.pragma === "function") {
              db.pragma("journal_mode = WAL");
              actions.push("Enabled WAL journal mode");
            }
          } catch (error) {
            actions.push(`DB optimization failed: ${error.message}`);
          }
        } else {
          actions.push("Database not available, skipping optimization");
        }

        return actions.join("; ");
      },
      cooldownMs: DEFAULT_COOLDOWN_MS,
      lastTriggered: null,
      triggerCount: 0,
      consecutiveRequired: 3,
      consecutiveCount: 0,
    });

    // Rule 2: Database VACUUM scheduling
    this.rules.set("db-vacuum", {
      id: "db-vacuum",
      name: "Database VACUUM Scheduling",
      description:
        "If uptime exceeds 24h and last VACUUM was over 7 days ago, schedule a VACUUM",
      enabled: true,
      condition(metrics) {
        const snapshot = metrics;
        const uptime = snapshot.uptime || 0;
        const uptimeHours = uptime / (1000 * 60 * 60);

        // Check if uptime > 24h
        if (uptimeHours < 24) {
          return false;
        }

        // Check last vacuum time (rule-level state)
        const rule = self.rules.get("db-vacuum");
        const lastVacuum = rule._lastVacuumTime || 0;
        const daysSinceVacuum =
          (Date.now() - lastVacuum) / (1000 * 60 * 60 * 24);

        return daysSinceVacuum > 7;
      },
      action(_metrics) {
        if (self.deps.database) {
          try {
            const db = self.deps.database.db || self.deps.database;
            if (typeof db.exec === "function") {
              db.prepare("VACUUM").run();
            } else if (typeof db.run === "function") {
              db.run("VACUUM");
            }

            // Record vacuum time
            const rule = self.rules.get("db-vacuum");
            rule._lastVacuumTime = Date.now();

            return "VACUUM executed successfully";
          } catch (error) {
            return `VACUUM failed: ${error.message}`;
          }
        }
        return "Database not available, skipping VACUUM";
      },
      cooldownMs: 24 * 60 * 60 * 1000, // 24h cooldown
      lastTriggered: null,
      triggerCount: 0,
      consecutiveRequired: 1,
      consecutiveCount: 0,
      _lastVacuumTime: 0,
    });

    // Rule 3: LLM high latency
    this.rules.set("llm-high-latency", {
      id: "llm-high-latency",
      name: "LLM High Latency Mitigation",
      description:
        "If average LLM latency exceeds 10s for 2 consecutive checks, reduce context window by 20%",
      enabled: true,
      condition(metrics) {
        const llm = metrics.llm || {};
        return (llm.latency || 0) > 10000;
      },
      action(_metrics) {
        self.emit("llm-latency-reduction", { reductionPercent: 20 });
        return "Emitted llm-latency-reduction event (reduce context window by 20%)";
      },
      cooldownMs: DEFAULT_COOLDOWN_MS,
      lastTriggered: null,
      triggerCount: 0,
      consecutiveRequired: 2,
      consecutiveCount: 0,
    });

    // Rule 4: Memory pressure
    this.rules.set("memory-pressure", {
      id: "memory-pressure",
      name: "Memory Pressure Relief",
      description:
        "If memory usage exceeds 85%, emit memory-pressure event and trigger GC",
      enabled: true,
      condition(metrics) {
        const system = metrics.system || {};
        return (system.memory || 0) > 85;
      },
      action(metrics) {
        const actions = [];

        // Emit memory pressure event
        self.emit("memory-pressure", {
          memoryUsage: metrics.system?.memory || 0,
          timestamp: Date.now(),
        });
        actions.push("Emitted memory-pressure event");

        // Trigger GC if available
        if (global.gc) {
          try {
            global.gc();
            actions.push("Triggered garbage collection");
          } catch (error) {
            actions.push(`GC trigger failed: ${error.message}`);
          }
        } else {
          actions.push("GC not exposed (run with --expose-gc to enable)");
        }

        return actions.join("; ");
      },
      cooldownMs: 2 * 60 * 1000, // 2 min cooldown (more aggressive)
      lastTriggered: null,
      triggerCount: 0,
      consecutiveRequired: 1,
      consecutiveCount: 0,
    });

    // Rule 5: P2P connections
    this.rules.set("p2p-connections", {
      id: "p2p-connections",
      name: "P2P Connection Limit",
      description:
        "If active connections exceed 50, reduce max connections setting",
      enabled: true,
      condition(metrics) {
        // Check from dashboard summary if available
        if (self.deps.performanceCollector) {
          try {
            const summary =
              self.deps.performanceCollector.getDashboardSummary("5m");
            return (summary.activeConnections || 0) > 50;
          } catch {
            // Fall through
          }
        }
        return false;
      },
      action(_metrics) {
        self.emit("p2p-reduce-connections", {
          reason: "Active connections exceeded threshold (50)",
          suggestedMax: 30,
        });
        return "Emitted p2p-reduce-connections event (suggested max: 30)";
      },
      cooldownMs: DEFAULT_COOLDOWN_MS,
      lastTriggered: null,
      triggerCount: 0,
      consecutiveRequired: 1,
      consecutiveCount: 0,
    });
  }

  /**
   * Start the auto-tuning evaluation loop
   */
  start() {
    if (this.running) {
      logger.info("[AutoTuner] Already running");
      return;
    }

    logger.info("[AutoTuner] Starting evaluation loop", {
      intervalMs: this.evalInterval,
      enabledRules: [...this.rules.values()].filter((r) => r.enabled).length,
    });

    this.running = true;

    // Evaluate immediately, then on interval
    this.evaluate();
    this._intervalId = setInterval(() => {
      this.evaluate();
    }, this.evalInterval);
  }

  /**
   * Stop the auto-tuning evaluation loop
   */
  stop() {
    if (!this.running) {
      return;
    }

    logger.info("[AutoTuner] Stopping evaluation loop");
    this.running = false;

    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
  }

  /**
   * Add a custom tuning rule
   * @param {Object} rule
   * @param {string} rule.id - Unique rule identifier
   * @param {string} rule.name - Human-readable name
   * @param {string} rule.description - Rule description
   * @param {boolean} [rule.enabled=true] - Whether rule is active
   * @param {Function} rule.condition - (metrics) => boolean
   * @param {Function} rule.action - (metrics) => string result description
   * @param {number} [rule.cooldownMs] - Cooldown period in ms
   * @param {number} [rule.consecutiveRequired=1] - Consecutive true conditions before triggering
   */
  addRule(rule) {
    if (!rule || !rule.id) {
      throw new Error("Rule must have an id");
    }
    if (typeof rule.condition !== "function") {
      throw new Error("Rule must have a condition function");
    }
    if (typeof rule.action !== "function") {
      throw new Error("Rule must have an action function");
    }

    const fullRule = {
      enabled: true,
      cooldownMs: DEFAULT_COOLDOWN_MS,
      lastTriggered: null,
      triggerCount: 0,
      consecutiveRequired: 1,
      consecutiveCount: 0,
      ...rule,
    };

    this.rules.set(rule.id, fullRule);
    logger.info(`[AutoTuner] Rule added: ${rule.id} (${rule.name})`);
  }

  /**
   * Remove a tuning rule by id
   * @param {string} id - Rule identifier
   * @returns {boolean} Whether the rule was found and removed
   */
  removeRule(id) {
    const removed = this.rules.delete(id);
    if (removed) {
      logger.info(`[AutoTuner] Rule removed: ${id}`);
    }
    return removed;
  }

  /**
   * Enable a tuning rule
   * @param {string} id - Rule identifier
   * @returns {boolean} Whether the rule was found
   */
  enableRule(id) {
    const rule = this.rules.get(id);
    if (!rule) {
      return false;
    }
    rule.enabled = true;
    logger.info(`[AutoTuner] Rule enabled: ${id}`);
    return true;
  }

  /**
   * Disable a tuning rule
   * @param {string} id - Rule identifier
   * @returns {boolean} Whether the rule was found
   */
  disableRule(id) {
    const rule = this.rules.get(id);
    if (!rule) {
      return false;
    }
    rule.enabled = false;
    rule.consecutiveCount = 0;
    logger.info(`[AutoTuner] Rule disabled: ${id}`);
    return true;
  }

  /**
   * Evaluate all enabled rules against current metrics
   * @returns {Array<Object>} Array of triggered actions
   */
  evaluate() {
    const now = Date.now();
    const triggered = [];

    this._stats.totalEvaluations++;
    this._stats.lastEvaluationTime = now;

    // Get current metrics snapshot
    let metrics = {};
    if (this.deps.performanceCollector) {
      try {
        metrics = this.deps.performanceCollector.getSnapshot();
      } catch (error) {
        logger.warn(
          "[AutoTuner] Failed to get metrics snapshot:",
          error.message,
        );
      }
    } else if (this.deps.performanceMonitor) {
      try {
        metrics = this.deps.performanceMonitor.getSummary();
      } catch (error) {
        logger.warn(
          "[AutoTuner] Failed to get performance summary:",
          error.message,
        );
      }
    }

    for (const [id, rule] of this.rules) {
      if (!rule.enabled) {
        continue;
      }

      try {
        const conditionMet = rule.condition(metrics);

        if (conditionMet) {
          rule.consecutiveCount++;
        } else {
          // Reset consecutive count when condition is no longer met
          rule.consecutiveCount = 0;
          continue;
        }

        // Check if consecutive threshold is met
        if (rule.consecutiveCount < rule.consecutiveRequired) {
          continue;
        }

        // Check cooldown (hysteresis)
        if (rule.lastTriggered) {
          const elapsed = now - rule.lastTriggered;
          if (elapsed < rule.cooldownMs) {
            continue;
          }
        }

        // Trigger the action
        const result = rule.action(metrics);
        rule.lastTriggered = now;
        rule.triggerCount++;
        rule.consecutiveCount = 0;
        this._stats.totalTriggers++;

        const entry = {
          ruleId: id,
          ruleName: rule.name,
          timestamp: now,
          metrics: { ...metrics },
          action: rule.description,
          result: result || "No result",
        };

        this.history.push(entry);
        if (this.history.length > this.maxHistory) {
          this.history.shift();
        }

        triggered.push(entry);

        this.emit("rule-triggered", entry);
        logger.info(`[AutoTuner] Rule triggered: ${id} — ${result}`);
      } catch (error) {
        logger.error(
          `[AutoTuner] Error evaluating rule '${id}':`,
          error.message,
        );
      }
    }

    return triggered;
  }

  /**
   * Manually trigger a specific rule regardless of condition or cooldown
   * @param {string} ruleId - Rule identifier
   * @returns {Object|null} The history entry, or null if rule not found
   */
  manualTune(ruleId) {
    const rule = this.rules.get(ruleId);
    if (!rule) {
      logger.warn(`[AutoTuner] Manual tune: rule '${ruleId}' not found`);
      return null;
    }

    const now = Date.now();

    // Get current metrics
    let metrics = {};
    if (this.deps.performanceCollector) {
      try {
        metrics = this.deps.performanceCollector.getSnapshot();
      } catch {
        // Ignore
      }
    }

    try {
      const result = rule.action(metrics);
      rule.lastTriggered = now;
      rule.triggerCount++;
      this._stats.totalTriggers++;

      const entry = {
        ruleId,
        ruleName: rule.name,
        timestamp: now,
        metrics: { ...metrics },
        action: `[Manual] ${rule.description}`,
        result: result || "No result",
      };

      this.history.push(entry);
      if (this.history.length > this.maxHistory) {
        this.history.shift();
      }

      this.emit("rule-triggered", entry);
      logger.info(`[AutoTuner] Manual tune: ${ruleId} — ${result}`);

      return entry;
    } catch (error) {
      logger.error(
        `[AutoTuner] Manual tune failed for '${ruleId}':`,
        error.message,
      );
      return null;
    }
  }

  /**
   * Get tuning history
   * @param {number} [limit=50] - Maximum entries to return
   * @returns {Array<Object>} History entries (most recent first)
   */
  getTuningHistory(limit = 50) {
    return this.history.slice(-limit).reverse();
  }

  /**
   * Get all rules with their current status
   * @returns {Array<Object>}
   */
  getRules() {
    const result = [];
    for (const [id, rule] of this.rules) {
      result.push({
        id: rule.id,
        name: rule.name,
        description: rule.description,
        enabled: rule.enabled,
        cooldownMs: rule.cooldownMs,
        lastTriggered: rule.lastTriggered,
        triggerCount: rule.triggerCount,
        consecutiveRequired: rule.consecutiveRequired,
        consecutiveCount: rule.consecutiveCount,
      });
    }
    return result;
  }

  /**
   * Get evaluation statistics
   * @returns {Object}
   */
  getStats() {
    return {
      totalEvaluations: this._stats.totalEvaluations,
      totalTriggers: this._stats.totalTriggers,
      lastEvaluationTime: this._stats.lastEvaluationTime,
      isRunning: this.running,
      rulesCount: this.rules.size,
      enabledRulesCount: [...this.rules.values()].filter((r) => r.enabled)
        .length,
      historyCount: this.history.length,
    };
  }
}

// Singleton instance
let instance = null;

/**
 * Get the singleton AutoTuner instance
 * @returns {AutoTuner}
 */
function getAutoTuner() {
  if (!instance) {
    instance = new AutoTuner();
  }
  return instance;
}

module.exports = {
  AutoTuner,
  getAutoTuner,
};

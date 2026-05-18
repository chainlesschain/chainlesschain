/**
 * LoadBalancer - Dynamic Agent Load Balancing
 *
 * Real-time monitoring and automatic task migration for the Cowork
 * multi-agent system. Ensures optimal agent utilization through
 * composite load scoring, health monitoring, and auto-rebalancing.
 *
 * Core capabilities:
 * 1. Real-time per-agent metrics tracking
 * 2. Composite load score calculation
 * 3. Automatic task migration on overload
 * 4. Load shedding under system-wide pressure
 * 5. Health monitoring with heartbeat checks
 *
 * @module ai-engine/cowork/load-balancer
 */

const { logger } = require("../../utils/logger.js");
const { v4: uuidv4 } = require("uuid");
const EventEmitter = require("events");

/**
 * Load score weight configuration
 */
const DEFAULT_WEIGHTS = {
  taskLoad: 0.4,
  queueDepth: 0.3,
  errorRate: 0.2,
  responseTime: 0.1,
};

/**
 * Default load balancer configuration
 */
const DEFAULT_CONFIG = {
  overloadThreshold: 0.8, // Agent considered overloaded above this
  systemOverloadThreshold: 0.9, // System-wide overload threshold
  heartbeatInterval: 30000, // 30s heartbeat check
  monitorInterval: 10000, // 10s metric collection
  metricsRetention: 3600000, // 1 hour of metric history
  maxQueueDepth: 20, // Max per-agent queue depth
  maxResponseTimeMs: 120000, // 2 min max expected response time
  enableAutoMigration: true,
  enableLoadShedding: true,
  weights: { ...DEFAULT_WEIGHTS },
};

/**
 * Agent health status
 */
const HealthStatus = {
  HEALTHY: "healthy",
  DEGRADED: "degraded",
  UNHEALTHY: "unhealthy",
  UNRESPONSIVE: "unresponsive",
};

class LoadBalancer extends EventEmitter {
  /**
   * @param {Object} [agentPool] - AgentPool instance
   * @param {Object} [teammateTool] - TeammateTool instance
   * @param {Object} [db] - Database instance
   * @param {Object} [config] - Configuration overrides
   */
  constructor(agentPool = null, teammateTool = null, db = null, config = {}) {
    super();

    this.agentPool = agentPool;
    this.teammateTool = teammateTool;
    this.db = db;
    this.config = { ...DEFAULT_CONFIG, ...config };
    if (config.weights) {
      this.config.weights = { ...DEFAULT_WEIGHTS, ...config.weights };
    }

    // Per-agent metrics: agentId -> MetricsSnapshot
    this._metrics = new Map();

    // Metric history for charts: agentId -> Array<{ timestamp, loadScore }>
    this._history = new Map();

    // Monitoring intervals
    this._monitorTimer = null;
    this._heartbeatTimer = null;

    // Migration log
    this._migrationLog = [];
    this._maxMigrationLogSize = 100;

    // Load shedding state
    this._loadSheddingActive = false;

    this.initialized = false;

    logger.info("[LoadBalancer] Created", {
      overloadThreshold: this.config.overloadThreshold,
      heartbeatInterval: this.config.heartbeatInterval,
    });
  }

  /**
   * Initialize and start monitoring loops
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    this._ensureTable();
    this._startMonitoring();
    this.initialized = true;

    logger.info("[LoadBalancer] Initialized and monitoring started");
    this.emit("initialized");
  }

  /**
   * Ensure agent_load_metrics table exists
   */
  _ensureTable() {
    if (!this.db) {
      return;
    }
    try {
      this.db.run(`
        CREATE TABLE IF NOT EXISTS agent_load_metrics (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL,
          active_tasks INTEGER DEFAULT 0,
          queue_depth INTEGER DEFAULT 0,
          avg_response_ms REAL DEFAULT 0,
          error_rate REAL DEFAULT 0,
          load_score REAL DEFAULT 0,
          tokens_processed INTEGER DEFAULT 0,
          last_heartbeat TEXT,
          recorded_at TEXT DEFAULT (datetime('now'))
        )
      `);
      this.db.run(
        "CREATE INDEX IF NOT EXISTS idx_agent_load_agent ON agent_load_metrics(agent_id)",
      );
      this.db.run(
        "CREATE INDEX IF NOT EXISTS idx_agent_load_time ON agent_load_metrics(recorded_at)",
      );
    } catch (error) {
      logger.warn("[LoadBalancer] Table creation warning:", error.message);
    }
  }

  /**
   * Start periodic monitoring and heartbeat loops
   */
  _startMonitoring() {
    // Metrics collection loop
    this._monitorTimer = setInterval(() => {
      this._collectMetrics();
      this._checkAndRebalance();
    }, this.config.monitorInterval);

    // Heartbeat loop
    this._heartbeatTimer = setInterval(() => {
      this._heartbeatCheck();
    }, this.config.heartbeatInterval);

    // Prevent timers from keeping the process alive
    if (this._monitorTimer.unref) {
      this._monitorTimer.unref();
    }
    if (this._heartbeatTimer.unref) {
      this._heartbeatTimer.unref();
    }
  }

  /**
   * Update metrics for a specific agent
   * @param {string} agentId - Agent identifier
   * @param {Object} metrics - Metric updates
   */
  updateMetrics(agentId, metrics = {}) {
    const existing =
      this._metrics.get(agentId) || this._defaultMetrics(agentId);

    const updated = {
      ...existing,
      ...metrics,
      agentId,
      lastUpdated: Date.now(),
    };

    // Recalculate load score
    updated.loadScore = this._calculateLoadScore(updated);
    updated.health = this._determineHealth(updated);

    this._metrics.set(agentId, updated);

    // Append to history
    this._appendHistory(agentId, updated.loadScore);

    // Persist to DB periodically (every 10th update)
    if (this.db && Math.random() < 0.1) {
      this._persistMetrics(updated);
    }

    return updated;
  }

  /**
   * Calculate composite load score for an agent (0-1)
   * @param {Object} metrics - Agent metrics
   * @returns {number} Load score
   */
  _calculateLoadScore(metrics) {
    const w = this.config.weights;

    // Normalize each component to 0-1
    const taskLoad = Math.min((metrics.activeTasks || 0) / 5, 1.0);
    const queueDepth = Math.min(
      (metrics.queueDepth || 0) / this.config.maxQueueDepth,
      1.0,
    );
    const errorRate = Math.min(metrics.errorRate || 0, 1.0);
    const responseTime = Math.min(
      (metrics.avgResponseMs || 0) / this.config.maxResponseTimeMs,
      1.0,
    );

    const score =
      w.taskLoad * taskLoad +
      w.queueDepth * queueDepth +
      w.errorRate * errorRate +
      w.responseTime * responseTime;

    return Math.round(score * 1000) / 1000;
  }

  /**
   * Calculate load score for an agent by ID
   * @param {string} agentId - Agent ID
   * @returns {number} Load score (0-1)
   */
  calculateLoadScore(agentId) {
    const metrics = this._metrics.get(agentId);
    if (!metrics) {
      return 0;
    }
    return this._calculateLoadScore(metrics);
  }

  /**
   * Determine agent health status
   * @param {Object} metrics - Agent metrics
   * @returns {string} Health status
   */
  _determineHealth(metrics) {
    const now = Date.now();
    const lastHeartbeat = metrics.lastHeartbeat || now;

    if (now - lastHeartbeat > this.config.heartbeatInterval * 3) {
      return HealthStatus.UNRESPONSIVE;
    }
    if (metrics.errorRate > 0.5 || metrics.loadScore > 0.95) {
      return HealthStatus.UNHEALTHY;
    }
    if (
      metrics.errorRate > 0.2 ||
      metrics.loadScore > this.config.overloadThreshold
    ) {
      return HealthStatus.DEGRADED;
    }
    return HealthStatus.HEALTHY;
  }

  /**
   * Suggest the best agent for a new task
   * @param {Object} task - Task to assign
   * @returns {Object} { agentId, loadScore, reason }
   */
  suggestAssignment(task = {}) {
    // Check system-wide load shedding
    if (this._loadSheddingActive && this.config.enableLoadShedding) {
      return {
        agentId: null,
        loadScore: 1.0,
        reason: "System under load shedding - task rejected",
        rejected: true,
      };
    }

    const candidates = [];

    for (const [agentId, metrics] of this._metrics) {
      if (
        metrics.health === HealthStatus.UNRESPONSIVE ||
        metrics.health === HealthStatus.UNHEALTHY
      ) {
        continue;
      }
      candidates.push({
        agentId,
        loadScore: metrics.loadScore,
        activeTasks: metrics.activeTasks || 0,
        health: metrics.health,
      });
    }

    if (candidates.length === 0) {
      return {
        agentId: null,
        loadScore: null,
        reason: "No available agents",
        rejected: false,
      };
    }

    // Sort by load score ascending (least loaded first)
    candidates.sort((a, b) => a.loadScore - b.loadScore);

    const best = candidates[0];

    // Check if even the best candidate is overloaded
    if (best.loadScore >= this.config.overloadThreshold) {
      return {
        agentId: best.agentId,
        loadScore: best.loadScore,
        reason: "All agents heavily loaded, assigning to least loaded",
        warning: true,
      };
    }

    return {
      agentId: best.agentId,
      loadScore: best.loadScore,
      reason: `Least loaded agent (${Math.round(best.loadScore * 100)}% load)`,
    };
  }

  /**
   * Migrate a task from one agent to another
   * @param {string} taskId - Task to migrate
   * @param {string} fromAgentId - Source agent
   * @param {string} toAgentId - Target agent
   * @returns {Object} Migration result
   */
  async migrateTask(taskId, fromAgentId, toAgentId) {
    try {
      const fromMetrics = this._metrics.get(fromAgentId);
      const toMetrics = this._metrics.get(toAgentId);

      if (!fromMetrics || !toMetrics) {
        return {
          success: false,
          error: "Source or target agent not found in metrics",
        };
      }

      // Check target can accept
      if (toMetrics.loadScore >= this.config.overloadThreshold) {
        return {
          success: false,
          error: "Target agent is already overloaded",
        };
      }

      // Update metrics
      this.updateMetrics(fromAgentId, {
        activeTasks: Math.max(0, (fromMetrics.activeTasks || 1) - 1),
        queueDepth: Math.max(0, (fromMetrics.queueDepth || 1) - 1),
      });

      this.updateMetrics(toAgentId, {
        activeTasks: (toMetrics.activeTasks || 0) + 1,
        queueDepth: (toMetrics.queueDepth || 0) + 1,
      });

      // Log migration
      const migration = {
        taskId,
        fromAgentId,
        toAgentId,
        timestamp: Date.now(),
        fromLoad: fromMetrics.loadScore,
        toLoad: toMetrics.loadScore,
      };
      this._migrationLog.push(migration);
      if (this._migrationLog.length > this._maxMigrationLogSize) {
        this._migrationLog.shift();
      }

      this.emit("task-migrated", migration);
      logger.info("[LoadBalancer] Task migrated", migration);

      return { success: true, migration };
    } catch (error) {
      logger.error("[LoadBalancer] Migration error:", error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Periodic rebalancing check
   */
  _checkAndRebalance() {
    if (!this.config.enableAutoMigration) {
      return;
    }

    const overloaded = [];
    const underloaded = [];

    for (const [agentId, metrics] of this._metrics) {
      if (metrics.health === HealthStatus.UNRESPONSIVE) {
        continue;
      }
      if (metrics.loadScore >= this.config.overloadThreshold) {
        overloaded.push({ agentId, ...metrics });
      } else if (metrics.loadScore < this.config.overloadThreshold * 0.5) {
        underloaded.push({ agentId, ...metrics });
      }
    }

    // Check system-wide load
    const systemLoad = this._getSystemLoadInternal();
    if (
      systemLoad.avgLoad >= this.config.systemOverloadThreshold &&
      !this._loadSheddingActive
    ) {
      this._loadSheddingActive = true;
      this.emit("load-shedding-activated", { avgLoad: systemLoad.avgLoad });
      logger.warn("[LoadBalancer] Load shedding activated", {
        avgLoad: systemLoad.avgLoad,
      });
    } else if (
      systemLoad.avgLoad < this.config.systemOverloadThreshold * 0.8 &&
      this._loadSheddingActive
    ) {
      this._loadSheddingActive = false;
      this.emit("load-shedding-deactivated", { avgLoad: systemLoad.avgLoad });
      logger.info("[LoadBalancer] Load shedding deactivated");
    }

    // Auto-migration suggestions (don't actually migrate without explicit command)
    if (overloaded.length > 0 && underloaded.length > 0) {
      this.emit("rebalance-suggested", {
        overloaded: overloaded.map((a) => ({
          agentId: a.agentId,
          loadScore: a.loadScore,
        })),
        underloaded: underloaded.map((a) => ({
          agentId: a.agentId,
          loadScore: a.loadScore,
        })),
      });
    }
  }

  /**
   * Heartbeat check for all agents
   */
  _heartbeatCheck() {
    const now = Date.now();
    const staleThreshold = this.config.heartbeatInterval * 3;

    for (const [agentId, metrics] of this._metrics) {
      const lastUpdate = metrics.lastUpdated || metrics.lastHeartbeat || 0;
      if (now - lastUpdate > staleThreshold) {
        if (metrics.health !== HealthStatus.UNRESPONSIVE) {
          metrics.health = HealthStatus.UNRESPONSIVE;
          this.emit("agent-unresponsive", { agentId });
          logger.warn("[LoadBalancer] Agent unresponsive:", agentId);
        }
      }
    }
  }

  /**
   * Collect metrics from agent pool (if available)
   */
  _collectMetrics() {
    if (!this.agentPool) {
      return;
    }

    // Collect from busy agents
    if (this.agentPool.busyAgents) {
      for (const [agentId] of this.agentPool.busyAgents) {
        const existing = this._metrics.get(agentId);
        if (!existing) {
          this.updateMetrics(agentId, {
            activeTasks: 1,
            lastHeartbeat: Date.now(),
          });
        } else {
          this.updateMetrics(agentId, {
            lastHeartbeat: Date.now(),
          });
        }
      }
    }

    // Mark idle agents
    if (this.agentPool.availableAgents) {
      for (const agent of this.agentPool.availableAgents) {
        const agentId = agent.id || agent.agentId;
        if (agentId) {
          this.updateMetrics(agentId, {
            activeTasks: 0,
            queueDepth: 0,
            lastHeartbeat: Date.now(),
          });
        }
      }
    }
  }

  /**
   * Get system-wide load summary (internal)
   * @returns {Object} System load info
   */
  _getSystemLoadInternal() {
    const agents = [];
    let totalLoad = 0;
    let maxLoad = 0;

    for (const [agentId, metrics] of this._metrics) {
      const load = metrics.loadScore || 0;
      agents.push({
        agentId,
        loadScore: load,
        activeTasks: metrics.activeTasks || 0,
        queueDepth: metrics.queueDepth || 0,
        health: metrics.health || HealthStatus.HEALTHY,
        errorRate: metrics.errorRate || 0,
      });
      totalLoad += load;
      if (load > maxLoad) {
        maxLoad = load;
      }
    }

    const avgLoad = agents.length > 0 ? totalLoad / agents.length : 0;

    return {
      agents,
      agentCount: agents.length,
      avgLoad: Math.round(avgLoad * 1000) / 1000,
      maxLoad: Math.round(maxLoad * 1000) / 1000,
      loadSheddingActive: this._loadSheddingActive,
      alerts: this._getAlerts(agents, avgLoad),
    };
  }

  /**
   * Get system load (public API)
   * @returns {Object} System load summary
   */
  getSystemLoad() {
    return this._getSystemLoadInternal();
  }

  /**
   * Get metrics for a specific agent
   * @param {string} agentId - Agent ID
   * @returns {Object|null} Agent metrics
   */
  getAgentLoad(agentId) {
    return this._metrics.get(agentId) || null;
  }

  /**
   * Get all agent metrics
   * @returns {Object} All metrics
   */
  getAllMetrics() {
    const result = {};
    for (const [agentId, metrics] of this._metrics) {
      result[agentId] = { ...metrics };
    }
    return result;
  }

  /**
   * Get load history for charts
   * @param {string} [agentId] - Specific agent (null for all)
   * @param {number} [limit=100] - Max entries per agent
   * @returns {Object} History data
   */
  getHistory(agentId = null, limit = 100) {
    if (agentId) {
      const history = this._history.get(agentId) || [];
      return { [agentId]: history.slice(-limit) };
    }

    const result = {};
    for (const [id, history] of this._history) {
      result[id] = history.slice(-limit);
    }
    return result;
  }

  /**
   * Set load threshold configuration
   * @param {Object} thresholds - Threshold updates
   * @returns {Object} Updated config
   */
  setThreshold(thresholds = {}) {
    if (thresholds.overloadThreshold !== undefined) {
      this.config.overloadThreshold = Math.max(
        0.1,
        Math.min(1.0, thresholds.overloadThreshold),
      );
    }
    if (thresholds.systemOverloadThreshold !== undefined) {
      this.config.systemOverloadThreshold = Math.max(
        0.1,
        Math.min(1.0, thresholds.systemOverloadThreshold),
      );
    }
    if (thresholds.enableAutoMigration !== undefined) {
      this.config.enableAutoMigration = !!thresholds.enableAutoMigration;
    }
    if (thresholds.enableLoadShedding !== undefined) {
      this.config.enableLoadShedding = !!thresholds.enableLoadShedding;
    }
    if (thresholds.weights) {
      this.config.weights = { ...this.config.weights, ...thresholds.weights };
    }

    logger.info("[LoadBalancer] Thresholds updated", this.config);
    return this.getConfig();
  }

  /**
   * Get current configuration
   * @returns {Object} Current config
   */
  getConfig() {
    return { ...this.config };
  }

  /**
   * Get active alerts
   * @param {Array} agents - Agent summaries
   * @param {number} avgLoad - Average load
   * @returns {Array} Alert list
   */
  _getAlerts(agents, avgLoad) {
    const alerts = [];

    if (this._loadSheddingActive) {
      alerts.push({
        level: "critical",
        message: "Load shedding is active - new tasks may be rejected",
      });
    }

    const overloaded = agents.filter(
      (a) => a.loadScore >= this.config.overloadThreshold,
    );
    if (overloaded.length > 0) {
      alerts.push({
        level: "warning",
        message: `${overloaded.length} agent(s) overloaded`,
        agents: overloaded.map((a) => a.agentId),
      });
    }

    const unresponsive = agents.filter(
      (a) => a.health === HealthStatus.UNRESPONSIVE,
    );
    if (unresponsive.length > 0) {
      alerts.push({
        level: "error",
        message: `${unresponsive.length} agent(s) unresponsive`,
        agents: unresponsive.map((a) => a.agentId),
      });
    }

    if (avgLoad > 0.7) {
      alerts.push({
        level: "info",
        message: `System average load at ${Math.round(avgLoad * 100)}%`,
      });
    }

    return alerts;
  }

  /**
   * Default metrics for a new agent
   * @param {string} agentId - Agent ID
   * @returns {Object} Default metrics
   */
  _defaultMetrics(agentId) {
    return {
      agentId,
      activeTasks: 0,
      queueDepth: 0,
      avgResponseMs: 0,
      errorRate: 0,
      loadScore: 0,
      tokensProcessed: 0,
      lastHeartbeat: Date.now(),
      lastUpdated: Date.now(),
      health: HealthStatus.HEALTHY,
    };
  }

  /**
   * Append load score to history
   * @param {string} agentId - Agent ID
   * @param {number} loadScore - Current load score
   */
  _appendHistory(agentId, loadScore) {
    if (!this._history.has(agentId)) {
      this._history.set(agentId, []);
    }
    const history = this._history.get(agentId);
    history.push({ timestamp: Date.now(), loadScore });

    // Trim old entries
    const cutoff = Date.now() - this.config.metricsRetention;
    while (history.length > 0 && history[0].timestamp < cutoff) {
      history.shift();
    }
  }

  /**
   * Persist metrics to database
   * @param {Object} metrics - Metrics to persist
   */
  _persistMetrics(metrics) {
    if (!this.db) {
      return;
    }
    try {
      this.db.run(
        `INSERT INTO agent_load_metrics
         (id, agent_id, active_tasks, queue_depth, avg_response_ms,
          error_rate, load_score, tokens_processed, last_heartbeat)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(),
          metrics.agentId,
          metrics.activeTasks || 0,
          metrics.queueDepth || 0,
          metrics.avgResponseMs || 0,
          metrics.errorRate || 0,
          metrics.loadScore || 0,
          metrics.tokensProcessed || 0,
          new Date(metrics.lastHeartbeat || Date.now()).toISOString(),
        ],
      );
    } catch (error) {
      logger.warn("[LoadBalancer] Persist metrics error:", error.message);
    }
  }

  /**
   * Shutdown the load balancer
   */
  shutdown() {
    if (this._monitorTimer) {
      clearInterval(this._monitorTimer);
      this._monitorTimer = null;
    }
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
    this._metrics.clear();
    this._history.clear();
    this.removeAllListeners();
    logger.info("[LoadBalancer] Shutdown");
  }
}

module.exports = { LoadBalancer, HealthStatus, DEFAULT_CONFIG };

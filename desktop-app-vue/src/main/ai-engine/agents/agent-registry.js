/**
 * Agent Registry
 *
 * Central registry for managing agent types, creating agent instances from templates,
 * tracking active instances, and collecting performance statistics.
 *
 * Extends EventEmitter to provide lifecycle events:
 *  - 'type-registered': When a new agent type is registered
 *  - 'instance-created': When an agent instance is created from a template
 *  - 'instance-terminated': When an agent instance is stopped
 *  - 'task-completed': When an agent finishes a task
 *  - 'task-failed': When an agent task fails
 *
 * @module ai-engine/agents/agent-registry
 */

const { logger } = require('../../utils/logger.js');
const { v4: uuidv4 } = require('uuid');
const { EventEmitter } = require('events');

// ============================================================
// AgentRegistry Class
// ============================================================

/**
 * AgentRegistry - Agent type registry, factory, and instance manager
 *
 * Manages the lifecycle of agent instances: creation from templates,
 * tracking active instances in memory, persisting task results to the
 * agent_task_history table, and aggregating performance statistics.
 *
 * @class AgentRegistry
 * @extends EventEmitter
 */
class AgentRegistry extends EventEmitter {
  /**
   * Create an AgentRegistry instance
   * @param {Object} options - Configuration options
   * @param {Object} options.database - Database instance with getDatabase() method
   * @param {Object} options.templateManager - AgentTemplateManager instance
   */
  constructor({ database, templateManager }) {
    super();

    this.database = database;
    this.templateManager = templateManager;

    // Registered agent types: type -> { config, registeredAt }
    this._agentTypes = new Map();

    // Active agent instances: instanceId -> { id, templateId, type, config, state, createdAt, ... }
    this._activeInstances = new Map();

    // Instance execution counters (in-memory)
    this._instanceStats = new Map();

    logger.info('[AgentRegistry] Instance created');
  }

  // ============================================================
  // Agent Type Registration
  // ============================================================

  /**
   * Register a new agent type with its configuration.
   * Agent types define the behavior and constraints for instances of that type.
   *
   * @param {string} type - Unique type identifier (e.g., 'code-security')
   * @param {Object} config - Type configuration
   * @param {number} [config.maxInstances=5] - Maximum concurrent instances of this type
   * @param {number} [config.defaultTimeout=60000] - Default task timeout in milliseconds
   * @param {number} [config.maxRetries=3] - Default max retries for failed tasks
   * @param {string} [config.description] - Human-readable description
   * @param {Object} [config.constraints] - Additional constraints for instances
   * @returns {{ success: boolean, type: string }}
   */
  registerAgentType(type, config = {}) {
    if (!type || typeof type !== 'string') {
      throw new Error('Agent type must be a non-empty string');
    }

    if (this._agentTypes.has(type)) {
      logger.warn(
        `[AgentRegistry] Agent type '${type}' already registered, overwriting`
      );
    }

    const typeConfig = {
      type,
      maxInstances: config.maxInstances || 5,
      defaultTimeout: config.defaultTimeout || 60000,
      maxRetries: config.maxRetries || 3,
      description: config.description || '',
      constraints: config.constraints || {},
      registeredAt: Date.now(),
    };

    this._agentTypes.set(type, typeConfig);

    logger.info(
      `[AgentRegistry] Registered agent type: ${type} (maxInstances: ${typeConfig.maxInstances})`
    );

    this.emit('type-registered', { type, config: typeConfig });

    return { success: true, type };
  }

  /**
   * Get all registered agent types.
   *
   * @returns {Array<Object>} List of registered agent type configurations
   */
  getAgentTypes() {
    const types = [];

    for (const [type, config] of this._agentTypes) {
      // Count active instances of this type
      let activeCount = 0;
      for (const instance of this._activeInstances.values()) {
        if (instance.type === type && instance.state === 'running') {
          activeCount++;
        }
      }

      types.push({
        type,
        description: config.description,
        maxInstances: config.maxInstances,
        defaultTimeout: config.defaultTimeout,
        maxRetries: config.maxRetries,
        activeInstances: activeCount,
        registeredAt: config.registeredAt,
      });
    }

    return types;
  }

  /**
   * Check if an agent type is registered.
   *
   * @param {string} type - Agent type identifier
   * @returns {boolean}
   */
  hasAgentType(type) {
    return this._agentTypes.has(type);
  }

  /**
   * Unregister an agent type.
   * Will fail if there are active instances of this type.
   *
   * @param {string} type - Agent type to unregister
   * @returns {{ success: boolean, error?: string }}
   */
  unregisterAgentType(type) {
    if (!this._agentTypes.has(type)) {
      return { success: false, error: 'TYPE_NOT_FOUND' };
    }

    // Check for active instances
    for (const instance of this._activeInstances.values()) {
      if (instance.type === type && instance.state === 'running') {
        return {
          success: false,
          error: 'ACTIVE_INSTANCES_EXIST',
          message: `Cannot unregister type '${type}' with active instances. Terminate them first.`,
        };
      }
    }

    this._agentTypes.delete(type);
    logger.info(`[AgentRegistry] Unregistered agent type: ${type}`);

    return { success: true };
  }

  // ============================================================
  // Instance Management
  // ============================================================

  /**
   * Create an agent instance from a template.
   * The instance is tracked in memory and an initial entry is recorded in the database.
   *
   * @param {string} templateId - UUID of the template to instantiate
   * @param {Object} [config={}] - Instance-specific configuration overrides
   * @param {string} [config.taskDescription] - Description of the task to execute
   * @param {number} [config.timeout] - Custom timeout for this instance
   * @param {Object} [config.context] - Additional context data
   * @returns {Promise<Object>} The created instance object
   */
  async createAgentInstance(templateId, config = {}) {
    try {
      // Retrieve template
      const template = await this.templateManager.getTemplate(templateId);
      if (!template) {
        throw new Error(`Template not found: ${templateId}`);
      }

      if (!template.enabled) {
        throw new Error(`Template is disabled: ${template.name}`);
      }

      // Check type registration and instance limits
      const typeConfig = this._agentTypes.get(template.type);
      if (typeConfig) {
        const activeOfType = this._countActiveByType(template.type);
        if (activeOfType >= typeConfig.maxInstances) {
          throw new Error(
            `Maximum instances reached for type '${template.type}': ${activeOfType}/${typeConfig.maxInstances}`
          );
        }
      }

      // Create instance
      const instanceId = uuidv4();
      const now = Date.now();

      const instance = {
        id: instanceId,
        templateId: template.id,
        type: template.type,
        name: template.name,
        capabilities: template.capabilities,
        tools: template.tools,
        systemPrompt: template.system_prompt,
        config: {
          ...template.config,
          ...config,
        },
        state: 'running',
        taskDescription: config.taskDescription || null,
        context: config.context || {},
        createdAt: now,
        startedAt: now,
        completedAt: null,
        result: null,
        error: null,
      };

      // Track in memory
      this._activeInstances.set(instanceId, instance);

      // Initialize stats for this instance
      this._instanceStats.set(instanceId, {
        tasksCompleted: 0,
        tasksFailed: 0,
        totalDuration: 0,
        tokensUsed: 0,
      });

      // Record in database
      try {
        const db = this.database.getDatabase();
        db.prepare(
          `INSERT INTO agent_task_history (
            id, agent_id, template_type, task_description,
            started_at, completed_at, success, result, tokens_used
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          instanceId,
          instanceId,
          template.type,
          config.taskDescription || null,
          now,
          null,
          null,
          null,
          null
        );
      } catch (dbError) {
        logger.warn(
          `[AgentRegistry] Failed to record instance in database: ${dbError.message}`
        );
        // Continue - instance is still valid in memory
      }

      logger.info(
        `[AgentRegistry] Created instance: ${instanceId} (type: ${template.type}, template: ${template.name})`
      );

      this.emit('instance-created', {
        instanceId,
        type: template.type,
        templateName: template.name,
      });

      return instance;
    } catch (error) {
      logger.error('[AgentRegistry] Failed to create agent instance:', error);
      throw error;
    }
  }

  /**
   * Get all active (non-terminated) agent instances.
   *
   * @returns {Array<Object>} List of active instance objects
   */
  getActiveInstances() {
    const instances = [];

    for (const [id, instance] of this._activeInstances) {
      if (instance.state === 'running') {
        instances.push({
          id,
          type: instance.type,
          name: instance.name,
          state: instance.state,
          taskDescription: instance.taskDescription,
          capabilities: instance.capabilities,
          tools: instance.tools,
          createdAt: instance.createdAt,
          startedAt: instance.startedAt,
          stats: this._instanceStats.get(id) || null,
        });
      }
    }

    return instances;
  }

  /**
   * Get details for a specific agent instance.
   *
   * @param {string} id - Instance UUID
   * @returns {Object|null} Instance details or null if not found
   */
  getInstance(id) {
    if (!id) return null;

    const instance = this._activeInstances.get(id);
    if (!instance) {
      return null;
    }

    return {
      ...instance,
      stats: this._instanceStats.get(id) || null,
    };
  }

  /**
   * Terminate a running agent instance.
   * Updates the in-memory state and persists the completion to the database.
   *
   * @param {string} id - Instance UUID
   * @param {Object} [options={}] - Termination options
   * @param {string} [options.reason] - Reason for termination
   * @param {Object} [options.result] - Final result data
   * @param {boolean} [options.success=true] - Whether the agent completed successfully
   * @param {number} [options.tokensUsed=0] - Total tokens consumed
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async terminateInstance(id, options = {}) {
    try {
      if (!id) {
        return { success: false, error: 'INSTANCE_ID_REQUIRED' };
      }

      const instance = this._activeInstances.get(id);
      if (!instance) {
        return { success: false, error: 'INSTANCE_NOT_FOUND' };
      }

      if (instance.state !== 'running') {
        return {
          success: false,
          error: 'INSTANCE_NOT_RUNNING',
          message: `Instance is in state '${instance.state}', not 'running'`,
        };
      }

      const now = Date.now();
      const success = options.success !== false;
      const duration = now - instance.startedAt;

      // Update in-memory state
      instance.state = success ? 'completed' : 'failed';
      instance.completedAt = now;
      instance.result = options.result || null;
      instance.error = success ? null : (options.reason || 'Terminated');

      // Update instance stats
      const stats = this._instanceStats.get(id);
      if (stats) {
        if (success) {
          stats.tasksCompleted++;
        } else {
          stats.tasksFailed++;
        }
        stats.totalDuration += duration;
        stats.tokensUsed += options.tokensUsed || 0;
      }

      // Persist to database
      try {
        const db = this.database.getDatabase();
        db.prepare(
          `UPDATE agent_task_history
           SET completed_at = ?, success = ?, result = ?, tokens_used = ?
           WHERE id = ?`
        ).run(
          now,
          success ? 1 : 0,
          options.result ? JSON.stringify(options.result) : null,
          options.tokensUsed || 0,
          id
        );
      } catch (dbError) {
        logger.warn(
          `[AgentRegistry] Failed to update instance in database: ${dbError.message}`
        );
      }

      logger.info(
        `[AgentRegistry] Terminated instance: ${id} (${instance.type}, success: ${success}, duration: ${duration}ms)`
      );

      this.emit('instance-terminated', {
        instanceId: id,
        type: instance.type,
        success,
        duration,
      });

      if (success) {
        this.emit('task-completed', { instanceId: id, result: options.result });
      } else {
        this.emit('task-failed', { instanceId: id, reason: options.reason });
      }

      return { success: true };
    } catch (error) {
      logger.error(
        `[AgentRegistry] Failed to terminate instance ${id}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Clean up terminated instances from memory.
   * Instances older than the specified max age are removed from the in-memory map.
   * Database records are preserved.
   *
   * @param {number} [maxAgeMs=3600000] - Maximum age in milliseconds (default: 1 hour)
   * @returns {{ cleaned: number }}
   */
  cleanupTerminatedInstances(maxAgeMs = 3600000) {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, instance] of this._activeInstances) {
      if (instance.state !== 'running') {
        const age = now - (instance.completedAt || instance.createdAt);
        if (age > maxAgeMs) {
          this._activeInstances.delete(id);
          this._instanceStats.delete(id);
          cleaned++;
        }
      }
    }

    if (cleaned > 0) {
      logger.info(
        `[AgentRegistry] Cleaned up ${cleaned} terminated instances`
      );
    }

    return { cleaned };
  }

  // ============================================================
  // Performance Statistics
  // ============================================================

  /**
   * Get aggregated performance statistics from the agent_task_history table.
   * Groups results by template type and provides success rates, durations,
   * and token usage.
   *
   * @param {Object} [options={}] - Query options
   * @param {number} [options.since] - Only include tasks after this timestamp
   * @param {string} [options.type] - Filter by specific template type
   * @param {number} [options.limit=100] - Maximum records to aggregate
   * @returns {Promise<Object>} Aggregated performance statistics
   */
  async getPerformanceStats(options = {}) {
    try {
      const db = this.database.getDatabase();

      // Build query conditions
      const conditions = ['completed_at IS NOT NULL'];
      const params = [];

      if (options.since) {
        conditions.push('started_at >= ?');
        params.push(options.since);
      }

      if (options.type) {
        conditions.push('template_type = ?');
        params.push(options.type);
      }

      const whereClause = conditions.length > 0
        ? `WHERE ${conditions.join(' AND ')}`
        : '';

      // Aggregate by template type
      const byType = db
        .prepare(
          `SELECT
            template_type,
            COUNT(*) as total,
            SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes,
            SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failures,
            AVG(completed_at - started_at) as avg_duration_ms,
            MIN(completed_at - started_at) as min_duration_ms,
            MAX(completed_at - started_at) as max_duration_ms,
            SUM(tokens_used) as total_tokens,
            AVG(tokens_used) as avg_tokens
          FROM agent_task_history
          ${whereClause}
          GROUP BY template_type
          ORDER BY total DESC`
        )
        .all(...params);

      // Overall aggregation
      const overall = db
        .prepare(
          `SELECT
            COUNT(*) as total,
            SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes,
            SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failures,
            AVG(completed_at - started_at) as avg_duration_ms,
            SUM(tokens_used) as total_tokens
          FROM agent_task_history
          ${whereClause}`
        )
        .get(...params);

      return {
        overall: {
          totalTasks: overall.total || 0,
          successes: overall.successes || 0,
          failures: overall.failures || 0,
          successRate:
            overall.total > 0
              ? ((overall.successes / overall.total) * 100).toFixed(2) + '%'
              : 'N/A',
          avgDurationMs: overall.avg_duration_ms
            ? Math.round(overall.avg_duration_ms)
            : null,
          totalTokens: overall.total_tokens || 0,
        },
        byType: byType.map((row) => ({
          type: row.template_type,
          total: row.total,
          successes: row.successes || 0,
          failures: row.failures || 0,
          successRate:
            row.total > 0
              ? ((row.successes / row.total) * 100).toFixed(2) + '%'
              : 'N/A',
          avgDurationMs: row.avg_duration_ms
            ? Math.round(row.avg_duration_ms)
            : null,
          minDurationMs: row.min_duration_ms
            ? Math.round(row.min_duration_ms)
            : null,
          maxDurationMs: row.max_duration_ms
            ? Math.round(row.max_duration_ms)
            : null,
          totalTokens: row.total_tokens || 0,
          avgTokens: row.avg_tokens ? Math.round(row.avg_tokens) : null,
        })),
        activeInstances: this.getActiveInstances().length,
        registeredTypes: this._agentTypes.size,
      };
    } catch (error) {
      logger.error(
        '[AgentRegistry] Failed to get performance stats:',
        error
      );
      throw error;
    }
  }

  /**
   * Get overall agent system statistics.
   * Combines in-memory instance data with persisted task history.
   *
   * @returns {Promise<Object>} System statistics
   */
  async getStatistics() {
    try {
      const db = this.database.getDatabase();

      // In-memory stats
      const activeInstances = [];
      const completedInstances = [];
      const failedInstances = [];

      for (const instance of this._activeInstances.values()) {
        switch (instance.state) {
          case 'running':
            activeInstances.push(instance);
            break;
          case 'completed':
            completedInstances.push(instance);
            break;
          case 'failed':
            failedInstances.push(instance);
            break;
        }
      }

      // Database stats
      const dbStats = db
        .prepare(
          `SELECT
            COUNT(*) as total_tasks,
            SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful,
            SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed,
            SUM(CASE WHEN completed_at IS NULL THEN 1 ELSE 0 END) as pending,
            SUM(tokens_used) as total_tokens
          FROM agent_task_history`
        )
        .get();

      // Type distribution
      const typeDistribution = db
        .prepare(
          `SELECT template_type, COUNT(*) as count
           FROM agent_task_history
           GROUP BY template_type
           ORDER BY count DESC`
        )
        .all();

      // Recent activity (last 24 hours)
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
      const recentActivity = db
        .prepare(
          `SELECT COUNT(*) as count
           FROM agent_task_history
           WHERE started_at >= ?`
        )
        .get(oneDayAgo);

      return {
        registeredTypes: this._agentTypes.size,
        types: Array.from(this._agentTypes.keys()),
        instances: {
          active: activeInstances.length,
          completed: completedInstances.length,
          failed: failedInstances.length,
          totalInMemory: this._activeInstances.size,
        },
        history: {
          totalTasks: dbStats.total_tasks || 0,
          successful: dbStats.successful || 0,
          failed: dbStats.failed || 0,
          pending: dbStats.pending || 0,
          totalTokens: dbStats.total_tokens || 0,
          successRate:
            dbStats.total_tasks > 0 && dbStats.successful !== null
              ? (
                  (dbStats.successful /
                    (dbStats.total_tasks - (dbStats.pending || 0))) *
                  100
                ).toFixed(2) + '%'
              : 'N/A',
        },
        typeDistribution: typeDistribution.map((r) => ({
          type: r.template_type,
          count: r.count,
        })),
        recentActivity: {
          last24Hours: recentActivity.count || 0,
        },
      };
    } catch (error) {
      logger.error('[AgentRegistry] Failed to get statistics:', error);
      throw error;
    }
  }

  // ============================================================
  // Helper Methods
  // ============================================================

  /**
   * Count active instances of a given type.
   * @private
   * @param {string} type - Agent type
   * @returns {number} Count of running instances
   */
  _countActiveByType(type) {
    let count = 0;
    for (const instance of this._activeInstances.values()) {
      if (instance.type === type && instance.state === 'running') {
        count++;
      }
    }
    return count;
  }
}

module.exports = { AgentRegistry };

/**
 * Workflow Storage - Database persistence for browser workflows
 *
 * @module browser/workflow/workflow-storage
 * @author ChainlessChain Team
 * @since v0.30.0
 */

const { v4: uuidv4 } = require('uuid');
const { logger } = require('../../utils/logger');

/**
 * Workflow Storage class for database operations
 */
class WorkflowStorage {
  constructor(db) {
    this.db = db;
  }

  // ==================== Workflow CRUD ====================

  /**
   * Create a new workflow
   * @param {Object} workflow - Workflow data
   * @returns {Object} Created workflow with ID
   */
  async createWorkflow(workflow) {
    const id = workflow.id || uuidv4();
    const now = Date.now();

    const sql = `
      INSERT INTO browser_workflows (
        id, name, description, steps, variables, triggers, tags,
        is_template, is_enabled, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      id,
      workflow.name,
      workflow.description || null,
      JSON.stringify(workflow.steps || []),
      JSON.stringify(workflow.variables || {}),
      JSON.stringify(workflow.triggers || []),
      JSON.stringify(workflow.tags || []),
      workflow.isTemplate ? 1 : 0,
      workflow.isEnabled !== false ? 1 : 0,
      workflow.createdBy || null,
      now,
      now
    ];

    try {
      this.db.run(sql, params);
      logger.info('[WorkflowStorage] Workflow created', { id, name: workflow.name });

      return {
        id,
        ...workflow,
        steps: workflow.steps || [],
        variables: workflow.variables || {},
        triggers: workflow.triggers || [],
        tags: workflow.tags || [],
        isTemplate: workflow.isTemplate || false,
        isEnabled: workflow.isEnabled !== false,
        usageCount: 0,
        successCount: 0,
        createdAt: now,
        updatedAt: now
      };
    } catch (error) {
      logger.error('[WorkflowStorage] Failed to create workflow', { error: error.message });
      throw error;
    }
  }

  /**
   * Get workflow by ID
   * @param {string} id - Workflow ID
   * @returns {Object|null} Workflow or null
   */
  async getWorkflow(id) {
    const sql = `SELECT * FROM browser_workflows WHERE id = ?`;

    try {
      const stmt = this.db.prepare(sql);
      stmt.bind([id]);

      if (stmt.step()) {
        const row = stmt.getAsObject();
        stmt.free();
        return this._deserializeWorkflow(row);
      }

      stmt.free();
      return null;
    } catch (error) {
      logger.error('[WorkflowStorage] Failed to get workflow', { id, error: error.message });
      throw error;
    }
  }

  /**
   * List workflows with optional filters
   * @param {Object} options - Filter options
   * @returns {Array} List of workflows
   */
  async listWorkflows(options = {}) {
    const {
      isTemplate,
      isEnabled,
      tags,
      search,
      limit = 100,
      offset = 0,
      orderBy = 'updated_at',
      orderDir = 'DESC'
    } = options;

    let sql = `SELECT * FROM browser_workflows WHERE 1=1`;
    const params = [];

    if (isTemplate !== undefined) {
      sql += ` AND is_template = ?`;
      params.push(isTemplate ? 1 : 0);
    }

    if (isEnabled !== undefined) {
      sql += ` AND is_enabled = ?`;
      params.push(isEnabled ? 1 : 0);
    }

    if (search) {
      sql += ` AND (name LIKE ? OR description LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }

    if (tags && tags.length > 0) {
      // Match any tag
      const tagConditions = tags.map(() => `tags LIKE ?`).join(' OR ');
      sql += ` AND (${tagConditions})`;
      tags.forEach(tag => params.push(`%"${tag}"%`));
    }

    // Validate orderBy to prevent SQL injection
    const validColumns = ['updated_at', 'created_at', 'name', 'usage_count', 'last_executed_at'];
    const safeOrderBy = validColumns.includes(orderBy) ? orderBy : 'updated_at';
    const safeOrderDir = orderDir.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    sql += ` ORDER BY ${safeOrderBy} ${safeOrderDir} LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    try {
      const stmt = this.db.prepare(sql);
      stmt.bind(params);

      const workflows = [];
      while (stmt.step()) {
        workflows.push(this._deserializeWorkflow(stmt.getAsObject()));
      }
      stmt.free();

      return workflows;
    } catch (error) {
      logger.error('[WorkflowStorage] Failed to list workflows', { error: error.message });
      throw error;
    }
  }

  /**
   * Update workflow
   * @param {string} id - Workflow ID
   * @param {Object} updates - Fields to update
   * @returns {Object} Updated workflow
   */
  async updateWorkflow(id, updates) {
    const allowed = ['name', 'description', 'steps', 'variables', 'triggers',
                     'tags', 'isTemplate', 'isEnabled'];
    const setClauses = [];
    const params = [];

    for (const key of allowed) {
      if (updates[key] !== undefined) {
        const dbKey = this._toSnakeCase(key);
        if (['steps', 'variables', 'triggers', 'tags'].includes(key)) {
          setClauses.push(`${dbKey} = ?`);
          params.push(JSON.stringify(updates[key]));
        } else if (['isTemplate', 'isEnabled'].includes(key)) {
          setClauses.push(`${dbKey} = ?`);
          params.push(updates[key] ? 1 : 0);
        } else {
          setClauses.push(`${dbKey} = ?`);
          params.push(updates[key]);
        }
      }
    }

    if (setClauses.length === 0) {
      return this.getWorkflow(id);
    }

    setClauses.push('updated_at = ?');
    params.push(Date.now());
    params.push(id);

    const sql = `UPDATE browser_workflows SET ${setClauses.join(', ')} WHERE id = ?`;

    try {
      this.db.run(sql, params);
      logger.info('[WorkflowStorage] Workflow updated', { id });
      return this.getWorkflow(id);
    } catch (error) {
      logger.error('[WorkflowStorage] Failed to update workflow', { id, error: error.message });
      throw error;
    }
  }

  /**
   * Delete workflow
   * @param {string} id - Workflow ID
   * @returns {boolean} Success
   */
  async deleteWorkflow(id) {
    const sql = `DELETE FROM browser_workflows WHERE id = ?`;

    try {
      this.db.run(sql, [id]);
      logger.info('[WorkflowStorage] Workflow deleted', { id });
      return true;
    } catch (error) {
      logger.error('[WorkflowStorage] Failed to delete workflow', { id, error: error.message });
      throw error;
    }
  }

  /**
   * Duplicate workflow
   * @param {string} id - Source workflow ID
   * @param {string} newName - Name for the duplicate
   * @returns {Object} New workflow
   */
  async duplicateWorkflow(id, newName) {
    const source = await this.getWorkflow(id);
    if (!source) {
      throw new Error(`Workflow ${id} not found`);
    }

    return this.createWorkflow({
      name: newName || `${source.name} (Copy)`,
      description: source.description,
      steps: source.steps,
      variables: source.variables,
      triggers: [], // Don't copy triggers
      tags: source.tags,
      isTemplate: false,
      isEnabled: true
    });
  }

  // ==================== Execution Records ====================

  /**
   * Create execution record
   * @param {Object} execution - Execution data
   * @returns {Object} Created execution
   */
  async createExecution(execution) {
    const id = execution.id || uuidv4();
    const now = Date.now();

    const sql = `
      INSERT INTO browser_workflow_executions (
        id, workflow_id, workflow_name, target_id, status,
        variables_snapshot, total_steps, started_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      id,
      execution.workflowId,
      execution.workflowName || null,
      execution.targetId || null,
      execution.status || 'pending',
      JSON.stringify(execution.variables || {}),
      execution.totalSteps || 0,
      now
    ];

    try {
      this.db.run(sql, params);
      logger.info('[WorkflowStorage] Execution created', { id, workflowId: execution.workflowId });

      return {
        id,
        workflowId: execution.workflowId,
        workflowName: execution.workflowName,
        targetId: execution.targetId,
        status: 'pending',
        variablesSnapshot: execution.variables || {},
        results: [],
        currentStep: 0,
        totalSteps: execution.totalSteps || 0,
        startedAt: now
      };
    } catch (error) {
      logger.error('[WorkflowStorage] Failed to create execution', { error: error.message });
      throw error;
    }
  }

  /**
   * Update execution record
   * @param {string} id - Execution ID
   * @param {Object} updates - Fields to update
   * @returns {Object} Updated execution
   */
  async updateExecution(id, updates) {
    const setClauses = [];
    const params = [];

    if (updates.status !== undefined) {
      setClauses.push('status = ?');
      params.push(updates.status);
    }

    if (updates.currentStep !== undefined) {
      setClauses.push('current_step = ?');
      params.push(updates.currentStep);
    }

    if (updates.results !== undefined) {
      setClauses.push('results = ?');
      params.push(JSON.stringify(updates.results));
    }

    if (updates.errorMessage !== undefined) {
      setClauses.push('error_message = ?');
      params.push(updates.errorMessage);
    }

    if (updates.errorStep !== undefined) {
      setClauses.push('error_step = ?');
      params.push(updates.errorStep);
    }

    if (updates.status === 'paused') {
      setClauses.push('paused_at = ?');
      params.push(Date.now());
    }

    if (['completed', 'failed', 'cancelled'].includes(updates.status)) {
      const now = Date.now();
      setClauses.push('completed_at = ?');
      params.push(now);

      // Calculate duration
      const execution = await this.getExecution(id);
      if (execution) {
        setClauses.push('duration = ?');
        params.push(now - execution.startedAt);
      }
    }

    if (updates.retryCount !== undefined) {
      setClauses.push('retry_count = ?');
      params.push(updates.retryCount);
    }

    if (setClauses.length === 0) {
      return this.getExecution(id);
    }

    params.push(id);
    const sql = `UPDATE browser_workflow_executions SET ${setClauses.join(', ')} WHERE id = ?`;

    try {
      this.db.run(sql, params);
      return this.getExecution(id);
    } catch (error) {
      logger.error('[WorkflowStorage] Failed to update execution', { id, error: error.message });
      throw error;
    }
  }

  /**
   * Get execution by ID
   * @param {string} id - Execution ID
   * @returns {Object|null} Execution or null
   */
  async getExecution(id) {
    const sql = `SELECT * FROM browser_workflow_executions WHERE id = ?`;

    try {
      const stmt = this.db.prepare(sql);
      stmt.bind([id]);

      if (stmt.step()) {
        const row = stmt.getAsObject();
        stmt.free();
        return this._deserializeExecution(row);
      }

      stmt.free();
      return null;
    } catch (error) {
      logger.error('[WorkflowStorage] Failed to get execution', { id, error: error.message });
      throw error;
    }
  }

  /**
   * List executions with filters
   * @param {Object} options - Filter options
   * @returns {Array} List of executions
   */
  async listExecutions(options = {}) {
    const { workflowId, status, limit = 50, offset = 0 } = options;

    let sql = `SELECT * FROM browser_workflow_executions WHERE 1=1`;
    const params = [];

    if (workflowId) {
      sql += ` AND workflow_id = ?`;
      params.push(workflowId);
    }

    if (status) {
      sql += ` AND status = ?`;
      params.push(status);
    }

    sql += ` ORDER BY started_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    try {
      const stmt = this.db.prepare(sql);
      stmt.bind(params);

      const executions = [];
      while (stmt.step()) {
        executions.push(this._deserializeExecution(stmt.getAsObject()));
      }
      stmt.free();

      return executions;
    } catch (error) {
      logger.error('[WorkflowStorage] Failed to list executions', { error: error.message });
      throw error;
    }
  }

  // ==================== Statistics ====================

  /**
   * Update workflow statistics after execution
   * @param {string} workflowId - Workflow ID
   * @param {boolean} success - Whether execution succeeded
   * @param {number} duration - Execution duration
   */
  async updateWorkflowStats(workflowId, success, duration) {
    const workflow = await this.getWorkflow(workflowId);
    if (!workflow) return;

    const usageCount = workflow.usageCount + 1;
    const successCount = success ? workflow.successCount + 1 : workflow.successCount;

    // Calculate running average duration
    const avgDuration = workflow.avgDuration
      ? Math.round((workflow.avgDuration * workflow.usageCount + duration) / usageCount)
      : duration;

    const sql = `
      UPDATE browser_workflows
      SET usage_count = ?, success_count = ?, avg_duration = ?, last_executed_at = ?, updated_at = ?
      WHERE id = ?
    `;

    const now = Date.now();
    try {
      this.db.run(sql, [usageCount, successCount, avgDuration, now, now, workflowId]);
    } catch (error) {
      logger.error('[WorkflowStorage] Failed to update workflow stats', { workflowId, error: error.message });
    }
  }

  /**
   * Get workflow statistics
   * @param {string} workflowId - Workflow ID
   * @returns {Object} Statistics
   */
  async getWorkflowStats(workflowId) {
    const workflow = await this.getWorkflow(workflowId);
    if (!workflow) return null;

    // Get recent execution stats
    const recentSql = `
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        AVG(duration) as avgDuration
      FROM browser_workflow_executions
      WHERE workflow_id = ? AND started_at > ?
    `;

    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    try {
      const stmt = this.db.prepare(recentSql);
      stmt.bind([workflowId, oneWeekAgo]);

      let recentStats = { total: 0, completed: 0, failed: 0, avgDuration: 0 };
      if (stmt.step()) {
        recentStats = stmt.getAsObject();
      }
      stmt.free();

      return {
        totalExecutions: workflow.usageCount,
        successRate: workflow.usageCount > 0
          ? (workflow.successCount / workflow.usageCount * 100).toFixed(1)
          : 0,
        avgDuration: workflow.avgDuration,
        lastExecutedAt: workflow.lastExecutedAt,
        recentWeek: {
          total: recentStats.total || 0,
          completed: recentStats.completed || 0,
          failed: recentStats.failed || 0,
          avgDuration: Math.round(recentStats.avgDuration || 0)
        }
      };
    } catch (error) {
      logger.error('[WorkflowStorage] Failed to get workflow stats', { workflowId, error: error.message });
      throw error;
    }
  }

  // ==================== Import/Export ====================

  /**
   * Export workflow to JSON
   * @param {string} id - Workflow ID
   * @returns {Object} Exportable workflow data
   */
  async exportWorkflow(id) {
    const workflow = await this.getWorkflow(id);
    if (!workflow) {
      throw new Error(`Workflow ${id} not found`);
    }

    // Remove internal fields
    const { usageCount, successCount, lastExecutedAt, avgDuration, createdAt, updatedAt, ...exportData } = workflow;

    return {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      workflow: exportData
    };
  }

  /**
   * Import workflow from JSON
   * @param {Object} data - Imported data
   * @param {Object} options - Import options
   * @returns {Object} Created workflow
   */
  async importWorkflow(data, options = {}) {
    if (!data.workflow) {
      throw new Error('Invalid import data: missing workflow');
    }

    const workflow = data.workflow;

    // Generate new ID if not keeping original
    if (!options.keepId) {
      delete workflow.id;
    }

    // Optionally rename
    if (options.newName) {
      workflow.name = options.newName;
    }

    return this.createWorkflow(workflow);
  }

  // ==================== Helper Methods ====================

  _deserializeWorkflow(row) {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      steps: JSON.parse(row.steps || '[]'),
      variables: JSON.parse(row.variables || '{}'),
      triggers: JSON.parse(row.triggers || '[]'),
      tags: JSON.parse(row.tags || '[]'),
      isTemplate: row.is_template === 1,
      isEnabled: row.is_enabled === 1,
      usageCount: row.usage_count || 0,
      successCount: row.success_count || 0,
      lastExecutedAt: row.last_executed_at,
      avgDuration: row.avg_duration,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  _deserializeExecution(row) {
    return {
      id: row.id,
      workflowId: row.workflow_id,
      workflowName: row.workflow_name,
      targetId: row.target_id,
      status: row.status,
      variablesSnapshot: JSON.parse(row.variables_snapshot || '{}'),
      results: JSON.parse(row.results || '[]'),
      currentStep: row.current_step || 0,
      totalSteps: row.total_steps || 0,
      errorMessage: row.error_message,
      errorStep: row.error_step,
      retryCount: row.retry_count || 0,
      startedAt: row.started_at,
      pausedAt: row.paused_at,
      completedAt: row.completed_at,
      duration: row.duration
    };
  }

  _toSnakeCase(str) {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }
}

module.exports = { WorkflowStorage };

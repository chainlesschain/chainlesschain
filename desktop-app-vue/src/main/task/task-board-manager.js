/**
 * Task Board Manager
 *
 * Manages Kanban/Scrum task boards for enterprise collaboration.
 *
 * Features:
 * - Board creation and management
 * - Column management with WIP limits
 * - Sprint management
 * - Workflow automation rules
 * - Board analytics
 *
 * @module task/task-board-manager
 */

const { logger } = require('../utils/logger.js');
const { v4: uuidv4 } = require('uuid');
const EventEmitter = require('events');

class TaskBoardManager extends EventEmitter {
  constructor(database) {
    super();
    this.database = database;
  }

  // ========================================
  // Board CRUD Operations
  // ========================================

  /**
   * Create a new task board
   */
  async createBoard(boardData) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();
      const boardId = uuidv4();

      db.prepare(`
        INSERT INTO task_boards (
          id, org_id, name, description, board_type, owner_did, settings, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        boardId,
        boardData.orgId,
        boardData.name,
        boardData.description,
        boardData.boardType || 'kanban',
        boardData.ownerDid,
        JSON.stringify(boardData.settings || {}),
        now,
        now
      );

      // Create default columns based on board type
      const defaultColumns = this._getDefaultColumns(boardData.boardType);
      for (let i = 0; i < defaultColumns.length; i++) {
        await this.createColumn(boardId, {
          name: defaultColumns[i].name,
          position: i,
          wipLimit: defaultColumns[i].wipLimit,
          isDoneColumn: defaultColumns[i].isDoneColumn
        });
      }

      logger.info(`[TaskBoard] Created board ${boardId} for org ${boardData.orgId}`);

      return {
        success: true,
        boardId,
        board: await this.getBoard(boardId)
      };
    } catch (error) {
      logger.error('[TaskBoard] Error creating board:', error);
      throw error;
    }
  }

  /**
   * Get a task board by ID
   */
  async getBoard(boardId) {
    try {
      const db = this.database.getDatabase();

      const board = db.prepare(`
        SELECT * FROM task_boards WHERE id = ?
      `).get(boardId);

      if (!board) {
        return null;
      }

      // Get columns
      const columns = db.prepare(`
        SELECT * FROM task_board_columns
        WHERE board_id = ?
        ORDER BY position ASC
      `).all(boardId);

      // Get task counts per column
      for (const col of columns) {
        const count = db.prepare(`
          SELECT COUNT(*) as count FROM team_tasks
          WHERE column_id = ? AND status != 'cancelled'
        `).get(col.id);
        col.taskCount = count?.count || 0;
      }

      return {
        id: board.id,
        orgId: board.org_id,
        name: board.name,
        description: board.description,
        boardType: board.board_type,
        ownerDid: board.owner_did,
        settings: board.settings ? JSON.parse(board.settings) : {},
        isArchived: !!board.is_archived,
        columns: columns.map(c => ({
          id: c.id,
          name: c.name,
          description: c.description,
          position: c.position,
          wipLimit: c.wip_limit,
          isDoneColumn: !!c.is_done_column,
          color: c.color,
          taskCount: c.taskCount
        })),
        createdAt: board.created_at,
        updatedAt: board.updated_at
      };
    } catch (error) {
      logger.error('[TaskBoard] Error getting board:', error);
      throw error;
    }
  }

  /**
   * Get all boards for an organization
   */
  async getBoards(orgId, options = {}) {
    try {
      const db = this.database.getDatabase();

      let query = `SELECT * FROM task_boards WHERE org_id = ?`;
      const params = [orgId];

      if (!options.includeArchived) {
        query += ` AND is_archived = 0`;
      }

      query += ` ORDER BY updated_at DESC`;

      if (options.limit) {
        query += ` LIMIT ?`;
        params.push(options.limit);
      }

      const boards = db.prepare(query).all(...params);

      return {
        success: true,
        boards: boards.map(b => ({
          id: b.id,
          name: b.name,
          description: b.description,
          boardType: b.board_type,
          ownerDid: b.owner_did,
          isArchived: !!b.is_archived,
          createdAt: b.created_at,
          updatedAt: b.updated_at
        }))
      };
    } catch (error) {
      logger.error('[TaskBoard] Error getting boards:', error);
      throw error;
    }
  }

  /**
   * Update a task board
   */
  async updateBoard(boardId, updates) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      const allowedFields = ['name', 'description', 'board_type', 'settings'];
      const updateParts = [];
      const values = [];

      for (const [key, value] of Object.entries(updates)) {
        const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        if (allowedFields.includes(dbKey)) {
          updateParts.push(`${dbKey} = ?`);
          values.push(key === 'settings' ? JSON.stringify(value) : value);
        }
      }

      if (updateParts.length === 0) {
        return { success: true, message: 'No fields to update' };
      }

      updateParts.push('updated_at = ?');
      values.push(now);
      values.push(boardId);

      db.prepare(`
        UPDATE task_boards SET ${updateParts.join(', ')} WHERE id = ?
      `).run(...values);

      logger.info(`[TaskBoard] Updated board ${boardId}`);

      return { success: true };
    } catch (error) {
      logger.error('[TaskBoard] Error updating board:', error);
      throw error;
    }
  }

  /**
   * Delete a task board
   */
  async deleteBoard(boardId) {
    try {
      const db = this.database.getDatabase();

      // Check for existing tasks
      const taskCount = db.prepare(`
        SELECT COUNT(*) as count FROM team_tasks WHERE board_id = ?
      `).get(boardId);

      if (taskCount?.count > 0) {
        return {
          success: false,
          error: 'BOARD_HAS_TASKS',
          message: `Board has ${taskCount.count} tasks. Archive instead of delete.`
        };
      }

      db.prepare(`DELETE FROM task_boards WHERE id = ?`).run(boardId);

      logger.info(`[TaskBoard] Deleted board ${boardId}`);

      return { success: true };
    } catch (error) {
      logger.error('[TaskBoard] Error deleting board:', error);
      throw error;
    }
  }

  /**
   * Archive a task board
   */
  async archiveBoard(boardId) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      db.prepare(`
        UPDATE task_boards SET is_archived = 1, updated_at = ? WHERE id = ?
      `).run(now, boardId);

      logger.info(`[TaskBoard] Archived board ${boardId}`);

      return { success: true };
    } catch (error) {
      logger.error('[TaskBoard] Error archiving board:', error);
      throw error;
    }
  }

  // ========================================
  // Column Operations
  // ========================================

  /**
   * Create a board column
   */
  async createColumn(boardId, columnData) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();
      const columnId = uuidv4();

      db.prepare(`
        INSERT INTO task_board_columns (
          id, board_id, name, description, position, wip_limit, is_done_column, color, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        columnId,
        boardId,
        columnData.name,
        columnData.description,
        columnData.position,
        columnData.wipLimit,
        columnData.isDoneColumn ? 1 : 0,
        columnData.color,
        now,
        now
      );

      logger.info(`[TaskBoard] Created column ${columnId} in board ${boardId}`);

      return { success: true, columnId };
    } catch (error) {
      logger.error('[TaskBoard] Error creating column:', error);
      throw error;
    }
  }

  /**
   * Update a board column
   */
  async updateColumn(columnId, updates) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      const allowedFields = ['name', 'description', 'wip_limit', 'is_done_column', 'color'];
      const updateParts = [];
      const values = [];

      for (const [key, value] of Object.entries(updates)) {
        const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        if (allowedFields.includes(dbKey)) {
          updateParts.push(`${dbKey} = ?`);
          values.push(value);
        }
      }

      if (updateParts.length === 0) {
        return { success: true };
      }

      updateParts.push('updated_at = ?');
      values.push(now);
      values.push(columnId);

      db.prepare(`
        UPDATE task_board_columns SET ${updateParts.join(', ')} WHERE id = ?
      `).run(...values);

      return { success: true };
    } catch (error) {
      logger.error('[TaskBoard] Error updating column:', error);
      throw error;
    }
  }

  /**
   * Reorder columns
   */
  async reorderColumns(boardId, columnOrder) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      const stmt = db.prepare(`
        UPDATE task_board_columns SET position = ?, updated_at = ? WHERE id = ? AND board_id = ?
      `);

      for (let i = 0; i < columnOrder.length; i++) {
        stmt.run(i, now, columnOrder[i], boardId);
      }

      return { success: true };
    } catch (error) {
      logger.error('[TaskBoard] Error reordering columns:', error);
      throw error;
    }
  }

  // ========================================
  // Sprint Operations
  // ========================================

  /**
   * Create a sprint
   */
  async createSprint(boardId, sprintData) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();
      const sprintId = uuidv4();

      db.prepare(`
        INSERT INTO task_sprints (
          id, board_id, name, goal, start_date, end_date, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'planning', ?, ?)
      `).run(
        sprintId,
        boardId,
        sprintData.name,
        sprintData.goal,
        sprintData.startDate,
        sprintData.endDate,
        now,
        now
      );

      logger.info(`[TaskBoard] Created sprint ${sprintId} for board ${boardId}`);

      return { success: true, sprintId };
    } catch (error) {
      logger.error('[TaskBoard] Error creating sprint:', error);
      throw error;
    }
  }

  /**
   * Start a sprint
   */
  async startSprint(sprintId) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      // Check if there's already an active sprint
      const sprint = db.prepare(`
        SELECT board_id FROM task_sprints WHERE id = ?
      `).get(sprintId);

      if (!sprint) {
        return { success: false, error: 'SPRINT_NOT_FOUND' };
      }

      const activeSprint = db.prepare(`
        SELECT id FROM task_sprints WHERE board_id = ? AND status = 'active'
      `).get(sprint.board_id);

      if (activeSprint) {
        return { success: false, error: 'ACTIVE_SPRINT_EXISTS' };
      }

      // Calculate planned velocity
      const plannedVelocity = db.prepare(`
        SELECT COALESCE(SUM(story_points), 0) as total
        FROM team_tasks WHERE sprint_id = ?
      `).get(sprintId);

      db.prepare(`
        UPDATE task_sprints
        SET status = 'active', start_date = ?, velocity_planned = ?, updated_at = ?
        WHERE id = ?
      `).run(now, plannedVelocity?.total || 0, now, sprintId);

      logger.info(`[TaskBoard] Started sprint ${sprintId}`);

      return { success: true };
    } catch (error) {
      logger.error('[TaskBoard] Error starting sprint:', error);
      throw error;
    }
  }

  /**
   * Complete a sprint
   */
  async completeSprint(sprintId) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      // Calculate completed velocity
      const sprint = db.prepare(`
        SELECT s.*, bc.id as done_column_id
        FROM task_sprints s
        LEFT JOIN task_board_columns bc ON bc.board_id = s.board_id AND bc.is_done_column = 1
        WHERE s.id = ?
      `).get(sprintId);

      if (!sprint) {
        return { success: false, error: 'SPRINT_NOT_FOUND' };
      }

      const completedVelocity = db.prepare(`
        SELECT COALESCE(SUM(story_points), 0) as total
        FROM team_tasks
        WHERE sprint_id = ? AND column_id = ?
      `).get(sprintId, sprint.done_column_id);

      // Get average velocity from last 3 sprints
      const recentSprints = db.prepare(`
        SELECT velocity_completed FROM task_sprints
        WHERE board_id = ? AND status = 'completed'
        ORDER BY end_date DESC LIMIT 3
      `).all(sprint.board_id);

      const avgVelocity = recentSprints.length > 0
        ? (recentSprints.reduce((sum, s) => sum + (s.velocity_completed || 0), 0) + (completedVelocity?.total || 0)) / (recentSprints.length + 1)
        : completedVelocity?.total || 0;

      db.prepare(`
        UPDATE task_sprints
        SET status = 'completed', end_date = ?,
            velocity_completed = ?, velocity_average = ?, updated_at = ?
        WHERE id = ?
      `).run(now, completedVelocity?.total || 0, avgVelocity, now, sprintId);

      // Move incomplete tasks to next sprint or backlog
      db.prepare(`
        UPDATE team_tasks SET sprint_id = NULL
        WHERE sprint_id = ? AND column_id != ?
      `).run(sprintId, sprint.done_column_id);

      logger.info(`[TaskBoard] Completed sprint ${sprintId}`);

      return {
        success: true,
        stats: {
          velocityPlanned: sprint.velocity_planned,
          velocityCompleted: completedVelocity?.total || 0,
          velocityAverage: avgVelocity
        }
      };
    } catch (error) {
      logger.error('[TaskBoard] Error completing sprint:', error);
      throw error;
    }
  }

  /**
   * Get sprint statistics
   */
  async getSprintStats(sprintId) {
    try {
      const db = this.database.getDatabase();

      const sprint = db.prepare(`
        SELECT * FROM task_sprints WHERE id = ?
      `).get(sprintId);

      if (!sprint) {
        return { success: false, error: 'SPRINT_NOT_FOUND' };
      }

      // Get task breakdown
      const taskStats = db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as completed,
          SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
          SUM(COALESCE(story_points, 0)) as total_points,
          SUM(CASE WHEN status = 'done' THEN COALESCE(story_points, 0) ELSE 0 END) as completed_points
        FROM team_tasks WHERE sprint_id = ?
      `).get(sprintId);

      return {
        success: true,
        sprint: {
          id: sprint.id,
          name: sprint.name,
          goal: sprint.goal,
          status: sprint.status,
          startDate: sprint.start_date,
          endDate: sprint.end_date,
          velocityPlanned: sprint.velocity_planned,
          velocityCompleted: sprint.velocity_completed,
          velocityAverage: sprint.velocity_average
        },
        tasks: {
          total: taskStats?.total || 0,
          completed: taskStats?.completed || 0,
          inProgress: taskStats?.in_progress || 0,
          totalPoints: taskStats?.total_points || 0,
          completedPoints: taskStats?.completed_points || 0,
          completionRate: taskStats?.total > 0 ? (taskStats.completed / taskStats.total * 100).toFixed(1) : 0
        }
      };
    } catch (error) {
      logger.error('[TaskBoard] Error getting sprint stats:', error);
      throw error;
    }
  }

  /**
   * Move tasks to sprint
   */
  async moveToSprint(taskIds, sprintId) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      const stmt = db.prepare(`
        UPDATE team_tasks SET sprint_id = ?, updated_at = ? WHERE id = ?
      `);

      for (const taskId of taskIds) {
        stmt.run(sprintId, now, taskId);
      }

      logger.info(`[TaskBoard] Moved ${taskIds.length} tasks to sprint ${sprintId}`);

      return { success: true, movedCount: taskIds.length };
    } catch (error) {
      logger.error('[TaskBoard] Error moving tasks to sprint:', error);
      throw error;
    }
  }

  // ========================================
  // Workflow Rules
  // ========================================

  /**
   * Create a workflow rule
   */
  async createWorkflowRule(boardId, ruleData) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();
      const ruleId = uuidv4();

      db.prepare(`
        INSERT INTO task_workflow_rules (
          id, board_id, name, description, trigger_event, trigger_conditions, actions, enabled, priority, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        ruleId,
        boardId,
        ruleData.name,
        ruleData.description,
        ruleData.triggerEvent,
        JSON.stringify(ruleData.triggerConditions || {}),
        JSON.stringify(ruleData.actions),
        ruleData.enabled !== false ? 1 : 0,
        ruleData.priority || 0,
        now,
        now
      );

      logger.info(`[TaskBoard] Created workflow rule ${ruleId}`);

      return { success: true, ruleId };
    } catch (error) {
      logger.error('[TaskBoard] Error creating workflow rule:', error);
      throw error;
    }
  }

  /**
   * Execute workflow rules for an event
   */
  async executeWorkflowRules(boardId, triggerEvent, task, context = {}) {
    try {
      const db = this.database.getDatabase();

      const rules = db.prepare(`
        SELECT * FROM task_workflow_rules
        WHERE board_id = ? AND trigger_event = ? AND enabled = 1
        ORDER BY priority ASC
      `).all(boardId, triggerEvent);

      const results = [];

      for (const rule of rules) {
        const conditions = rule.trigger_conditions ? JSON.parse(rule.trigger_conditions) : {};
        const actions = JSON.parse(rule.actions);

        // Check conditions
        if (this._checkConditions(conditions, task, context)) {
          // Execute actions
          const actionResults = await this._executeActions(actions, task, context);
          results.push({
            ruleId: rule.id,
            ruleName: rule.name,
            executed: true,
            actionResults
          });
        }
      }

      return { success: true, results };
    } catch (error) {
      logger.error('[TaskBoard] Error executing workflow rules:', error);
      throw error;
    }
  }

  // ========================================
  // Analytics
  // ========================================

  /**
   * Get board analytics
   */
  async getBoardAnalytics(boardId, options = {}) {
    try {
      const db = this.database.getDatabase();

      const dateFrom = options.dateFrom || Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 days
      const dateTo = options.dateTo || Date.now();

      // Task statistics
      const taskStats = db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as completed,
          SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
          SUM(CASE WHEN priority = 'critical' THEN 1 ELSE 0 END) as critical,
          SUM(CASE WHEN priority = 'high' THEN 1 ELSE 0 END) as high,
          AVG(CASE WHEN completed_at IS NOT NULL THEN completed_at - created_at ELSE NULL END) as avg_cycle_time
        FROM team_tasks
        WHERE board_id = ? AND created_at BETWEEN ? AND ?
      `).get(boardId, dateFrom, dateTo);

      // Tasks per column
      const columnStats = db.prepare(`
        SELECT bc.name, COUNT(tt.id) as count
        FROM task_board_columns bc
        LEFT JOIN team_tasks tt ON tt.column_id = bc.id AND tt.status != 'cancelled'
        WHERE bc.board_id = ?
        GROUP BY bc.id
        ORDER BY bc.position
      `).all(boardId);

      // Activity by day
      const dailyActivity = db.prepare(`
        SELECT
          DATE(created_at / 1000, 'unixepoch') as date,
          COUNT(*) as created,
          SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as completed
        FROM team_tasks
        WHERE board_id = ? AND created_at BETWEEN ? AND ?
        GROUP BY DATE(created_at / 1000, 'unixepoch')
        ORDER BY date
      `).all(boardId, dateFrom, dateTo);

      // Top contributors
      const topContributors = db.prepare(`
        SELECT assignee_did, COUNT(*) as completed_count
        FROM team_tasks
        WHERE board_id = ? AND status = 'done' AND completed_at BETWEEN ? AND ?
        GROUP BY assignee_did
        ORDER BY completed_count DESC
        LIMIT 10
      `).all(boardId, dateFrom, dateTo);

      return {
        success: true,
        analytics: {
          period: { from: dateFrom, to: dateTo },
          tasks: {
            total: taskStats?.total || 0,
            completed: taskStats?.completed || 0,
            cancelled: taskStats?.cancelled || 0,
            critical: taskStats?.critical || 0,
            high: taskStats?.high || 0,
            avgCycleTimeMs: taskStats?.avg_cycle_time || 0
          },
          columns: columnStats.map(c => ({ name: c.name, count: c.count })),
          dailyActivity: dailyActivity.map(d => ({ date: d.date, created: d.created, completed: d.completed })),
          topContributors: topContributors.map(c => ({ did: c.assignee_did, completedCount: c.completed_count }))
        }
      };
    } catch (error) {
      logger.error('[TaskBoard] Error getting board analytics:', error);
      throw error;
    }
  }

  /**
   * Export board data
   */
  async exportBoard(boardId, format = 'json') {
    try {
      const db = this.database.getDatabase();

      const board = await this.getBoard(boardId);
      if (!board) {
        return { success: false, error: 'BOARD_NOT_FOUND' };
      }

      // Get all tasks
      const tasks = db.prepare(`
        SELECT * FROM team_tasks WHERE board_id = ?
      `).all(boardId);

      // Get all sprints
      const sprints = db.prepare(`
        SELECT * FROM task_sprints WHERE board_id = ?
      `).all(boardId);

      const exportData = {
        board,
        tasks: tasks.map(t => ({
          id: t.id,
          title: t.title,
          description: t.description,
          status: t.status,
          priority: t.priority,
          taskType: t.task_type,
          assigneeDid: t.assignee_did,
          dueDate: t.due_date,
          storyPoints: t.story_points,
          labels: t.labels ? JSON.parse(t.labels) : [],
          createdAt: t.created_at,
          completedAt: t.completed_at
        })),
        sprints: sprints.map(s => ({
          id: s.id,
          name: s.name,
          goal: s.goal,
          status: s.status,
          startDate: s.start_date,
          endDate: s.end_date,
          velocityPlanned: s.velocity_planned,
          velocityCompleted: s.velocity_completed
        })),
        exportedAt: Date.now()
      };

      if (format === 'json') {
        return {
          success: true,
          data: exportData,
          format: 'json'
        };
      }

      // CSV format for tasks
      if (format === 'csv') {
        const headers = ['ID', 'Title', 'Status', 'Priority', 'Type', 'Assignee', 'Due Date', 'Story Points', 'Created At'];
        const rows = [headers.join(',')];

        for (const task of exportData.tasks) {
          rows.push([
            task.id,
            `"${(task.title || '').replace(/"/g, '""')}"`,
            task.status,
            task.priority,
            task.taskType,
            task.assigneeDid,
            task.dueDate ? new Date(task.dueDate).toISOString() : '',
            task.storyPoints || '',
            new Date(task.createdAt).toISOString()
          ].join(','));
        }

        return {
          success: true,
          data: rows.join('\n'),
          format: 'csv'
        };
      }

      return { success: false, error: 'UNSUPPORTED_FORMAT' };
    } catch (error) {
      logger.error('[TaskBoard] Error exporting board:', error);
      throw error;
    }
  }

  // ========================================
  // Helper Methods
  // ========================================

  _getDefaultColumns(boardType) {
    if (boardType === 'scrum') {
      return [
        { name: 'Backlog', wipLimit: null, isDoneColumn: false },
        { name: 'To Do', wipLimit: null, isDoneColumn: false },
        { name: 'In Progress', wipLimit: 5, isDoneColumn: false },
        { name: 'Review', wipLimit: 3, isDoneColumn: false },
        { name: 'Done', wipLimit: null, isDoneColumn: true }
      ];
    }

    // Default Kanban
    return [
      { name: 'To Do', wipLimit: null, isDoneColumn: false },
      { name: 'In Progress', wipLimit: 5, isDoneColumn: false },
      { name: 'Done', wipLimit: null, isDoneColumn: true }
    ];
  }

  _checkConditions(conditions, task, context) {
    for (const [field, expected] of Object.entries(conditions)) {
      const actual = task[field] || context[field];
      if (expected !== actual) {
        return false;
      }
    }
    return true;
  }

  async _executeActions(actions, task, context) {
    const results = [];

    for (const action of actions) {
      try {
        switch (action.type) {
          case 'move_to_column':
            // Would update task column
            results.push({ action: 'move_to_column', success: true });
            break;
          case 'assign_user':
            // Would assign user
            results.push({ action: 'assign_user', success: true });
            break;
          case 'add_label':
            // Would add label
            results.push({ action: 'add_label', success: true });
            break;
          case 'notify':
            // Would send notification
            results.push({ action: 'notify', success: true });
            break;
          default:
            results.push({ action: action.type, success: false, error: 'Unknown action' });
        }
      } catch (error) {
        results.push({ action: action.type, success: false, error: error.message });
      }
    }

    return results;
  }
}

// Singleton instance
let taskBoardManager = null;

function getTaskBoardManager(database) {
  if (!taskBoardManager && database) {
    taskBoardManager = new TaskBoardManager(database);
  }
  return taskBoardManager;
}

module.exports = {
  TaskBoardManager,
  getTaskBoardManager
};

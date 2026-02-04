/**
 * Team Task Manager
 * Handles CRUD operations for team_tasks (board tasks)
 */

const { v4: uuidv4 } = require('uuid');
const { logger } = require('../utils/logger.js');

class TeamTaskManager {
  constructor(database) {
    this.database = database;
  }

  /**
   * Create a team task (board task)
   */
  async createTask(taskData) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();
      const taskId = uuidv4();

      db.prepare(`
        INSERT INTO team_tasks (
          id, board_id, column_id, title, description, priority, status,
          task_type, parent_task_id, assignee_did, reporter_did, due_date,
          start_date, story_points, estimated_hours, actual_hours, labels,
          position, sprint_id, created_at, updated_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        taskId,
        taskData.boardId,
        taskData.columnId,
        taskData.title,
        taskData.description || '',
        taskData.priority || 'medium',
        taskData.status || 'open',
        taskData.taskType || 'task',
        taskData.parentTaskId || null,
        taskData.assigneeDid || null,
        taskData.createdBy || taskData.reporterDid,
        taskData.dueDate || null,
        taskData.startDate || null,
        taskData.storyPoints || null,
        taskData.estimatedHours || null,
        taskData.actualHours || null,
        taskData.labels ? JSON.stringify(taskData.labels) : null,
        taskData.position || 0,
        taskData.sprintId || null,
        now,
        now,
        null
      );

      logger.info('[TeamTaskManager] ✓ Task created:', taskId);

      return {
        success: true,
        taskId,
        task: {
          id: taskId,
          boardId: taskData.boardId,
          columnId: taskData.columnId,
          title: taskData.title,
          description: taskData.description,
          priority: taskData.priority || 'medium',
          status: taskData.status || 'open',
          createdAt: now
        }
      };
    } catch (error) {
      logger.error('[TeamTaskManager] Create task failed:', error);
      throw error;
    }
  }

  /**
   * Get a task by ID
   */
  async getTask(taskId) {
    try {
      const db = this.database.getDatabase();
      const task = db.prepare(`
        SELECT * FROM team_tasks WHERE id = ?
      `).get(taskId);

      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }

      return {
        id: task.id,
        boardId: task.board_id,
        columnId: task.column_id,
        title: task.title,
        description: task.description,
        priority: task.priority,
        status: task.status,
        taskType: task.task_type,
        assigneeDid: task.assignee_did,
        reporterDid: task.reporter_did,
        dueDate: task.due_date,
        estimatedHours: task.estimated_hours,
        actualHours: task.actual_hours,
        createdAt: task.created_at,
        updatedAt: task.updated_at,
        completedAt: task.completed_at
      };
    } catch (error) {
      logger.error('[TeamTaskManager] Get task failed:', error);
      throw error;
    }
  }

  /**
   * Update a task
   */
  async updateTask(taskId, updates, actorDid) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      const updateFields = [];
      const params = [];

      if (updates.title !== undefined) {
        updateFields.push('title = ?');
        params.push(updates.title);
      }
      if (updates.description !== undefined) {
        updateFields.push('description = ?');
        params.push(updates.description);
      }
      if (updates.status !== undefined) {
        updateFields.push('status = ?');
        params.push(updates.status);
        if (updates.status === 'done' || updates.status === 'completed') {
          updateFields.push('completed_at = ?');
          params.push(now);
        }
      }
      if (updates.priority !== undefined) {
        updateFields.push('priority = ?');
        params.push(updates.priority);
      }
      if (updates.assigneeDid !== undefined) {
        updateFields.push('assignee_did = ?');
        params.push(updates.assigneeDid);
      }
      if (updates.dueDate !== undefined) {
        updateFields.push('due_date = ?');
        params.push(updates.dueDate);
      }
      if (updates.estimatedHours !== undefined) {
        updateFields.push('estimated_hours = ?');
        params.push(updates.estimatedHours);
      }
      if (updates.actualHours !== undefined) {
        updateFields.push('actual_hours = ?');
        params.push(updates.actualHours);
      }

      updateFields.push('updated_at = ?');
      params.push(now);

      params.push(taskId);

      db.prepare(`
        UPDATE team_tasks
        SET ${updateFields.join(', ')}
        WHERE id = ?
      `).run(...params);

      logger.info('[TeamTaskManager] ✓ Task updated:', taskId);

      return { success: true, taskId };
    } catch (error) {
      logger.error('[TeamTaskManager] Update task failed:', error);
      throw error;
    }
  }

  /**
   * Move task to different column
   */
  async moveTask(taskId, columnId, position, actorDid) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      db.prepare(`
        UPDATE team_tasks
        SET column_id = ?, position = ?, updated_at = ?
        WHERE id = ?
      `).run(columnId, position || 0, now, taskId);

      logger.info('[TeamTaskManager] ✓ Task moved:', taskId);

      return { success: true, taskId };
    } catch (error) {
      logger.error('[TeamTaskManager] Move task failed:', error);
      throw error;
    }
  }

  /**
   * Delete a task
   */
  async deleteTask(taskId) {
    try {
      const db = this.database.getDatabase();

      db.prepare(`
        DELETE FROM team_tasks WHERE id = ?
      `).run(taskId);

      logger.info('[TeamTaskManager] ✓ Task deleted:', taskId);

      return { success: true, taskId };
    } catch (error) {
      logger.error('[TeamTaskManager] Delete task failed:', error);
      throw error;
    }
  }

  /**
   * Assign task to a user
   */
  async assignTask(taskId, userDid, role, assignedBy) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      // Update task assignee
      db.prepare(`
        UPDATE team_tasks
        SET assignee_did = ?, updated_at = ?
        WHERE id = ?
      `).run(userDid, now, taskId);

      // Add to task_assignees table
      const assigneeId = uuidv4();
      db.prepare(`
        INSERT OR REPLACE INTO task_assignees
        (id, task_id, user_did, role, assigned_at, assigned_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(assigneeId, taskId, userDid, role || 'assignee', now, assignedBy);

      logger.info('[TeamTaskManager] ✓ Task assigned:', taskId, 'to', userDid);

      return { success: true, taskId, assigneeId };
    } catch (error) {
      logger.error('[TeamTaskManager] Assign task failed:', error);
      throw error;
    }
  }

  /**
   * Set task priority
   */
  async setPriority(taskId, priority, actorDid) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      db.prepare(`
        UPDATE team_tasks
        SET priority = ?, updated_at = ?
        WHERE id = ?
      `).run(priority, now, taskId);

      logger.info('[TeamTaskManager] ✓ Task priority set:', taskId, priority);

      return { success: true, taskId };
    } catch (error) {
      logger.error('[TeamTaskManager] Set priority failed:', error);
      throw error;
    }
  }

  /**
   * Set task due date
   */
  async setDueDate(taskId, dueDate, actorDid) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      const dueDateTimestamp = dueDate ? new Date(dueDate).getTime() : null;

      db.prepare(`
        UPDATE team_tasks
        SET due_date = ?, updated_at = ?
        WHERE id = ?
      `).run(dueDateTimestamp, now, taskId);

      logger.info('[TeamTaskManager] ✓ Task due date set:', taskId);

      return { success: true, taskId };
    } catch (error) {
      logger.error('[TeamTaskManager] Set due date failed:', error);
      throw error;
    }
  }
}

// Singleton instance
let teamTaskManagerInstance = null;

function getTeamTaskManager(database) {
  if (!teamTaskManagerInstance) {
    teamTaskManagerInstance = new TeamTaskManager(database);
  }
  return teamTaskManagerInstance;
}

module.exports = {
  TeamTaskManager,
  getTeamTaskManager
};
